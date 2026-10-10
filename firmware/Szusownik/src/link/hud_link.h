#pragma once
#include <Arduino.h>

#include "../core/espnow_packet.h"

// Wejście do nadajnika HUD (zbierane w głównej pętli z GNSS i statystyk).
struct HudInput {
  bool fix = false;
  float speedKmh = 0.0f;
  uint16_t maxDayKmh = 0;
  int16_t heading = 0;
  float totalKm = 0.0f;
  int32_t latE7 = 0;
  int32_t lonE7 = 0;
  uint8_t segmentIndex = 255;  // HUD_SEGMENT_NONE — bieżący odcinek trasy
};

// Nadajnik ESP-NOW do HudRekaw (kanał HUD_LINK_CHANNEL, broadcast).
// Tryb wg prędkości: > HUD_STATS_ABOVE_KMH → statystyki (tylko `S` co 1 s),
// inaczej mapa (tylko `L` co 5 s). Zmiana trybu → natychmiast jeden `L`
// (odbiornik poznaje tryb wyłącznie z pakietu `L`). Przy `paused` (transfer
// BLE) wysyłka jest wstrzymana, żeby nie zabierać pasma wspólnemu radiu.
//
// Dodatkowo odbiera heartbeat HudRekaw (`H`) i — gdy odbiornik jest dostępny i
// trzyma inną wersję trasy — wysyła blob trasy chunkami (`R`). Tożsamość trasy
// to CRC32 bloba (SSOT: protocol/route-v1.json).
class HudLink {
 public:
  bool begin();
  bool ready() const { return ready_; }
  void setRoute(const uint8_t* data, uint16_t len, uint32_t crc);
  void tick(unsigned long nowMs, const HudInput& in, bool paused);
  void handlePacket(const uint8_t* data, size_t len);

 private:
  bool ready_ = false;
  uint8_t seqS_ = 0;
  uint8_t seqL_ = 0;
  int lastMode_ = -1;
  unsigned long lastSMs_ = 0;
  unsigned long lastLMs_ = 0;
  bool haveFix_ = false;
  int32_t lastLatE7_ = 0;
  int32_t lastLonE7_ = 0;
  int16_t lastHeading_ = -1;
  uint8_t lastSegmentIndex_ = 255;  // HUD_SEGMENT_NONE

  // Trasa do przekazania + stan odbiornika (z heartbeatu).
  const uint8_t* routeData_ = nullptr;
  uint16_t routeLen_ = 0;
  uint32_t routeCrc_ = 0;
  bool peerSeen_ = false;
  unsigned long lastHeartbeatMs_ = 0;
  uint32_t peerRouteCrc_ = 0;
  bool peerHasRoute_ = false;
  uint8_t routeSeq_ = 0;
  uint8_t routeChunk_ = 0;
  uint8_t routeCycle_ = 0;
  bool routeSending_ = false;
  unsigned long lastChunkMs_ = 0;

  void sendTelemetry(unsigned long nowMs, const HudInput& in);
  bool sendLocation(unsigned long nowMs, uint8_t mode);
  void serviceRoute(unsigned long nowMs);
};
