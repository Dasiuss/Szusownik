#pragma once
#include <Arduino.h>

// Szusownik v1 — stałe konfiguracyjne. SSOT decyzji: docs/koncepcja.md,
// docs/wymagania-ESP.md, docs/ble-transfer.md.

#define SZ_FW_VERSION "1.4.0-audio"
#define SZ_WIRE_PROTO "szusownik/ble-file-v1"
#define SZ_CSV_HEADER "timestamp,lat,lon,speed,altitude,heading"

// Adaptacyjne próbkowanie (docs/koncepcja.md): <20:0.5Hz, 20-50:1Hz,
// 50-70:3Hz, 70-80:6Hz, >=80:10Hz. Histereza +/-3 km/h.
static const float SZ_HYST_KMH = 3.0f;

// Buzzer (pasywny piezo, GPIO10, sterowanie LEDC z głośnością):
// domyślnie przerwa między sygnałami 1000 ms, cisza poniżej ustawionego progu.
// Mapowanie: 60-69:1, 70-79:2, 80-89:3,
// 90-99:4 krótkie; >=100: długie + krótkie (1 długi na każde 50, reszta
// dziesiątek krótkimi — 120 = 1 długi + 2 krótkie). Im szybciej, tym więcej.
#define SZ_BEEP_INTERVAL_DEFAULT_MS 1000
#define SZ_BEEP_INTERVAL_MIN_MS 100
#define SZ_BEEP_INTERVAL_MAX_MS 5000
// Częstotliwości tonów (ustawialne z PWA przez SETFREQ, trzymane w NVS;
// suwaki 600-1500 Hz, krok 25). Krótki i długi niezależne — użytkownik może
// ustawić krótki >= długi (decyzja: pełna swoboda, bez ostrzeżeń).
#define SZ_FREQ_SHORT_DEFAULT 880   // krótkie ("kropki")
#define SZ_FREQ_LONG_DEFAULT 1100   // długie ("kreski")
#define SZ_FREQ_MIN_HZ 600
#define SZ_FREQ_MAX_HZ 1500
#define SZ_BEEP_SHORT_DEFAULT_MS 56     // -30% względem MVP1 (było 80)
#define SZ_BEEP_SHORT_MIN_MS 20
#define SZ_BEEP_SHORT_MAX_MS 200
#define SZ_BEEP_LONG_DEFAULT_MS 140     // -30% względem MVP1 (było 200)
#define SZ_BEEP_LONG_MIN_MS 40
#define SZ_BEEP_LONG_MAX_MS 500
#define SZ_BEEP_GAP_DEFAULT_MS 60       // -50% względem MVP1 (było 120)
#define SZ_BEEP_GAP_MIN_MS 0
#define SZ_BEEP_GAP_MAX_MS 500
#define SZ_BEEP_MIN_KMH_DEFAULT 60
#define SZ_BEEP_MIN_KMH_MIN 60
#define SZ_BEEP_MIN_KMH_MAX 120

// Głośność adaptacyjna 0..100 (kwadratowe mapowanie na duty LEDC, max 50%).
// Kotwice: volLow przy 60 km/h, volHigh przy 120 km/h, pomiędzy liniowo,
// powyżej 120 wartość z 120. Ustawiane z PWA (SETVOL), trzymane w NVS.
#define SZ_VOL_LOW_KMH 60.0f
#define SZ_VOL_HIGH_KMH 120.0f
#define SZ_VOL_LOW_DEFAULT 20
#define SZ_VOL_HIGH_DEFAULT 70

// Detekcja wyciągu do rotacji (progi do strojenia, wymagania-ESP.md).
#define SZ_LIFT_ALT_GAIN_M 20.0f
#define SZ_LIFT_SPEED_KMH 15.0f
#define SZ_RUNS_PER_FILE 5

// HUD: SPD pokazuje max ostatniego zjazdu gdy prędkość <5 km/h.
#define SZ_SPD_STATIC_BELOW_KMH 5.0f

// Debug: loguj każdy zapis próbki (SAMPLE) na Serial. Do testów na stole;
// docelowo wyłączyć (przy 10 Hz to 10 linii/s).
#define SZ_DEBUG_SAMPLES 1

// Debug: loguj każdy nowy odczyt z odbiornika (FIX) na Serial, niezależnie
// od zapisu do CSV. Do weryfikacji rzeczywistego tempa pomiarów.
#define SZ_DEBUG_FIX 1

// Debug: status GPS + tempo zapisu co 2 s.
#define SZ_DEBUG_STATUS 1

// Tryb stokowy: 1 = cisza na Serial (oszczędność CDC/baterii, mniej zakłóceń).
// Wymusza wygaszenie wszystkich debugów powyżej.
#define SZ_STOK_MODE 0
#if SZ_STOK_MODE
#undef SZ_DEBUG_SAMPLES
#define SZ_DEBUG_SAMPLES 0
#undef SZ_DEBUG_FIX
#define SZ_DEBUG_FIX 0
#undef SZ_DEBUG_STATUS
#define SZ_DEBUG_STATUS 0
#endif

// FIFO: przy mniej niż tyle wolnego miejsca kasuj najstarsze pliki CSV.
#define SZ_SD_MIN_FREE_BYTES (4UL * 1024UL * 1024UL)

// BLE — profil ZAMROŻONY (docs/ble-transfer.md). Zmiana tylko po benchmarku
// na rzeczywistym ESP32 + Androidzie.
#define SZ_BLE_FRAME_SIZE 244
#define SZ_BLE_HEADER_SIZE 4
#define SZ_BLE_PAYLOAD_SIZE 240
#define SZ_BLE_ACK_BLOCK 32
#define SZ_BLE_WINDOW 128
#define SZ_BLE_NOTIFY_MS 4
#define SZ_BLE_ACK_TIMEOUT_MS 500
#define SZ_BLE_ACK_RETRY 3
#define SZ_BLE_INPUT_CHUNK 512

// BLE UUID v1 Szusownika — NOWE, nie mieszać z testowymi 7e6d… / 5f8a….
#define SZ_UUID_SVC "3f9a0001-7c4e-4b2a-9e11-000000000001"
#define SZ_UUID_INFO "3f9a0002-7c4e-4b2a-9e11-000000000002"
#define SZ_UUID_CTRL "3f9a0003-7c4e-4b2a-9e11-000000000003"
#define SZ_UUID_DATA "3f9a0004-7c4e-4b2a-9e11-000000000004"
#define SZ_UUID_STAT "3f9a0005-7c4e-4b2a-9e11-000000000005"
#define SZ_BLE_NAME "Szusownik"
