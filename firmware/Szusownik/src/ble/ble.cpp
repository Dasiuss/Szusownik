#include "ble.h"
#include "crc32.h"
#include "../storage/storage.h"
#include "../audio/audio.h"
#include "../core/route.h"
#include "../config/config.h"
#include "../config/log.h"
#include <NimBLEDevice.h>
#include <cstring>

static NimBLECharacteristic* chrInfo = nullptr;
static NimBLECharacteristic* chrCtrl = nullptr;
static NimBLECharacteristic* chrData = nullptr;
static NimBLECharacteristic* chrStat = nullptr;
static NimBLECharacteristic* chrRoute = nullptr;

class BleFiles;
static BleFiles* g_bleSelf = nullptr;

// Callbacki serwera tylko ustawiaja flagi (kontekst taska NimBLE). Logi
// wystawiamy w poll() z glownej petli, zeby nie mieszac strumieni Serial.
static volatile bool g_connChanged = false;
static volatile bool g_connected = false;
static volatile bool g_mtuChanged = false;
static volatile uint16_t g_mtu = 0;
static volatile int g_discReason = 0;

class SzBleServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer*, NimBLEConnInfo& info) override {
    g_mtu = info.getMTU();
    g_connected = true;
    g_connChanged = true;
  }
  void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int reason) override {
    g_connected = false;
    g_discReason = reason;
    g_connChanged = true;
  }
  void onMTUChange(uint16_t mtu, NimBLEConnInfo&) override {
    g_mtu = mtu;
    g_mtuChanged = true;
  }
};
static SzBleServerCallbacks szBleCallbacks;

// Komendy CTRL przechodzą przez callback onWrite (kontekst taska hosta NimBLE)
// do kolejki czytanej w pętli głównej. NIE czytamy chrCtrl->getValue() z pętli:
// writeEvent() woła w tasku hosta setValue() (realloc m_value), a getValue() robi
// deepCopy() z rozmiarem czytanym poza sekcją krytyczną, więc równoległy odczyt
// i zapis przepełnia bufor/niszczy stertę ("CORRUPT HEAP" po transferze).
#define SZ_CTRL_Q_SLOTS 8
#define SZ_CTRL_Q_LEN 96
static portMUX_TYPE g_ctrlMux = portMUX_INITIALIZER_UNLOCKED;
static char g_ctrlQ[SZ_CTRL_Q_SLOTS][SZ_CTRL_Q_LEN];
static uint16_t g_ctrlQLen[SZ_CTRL_Q_SLOTS];
static uint16_t g_ctrlHead = 0;  // producent: task hosta NimBLE
static uint16_t g_ctrlTail = 0;  // konsument: pętla główna

class SzCtrlCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c, NimBLEConnInfo&) override {
    std::string v = c->getValue();  // ten sam task, który zmienił m_value — bez wyścigu
    if (v.empty()) return;
    if (v.length() >= SZ_CTRL_Q_LEN) v.resize(SZ_CTRL_Q_LEN - 1);
    portENTER_CRITICAL(&g_ctrlMux);
    uint16_t next = (uint16_t)((g_ctrlHead + 1) % SZ_CTRL_Q_SLOTS);
    if (next != g_ctrlTail) {  // gdy pełna, gubimy nową komendę (pętla nadąża)
      memcpy(g_ctrlQ[g_ctrlHead], v.data(), v.length());
      g_ctrlQ[g_ctrlHead][v.length()] = '\0';
      g_ctrlQLen[g_ctrlHead] = (uint16_t)v.length();
      g_ctrlHead = next;
    }
    portEXIT_CRITICAL(&g_ctrlMux);
  }
};
static SzCtrlCallbacks szCtrlCallbacks;

// Charakterystyka trasy: porcja = [offset u16, totalLen u16, payload...].
class SzRouteCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c, NimBLEConnInfo&) override {
    std::string v = c->getValue();  // ten sam task, który zmienił m_value
    if (g_bleSelf && !v.empty()) {
      g_bleSelf->onRouteWrite(reinterpret_cast<const uint8_t*>(v.data()), v.size());
    }
  }
};
static SzRouteCallbacks szRouteCallbacks;

void BleFiles::begin(Storage* storage) {
  storage_ = storage;
  g_bleSelf = this;
  allocStreamMem();
  NimBLEDevice::init(SZ_BLE_NAME);
  NimBLEDevice::setMTU(517);
  NimBLEServer* srv = NimBLEDevice::createServer();
  srv->setCallbacks(&szBleCallbacks, false);  // obiekt statyczny - nie kasuj
  NimBLEService* svc = srv->createService(SZ_UUID_SVC);
  chrInfo = svc->createCharacteristic(SZ_UUID_INFO, NIMBLE_PROPERTY::READ);
  chrCtrl = svc->createCharacteristic(SZ_UUID_CTRL,
                                      NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  chrCtrl->setCallbacks(&szCtrlCallbacks);
  chrData = svc->createCharacteristic(SZ_UUID_DATA, NIMBLE_PROPERTY::NOTIFY);
  chrStat = svc->createCharacteristic(SZ_UUID_STAT,
                                      NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  chrRoute = svc->createCharacteristic(SZ_UUID_ROUTE,
                                       NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  chrRoute->setCallbacks(&szRouteCallbacks);
  // Rozgrzej pojemność buforów wartości do maksimum, żeby późniejsze setValue()
  // z pętli głównej nie robiło realloc() równolegle z odczytem z taska hosta
  // (ten sam wyścig, który niszczy stertę przy CTRL — patrz SzCtrlCallbacks).
  {
    std::string pad(480, ' ');
    chrInfo->setValue(pad.c_str());
    chrStat->setValue(pad.c_str());
  }
  {
    // Rozgrzej bufor charakterystyki trasy do maksymalnego zapisu, żeby zapis
    // porcji nie robił realloc() równolegle z odczytem z taska hosta.
    std::string pad(ROUTE_BLE_MAX_WRITE, ' ');
    chrRoute->setValue(pad.c_str());
  }
  // Start z kanonicznym pustym blobem (CLEAR): HudRekaw dostanie go, gdy zgłosi
  // inną wersję, a porównanie wersji z PWA działa od pierwszego połączenia.
  routeRawLen_ = static_cast<uint16_t>(routeBuildEmpty(routeRaw_, sizeof(routeRaw_)));
  routeCrc_ = 0;
  if (routeRawLen_ >= ROUTE_CRC_SIZE) {
    const uint8_t* p = routeRaw_ + routeRawLen_ - ROUTE_CRC_SIZE;
    routeCrc_ = static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) |
                (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
  }
  routePoints_ = 0;
  refreshInfo();
  setStatus(SZ_ST_OK);
  svc->start();
  srv->advertiseOnDisconnect(true);  // NimBLE 2.x domyślnie NIE wznawia reklamowania
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  // 128-bit service UUID zajmuje prawie cały pakiet (31 B), więc nazwa nie mieści się
  // w adv i setName() cicho zawodzi -> telefon pokazuje "unrecognized device".
  // Scan response daje osobny pakiet na nazwę.
  adv->enableScanResponse(true);
  adv->addServiceUUID(SZ_UUID_SVC);
  adv->setName(SZ_BLE_NAME);
  adv->start();
  SZ_LOGIF("BLE start name=%s mtu_req=517", SZ_BLE_NAME);
}

bool BleFiles::allocStreamMem() {
  // ~165 KB kompresor + ~31 KB okno ramek -> PSRAM (2 MB), żeby nie zjeść DRAM.
  comp_ = (tdefl_compressor*)ps_malloc(sizeof(tdefl_compressor));
  window_ = (uint8_t(*)[SZ_BLE_FRAME_SIZE])ps_malloc(SZ_BLE_WINDOW * SZ_BLE_FRAME_SIZE);
  windowLen_ = (uint16_t*)ps_malloc(SZ_BLE_WINDOW * sizeof(uint16_t));
  if (!comp_ || !window_ || !windowLen_) {
    SZ_LOGE("BLE PSRAM alloc FAIL (streaming niedostepny)");
    return false;
  }
  memset(windowLen_, 0, SZ_BLE_WINDOW * sizeof(uint16_t));
  SZ_LOGIF("BLE stream mem OK (comp=%u ring=%u w PSRAM)", (unsigned)sizeof(tdefl_compressor),
           (unsigned)(SZ_BLE_WINDOW * SZ_BLE_FRAME_SIZE));
  return true;
}

void BleFiles::refreshInfo() {
  if (!chrInfo) return;
  // INFO celowo małe: pełna lista plików nie mieści się w limicie 512 B atrybutu
  // ATT (Web Bluetooth i tak nie odczyta >512 B), a przekroczenie zeruje wartość
  // w NimBLE. Metadane plików PWA pobiera stronicowanym LIST:<since>.
  String j = "{\"proto\":\"" SZ_WIRE_PROTO "\",\"fw\":\"" SZ_FW_VERSION "\",\"fileCount\":";
  j += String(storage_ ? (unsigned long)storage_->countCsv() : 0UL);
  j += ",\"routeCrc\":";
  j += String((unsigned long)routeCrc_);
  j += ",\"routePoints\":";
  j += String((unsigned)routePoints_);
  if (beeper_) {
    j += ",\"volLow\":";
    j += String(beeper_->volLow());
    j += ",\"volHigh\":";
    j += String(beeper_->volHigh());
    j += ",\"freqShort\":";
    j += String(beeper_->freqShort());
    j += ",\"freqLong\":";
    j += String(beeper_->freqLong());
    j += ",\"beepShortMs\":";
    j += String(beeper_->beepShortMs());
    j += ",\"beepLongMs\":";
    j += String(beeper_->beepLongMs());
    j += ",\"beepGapMs\":";
    j += String(beeper_->beepGapMs());
    j += ",\"signalGapMs\":";
    j += String(beeper_->signalGapMs());
    j += ",\"minBeepKmh\":";
    j += String(beeper_->minBeepKmh());
  }
  j += "}";
  chrInfo->setValue(j.c_str());
  SZ_LOGDF("BLE INFO len=%u stored=%u", (unsigned)j.length(),
           (unsigned)chrInfo->getValue().length());
}

void BleFiles::reportVolume() {
  if (!beeper_) {
    setStatus(SZ_ERR_NO_BEEPER);
    return;
  }
  char msg[48];
  snprintf(msg, sizeof(msg), "vol low=%u high=%u", beeper_->volLow(), beeper_->volHigh());
  refreshInfo();  // INFO niesie volLow/volHigh dla PWA
  setStatus(String(msg));
  SZ_LOGI(msg);
}

void BleFiles::reportFreq() {
  if (!beeper_) {
    setStatus(SZ_ERR_NO_BEEPER);
    return;
  }
  char msg[48];
  snprintf(msg, sizeof(msg), "freq short=%u long=%u", beeper_->freqShort(),
           beeper_->freqLong());
  refreshInfo();  // INFO niesie freqShort/freqLong dla PWA
  setStatus(String(msg));
  SZ_LOGI(msg);
}

void BleFiles::reportTiming() {
  if (!beeper_) {
    setStatus(SZ_ERR_NO_BEEPER);
    return;
  }
  char msg[96];
  snprintf(msg, sizeof(msg), "timing short=%u long=%u gap=%u interval=%u",
           beeper_->beepShortMs(), beeper_->beepLongMs(), beeper_->beepGapMs(),
           beeper_->signalGapMs());
  refreshInfo();  // INFO niesie czasy dla PWA
  setStatus(String(msg));
  SZ_LOGI(msg);
}

void BleFiles::reportMinBeep() {
  if (!beeper_) {
    setStatus(SZ_ERR_NO_BEEPER);
    return;
  }
  char msg[40];
  snprintf(msg, sizeof(msg), "beep min=%u", beeper_->minBeepKmh());
  refreshInfo();
  setStatus(String(msg));
  SZ_LOGI(msg);
}

void BleFiles::setStatus(const String& s) {
  lastError_ = s;
  if (chrStat) {
    chrStat->setValue(s.c_str());
    chrStat->notify();
  }
}

void BleFiles::handleCommand(const String& cmd) {
  if (cmd.startsWith(SZ_CMD_LIST)) {
    // Filtr po nazwie (YYYYMMDD_HHMMSS): zwracamy do SZ_BLE_LIST_MAX najstarszych
    // plików > since. Puste since = od najstarszego. Pusta lista = brak nowych.
    String since = cmd.substring((unsigned int)strlen(SZ_CMD_LIST));
    since.trim();
    StorageEntry entries[SZ_BLE_LIST_MAX];
    uint32_t n = storage_ ? storage_->listCsv(since, SZ_BLE_LIST_MAX, entries) : 0;
    // Echo kursora: PWA czeka na status z DOKŁADNIE swoim `since`. Bez tego
    // pollStatus łapie poprzednią odpowiedź `list ...` (ten sam prefiks) i lista
    // "nie posuwa kursora" (ostatnia nazwa nie rośnie). "0" jest mniejsze od
    // każdej nazwy YYYYMMDD_..., więc reprezentuje puste `since`.
    String msg = SZ_ST_LIST;
    msg += since.length() ? since : String("0");
    for (uint32_t i = 0; i < n; i++) {
      msg += ' ';
      msg += entries[i].name;
      msg += ' ';
      msg += String(entries[i].size);
    }
    setStatus(msg);
  } else if (cmd.startsWith(SZ_CMD_ROTATE)) {
    // Żądanie sync: zamknij bieżący plik, żeby transfer czytał kompletny plik.
    if (storage_) storage_->rotateForSync();
    refreshInfo();
    setStatus(SZ_ST_OK);
  } else if (cmd.startsWith(SZ_CMD_DRYRUN)) {
    String name = cmd.substring((unsigned int)strlen(SZ_CMD_DRYRUN));
    name.trim();
    dryRun(name);
  } else if (cmd.startsWith(SZ_CMD_START_FILE)) {
    String name = cmd.substring((unsigned int)strlen(SZ_CMD_START_FILE));
    name.trim();
    startStream(name);
  } else if (cmd.startsWith(SZ_CMD_STOP)) {
    if (transferring_) abortStream("stopped");
    activeFile_ = "";
    setStatus(SZ_ST_OK);
  } else if (cmd.startsWith(SZ_CMD_ACK)) {
    onAck((uint32_t)cmd.substring((unsigned int)strlen(SZ_CMD_ACK)).toInt());
  } else if (cmd.startsWith(SZ_CMD_NACK)) {
    onNack((uint32_t)cmd.substring((unsigned int)strlen(SZ_CMD_NACK)).toInt());
  } else if (cmd.startsWith(SZ_CMD_SETVOL_LOW)) {
    if (beeper_) {
      beeper_->setVolLow(cmd.substring((unsigned int)strlen(SZ_CMD_SETVOL_LOW)).toInt());  // feedback: sygnał 60
      reportVolume();
    } else {
      setStatus(SZ_ERR_NO_BEEPER);
    }
  } else if (cmd.startsWith(SZ_CMD_SETVOL_HIGH)) {
    if (beeper_) {
      beeper_->setVolHigh(cmd.substring((unsigned int)strlen(SZ_CMD_SETVOL_HIGH)).toInt());  // feedback: sygnał 120
      reportVolume();
    } else {
      setStatus(SZ_ERR_NO_BEEPER);
    }
  } else if (cmd.startsWith(SZ_CMD_SETFREQ_SHORT)) {
    if (beeper_) {
      beeper_->setFreqShort(cmd.substring((unsigned int)strlen(SZ_CMD_SETFREQ_SHORT)).toInt());  // feedback: 1 długi + 2 krótkie
      reportFreq();
    } else {
      setStatus(SZ_ERR_NO_BEEPER);
    }
  } else if (cmd.startsWith(SZ_CMD_SETFREQ_LONG)) {
    if (beeper_) {
      beeper_->setFreqLong(cmd.substring((unsigned int)strlen(SZ_CMD_SETFREQ_LONG)).toInt());  // feedback: 1 długi + 2 krótkie
      reportFreq();
    } else {
      setStatus(SZ_ERR_NO_BEEPER);
    }
  } else if (cmd.startsWith(SZ_CMD_SETTIMING_SHORT)) {
    if (beeper_) {
      beeper_->setBeepShortMs(cmd.substring((unsigned int)strlen(SZ_CMD_SETTIMING_SHORT)).toInt());  // feedback: 3 x sygnał 120
      reportTiming();
    } else {
      setStatus(SZ_ERR_NO_BEEPER);
    }
  } else if (cmd.startsWith(SZ_CMD_SETTIMING_LONG)) {
    if (beeper_) {
      beeper_->setBeepLongMs(cmd.substring((unsigned int)strlen(SZ_CMD_SETTIMING_LONG)).toInt());  // feedback: 3 x sygnał 120
      reportTiming();
    } else {
      setStatus(SZ_ERR_NO_BEEPER);
    }
  } else if (cmd.startsWith(SZ_CMD_SETTIMING_GAP)) {
    if (beeper_) {
      beeper_->setBeepGapMs(cmd.substring((unsigned int)strlen(SZ_CMD_SETTIMING_GAP)).toInt());  // feedback: 3 x sygnał 120
      reportTiming();
    } else {
      setStatus(SZ_ERR_NO_BEEPER);
    }
  } else if (cmd.startsWith(SZ_CMD_SETTIMING_INTERVAL)) {
    if (beeper_) {
      beeper_->setSignalGapMs(cmd.substring((unsigned int)strlen(SZ_CMD_SETTIMING_INTERVAL)).toInt());  // feedback: 3 x sygnał 120
      reportTiming();
    } else {
      setStatus(SZ_ERR_NO_BEEPER);
    }
  } else if (cmd.startsWith(SZ_CMD_SETMINBEEP)) {
    if (beeper_) {
      beeper_->setMinBeepKmh(cmd.substring((unsigned int)strlen(SZ_CMD_SETMINBEEP)).toInt());
      reportMinBeep();
    } else {
      setStatus(SZ_ERR_NO_BEEPER);
    }
  }
}

void BleFiles::poll() {
  if (!chrCtrl) return;
  // Zdarzenia z callbackow (kontekst NimBLE) logujemy tu, w petli glownej.
  if (g_mtuChanged) {
    g_mtuChanged = false;
    mtu_ = g_mtu;
    if (g_connected) SZ_LOGIF("BLE mtu -> %u", (unsigned)g_mtu);
  }
  if (g_connChanged) {
    g_connChanged = false;
    mtu_ = g_mtu;
    if (g_connected) {
      SZ_LOGIF("BLE conn mtu=%u", (unsigned)g_mtu);
    } else {
      SZ_LOGIF("BLE disconn reason=%d", g_discReason);
    }
  }
  // Konsumuj komendy z kolejki onWrite (patrz SzCtrlCallbacks). Nie czytamy
  // chrCtrl->getValue() tutaj — to wyścig ze setValue() w tasku hosta NimBLE.
  while (true) {
    char cmd[SZ_CTRL_Q_LEN];
    uint16_t len;
    portENTER_CRITICAL(&g_ctrlMux);
    if (g_ctrlTail == g_ctrlHead) {
      portEXIT_CRITICAL(&g_ctrlMux);
      break;
    }
    len = g_ctrlQLen[g_ctrlTail];
    memcpy(cmd, g_ctrlQ[g_ctrlTail], len);
    cmd[len] = '\0';
    g_ctrlTail = (uint16_t)((g_ctrlTail + 1) % SZ_CTRL_Q_SLOTS);
    portEXIT_CRITICAL(&g_ctrlMux);
    handleCommand(String(cmd));
  }
  if (routeCommitPending_) commitRoute();
  if (transferring_) pumpStream();
}

void BleFiles::onRouteWrite(const uint8_t* data, size_t len) {
  if (data == nullptr || len < ROUTE_BLE_HEADER_SIZE) return;
  if (routeCommitPending_) return;  // poczekaj, aż pętla zatwierdzi porcję
  const uint16_t offset =
      static_cast<uint16_t>(data[0]) | (static_cast<uint16_t>(data[1]) << 8);
  const uint16_t total =
      static_cast<uint16_t>(data[2]) | (static_cast<uint16_t>(data[3]) << 8);
  if (total < ROUTE_HEADER_SIZE + ROUTE_CRC_SIZE || total > ROUTE_MAX_BLOB) return;
  const size_t payloadLen = len - ROUTE_BLE_HEADER_SIZE;
  if (static_cast<size_t>(offset) + payloadLen > total) return;
  if (offset == 0) {
    routeStageTotal_ = total;
    routeStageLen_ = 0;
  } else if (total != routeStageTotal_) {
    return;  // porcja bez początku albo mieszanie dwóch transferów
  }
  memcpy(routeStage_ + offset, data + ROUTE_BLE_HEADER_SIZE, payloadLen);
  const uint16_t end = static_cast<uint16_t>(offset + payloadLen);
  if (end > routeStageLen_) routeStageLen_ = end;
  if (end >= total) routeCommitPending_ = true;
}

void BleFiles::clearRoute() {
  routeRawLen_ = static_cast<uint16_t>(routeBuildEmpty(routeRaw_, sizeof(routeRaw_)));
  routePoints_ = 0;
  routeCrc_ = 0;
  if (routeRawLen_ >= ROUTE_CRC_SIZE) {
    const uint8_t* p = routeRaw_ + routeRawLen_ - ROUTE_CRC_SIZE;
    routeCrc_ = static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) |
                (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
  }
  routeCommitPending_ = false;
  refreshInfo();
  setStatus(SZ_ST_OK);
}

void BleFiles::commitRoute() {
  routeCommitPending_ = false;
  static RouteData decoded;
  const uint16_t len = routeStageTotal_;
  uint32_t storedCrc = 0;
  if (len >= ROUTE_CRC_SIZE) {
    const uint8_t* p = routeStage_ + len - ROUTE_CRC_SIZE;
    storedCrc = static_cast<uint32_t>(p[0]) | (static_cast<uint32_t>(p[1]) << 8) |
                (static_cast<uint32_t>(p[2]) << 16) | (static_cast<uint32_t>(p[3]) << 24);
  }
  if (routeDecode(routeStage_, routeStageLen_, &decoded)) {
    memcpy(routeRaw_, routeStage_, routeStageLen_);
    routeRawLen_ = routeStageLen_;
    routeCrc_ = decoded.crc;
    routePoints_ = decoded.pointCount;
    char msg[64];
    snprintf(msg, sizeof(msg), "route ok crc=%08lX points=%u", (unsigned long)decoded.crc,
             (unsigned)decoded.pointCount);
    refreshInfo();
    setStatus(String(msg));
    SZ_LOGIF("BLE %s", msg);
  } else {
    char msg[48];
    snprintf(msg, sizeof(msg), "route err crc=%08lX", (unsigned long)storedCrc);
    setStatus(String(msg));
    SZ_LOGWF("BLE %s", msg);
  }
}

bool BleFiles::startStream(const String& name) {
  if (transferring_) abortStream("restart");
  if (!storage_) {
    setStatus(SZ_ERR_NO_STORAGE " " + name);
    return false;
  }
  storage_->rotateForSync();  // plik do pobrania zawsze kompletny/zamknięty
  activeFile_ = name;
  if (!storage_->openRead(name)) {
    SZ_LOGEF("BLE START open fail name=%s", name.c_str());
    setStatus(SZ_ERR_OPEN " " + name);
    return false;
  }
  if (!comp_ || !window_) {
    storage_->closeRead();
    setStatus(SZ_ERR_NOMEM " " + name);
    return false;
  }
  tdefl_status st = tdefl_init(comp_, nullptr, nullptr,
                               TDEFL_DEFAULT_MAX_PROBES | TDEFL_WRITE_ZLIB_HEADER |
                                   TDEFL_COMPUTE_ADLER32);
  if (st != TDEFL_STATUS_OKAY) {
    SZ_LOGE("BLE START tdefl_init fail");
    storage_->closeRead();
    setStatus(SZ_ERR_DEFLATE " " + name);
    return false;
  }
  compActive_ = true;
  nextSeq_ = 0;
  oldestUnacked_ = 0;
  endSent_ = false;
  inputEof_ = false;
  compFinished_ = false;
  rawBytes_ = 0;
  compBytes_ = 0;
  frameCount_ = 0;
  fileCrc_ = SZ_CRC32_INIT;
  inLen_ = 0;
  inPos_ = 0;
  pendLen_ = 0;
  ackRetries_ = 0;
  replaying_ = false;
  replays_ = 0;
  ackTimeouts_ = 0;
  lastProgressMs_ = millis();
  lastNotifyMs_ = 0;
  transferring_ = true;
  refreshInfo();
  setStatus(SZ_ST_STREAMING + name);
  SZ_LOGIF("BLE START name=%s raw=%lu", name.c_str(), (unsigned long)storage_->readSize());
  return true;
}

void BleFiles::abortStream(const String& reason) {
  if (storage_) storage_->closeRead();
  transferring_ = false;
  compActive_ = false;
  replaying_ = false;
  // Dołącz nazwę pliku, żeby PWA odróżniła błąd bieżącego transferu od
  // poprzedniego (nazwy plików są unikalne).
  setStatus(activeFile_.length() ? reason + " " + activeFile_ : reason);
  SZ_LOGWF("BLE abort (%s)", reason.c_str());
}

void BleFiles::finishStream() {
  uint32_t crc = szCrc32Final(fileCrc_);
  char msg[160];
  snprintf(msg, sizeof(msg), SZ_ST_DONE "%s raw=%lu comp=%lu frames=%lu crc=%08lX",
           activeFile_.c_str(), (unsigned long)rawBytes_, (unsigned long)compBytes_,
           (unsigned long)frameCount_, (unsigned long)crc);
  if (storage_) storage_->closeRead();
  transferring_ = false;
  compActive_ = false;
  setStatus(String(msg));
  SZ_LOGIF("BLE %s name=%s replay=%lu ackTimeout=%lu", msg, activeFile_.c_str(),
           (unsigned long)replays_, (unsigned long)ackTimeouts_);
}

bool BleFiles::emitFrame(const uint8_t* payload, size_t len) {
  unsigned long now = millis();
  if (now - lastNotifyMs_ < SZ_BLE_NOTIFY_MS) return false;  // pacing 4 ms
  uint32_t idx = nextSeq_ % SZ_BLE_WINDOW;
  window_[idx][0] = (uint8_t)(nextSeq_ & 0xFF);
  window_[idx][1] = (uint8_t)((nextSeq_ >> 8) & 0xFF);
  window_[idx][2] = (uint8_t)((nextSeq_ >> 16) & 0xFF);
  window_[idx][3] = (uint8_t)((nextSeq_ >> 24) & 0xFF);
  if (len) memcpy(window_[idx] + SZ_BLE_HEADER_SIZE, payload, len);
  windowLen_[idx] = (uint16_t)(SZ_BLE_HEADER_SIZE + len);
  if (chrData) chrData->notify(window_[idx], windowLen_[idx]);
  compBytes_ += (uint32_t)len;
  frameCount_++;
  nextSeq_++;
  lastNotifyMs_ = now;
  lastProgressMs_ = now;
  if ((frameCount_ & 31) == 0) {
    SZ_LOGIF("BLE tx frames=%lu next=%lu unacked=%lu", (unsigned long)frameCount_,
             (unsigned long)nextSeq_, (unsigned long)(nextSeq_ - oldestUnacked_));
  }
  return true;
}

void BleFiles::sendEndMarker() {
  // Pusta ramka (sam nagłówek) = koniec strumienia.
  uint32_t idx = nextSeq_ % SZ_BLE_WINDOW;
  window_[idx][0] = (uint8_t)(nextSeq_ & 0xFF);
  window_[idx][1] = (uint8_t)((nextSeq_ >> 8) & 0xFF);
  window_[idx][2] = (uint8_t)((nextSeq_ >> 16) & 0xFF);
  window_[idx][3] = (uint8_t)((nextSeq_ >> 24) & 0xFF);
  windowLen_[idx] = SZ_BLE_HEADER_SIZE;
  if (chrData) chrData->notify(window_[idx], windowLen_[idx]);
  endSeq_ = nextSeq_;
  endSent_ = true;
  nextSeq_++;
  lastNotifyMs_ = millis();
  lastProgressMs_ = lastNotifyMs_;
  SZ_LOGIF("BLE end marker seq=%lu", (unsigned long)endSeq_);
}

void BleFiles::pumpStream() {
  // 1) retransmisja w toku — najpierw dokończ replay (max 8 ramek na poll).
  if (replaying_) {
    uint8_t n = 0;
    while (replaying_ && n < 8) {
      unsigned long now = millis();
      if (now - lastNotifyMs_ < SZ_BLE_NOTIFY_MS) break;
      uint32_t idx = replayPos_ % SZ_BLE_WINDOW;
      if (chrData) chrData->notify(window_[idx], windowLen_[idx]);
      lastNotifyMs_ = now;
      lastProgressMs_ = now;
      replayPos_++;
      n++;
      if (replayPos_ >= nextSeq_) replaying_ = false;
    }
    if (replaying_) return;  // reszta replay w kolejnym poll
  }

  // 2) produkcja nowych ramek (max 16 na poll, żeby nie blokować pętli).
  // pend_ jest stagingiem. KOLEJNOŚĆ JEST ISTOTNA: najpierw wysyłamy pełne
  // ramki, a dopisujemy output kompresora tylko gdy w stagingu zostało < 240 B.
  // Dzięki temu przy zablokowanym pacingu (emitFrame zwraca false i robimy
  // return) staging nie rośnie między poll() i nie przepełnia pend_[512].
  uint8_t made = 0;
  while (made < 16 && (nextSeq_ - oldestUnacked_) < SZ_BLE_WINDOW) {
    if (endSent_) break;

    // (a) Wyślij jedną pełną ramkę ze stagingu (pacing może wstrzymać).
    if (pendLen_ >= SZ_BLE_PAYLOAD_SIZE) {
      if (!emitFrame(pend_, SZ_BLE_PAYLOAD_SIZE)) return;  // pacing — dane zostają
      memmove(pend_, pend_ + SZ_BLE_PAYLOAD_SIZE, pendLen_ - SZ_BLE_PAYLOAD_SIZE);
      pendLen_ -= SZ_BLE_PAYLOAD_SIZE;
      made++;
      continue;
    }

    // (b) Kompresja — dopisujemy tylko mając miejsce: pend_ < 240, a output
    //     kompresora to <= 256 B, więc razem <= 496 < 512.
    if (!compFinished_) {
      // Dociągnij dane wejściowe.
      if (!inputEof_ && inPos_ >= inLen_) {
        inLen_ = storage_ ? storage_->readBytes(inBuf_, sizeof(inBuf_)) : 0;
        inPos_ = 0;
        if (inLen_ == 0) {
          if (storage_ && storage_->readError()) {
            // Realny błąd nośnika — nie raportuj pustego pliku jako sukcesu.
            abortStream(SZ_ERR_READ);
            return;
          }
          inputEof_ = true;
          SZ_LOGIF("BLE input EOF raw=%lu", (unsigned long)rawBytes_);
        } else {
          rawBytes_ += (uint32_t)inLen_;
          fileCrc_ = szCrc32Update(fileCrc_, inBuf_, inLen_);
        }
      }
      // Kompresuj porcją i dopisz CAŁY output do stagingu.
      const void* inPtr = (!inputEof_ && inLen_ > inPos_) ? (inBuf_ + inPos_) : nullptr;
      size_t inAvail = (!inputEof_ && inLen_ > inPos_) ? (inLen_ - inPos_) : 0;
      uint8_t out[256];
      size_t outAvail = sizeof(out);
      tdefl_flush flush = inputEof_ ? TDEFL_FINISH : TDEFL_NO_FLUSH;
      tdefl_status st = compActive_ ? tdefl_compress(comp_, inPtr, &inAvail, out, &outAvail,
                                                    flush)
                                    : TDEFL_STATUS_DONE;
      // miniz zwraca: inAvail = liczba SKONSUMOWANYCH bajtów wejścia,
      // outAvail = liczba ZAPISANYCH bajtów wyjścia (a nie „ile zostało").
      inPos_ += inAvail;
      size_t produced = outAvail;
      if (produced > 0) {
        memcpy(pend_ + pendLen_, out, produced);
        pendLen_ += produced;
      }
      if (st == TDEFL_STATUS_DONE) {
        compFinished_ = true;
      } else if (produced == 0) {
        break;  // brak postępu — wróć w kolejnym poll()
      }
      continue;  // wróć na górę: wyślij pełne ramki, ew. dokończ kompresję
    }

    // (c) Kompresja zakończona, w stagingu < pełnej ramki: wyślij resztę i end.
    if (pendLen_ > 0) {
      if (!emitFrame(pend_, pendLen_)) return;  // pacing — dane zostają
      pendLen_ = 0;
      made++;
    }
    sendEndMarker();
    break;
  }

  // 3) timeout ACK -> replay od najstarszej niepotwierdzonej.
  if (millis() - lastProgressMs_ > SZ_BLE_ACK_TIMEOUT_MS) {
    if (ackRetries_ >= SZ_BLE_ACK_RETRY) {
      abortStream(SZ_ERR_ACK_TIMEOUT);
      return;
    }
    ackRetries_++;
    ackTimeouts_++;
    SZ_LOGWF("BLE ack timeout, replay od %lu (retry %u)", (unsigned long)oldestUnacked_,
             ackRetries_);
    replayFrom(oldestUnacked_);
  }
}

void BleFiles::onAck(uint32_t n) {
  if (!transferring_) return;
  if (n <= oldestUnacked_ || n > nextSeq_) {
    SZ_LOGWF("BLE ACK:%lu poza zakresem (oldest=%lu next=%lu) - ignoruje", (unsigned long)n,
             (unsigned long)oldestUnacked_, (unsigned long)nextSeq_);
    return;
  }
  oldestUnacked_ = n;
  ackRetries_ = 0;
  lastProgressMs_ = millis();
  if (endSent_ && n == endSeq_ + 1) {
    finishStream();  // finalny ACK obejmuje end marker
  }
}

void BleFiles::onNack(uint32_t e) {
  if (!transferring_) return;
  if (e < oldestUnacked_ || e >= nextSeq_) {
    SZ_LOGWF("BLE NACK:%lu poza zakresem - ignoruje", (unsigned long)e);
    return;
  }
  // PWA wysyła NACK dla każdej ramki poza kolejnością (chroniony throttle po jej
  // stronie). Gdy replay od <= e już trwa, żądanie jest już pokryte — restart od
  // e cofałby wysyłkę i dusił łącze. Replay dojdzie do e, bo e < nextSeq_.
  if (replaying_ && replayPos_ <= e) return;
  SZ_LOGIF("BLE NACK:%lu - replay", (unsigned long)e);
  replayFrom(e);
}

void BleFiles::replayFrom(uint32_t seq) {
  replayPos_ = seq;
  replaying_ = true;
  replays_++;
  lastProgressMs_ = millis();
}

void BleFiles::dryRun(const String& name) {
  // Lokalny test ścieżki SD + miniz + CRC bez telefonu: wynik w logu i STATUS.
  if (transferring_) {
    setStatus(SZ_ERR_BUSY);
    return;
  }
  if (!storage_) {
    setStatus(SZ_ERR_NO_STORAGE);
    return;
  }
  storage_->rotateForSync();
  if (!comp_) {
    setStatus(SZ_ERR_NOMEM);
    return;
  }
  if (!storage_->openRead(name)) {
    SZ_LOGEF("BLE DRYRUN open fail name=%s", name.c_str());
    setStatus(SZ_ERR_OPEN);
    return;
  }
  tdefl_compressor* c = comp_;  // współdzielony bufor (dryRun tylko gdy !busy)
  if (tdefl_init(c, nullptr, nullptr,
                 TDEFL_DEFAULT_MAX_PROBES | TDEFL_WRITE_ZLIB_HEADER | TDEFL_COMPUTE_ADLER32) !=
      TDEFL_STATUS_OKAY) {
    storage_->closeRead();
    setStatus(SZ_ERR_DEFLATE);
    return;
  }
  uint32_t raw = 0, compBytes = 0, crc = SZ_CRC32_INIT;
  uint8_t in[512];
  bool done = false;
  while (!done) {
    size_t n = storage_->readBytes(in, sizeof(in));
    bool eof = (n == 0);
    if (n) {
      raw += (uint32_t)n;
      crc = szCrc32Update(crc, in, n);
    }
    tdefl_flush flush = eof ? TDEFL_FINISH : TDEFL_NO_FLUSH;
    const uint8_t* p = in;
    size_t left = n;
    for (;;) {
      uint8_t out[512];
      size_t outAvail = sizeof(out);
      size_t inAvail = left;
      tdefl_status st = tdefl_compress(c, left ? p : nullptr, &inAvail, out, &outAvail, flush);
      p += inAvail;      // inAvail = skonsumowane wejście
      left -= inAvail;
      compBytes += (uint32_t)outAvail;  // outAvail = zapisane wyjście
      if (st == TDEFL_STATUS_DONE) {
        done = true;
        break;
      }
      if (outAvail == 0 && inAvail == 0) break;  // brak postępu — dociągnij wejście
    }
    if (raw % 65536 < 512) {
      SZ_LOGDF("BLE DRYRUN raw=%lu comp=%lu", (unsigned long)raw, (unsigned long)compBytes);
    }
  }
  storage_->closeRead();
  char msg[128];
  snprintf(msg, sizeof(msg), SZ_ST_DRYRUN "raw=%lu comp=%lu crc=%08lX", (unsigned long)raw,
           (unsigned long)compBytes, (unsigned long)szCrc32Final(crc));
  setStatus(String(msg));
  SZ_LOGIF("BLE %s name=%s", msg, name.c_str());
  refreshInfo();
}
