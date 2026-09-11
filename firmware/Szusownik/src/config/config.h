#pragma once
#include <Arduino.h>

// Szusownik v1 — stałe konfiguracyjne. SSOT decyzji: docs/koncepcja.md,
// docs/wymagania-ESP.md, docs/ble-transfer.md.

#define SZ_FW_VERSION "1.0.0-mvp1"
#define SZ_WIRE_PROTO "szusownik/ble-file-v1"
#define SZ_CSV_HEADER "timestamp,lat,lon,speed,altitude,heading"

// Adaptacyjne próbkowanie (docs/koncepcja.md): <20:0.5Hz, 20-50:1Hz,
// 50-70:3Hz, 70-80:6Hz, >=80:10Hz. Histereza +/-3 km/h.
static const float SZ_HYST_KMH = 3.0f;

// Buzzer: sygnał co 1 s (konfigurowalny), cisza <60 km/h.
#define SZ_BEEP_INTERVAL_MS 1000
#define SZ_BEEP_FREQ_HZ 2800
#define SZ_RECORD_FREQ_HZ 3200
#define SZ_SILENCE_BELOW_KMH 60.0f

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
