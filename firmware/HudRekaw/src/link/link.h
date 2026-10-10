#pragma once
#include <Arduino.h>

#include "../config/hud_protocol.h"
#include "../core/hud_packet.h"
#include "../core/route.h"

// Łączność HudRekaw: hybryda WiFi (sieci z secrets.h, inaczej kanał
// HUD_LINK_CHANNEL) + odbiór ESP-NOW od Szusownika. Tryb ekranu pochodzi
// wyłącznie z pakietu `L` (bajt mode).
//
// Dodatkowo odbiornik nadaje okresowy heartbeat (`H`) z wersją trzymanej trasy
// (CRC32 bloba) i odbiera trasę chunkami (`R`). Szusownik dzięki temu wie, że
// odbiornik jest dostępny i czy potrzebuje nowej trasy (SSOT: route-v1.json).
class Link {
 public:
  void begin();
  void poll();

  void handlePacket(const uint8_t* data, uint8_t len);

  bool espNowReady() const { return espNowReady_; }
  bool wifiConnected() const { return wifiConnected_; }
  int channel() const { return channel_; }

  bool telemetryValid() const { return telemetryValid_; }
  bool locationValid() const { return locationValid_; }
  const HudTelemetry& telemetry() const { return telemetry_; }
  const HudLocation& location() const { return location_; }

  bool linkSeen() const { return linkSeen_; }
  bool linkFresh() const;
  unsigned long lastPacketAgeMs() const;
  uint8_t mode() const { return locationValid_ ? location_.mode : HUD_MODE_STATS; }

  bool takeTelemetryDirty();
  bool takeLocationDirty();

  // Trasa odebrana od Szusownika.
  bool routeHasRoute() const { return routeHasRoute_; }
  uint32_t routeCrc() const { return routeCrc_; }
  const HudRoute& route() const { return route_; }
  bool takeRouteDirty();

 private:
  void startEspNow();
  void useFallbackChannel();
  void wifiStartNext();
  void serviceWifi();
  void sendHeartbeat(unsigned long nowMs);
  void applyRouteChunk(const HudRouteChunk& chunk);
  void commitRoute();

  HudTelemetry telemetry_;
  HudLocation location_;
  bool telemetryValid_ = false;
  bool locationValid_ = false;
  bool linkSeen_ = false;
  volatile unsigned long lastPacketMs_ = 0;
  volatile bool telemetryDirty_ = false;
  volatile bool locationDirty_ = false;

  bool espNowReady_ = false;
  bool wifiConnected_ = false;
  bool wifiSearching_ = false;
  int wifiNetIndex_ = 0;
  unsigned long wifiAttemptStart_ = 0;
  int channel_ = HUD_LINK_CHANNEL;

  // Heartbeat.
  uint8_t heartbeatSeq_ = 0;
  unsigned long lastHeartbeatMs_ = 0;

  // Trasa: bufor składania chunków + zatwierdzona trasa.
  uint8_t routeStage_[ROUTE_MAX_BLOB];
  uint16_t routeStageTotal_ = 0;
  uint16_t routeStageReceived_ = 0;
  uint32_t routeStageCrc_ = 0;
  volatile bool routeCommitPending_ = false;
  HudRoute route_;
  uint32_t routeCrc_ = 0;
  bool routeHasRoute_ = false;
  volatile bool routeDirty_ = false;
};
