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

// Prośba o parowanie (Szusownik -> broadcast). Jedyne użycie broadcastu: Szusownik
// nie zna jeszcze MAC-a Huda. Odpowiedzią jest `Q` (HudRekaw -> Szusownik), a MAC
// Huda Szusownik bierze z metadanych ESP-NOW (src_addr), nie z treści pakietu.
struct HudPairRequest {
  uint8_t seq = 0;
};

size_t encodeHudPairRequest(uint8_t* out, size_t outLen, uint8_t seq);

// Odpowiedź Huda na prośbę o parowanie.
struct HudPairResponse {
  uint8_t seq = 0;
};

size_t decodeHudPairResponse(const uint8_t* in, size_t len, HudPairResponse& out);

// Potwierdzenie trasy (HudRekaw -> Szusownik): niesie wersję trzymanej trasy
// (CRC32 bloba) i flagę "ma trasę". Zastępuje dawny heartbeat — Szusownik
// przestaje ponawiać wysyłkę, gdy CRC się zgadza (tożsamością jest sam CRC32,
// także dla CLEAR). Dostępność odbiornika daje sprzętowy ACK unicastu.
struct HudRouteConfirm {
  uint8_t seq = 0;
  uint32_t crc = 0;
  bool hasRoute = false;
};

size_t decodeHudRouteConfirm(const uint8_t* in, size_t len, HudRouteConfirm& out);

// Chunk trasy (Szusownik -> HudRekaw): nagłówek 10 B + do HUD_ROUTE_CHUNK_BYTES
// bajtów bloba. HudRekaw składa po chunkIndex i waliduje CRC całości.
size_t encodeHudRouteChunk(uint8_t* out, size_t outLen, uint8_t seq, uint8_t chunkIndex,
                           uint8_t chunkCount, uint16_t totalLen, uint32_t crc,
                           const uint8_t* payload, uint16_t payloadLen);

// Dystans [km] -> TOT (km * HUD_TOT_SCALE), z obcięciem do zakresu uint16.
uint16_t hudTenthsKm(float km);
// Tryb HUD wg prędkości: > HUD_STATS_ABOVE_KMH -> statystyki, inaczej mapa.
uint8_t hudModeForSpeed(float kmh);

// Liczba chunków trasy dla bloba długości `len` (0 dla pustego bloba).
uint8_t hudRouteChunkCount(uint16_t len);
// Długość danych w chunku `chunkIndex` albo 0, gdy indeks jest poza zakresem.
// Chroni przed niedomiarowym `len - offset` (i odczytem poza bloba), gdy trasa
// w trakcie wysyłki zostanie zastąpiona krótszą.
uint16_t hudRouteChunkLen(uint16_t len, uint8_t chunkIndex);

// Czy pakiet `K` (potwierdzenie trasy) pochodzi od sparowanego Huda. Potwierdzenie
// bez sparowanego MAC-a albo z obcego MAC-a jest ignorowane — inaczej po
// sparowaniu innego HudRekaw stary CRC zablokowałby wysyłkę bieżącej trasy.
bool hudConfirmFromPeer(const uint8_t* mac, const uint8_t* peerMac, bool peerValid);

// Okres między oknami nadawania (ms). Gdy łącze nie jest potwierdzone (brak
// niedawnego ACK), nadajemy rzadko (HUD_SEND_BACKOFF_MS), żeby nie grzać radia
// w poszukiwaniu nieobecnego Huda. Przy potwierdzonym łączu okres zależy od
// trybu: statystyki `S` co HUD_SEND_TELEMETRY_MS, mapa `L` co HUD_SEND_LOCATION_MS.
unsigned long hudWindowPeriodMs(bool peerLinked, uint8_t mode);
