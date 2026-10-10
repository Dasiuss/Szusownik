#pragma once
#include <stddef.h>
#include <stdint.h>

#include "../config/hud_protocol.h"

// Dekodowanie pakietów ESP-NOW HUD (Szusownik -> HudRekaw). Czysta logika bez
// Arduino.h — testy hostowe w firmware/test/host/hudrekaw/.

struct HudTelemetry {
  uint16_t speed = 0;
  int16_t navAngle = 0;
  uint16_t average = 0;       // pole MAX
  uint16_t remaining = 0;     // pole REM
  uint16_t totalTenthsKm = 0; // pole TOT = km * HUD_TOT_SCALE
  bool frame = true;
  uint8_t segmentIndex = HUD_SEGMENT_NONE; // bieżący odcinek trasy
};

struct HudLocation {
  uint8_t mode = 0;
  uint8_t zoom = 1;
  int32_t latE7 = 0;
  int32_t lonE7 = 0;
  int16_t heading = -1;
  uint16_t fisheye = 220;
  uint8_t segmentIndex = HUD_SEGMENT_NONE; // bieżący odcinek trasy
};

// Zwraca liczbę skonsumowanych bajtów albo 0, gdy pakiet jest niepoprawny.
size_t decodeHudTelemetry(const uint8_t* in, size_t len, HudTelemetry& out);
size_t decodeHudLocation(const uint8_t* in, size_t len, HudLocation& out);

// Heartbeat wysyłany przez HudRekaw do Szusownika: wersja trzymanej trasy
// (CRC32 bloba) + flaga "ma trasę". Szusownik dzięki temu wie, że odbiornik
// jest dostępny i czy potrzebuje nowej trasy.
size_t encodeHudHeartbeat(uint8_t* out, size_t outLen, uint8_t seq, uint32_t crc, bool hasRoute);

// Chunk trasy odebrany od Szusownika (payload wskazuje w buforze wejściowym).
struct HudRouteChunk {
  uint8_t seq = 0;
  uint8_t chunkIndex = 0;
  uint8_t chunkCount = 0;
  uint16_t totalLen = 0;
  uint32_t crc = 0;
  const uint8_t* payload = nullptr;
  uint16_t payloadLen = 0;
};

size_t decodeHudRouteChunk(const uint8_t* in, size_t len, HudRouteChunk& out);
