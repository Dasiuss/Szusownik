#include "gnss.h"
#include "../config/pins.h"
#include "../config/config.h"
#include "../config/log.h"

bool Gnss::begin(long baud) {
  baud_ = baud;
  Serial0.begin(baud_, SERIAL_8N1, PIN_GNSS_RX, PIN_GNSS_TX);
  szLogf("GPS: UART0 %ld 8N1 (RX=GPIO%d TX=GPIO%d), czekam na dane...", baud_,
         PIN_GNSS_RX, PIN_GNSS_TX);
  return true;
}

void Gnss::poll() {
  while (Serial0.available()) {
    gps_.encode((char)Serial0.read());
  }
  // Wyzwalaczem jest commit RMC: TinyGPS++ commituje tam jednocześnie pozycję
  // i prędkość (VTG nie jest parsowane), więc para jest spójna z jednej epoki.
  // Odczyt speedKmh() konsumuje flagę isUpdated (jednorazowa).
  if (gps_.speed.isUpdated()) {
    float kmh = speedKmh();
    newSample_ = true;
#if SZ_DEBUG_FIX
    szLogf("FIX ok=%d spd=%.1f sats=%lu lat=%.6f lon=%.6f alt=%.1f hdg=%.0f", hasFix() ? 1 : 0,
           kmh, (unsigned long)sats(), lat(), lon(), altM(), headingDeg());
#endif
    updateAdaptiveRate(kmh);
  }
}

bool Gnss::consumeNewSample() {
  bool s = newSample_;
  newSample_ = false;
  return s;
}

void Gnss::maintain(unsigned long nowMs) {
  if (configured_) return;
  if (nowMs - lastAttempt_ < 5000) return;
  lastAttempt_ = nowMs;
  szLog(F("GPS: proba konfiguracji..."));
  attemptConfigure();
}

bool Gnss::hasFix() {
  if (!gps_.location.isValid()) return false;
  // Próg wieku fixa skalowany do meas rate: w spoczynku fix przychodzi co 2 s,
  // sztywne 2000 ms powodowałoby migotanie fix/działa.
  unsigned long maxAge = logIntervalMs_ * 3 + 1500;
  if (gps_.location.age() > maxAge) return false;
  if (!gps_.satellites.isValid() || gps_.satellites.value() < 3) return false;
  return true;
}

GnssSampleQuality Gnss::sampleQuality() {
  GnssSampleQuality quality;
  quality.fixValid = hasFix();
  quality.fixAgeValid = gps_.location.isValid();
  if (quality.fixAgeValid) quality.fixAgeMs = gps_.location.age();

  quality.satellitesValid = gps_.satellites.isValid();
  if (quality.satellitesValid) {
    quality.satellites = gps_.satellites.value();
    quality.satellitesAgeValid = true;
    quality.satellitesAgeMs = gps_.satellites.age();
  }

  quality.hdopValid = gps_.hdop.isValid();
  if (quality.hdopValid) {
    quality.hdop = (float)gps_.hdop.hdop();
    quality.hdopAgeValid = true;
    quality.hdopAgeMs = gps_.hdop.age();
  }
  return quality;
}

float Gnss::speedKmh() {
  if (!gps_.speed.isValid()) return 0.0f;
  return (float)gps_.speed.kmph();  // Doppler, liczony przez odbiornik
}

double Gnss::lat() { return gps_.location.isValid() ? gps_.location.lat() : 0.0; }
double Gnss::lon() { return gps_.location.isValid() ? gps_.location.lng() : 0.0; }
float Gnss::altM() { return gps_.altitude.isValid() ? (float)gps_.altitude.meters() : 0.0f; }
float Gnss::headingDeg() { return gps_.course.isValid() ? (float)gps_.course.deg() : 0.0f; }
uint32_t Gnss::sats() { return gps_.satellites.isValid() ? gps_.satellites.value() : 0; }
bool Gnss::timeValid() { return gps_.date.isValid() && gps_.time.isValid(); }

String Gnss::utcStamp() {
  if (!timeValid()) return String("");
  char b[20];
  snprintf(b, sizeof(b), "%04d%02d%02d_%02d%02d%02d", gps_.date.year(), gps_.date.month(),
           gps_.date.day(), gps_.time.hour(), gps_.time.minute(), gps_.time.second());
  return String(b);
}

String Gnss::csvStamp() {
  if (!timeValid()) return String("");
  // NMEA podaje czas z dokładnością do sekundy, a logujemy do 10 Hz — dokładamy
  // milisekundy z zegara ESP32 zakotwiczone w sekundach GPS (re-anchor przy każdej
  // zmianie sekundy). Daje to monotoniczny czas i poprawne odstępy między próbkami.
  unsigned long now = millis();
  uint8_t sec = gps_.time.second();
  if ((int)sec != lastStampSec_) {
    lastStampSec_ = (int)sec;
    stampSecAnchorMs_ = now;
  }
  unsigned long sub = now - stampSecAnchorMs_;
  if (sub > 999) sub = 999;  // ochrona przy nieświeżym czasie (brak nowej sekundy)
  char b[32];
  snprintf(b, sizeof(b), "%04d-%02d-%02dT%02d:%02d:%02d.%03luZ", gps_.date.year(),
           gps_.date.month(), gps_.date.day(), gps_.time.hour(), gps_.time.minute(), sec, sub);
  return String(b);
}

void Gnss::dumpStatus() {
  szLogf("GPS: fix=%d sats=%lu spd=%.1f band=%d rate=%lums baud=%ld cfg=%d chars=%lu fails=%lu",
         hasFix() ? 1 : 0, (unsigned long)sats(), speedKmh(), band_, logIntervalMs_,
         baud_, configured_ ? 1 : 0, (unsigned long)gps_.charsProcessed(),
         (unsigned long)ubxFails_);
}

int Gnss::bandOf(float kmh) {
  if (kmh < 20.0f) return 0;
  if (kmh < 50.0f) return 1;
  if (kmh < 70.0f) return 2;
  if (kmh < 80.0f) return 3;
  return 4;
}

unsigned long Gnss::bandIntervalMs(int band) {
  static const unsigned long iv[5] = {2000, 1000, 333, 166, 100};
  if (band < 0) band = 0;
  if (band > 4) band = 4;
  return iv[band];
}

void Gnss::updateAdaptiveRate(float kmh) {
  static const float bounds[4] = {20.0f, 50.0f, 70.0f, 80.0f};
  static const int hz[5] = {0, 1, 3, 6, 10};  // 0 = 0.5 Hz
  int want = bandOf(kmh);
  if (want == band_) return;
  bool cross = want > band_ ? (kmh >= bounds[want - 1] + SZ_HYST_KMH)
                            : (kmh <= bounds[want] - SZ_HYST_KMH);
  if (!cross) return;  // histereza: czekaj na przekroczenie progu +/-3
  band_ = want;
  rateHz_ = hz[band_];
  logIntervalMs_ = bandIntervalMs(band_);
  szLogf("GPS: pasmo -> b%d, interwal %lums", band_, logIntervalMs_);
  if (configured_) {
    if (!ubxSetRate((uint16_t)logIntervalMs_)) {
      szLog(F("GPS: zmiana meas rate NIEUDANA (logowanie dalej po staremu)"));
    }
  }
}

// ---------- autokonfiguracja ----------

bool Gnss::attemptConfigure() {
  szLog(F("GPS: krok 1/5 - czekam na NMEA @9600..."));
  if (!waitForData(8000, "9600")) {
    // Moduł mógł wstać z ZAPISANĄ konfiguracją (115200) po poprzednim restarcie.
    szLog(F("GPS: brak danych @9600 - probuje @115200 (zapisana konfiguracja?)..."));
    Serial0.updateBaudRate(115200);
    baud_ = 115200;
    if (waitForData(8000, "115200")) {
      szLog(F("GPS: modul ma zapisana konfiguracje, przejmuje @115200"));
      ubxSetRate(2000);  // upewnij sie, ze spoczynek = 0.5 Hz
      configured_ = true;
      szLog(F("GPS: KONFIGURACJA OK (przejeta @115200, rate=2000ms)"));
      return true;
    }
    Serial0.updateBaudRate(9600);
    baud_ = 9600;
    szLog(F("GPS: BRAK DANYCH @9600 i @115200. Sprawdz: TX modulu->GPIO44, "
            "RX modulu->GPIO43, VCC 3V3, GND."));
    return false;
  }
  szLogf("GPS: dane @9600 OK (chars=%lu)", (unsigned long)gps_.charsProcessed());

  szLog(F("GPS: krok 2/5 - CFG-RATE 2000ms (spoczynek 0.5Hz)..."));
  if (!ubxSetRate(2000)) return false;

  szLog(F("GPS: krok 3/5 - CFG-PRT 115200..."));
  if (!ubxSetUart(115200)) return false;
  Serial0.flush();
  delay(120);  // daj odbiornikowi czas na przelaczenie UART
  Serial0.updateBaudRate(115200);
  baud_ = 115200;
  szLog(F("GPS: host UART -> 115200"));

  szLog(F("GPS: krok 4/5 - weryfikacja danych @115200..."));
  if (!waitForData(8000, "115200")) {
    szLog(F("GPS: BRAK DANYCH @115200 - wracam na 9600"));
    Serial0.updateBaudRate(9600);
    baud_ = 9600;
    return false;
  }

  szLog(F("GPS: krok 5/5 - CFG-CFG zapis do flash..."));
  if (!ubxSave()) {
    szLog(F("GPS: zapis WARN - jade dalej, konfiguracja w RAM"));
  }
  configured_ = true;
  szLog(F("GPS: KONFIGURACJA OK (baud=115200, rate=2000ms)"));
  return true;
}

bool Gnss::waitForData(unsigned long timeoutMs, const char* tag) {
  uint32_t startChars = gps_.charsProcessed();
  unsigned long t0 = millis();
  while (millis() - t0 < timeoutMs) {
    while (Serial0.available()) {
      gps_.encode((char)Serial0.read());
    }
    if (gps_.charsProcessed() - startChars > 100) {
      szLogf("GPS: NMEA plynie @%s (+%lu chars)", tag,
             (unsigned long)(gps_.charsProcessed() - startChars));
      return true;
    }
    yield();
  }
  szLogf("GPS: timeout @%s (chars=%lu, przybylo %lu)", tag,
         (unsigned long)gps_.charsProcessed(),
         (unsigned long)(gps_.charsProcessed() - startChars));
  return false;
}

void Gnss::ubxWrite(uint8_t cls, uint8_t id, const uint8_t* pl, uint16_t len) {
  uint8_t ckA = 0, ckB = 0;
  Serial0.write(0xB5);
  Serial0.write(0x62);
  auto out = [&](uint8_t b) {
    Serial0.write(b);
    ckA += b;
    ckB += ckA;
  };
  out(cls);
  out(id);
  out(len & 0xFF);
  out((len >> 8) & 0xFF);
  for (uint16_t i = 0; i < len; i++) out(pl[i]);
  Serial0.write(ckA);
  Serial0.write(ckB);
  Serial0.flush();
  szLogf("GPS: UBX tx cls=0x%02X id=0x%02X len=%u ck=%02X%02X", cls, id, len, ckA, ckB);
}

bool Gnss::ubxWaitAck(uint8_t cls, uint8_t id, unsigned long timeoutMs) {
  enum { S_SYNC1, S_SYNC2, S_CLS, S_ID, S_L1, S_L2, S_PL, S_CKA, S_CKB } st = S_SYNC1;
  uint8_t c2 = 0, i2 = 0, ckA = 0, ckB = 0, rckA = 0, rckB = 0;
  uint16_t ln = 0, idx = 0;
  uint8_t pl[8] = {0};
  unsigned long t0 = millis();
  auto step = [&](uint8_t b) {
    ckA += b;
    ckB += ckA;
  };
  while (millis() - t0 < timeoutMs) {
    while (Serial0.available()) {
      uint8_t b = (uint8_t)Serial0.read();
      switch (st) {
        case S_SYNC1:
          if (b == 0xB5) st = S_SYNC2;
          break;
        case S_SYNC2:
          st = (b == 0x62) ? S_CLS : (b == 0xB5 ? S_SYNC2 : S_SYNC1);
          break;
        case S_CLS:
          c2 = b;
          ckA = 0;
          ckB = 0;
          step(b);
          st = S_ID;
          break;
        case S_ID:
          i2 = b;
          step(b);
          st = S_L1;
          break;
        case S_L1:
          ln = b;
          step(b);
          st = S_L2;
          break;
        case S_L2:
          ln |= ((uint16_t)b << 8);
          step(b);
          idx = 0;
          st = S_PL;
          break;
        case S_PL:
          step(b);
          if (idx < sizeof(pl)) pl[idx] = b;
          idx++;
          if (idx >= ln) st = S_CKA;
          break;
        case S_CKA:
          rckA = b;
          st = S_CKB;
          break;
        case S_CKB:
          rckB = b;
          if (ckA == rckA && ckB == rckB && ln >= 2 && pl[0] == cls && pl[1] == id) {
            if (c2 == 0x05 && i2 == 0x01) {
              szLogf("GPS: UBX ACK (0x%02X/0x%02X)", cls, id);
              return true;
            }
            if (c2 == 0x05 && i2 == 0x00) {
              szLogf("GPS: UBX NAK (0x%02X/0x%02X)", cls, id);
              ubxFails_++;
              return false;
            }
          }
          st = S_SYNC1;
          break;
      }
    }
    yield();
  }
  szLogf("GPS: UBX ACK-TIMEOUT (0x%02X/0x%02X)", cls, id);
  ubxFails_++;
  return false;
}

bool Gnss::ubxSetRate(uint16_t measMs) {
  uint8_t pl[6] = {(uint8_t)(measMs & 0xFF), (uint8_t)(measMs >> 8),
                   0x01, 0x00,  // navRate = 1
                   0x01, 0x00};  // timeRef = GPS
  szLogf("GPS: CFG-RATE meas=%ums...", measMs);
  ubxWrite(0x06, 0x08, pl, sizeof(pl));
  return ubxWaitAck(0x06, 0x08, 1000);
}

bool Gnss::ubxSetUart(uint32_t baud) {
  uint8_t pl[20] = {
      0x01, 0x00,  // portID = UART1
      0x00, 0x00,  // txReady
      0xD0, 0x08, 0x00, 0x00,  // mode 8N1
      (uint8_t)(baud & 0xFF), (uint8_t)((baud >> 8) & 0xFF),
      (uint8_t)((baud >> 16) & 0xFF), (uint8_t)((baud >> 24) & 0xFF),
      0x01, 0x00,  // inProtoMask = UBX
      0x03, 0x00,  // outProtoMask = UBX+NMEA
      0x00, 0x00,  // flags
      0x00, 0x00   // reserved
  };
  szLogf("GPS: CFG-PRT baud=%lu...", (unsigned long)baud);
  ubxWrite(0x06, 0x00, pl, sizeof(pl));
  return ubxWaitAck(0x06, 0x00, 1000);
}

bool Gnss::ubxSave() {
  uint8_t pl[12] = {0x00, 0x00, 0x00, 0x00,  // clearMask = nic
                    0x1F, 0x1F, 0x00, 0x00,  // saveMask = wszystko
                    0x00, 0x00, 0x00, 0x00};  // loadMask = nic
  ubxWrite(0x06, 0x09, pl, sizeof(pl));
  return ubxWaitAck(0x06, 0x09, 1000);
}

bool Gnss::setRateMs(uint16_t ms) {
  logIntervalMs_ = ms;
  if (!configured_) {
    szLog(F("GPS: setRateMs - brak konfiguracji, tylko interwal logowania"));
    return false;
  }
  return ubxSetRate(ms);
}
