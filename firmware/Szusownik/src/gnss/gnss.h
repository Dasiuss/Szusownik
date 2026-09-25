#pragma once
#include <Arduino.h>
#include <TinyGPSPlus.h>

struct GnssSampleQuality {
  bool fixValid = false;
  bool fixAgeValid = false;
  uint32_t fixAgeMs = 0;
  bool satellitesValid = false;
  uint32_t satellites = 0;
  bool satellitesAgeValid = false;
  uint32_t satellitesAgeMs = 0;
  bool hdopValid = false;
  float hdop = 0.0f;
  bool hdopAgeValid = false;
  uint32_t hdopAgeMs = 0;
};

// GNSS u-blox (NEO-M8N) po UART0. Prędkość z Dopplera (odbiornik liczy ją sam,
// my tylko odczytujemy gps.speed). Moduł wydzielony pod przyszłe IMU.
//
// Autokonfiguracja (maintain, aż do skutku):
//   9600 default -> wykryj NMEA -> CFG-RATE 2000 ms (spoczynek) ->
//   CFG-PRT 115200 -> weryfikacja danych -> CFG-CFG zapis do flash.
// Potem pomiar (meas rate) jest przełączany dynamicznie wg pasma prędkości
// (ta sama tabelka co zapis). Każda komenda UBX czeka na ACK/NAK i wszystko
// jest logowane na Serial do debugowania.
class Gnss {
 public:
  bool begin(long baud = 9600);
  void poll();
  void maintain(unsigned long nowMs);  // próba konfiguracji co 5 s aż do skutku
  bool isConfigured() const { return configured_; }
  long baud() const { return baud_; }
  bool setRateMs(uint16_t ms);  // ręczna zmiana meas rate (też do testów)
  void dumpStatus();            // jedna linia statusu na Serial
  bool hasFix();
  GnssSampleQuality sampleQuality();
  float speedKmh();
  double lat();
  double lon();
  float altM();
  float headingDeg();
  uint32_t sats();
  bool timeValid();
  String utcStamp();  // YYYYMMDD_HHMMSS (nazwa pliku)
  String csvStamp();  // YYYY-MM-DDTHH:MM:SS.mmmZ (pole CSV, ms z ESP32)
  int rateHz() const { return rateHz_; }
  unsigned long logIntervalMs() const { return logIntervalMs_; }
  // true raz na nową epokę GNSS (commit RMC = świeża para pozycja+prędkość).
  bool consumeNewSample();

 private:
  TinyGPSPlus gps_;
  int band_ = 0;  // 0:<20 1:20-50 2:50-70 3:70-80 4:>=80
  int rateHz_ = 0;
  unsigned long logIntervalMs_ = 2000;
  long baud_ = 9600;
  bool configured_ = false;
  bool newSample_ = false;
  unsigned long lastAttempt_ = 0;
  uint32_t ubxFails_ = 0;
  int lastStampSec_ = -1;              // ostatnia sekunda GPS w csvStamp()
  unsigned long stampSecAnchorMs_ = 0;  // millis() przy zmianie sekundy (kotwica ms)
  static int bandOf(float kmh);
  static unsigned long bandIntervalMs(int band);
  void updateAdaptiveRate(float kmh);
  bool attemptConfigure();
  bool waitForData(unsigned long timeoutMs, const char* tag);
  void ubxWrite(uint8_t cls, uint8_t id, const uint8_t* pl, uint16_t len);
  bool ubxWaitAck(uint8_t cls, uint8_t id, unsigned long timeoutMs);
  bool ubxSetRate(uint16_t measMs);
  bool ubxSetUart(uint32_t baud);
  bool ubxSave();
};
