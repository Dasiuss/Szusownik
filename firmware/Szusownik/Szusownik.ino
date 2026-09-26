// Szusownik v1 — ESP32-S3-Zero, budowanie: arduino-cli (nie PlatformIO).
// FQBN: esp32:esp32:esp32s3:FlashSize=4M,PSRAM=enabled,USBMode=hwcdc,CDCOnBoot=cdc
// SSOT pinout: firmware/README.md
#include <Arduino.h>
#include <esp_system.h>
#include <TinyGPSPlus.h>
#include "src/config/pins.h"
#include "src/config/config.h"
#include "src/config/log.h"
#include "src/gnss/gnss.h"
#include "src/storage/storage.h"
#include "src/audio/audio.h"
#include "src/hud/hud.h"
#include "src/baro/baro.h"
#include "src/ble/ble.h"
#include "src/health/health.h"

static Gnss gnss;
static Storage storage;
static Beeper beeper;
static Hud hud;
static Baro baro;
static BleFiles ble;
static Health health;

// Statystyki dnia (reset przy restarcie = "max dnia od włączenia").
static float maxDayKmh = 0.0f;
static float maxLastKmh = 0.0f;
static float totalKm = 0.0f;
static double prevLat = 0.0, prevLon = 0.0;
static bool havePrev = false;
static bool runActive = false;

static unsigned long nextHud = 0;
static unsigned long nextSync = 0;

// Miernik tempa zapisu i epok GNSS w oknie statusu.
static uint32_t totalSamples = 0;   // wiersze zapisane od startu
static uint32_t windowSamples = 0;  // wiersze w bieżącym oknie
static uint32_t windowEpochs = 0;   // epoki GNSS w bieżącym oknie
static unsigned long lastEpochMs = 0;
static unsigned long maxEpochGapMs = 0;
static unsigned long windowStart = 0;

// Zdarzenia (przejścia) — logowane raz, nie co próbkę.
static bool prevFix = false;
static bool prevTimeValid = false;

// Zdrowie pętli.
static unsigned long lastLoopMs = 0;
static unsigned long maxLoopMs = 0;
static uint32_t loopStallCount = 0;
static bool loopStallWarned = false;
static uint32_t loopIterations = 0;

static const char* resetReasonName(esp_reset_reason_t r) {
  switch (r) {
    case ESP_RST_POWERON: return "poweron";
    case ESP_RST_EXT: return "external";
    case ESP_RST_SW: return "software";
    case ESP_RST_PANIC: return "panic";
    case ESP_RST_INT_WDT: return "int_wdt";
    case ESP_RST_TASK_WDT: return "task_wdt";
    case ESP_RST_WDT: return "wdt";
    case ESP_RST_BROWNOUT: return "brownout";
    case ESP_RST_SDIO: return "sdio";
    default: return "other";
  }
}

void setup() {
  Serial.begin(115200);
  unsigned long t0 = millis();
  while (!Serial && millis() - t0 < 1500) {
  }
  SZ_LOGIF("Szusownik %s proto=%s", SZ_FW_VERSION, SZ_WIRE_PROTO);
  SZ_LOGIF("BOOT reset=%s heap=%lu psram=%lu", resetReasonName(esp_reset_reason()),
           (unsigned long)ESP.getFreeHeap(), (unsigned long)ESP.getFreePsram());

  gnss.begin(9600);  // NEO-M8N default; reszta (rate/baud/zapis) w gnss.maintain()
  if (!storage.begin()) {
    SZ_LOGE("SD blad init");
  } else {
    SZ_LOGI("SD ok");  // plik powstanie dopiero przy poprawnej dacie/czasie GNSS
  }
  if (!hud.begin()) {
    SZ_LOGE("OLED blad init");
  }
  if (!baro.begin()) {
    SZ_LOGE("BARO blad init");
  } else if (baro.read()) {
    SZ_LOGIF("BARO %s @0x%02X P=%.1f Pa T=%.1f C alt=%.1f m", baro.typeName(), baro.address(),
             baro.pressurePa(), baro.tempC(), baro.altitudeM());
  } else {
    SZ_LOGIF("BARO %s @0x%02X (odczyt blad)", baro.typeName(), baro.address());
  }
  beeper.begin();
  beeper.playBoot();  // sygnał 120 (1 długi + 2 krótkie) przy głośności 60
  ble.setBeeper(&beeper);
  ble.begin(&storage);
  health.begin(&storage, &beeper, &hud, &baro);

  windowStart = millis();
  nextSync = windowStart + SZ_SD_COMMIT_MS;
  SZ_LOGI("BOOT ok");
}

void loop() {
  unsigned long now = millis();

  // --- zdrowie pętli (wykrywa blokady I2C/SD/BLE/Serial) ---
  if (lastLoopMs) {
    unsigned long dt = now - lastLoopMs;
    if (dt > maxLoopMs) maxLoopMs = dt;
    if (dt >= SZ_LOOP_STALL_WARN_MS) {
      loopStallCount++;
      if (!loopStallWarned) {
        SZ_LOGWF("SYS loop stall %lums", dt);
        loopStallWarned = true;
      }
    }
  }
  lastLoopMs = now;
  loopIterations++;

  gnss.poll();
  gnss.maintain(now);  // autokonfiguracja UBX (co 5 s aż do skutku) + logi
  bool fix = gnss.hasFix();
  float kmh = fix ? gnss.speedKmh() : 0.0f;

  // Zdarzenia GNSS (raz na przejście, nie per próbka).
  if (fix != prevFix) {
    if (fix) {
      SZ_LOGIF("GNSS fix acquired sats=%lu hdop=%.2f", (unsigned long)gnss.sats(), gnss.hdop());
    } else {
      SZ_LOGIF("GNSS fix lost (sats=%lu age=%lums)", (unsigned long)gnss.sats(),
               gnss.locationAgeMs());
    }
    prevFix = fix;
  }
  if (!prevTimeValid && gnss.timeValid()) {
    prevTimeValid = true;
    SZ_LOGI("GNSS UTC valid (mozna tworzyc plik)");
  }

  // Rolka na postoju: domyka plik, gdy stoimy (chroni dane przed odcięciem
  // zasilania). Wołane co iterację (na millis), nie tylko na nowej próbce.
  storage.updateFileRotation(kmh, fix);

  // Statystyki: dystans z kolejnych fixów (haversine), max dnia / ostatniego zjazdu.
  if (fix) {
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

  // Zapis na nadejście nowej próbki GNSS (commit RMC), nie na zegarze pętli.
  // Gwarantuje 1 wiersz = 1 pomiar i brak duplikatów przy dudnieniu zegarów.
  if (gnss.consumeNewSample()) {
    windowEpochs++;
    if (lastEpochMs) {
      unsigned long gap = now - lastEpochMs;
      if (gap > maxEpochGapMs) maxEpochGapMs = gap;
    }
    lastEpochMs = now;

#if SZ_LOG_LEVEL >= 3
    // Jedyna per-próbka linia (DEBUG). Wycinana kompilacyjnie w produkcji —
    // dane per próbka są trwale w CSV, a status okresowy wystarcza do oceny.
    SZ_LOGDF("GNSS smpl ok=%d spd=%.1f sats=%lu hdop=%.2f age=%lums altBaro=%.1f "
             "lat=%.6f lon=%.6f alt=%.1f hdg=%.0f",
             fix ? 1 : 0, kmh, (unsigned long)gnss.sats(), gnss.hdop(), gnss.locationAgeMs(),
             baro.valid() ? baro.altitudeM() : 0.0f, gnss.lat(), gnss.lon(), gnss.altM(),
             gnss.headingDeg());
#endif

    if (fix) {
      // Plik powstaje dopiero, gdy GNSS poda poprawną datę/czas (nazwa = UTC).
      // Bez tego nie nazwiemy pliku, więc próbkę pomijamy i nie dotykamy SD.
      if (storage.isReady() && !storage.isOpen()) {
        String stamp = gnss.utcStamp();
        if (stamp.length()) storage.openLog(stamp);
      }
      if (storage.isReady() && storage.isOpen()) {
        // baro.read() aktualizuje cache; przy chwilowym bledzie zostaje ostatni
        // poprawny odczyt (bez zera w CSV).
        if (baro.present()) baro.read();
        bool baroOk = baro.present() && baro.valid();
        float baroAlt = baroOk ? baro.altitudeM() : 0.0f;
        const GnssSampleQuality quality = gnss.sampleQuality();
        storage.writeSample(gnss.csvStamp(), gnss.lat(), gnss.lon(), kmh, gnss.altM(),
                            gnss.headingDeg(), baroAlt, quality);
        totalSamples++;
        windowSamples++;
      }
    }
  }

  if (now >= nextSync) {
    nextSync = now + SZ_SD_COMMIT_MS;
    storage.sync();
  }
  if (now >= nextHud) {
    nextHud = now + 500;
    hud.draw(kmh, maxDayKmh, totalKm, maxLastKmh, fix);
  }

  // Jedna linia statusu (DEBUG) zamiast dawnych "GPS:" + "LOG:".
  if (now - windowStart >= SZ_STATUS_MS) {
    unsigned long win = now - windowStart;
    float sampleHz = win ? windowSamples * 1000.0f / (float)win : 0.0f;
    float epochHz = win ? windowEpochs * 1000.0f / (float)win : 0.0f;
    float loopAvg = loopIterations ? (float)win / (float)loopIterations : 0.0f;
    float airC = (baro.present() && baro.valid()) ? baro.tempC() : 0.0f;
    SZ_LOGDF("SYS fix=%d sats=%lu hdop=%.2f age=%lums band=%d rate=%lums cfg=%d chars=%lu "
             "ubxfail=%lu | sd=%s file=%s wr=%lu err=%lu syncMax=%lums | "
             "smp=%.2fHz ep=%.2fHz gapMax=%lums | loop=%.1f/%lums stall=%lu | "
             "heap=%lu min=%lu psram=%lu | die=%.1f air=%.1f | ble=%s mtu=%u",
             gnss.hasFix() ? 1 : 0, (unsigned long)gnss.sats(), gnss.hdop(), gnss.locationAgeMs(),
             gnss.band(), gnss.logIntervalMs(), gnss.isConfigured() ? 1 : 0,
             (unsigned long)gnss.charsProcessed(), (unsigned long)gnss.ubxFails(),
             storage.isOpen() ? "open" : "idle", storage.currentName().c_str(),
             (unsigned long)totalSamples, (unsigned long)storage.writeErrors(),
             storage.syncMaxMs(), sampleHz, epochHz, maxEpochGapMs, loopAvg, maxLoopMs,
             (unsigned long)loopStallCount, (unsigned long)ESP.getFreeHeap(),
             (unsigned long)ESP.getMinFreeHeap(), (unsigned long)ESP.getFreePsram(),
             temperatureRead(), airC, ble.busy() ? "xfer" : "idle", (unsigned)ble.mtu());

    windowStart = now;
    windowSamples = 0;
    windowEpochs = 0;
    maxEpochGapMs = 0;
    maxLoopMs = 0;
    loopStallCount = 0;
    loopStallWarned = false;
    loopIterations = 0;
    storage.resetSyncStats();
  }

  beeper.tick(kmh, now);
  health.tick(now);  // termika: alarm >95C, deep sleep >100C
  ble.poll();  // callback BLE tylko ustawia flagi (poll czyta CTRL); bez blokowania SD
}
