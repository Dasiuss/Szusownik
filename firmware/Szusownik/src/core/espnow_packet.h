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
  uint8_t segmentIndex = HUD_SEGMENT_NONE;  // bieżący odcinek trasy (na dole ekranu)
};

struct HudLocation {
  uint8_t mode = 0;      // HUD_MODE_STATS / HUD_MODE_MAP
  uint8_t zoom = 1;
  int32_t latE7 = 0;
  int32_t lonE7 = 0;
  int16_t heading = 0;   // -1 = nieznany
  uint16_t fisheye = 220;
  uint8_t segmentIndex = HUD_SEGMENT_NONE;  // bieżący odcinek trasy
};

// Zwraca liczbę zapisanych bajtów albo 0, gdy bufor jest za mały.
size_t encodeHudTelemetry(uint8_t* out, size_t outLen, uint8_t seq, const HudTelemetry& t);
size_t encodeHudLocation(uint8_t* out, size_t outLen, uint8_t seq, const HudLocation& loc);

// Heartbeat odbiornika (HudRekaw -> Szusownik): niesie wersję trzymanej trasy
// (CRC32 bloba) i flagę "ma trasę". Szusownik wysyła trasę tylko, gdy wersje
// się różnią — to jednocześnie wykrywanie dostępności odbiornika.
struct HudHeartbeat {
  uint8_t seq = 0;
  uint32_t crc = 0;
  bool hasRoute = false;
};

size_t decodeHudHeartbeat(const uint8_t* in, size_t len, HudHeartbeat& out);

// Chunk trasy (Szusownik -> HudRekaw): nagłówek 10 B + do HUD_ROUTE_CHUNK_BYTES
// bajtów bloba. HudRekaw składa po chunkIndex i waliduje CRC całości.
size_t encodeHudRouteChunk(uint8_t* out, size_t outLen, uint8_t seq, uint8_t chunkIndex,
                           uint8_t chunkCount, uint16_t totalLen, uint32_t crc,
                           const uint8_t* payload, uint16_t payloadLen);

// Dystans [km] -> TOT (km * HUD_TOT_SCALE), z obcięciem do zakresu uint16.
uint16_t hudTenthsKm(float km);
// Tryb HUD wg prędkości: > HUD_STATS_ABOVE_KMH -> statystyki, inaczej mapa.
uint8_t hudModeForSpeed(float kmh);
