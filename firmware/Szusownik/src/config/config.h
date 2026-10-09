#pragma once
#include <Arduino.h>
#include "protocol.h"

// Szusownik v1 — stałe konfiguracyjne. SSOT decyzji: docs/koncepcja.md,
// docs/wymagania-ESP.md, docs/ble-transfer.md, docs/jakosc-danych.md.

#define SZ_FW_VERSION "1.8.0-hud-espnow"
// SZ_WIRE_PROTO, SZ_CSV_HEADER i SZ_CSV_META_SUFFIX są w protocol.h.

// Adaptacyjne próbkowanie (docs/koncepcja.md): <20:0.5Hz, 20-50:1Hz,
// 50-70:3Hz, 70-80:6Hz, >=80:10Hz. Histereza +/-3 km/h.
static const float SZ_HYST_KMH = 3.0f;

// Buzzer: mapowanie prędkość -> wzór jest w audio.cpp; zakresy i wartości
// domyślne (częstotliwości, czasy tonów/przerw, próg pikania, głośność) są
// w protocol.h — PWA i firmware czytają te same liczby.


// Rotacja pliku na postoju (wymagania-ESP.md §7). Gdy prędkość spadnie poniżej
// SZ_ROLL_STOP_BELOW_KMH i utrzyma się przez SZ_ROLL_HOLD_MS, bieżący plik jest
// domykany — w chwili odcięcia zasilania otwarty jest już tylko plik z próbkami
// z postoju (bezwartościowy). Ponowne uzbrojenie rolki dopiero po prędkości
// > SZ_ROLL_REARM_ABOVE_KMH przez SZ_ROLL_HOLD_MS, więc jeden postój = jedna
// rolka (bez mnożenia plików); ruch < SZ_ROLL_REARM_ABOVE_KMH nie jest chroniony.
#define SZ_ROLL_STOP_BELOW_KMH 0.3f
#define SZ_ROLL_REARM_ABOVE_KMH 5.0f
#define SZ_ROLL_HOLD_MS 3000UL

// Monitoring zdrowia urzadzenia (modul Health). MVP: termika SoC.
// ESP32-S3 NIE ma sprzetowego zabezpieczenia termicznego, wiec ochrona jest
// programowa: sprawdzenie co SZ_HEALTH_CHECK_MS; po SZ_HEALTH_WARN_CONFIRM
// kolejnych odczytach >= WARN kazdy kolejny odczyt >= WARN daje alarm buzzerem
// (SZ_HEALTH_ALARM_MS). Przy >= CRIT: zamkniecie SD, ekran, alarm i deep sleep.
// Uwaga: temperatureRead() jest slabo skalibrowany bezwzglednie — progi
// ustawione z zapasem (CRIT 100 < junction max 125). Histereza chroni przed
// zatrzasnieciem alarmu po ostygnięciu.
#define SZ_HEALTH_CHECK_MS 30000UL
#define SZ_HEALTH_TEMP_WARN_C 95.0f
#define SZ_HEALTH_TEMP_CRIT_C 100.0f
#define SZ_HEALTH_WARN_CONFIRM 3
#define SZ_HEALTH_ALARM_MS 3000
#define SZ_HEALTH_HYST_C 2.0f

// HUD: próg ruchu dla liczenia dystansu (km). SPD na ekranie pokazuje zawsze
// bieżącą prędkość; hero "max zjazdu" liczy core::RunTracker (port ZigZag z PWA).
#define SZ_SPD_STATIC_BELOW_KMH 5.0f

// HUD: strefa czasowa (minuty) dla wyświetlanego czasu lokalnego (UTC+offset).
#define SZ_HUD_TZ_OFFSET_MIN 60

// Detekcja zjazdu (port ZigZag z web/src/lib/runs.ts): histereza zwrotu
// wysokości, stała czasowa fuzji baro+GPS i twarda granica przerwy.
#define SZ_RUN_REVERSAL_M 5.0f
#define SZ_RUN_ALT_TAU_S 10.0f
#define SZ_RUN_MAX_GAP_MS 3600000UL

// Poziom logowania na Serial: 0=ERR 1=WARN 2=INFO (domyslny) 3=DEBUG.
// INFO = zdarzenia (fix, SD, BLE, health, boot) + cykl transferu BLE;
// DEBUG = status okresowy, per-probka GNSS, diagnostyka UBX/INFO/BLE.
// Wszystko ponizej progu jest wycinane kompilacyjnie (src/config/log.h).
#define SZ_LOG_LEVEL 2

// Linia statusu SYS (DEBUG) i progi ostrzezen.
#define SZ_STATUS_MS 5000UL          // okres linii SYS: GNSS/SD/loop/heap/termika/BLE
#define SZ_SD_SYNC_WARN_MS 100UL     // wolny flush (fsync) -> WARN
#define SZ_LOOP_STALL_WARN_MS 200UL  // dluzsza iteracja petli -> WARN (pierwsza w oknie)

// FIFO: przy mniej niż tyle wolnego miejsca kasuj najstarsze pliki CSV.
#define SZ_SD_MIN_FREE_BYTES (4UL * 1024UL * 1024UL)

// Co tyle ms robimy flush bieżącego pliku (File::flush -> fsync -> FATFS f_sync,
// czyli domknięcie wpisu katalogowego i FAT na karcie). Ogranicza okno utraty
// danych przy odcięciu zasilania w trakcie jazdy; koniec jazdy chroni rolka.
#define SZ_SD_COMMIT_MS 10000UL

// BLE — profil ZAMROŻONY (docs/ble-transfer.md). Wszystkie stałe protokołu
// (ramki, okno, ACK, UUID, nazwa) są w protocol.h — zmiana tylko po benchmarku
// na rzeczywistym ESP32 + Androidzie.

