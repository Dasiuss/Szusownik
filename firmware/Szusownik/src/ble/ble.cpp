#include "ble.h"
#include "crc32.h"
#include "../storage/storage.h"
#include "../audio/audio.h"
#include "../config/config.h"
#include "../config/log.h"
#include <NimBLEDevice.h>

static NimBLECharacteristic* chrInfo = nullptr;
static NimBLECharacteristic* chrCtrl = nullptr;
static NimBLECharacteristic* chrData = nullptr;
static NimBLECharacteristic* chrStat = nullptr;

void BleFiles::begin(Storage* storage) {
  storage_ = storage;
  allocStreamMem();
  NimBLEDevice::init(SZ_BLE_NAME);
  NimBLEDevice::setMTU(517);
  NimBLEServer* srv = NimBLEDevice::createServer();
  NimBLEService* svc = srv->createService(SZ_UUID_SVC);
  chrInfo = svc->createCharacteristic(SZ_UUID_INFO, NIMBLE_PROPERTY::READ);
  chrCtrl = svc->createCharacteristic(SZ_UUID_CTRL,
                                      NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  chrData = svc->createCharacteristic(SZ_UUID_DATA, NIMBLE_PROPERTY::NOTIFY);
  chrStat = svc->createCharacteristic(SZ_UUID_STAT,
                                      NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  refreshInfo();
  setStatus("ok");
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
  szLogf("BLE: start name=%s mtu=517", SZ_BLE_NAME);
}

bool BleFiles::allocStreamMem() {
  // ~165 KB kompresor + ~31 KB okno ramek -> PSRAM (2 MB), żeby nie zjeść DRAM.
  comp_ = (tdefl_compressor*)ps_malloc(sizeof(tdefl_compressor));
  window_ = (uint8_t(*)[SZ_BLE_FRAME_SIZE])ps_malloc(SZ_BLE_WINDOW * SZ_BLE_FRAME_SIZE);
  windowLen_ = (uint16_t*)ps_malloc(SZ_BLE_WINDOW * sizeof(uint16_t));
  if (!comp_ || !window_ || !windowLen_) {
    szLog("BLE: PSRAM alloc FAIL (streaming niedostepny)");
    return false;
  }
  memset(windowLen_, 0, SZ_BLE_WINDOW * sizeof(uint16_t));
  szLogf("BLE: stream mem OK (comp=%u ring=%u w PSRAM)", (unsigned)sizeof(tdefl_compressor),
         (unsigned)(SZ_BLE_WINDOW * SZ_BLE_FRAME_SIZE));
  return true;
}

void BleFiles::refreshInfo() {
  if (!chrInfo) return;
  String arr = storage_ ? storage_->listJsonArray() : String("[]");
  String j = "{\"proto\":\"" SZ_WIRE_PROTO "\",\"fw\":\"" SZ_FW_VERSION "\",\"files\":";
  j += arr;
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
}

void BleFiles::reportVolume() {
  if (!beeper_) {
    setStatus("err:no-beeper");
    return;
  }
  char msg[48];
  snprintf(msg, sizeof(msg), "vol low=%u high=%u", beeper_->volLow(), beeper_->volHigh());
  refreshInfo();  // INFO niesie volLow/volHigh dla PWA
  setStatus(String(msg));
  szLogf("BLE: %s", msg);
}

void BleFiles::reportFreq() {
  if (!beeper_) {
    setStatus("err:no-beeper");
    return;
  }
  char msg[48];
  snprintf(msg, sizeof(msg), "freq short=%u long=%u", beeper_->freqShort(),
           beeper_->freqLong());
  refreshInfo();  // INFO niesie freqShort/freqLong dla PWA
  setStatus(String(msg));
  szLogf("BLE: %s", msg);
}

void BleFiles::reportTiming() {
  if (!beeper_) {
    setStatus("err:no-beeper");
    return;
  }
  char msg[96];
  snprintf(msg, sizeof(msg), "timing short=%u long=%u gap=%u interval=%u",
           beeper_->beepShortMs(), beeper_->beepLongMs(), beeper_->beepGapMs(),
           beeper_->signalGapMs());
  refreshInfo();  // INFO niesie czasy dla PWA
  setStatus(String(msg));
  szLogf("BLE: %s", msg);
}

void BleFiles::reportMinBeep() {
  if (!beeper_) {
    setStatus("err:no-beeper");
    return;
  }
  char msg[40];
  snprintf(msg, sizeof(msg), "beep min=%u", beeper_->minBeepKmh());
  refreshInfo();
  setStatus(String(msg));
  szLogf("BLE: %s", msg);
}

void BleFiles::setStatus(const String& s) {
  lastError_ = s;
  if (chrStat) {
    chrStat->setValue(s.c_str());
    chrStat->notify();
  }
}

void BleFiles::handleCommand(const String& cmd) {
  if (cmd.startsWith("LIST_FILES")) {
    refreshInfo();
    setStatus("ok");
  } else if (cmd.startsWith("ROTATE")) {
    // Żądanie sync: zamknij bieżący plik, żeby transfer czytał kompletny plik.
    if (storage_) storage_->rotateForSync();
    refreshInfo();
    setStatus("ok");
  } else if (cmd.startsWith("DRYRUN:")) {
    String name = cmd.substring(7);
    name.trim();
    dryRun(name);
  } else if (cmd.startsWith("START_FILE:")) {
    String name = cmd.substring(11);
    name.trim();
    startStream(name);
  } else if (cmd.startsWith("STOP")) {
    if (transferring_) abortStream("stopped");
    activeFile_ = "";
    setStatus("ok");
  } else if (cmd.startsWith("ACK:")) {
    onAck((uint32_t)cmd.substring(4).toInt());
  } else if (cmd.startsWith("NACK:")) {
    onNack((uint32_t)cmd.substring(5).toInt());
  } else if (cmd.startsWith("SETVOL:LOW:")) {
    if (beeper_) {
      beeper_->setVolLow(cmd.substring(11).toInt());  // feedback: sygnał 60
      reportVolume();
    } else {
      setStatus("err:no-beeper");
    }
  } else if (cmd.startsWith("SETVOL:HIGH:")) {
    if (beeper_) {
      beeper_->setVolHigh(cmd.substring(12).toInt());  // feedback: sygnał 120
      reportVolume();
    } else {
      setStatus("err:no-beeper");
    }
  } else if (cmd.startsWith("SETFREQ:SHORT:")) {
    if (beeper_) {
      beeper_->setFreqShort(cmd.substring(14).toInt());  // feedback: 1 długi + 2 krótkie
      reportFreq();
    } else {
      setStatus("err:no-beeper");
    }
  } else if (cmd.startsWith("SETFREQ:LONG:")) {
    if (beeper_) {
      beeper_->setFreqLong(cmd.substring(13).toInt());  // feedback: 1 długi + 2 krótkie
      reportFreq();
    } else {
      setStatus("err:no-beeper");
    }
  } else if (cmd.startsWith("SETTIMING:SHORT:")) {
    if (beeper_) {
      beeper_->setBeepShortMs(cmd.substring(16).toInt());  // feedback: 3 x sygnał 120
      reportTiming();
    } else {
      setStatus("err:no-beeper");
    }
  } else if (cmd.startsWith("SETTIMING:LONG:")) {
    if (beeper_) {
      beeper_->setBeepLongMs(cmd.substring(15).toInt());  // feedback: 3 x sygnał 120
      reportTiming();
    } else {
      setStatus("err:no-beeper");
    }
  } else if (cmd.startsWith("SETTIMING:GAP:")) {
    if (beeper_) {
      beeper_->setBeepGapMs(cmd.substring(14).toInt());  // feedback: 3 x sygnał 120
      reportTiming();
    } else {
      setStatus("err:no-beeper");
    }
  } else if (cmd.startsWith("SETTIMING:INTERVAL:")) {
    if (beeper_) {
      beeper_->setSignalGapMs(cmd.substring(19).toInt());  // feedback: 3 x sygnał 120
      reportTiming();
    } else {
      setStatus("err:no-beeper");
    }
  } else if (cmd.startsWith("SETMINBEEP:")) {
    if (beeper_) {
      beeper_->setMinBeepKmh(cmd.substring(11).toInt());
      reportMinBeep();
    } else {
      setStatus("err:no-beeper");
    }
  }
}

void BleFiles::poll() {
  if (!chrCtrl) return;
  // Odczyt i skonsumowanie komendy zamiast callbacku — bez ryzyka API callbacks.
  std::string v = chrCtrl->getValue();
  String cmd(v.c_str());
  if (cmd.length()) {
    chrCtrl->setValue("");
    handleCommand(cmd);
  }
  if (transferring_) pumpStream();
}

bool BleFiles::startStream(const String& name) {
  if (transferring_) abortStream("restart");
  if (!storage_) {
    setStatus("err:no-storage");
    return false;
  }
  storage_->rotateForSync();  // plik do pobrania zawsze kompletny/zamknięty
  activeFile_ = name;
  if (!storage_->openRead(name)) {
    szLogf("BLE: START open fail name=%s", name.c_str());
    setStatus("err:open");
    return false;
  }
  if (!comp_ || !window_) {
    storage_->closeRead();
    setStatus("err:nomem");
    return false;
  }
  tdefl_status st = tdefl_init(comp_, nullptr, nullptr,
                               TDEFL_DEFAULT_MAX_PROBES | TDEFL_WRITE_ZLIB_HEADER |
                                   TDEFL_COMPUTE_ADLER32);
  if (st != TDEFL_STATUS_OKAY) {
    szLog("BLE: START tdefl_init fail");
    storage_->closeRead();
    setStatus("err:deflate");
    return false;
  }
  compActive_ = true;
  nextSeq_ = 0;
  oldestUnacked_ = 0;
  endSent_ = false;
  inputEof_ = false;
  rawBytes_ = 0;
  compBytes_ = 0;
  frameCount_ = 0;
  fileCrc_ = SZ_CRC32_INIT;
  inLen_ = 0;
  inPos_ = 0;
  pendLen_ = 0;
  ackRetries_ = 0;
  replaying_ = false;
  lastProgressMs_ = millis();
  lastNotifyMs_ = 0;
  transferring_ = true;
  refreshInfo();
  setStatus("streaming");
  szLogf("BLE: START name=%s raw=%lu", name.c_str(), (unsigned long)storage_->readSize());
  return true;
}

void BleFiles::abortStream(const String& reason) {
  if (storage_) storage_->closeRead();
  transferring_ = false;
  compActive_ = false;
  replaying_ = false;
  setStatus(reason);
  szLogf("BLE: abort (%s)", reason.c_str());
}

void BleFiles::finishStream() {
  uint32_t crc = szCrc32Final(fileCrc_);
  char msg[128];
  snprintf(msg, sizeof(msg), "done raw=%lu comp=%lu frames=%lu crc=%08lX",
           (unsigned long)rawBytes_, (unsigned long)compBytes_, (unsigned long)frameCount_,
           (unsigned long)crc);
  if (storage_) storage_->closeRead();
  transferring_ = false;
  compActive_ = false;
  setStatus(String(msg));
  szLogf("BLE: %s name=%s", msg, activeFile_.c_str());
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
    szLogf("BLE: tx frames=%lu next=%lu unacked=%lu", (unsigned long)frameCount_,
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
  szLogf("BLE: end marker seq=%lu", (unsigned long)endSeq_);
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
  uint8_t made = 0;
  while (made < 16 && (nextSeq_ - oldestUnacked_) < SZ_BLE_WINDOW) {
    if (!endSent_) {
      // Dociągnij dane wejściowe.
      if (!inputEof_ && inPos_ >= inLen_) {
        inLen_ = storage_ ? storage_->readBytes(inBuf_, sizeof(inBuf_)) : 0;
        inPos_ = 0;
        if (inLen_ == 0) {
          inputEof_ = true;
        } else {
          rawBytes_ += (uint32_t)inLen_;
          fileCrc_ = szCrc32Update(fileCrc_, inBuf_, inLen_);
        }
      }
      // Kompresuj porcją.
      const void* inPtr = (!inputEof_ && inLen_ > inPos_) ? (inBuf_ + inPos_) : nullptr;
      size_t inAvail = (!inputEof_ && inLen_ > inPos_) ? (inLen_ - inPos_) : 0;
      uint8_t out[256];
      size_t outAvail = sizeof(out);
      tdefl_flush flush = inputEof_ ? TDEFL_FINISH : TDEFL_NO_FLUSH;
      tdefl_status st = compActive_ ? tdefl_compress(comp_, inPtr, &inAvail, out, &outAvail,
                                                    flush)
                                    : TDEFL_STATUS_DONE;
      inPos_ = inLen_ - inAvail;
      size_t produced = sizeof(out) - outAvail;
      // Dopisz do bufora częściowej ramki.
      size_t op = 0;
      while (op < produced) {
        size_t room = SZ_BLE_PAYLOAD_SIZE - pendLen_;
        size_t cp = produced - op < room ? produced - op : room;
        memcpy(pend_ + pendLen_, out + op, cp);
        pendLen_ += cp;
        op += cp;
        if (pendLen_ == SZ_BLE_PAYLOAD_SIZE) {
          if (!emitFrame(pend_, pendLen_)) return;  // pacing — reszta w kolejnym poll
          pendLen_ = 0;
          made++;
        }
      }
      if (st == TDEFL_STATUS_DONE) {
        if (pendLen_ > 0) {
          if (!emitFrame(pend_, pendLen_)) return;
          pendLen_ = 0;
          made++;
        }
        sendEndMarker();
      } else if (produced == 0 && !inputEof_) {
        break;  // kompresor czeka na więcej wejścia, a okno pełne — wyjdź
      }
      if (endSent_) break;
    } else {
      break;  // end marker wysłany — czekamy na finalny ACK
    }
  }

  // 3) timeout ACK -> replay od najstarszej niepotwierdzonej.
  if (millis() - lastProgressMs_ > SZ_BLE_ACK_TIMEOUT_MS) {
    if (ackRetries_ >= SZ_BLE_ACK_RETRY) {
      abortStream("err:ack-timeout");
      return;
    }
    ackRetries_++;
    szLogf("BLE: ack timeout, replay od %lu (retry %u)", (unsigned long)oldestUnacked_,
           ackRetries_);
    replayFrom(oldestUnacked_);
  }
}

void BleFiles::onAck(uint32_t n) {
  if (!transferring_) return;
  if (n <= oldestUnacked_ || n > nextSeq_) {
    szLogf("BLE: ACK:%lu poza zakresem (oldest=%lu next=%lu) - ignoruje", (unsigned long)n,
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
    szLogf("BLE: NACK:%lu poza zakresem - ignoruje", (unsigned long)e);
    return;
  }
  szLogf("BLE: NACK:%lu - replay", (unsigned long)e);
  replayFrom(e);
}

void BleFiles::replayFrom(uint32_t seq) {
  replayPos_ = seq;
  replaying_ = true;
  lastProgressMs_ = millis();
}

void BleFiles::dryRun(const String& name) {
  // Lokalny test ścieżki SD + miniz + CRC bez telefonu: wynik w logu i STATUS.
  if (transferring_) {
    setStatus("err:busy");
    return;
  }
  if (!storage_) {
    setStatus("err:no-storage");
    return;
  }
  storage_->rotateForSync();
  if (!comp_) {
    setStatus("err:nomem");
    return;
  }
  if (!storage_->openRead(name)) {
    szLogf("BLE: DRYRUN open fail name=%s", name.c_str());
    setStatus("err:open");
    return;
  }
  tdefl_compressor* c = comp_;  // współdzielony bufor (dryRun tylko gdy !busy)
  if (tdefl_init(c, nullptr, nullptr,
                 TDEFL_DEFAULT_MAX_PROBES | TDEFL_WRITE_ZLIB_HEADER | TDEFL_COMPUTE_ADLER32) !=
      TDEFL_STATUS_OKAY) {
    storage_->closeRead();
    setStatus("err:deflate");
    return;
  }
  uint32_t raw = 0, compBytes = 0, crc = SZ_CRC32_INIT;
  uint8_t in[512];
  bool done = false;
  while (!done) {
    size_t n = storage_->readBytes(in, sizeof(in));
    bool eof = (n == 0);
    size_t inAvail = n;
    const void* inPtr = eof ? nullptr : in;
    if (n) {
      raw += (uint32_t)n;
      crc = szCrc32Update(crc, in, n);
    }
    tdefl_flush flush = eof ? TDEFL_FINISH : TDEFL_NO_FLUSH;
    while (true) {
      uint8_t out[512];
      size_t outAvail = sizeof(out);
      tdefl_status st = tdefl_compress(c, inPtr, &inAvail, out, &outAvail, flush);
      compBytes += (uint32_t)(sizeof(out) - outAvail);
      if (st == TDEFL_STATUS_DONE) {
        done = true;
        break;
      }
      if (!eof && inAvail == 0) break;  // FINISH wołamy aż do DONE
    }
    if (raw % 65536 < 512) {
      szLogf("BLE: DRYRUN raw=%lu comp=%lu", (unsigned long)raw, (unsigned long)compBytes);
    }
  }
  storage_->closeRead();
  char msg[128];
  snprintf(msg, sizeof(msg), "dryrun raw=%lu comp=%lu crc=%08lX", (unsigned long)raw,
           (unsigned long)compBytes, (unsigned long)szCrc32Final(crc));
  setStatus(String(msg));
  szLogf("BLE: %s name=%s", msg, name.c_str());
  refreshInfo();
}
