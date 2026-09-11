// Szusownik v1 — ESP32-S3-Zero, budowanie: arduino-cli (nie PlatformIO).
// FQBN: esp32:esp32:esp32s3:FlashSize=4M,PSRAM=enabled,USBMode=hwcdc,CDCOnBoot=cdc
// SSOT pinout: firmware/README.md
#include <Arduino.h>
#include <TinyGPSPlus.h>
#include "src/config/pins.h"
#include "src/config/config.h"
#include "src/config/log.h"
#include "src/gnss/gnss.h"
#include "src/storage/storage.h"
#include "src/audio/audio.h"
#include "src/hud/hud.h"
#include "src/ble/ble.h"

static Gnss gnss;
static Storage storage;
static Beeper beeper;
static Hud hud;
static BleFiles ble;

// Statystyki dnia (reset przy restarcie = "max dnia od włączenia").
static float maxDayKmh = 0.0f;
static float maxLastKmh = 0.0f;
static float totalKm = 0.0f;
static double prevLat = 0.0, prevLon = 0.0;
static bool havePrev = false;
static bool runActive = false;

static unsigned long nextLog = 0;
static unsigned long nextHud = 0;
static unsigned long nextSync = 0;
static unsigned long nextGpsLog = 0;

// Miernik tempa zapisu (dowód, że logujemy każdy pomiar, nie co 1 s).
static uint32_t sampleCount = 0;
static uint32_t totalSamples = 0;
static unsigned long rateWindowStart = 0;

void setup() {
  Serial.begin(115200);
  unsigned long t0 = millis();
  while (!Serial && millis() - t0 < 1500) {
  }
  szLogf("Szusownik %s proto=%s", SZ_FW_VERSION, SZ_WIRE_PROTO);

  gnss.begin(9600);  // NEO-M8N default; reszta (rate/baud/zapis) w gnss.maintain()
  if (!storage.begin()) {
    szLog("SD: blad init");
  } else {
    storage.openLog("");
    szLog("SD: ok");
  }
  if (!hud.begin()) {
    szLog("OLED: blad init");
  }
  beeper.begin();
  // Test buzzera: 3 krótkie piknięcia na starcie.
  for (int i = 0; i < 3; i++) {
    tone(PIN_BUZZER, SZ_BEEP_FREQ_HZ, 120);
    delay(300);
  }
  ble.begin(&storage);
  szLog("boot ok");
}

void loop() {
  unsigned long now = millis();
  gnss.poll();
  gnss.maintain(now);  // autokonfiguracja UBX (co 5 s aż do skutku) + logi
  float kmh = gnss.hasFix() ? gnss.speedKmh() : 0.0f;

  // Statystyki: dystans z kolejnych fixów (haversine), max dnia / ostatniego zjazdu.
  if (gnss.hasFix()) {
    if (kmh > maxDayKmh) maxDayKmh = kmh;
    if (kmh >= SZ_SPD_STATIC_BELOW_KMH) {
      runActive = true;
      if (kmh > maxLastKmh) maxLastKmh = kmh;
      double la = gnss.lat(), lo = gnss.lon();
      if (havePrev) {
        double d = TinyGPSPlus::distanceBetween(prevLat, prevLon, la, lo);
        if (d >= 0.0 && d < 200.0) totalKm += (float)(d / 1000.0);
      }
      prevLat = la;
      prevLon = lo;
      havePrev = true;
    } else if (runActive) {
      runActive = false;  // koniec zjazdu — maxLast zamrożone do następnego
    }
  }

  // Zapis wg adaptacyjnego interwału z GNSS (0.5-10 Hz).
  if (now >= nextLog) {
    nextLog = now + gnss.logIntervalMs();
    if (gnss.hasFix()) {
      if (!storage.isOpen()) storage.openLog(gnss.utcStamp());
      storage.writeSample(gnss.csvStamp(), gnss.lat(), gnss.lon(), kmh, gnss.altM(),
                          gnss.headingDeg());
      storage.noteSample(kmh, gnss.altM());
      sampleCount++;
      totalSamples++;
#if SZ_DEBUG_SAMPLES
      szLogf("SAMPLE spd=%.1f sats=%lu", kmh, (unsigned long)gnss.sats());
#endif
    }
  }
  if (now >= nextSync) {
    nextSync = now + 5000;
    storage.sync();
  }
  if (now >= nextHud) {
    nextHud = now + 500;
    hud.draw(kmh, maxDayKmh, totalKm, maxLastKmh, gnss.hasFix());
  }
#if SZ_DEBUG_STATUS
  if (now >= nextGpsLog) {
    nextGpsLog = now + 2000;
    gnss.dumpStatus();
    unsigned long dt = now - rateWindowStart;
    float hz = dt ? (sampleCount * 1000.0f / (float)dt) : 0.0f;
    szLogf("LOG: samples=%lu rate=%.2fHz total=%lu", (unsigned long)sampleCount, hz,
           (unsigned long)totalSamples);
    sampleCount = 0;
    rateWindowStart = now;
  }
#endif

  beeper.tick(kmh, now);
  ble.poll();  // callback BLE tylko ustawia flagi (poll czyta CTRL); bez blokowania SD
}
