#pragma once
#include <stddef.h>
#include <stdint.h>

#include "../config/hud_protocol.h"

// Pakiety ESP-NOW HUD (Szusownik -> HudRekaw). SSOT: protocol/hud-espnow-v1.json
// (generowane do config/hud_protocol.h). Czysta logika bez Arduino.h, żeby dała
// się pokryć testami hostowymi (firmware/test/host).

struct HudTelemetry {
  uint16_t speedKmh = 0;       // realny
  int16_t navAngle = 0;        // realny kurs; -1 = nieznany
  uint16_t averageKmh = 0;     // pole MAX (tu: max dnia)
  uint16_t remaining = 0;      // pole REM (na razie stałe 0)
  uint16_t totalTenthsKm = 0;  // pole TOT = km * HUD_TOT_SCALE
  bool frame = true;
};

struct HudLocation {
  uint8_t mode = 0;      // HUD_MODE_STATS / HUD_MODE_MAP
  uint8_t zoom = 1;
  int32_t latE7 = 0;
  int32_t lonE7 = 0;
  int16_t heading = 0;   // -1 = nieznany
  uint16_t fisheye = 220;
};

// Zwraca liczbę zapisanych bajtów albo 0, gdy bufor jest za mały.
size_t encodeHudTelemetry(uint8_t* out, size_t outLen, uint8_t seq, const HudTelemetry& t);
size_t encodeHudLocation(uint8_t* out, size_t outLen, uint8_t seq, const HudLocation& loc);

// Dystans [km] -> TOT (km * HUD_TOT_SCALE), z obcięciem do zakresu uint16.
uint16_t hudTenthsKm(float km);
// Tryb HUD wg prędkości: > HUD_STATS_ABOVE_KMH -> statystyki, inaczej mapa.
uint8_t hudModeForSpeed(float kmh);
