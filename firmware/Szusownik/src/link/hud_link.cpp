#include "hud_link.h"

#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <math.h>

#include "../config/log.h"

namespace {

const uint8_t kBroadcast[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

HudLink* g_hudSelf = nullptr;

// ESP32 (core 3.x): callback odbioru ma sygnaturę z esp_now_recv_info_t*.
void onHudRecv(const esp_now_recv_info_t*, const uint8_t* data, int len) {
  if (g_hudSelf != nullptr) g_hudSelf->handlePacket(data, static_cast<size_t>(len));
}

}  // namespace

bool HudLink::begin() {
  g_hudSelf = this;
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();  // bez asocjacji — tylko ESP-NOW na stałym kanale
  if (esp_now_init() != ESP_OK) {
    SZ_LOGE("HUD esp-now init fail");
    return false;
  }
  esp_now_peer_info_t peer;
  memset(&peer, 0, sizeof(peer));
  memcpy(peer.peer_addr, kBroadcast, sizeof(kBroadcast));
  peer.channel = HUD_LINK_CHANNEL;
  peer.encrypt = false;
  peer.ifidx = WIFI_IF_STA;
  if (esp_now_add_peer(&peer) != ESP_OK) {
    SZ_LOGWF("HUD esp-now add peer fail");
  }
  esp_now_register_recv_cb(onHudRecv);
  esp_wifi_set_channel(HUD_LINK_CHANNEL, WIFI_SECOND_CHAN_NONE);
  ready_ = true;
  SZ_LOGIF("HUD esp-now ready ch=%d", HUD_LINK_CHANNEL);
  return true;
}

void HudLink::setRoute(const uint8_t* data, uint16_t len, uint32_t crc) {
  if (routeData_ == data && routeLen_ == len && routeCrc_ == crc) return;
  routeData_ = data;
  routeLen_ = len;
  routeCrc_ = crc;
  // Nowa trasa: zaczynamy wysyłkę od nowa (peer potwierdzi w heartbeacie).
  routeSending_ = false;
  routeCycle_ = 0;
}

void HudLink::handlePacket(const uint8_t* data, size_t len) {
  if (data == nullptr) return;
  if (data[0] == static_cast<uint8_t>(HUD_PKT_HEARTBEAT)) {
    HudHeartbeat heartbeat;
    if (decodeHudHeartbeat(data, len, heartbeat) == 0) return;
    peerSeen_ = true;
    lastHeartbeatMs_ = millis();
    peerRouteCrc_ = heartbeat.crc;
    peerHasRoute_ = heartbeat.hasRoute;
  }
}

void HudLink::tick(unsigned long nowMs, const HudInput& in, bool paused) {
  if (!ready_) return;

  const uint8_t mode = hudModeForSpeed(in.speedKmh);
  const bool modeChanged = static_cast<int>(mode) != lastMode_;
  lastMode_ = mode;
  lastSegmentIndex_ = in.segmentIndex;

  if (paused) return;  // transfer BLE ma priorytet — nie zabieramy radia

  if (mode == HUD_MODE_MAP) {
    const bool firstFix = in.fix && !haveFix_;
    if (in.fix) {
      haveFix_ = true;
      lastLatE7_ = in.latE7;
      lastLonE7_ = in.lonE7;
      lastHeading_ = in.heading;
    }
    if (haveFix_ && (modeChanged || firstFix || nowMs - lastLMs_ >= HUD_SEND_LOCATION_MS)) {
      sendLocation(nowMs, HUD_MODE_MAP);
    }
  } else {
    if (modeChanged && haveFix_) {
      // Jednorazowy `L` z mode=STATS — odbiornik przełącza się na statystyki.
      sendLocation(nowMs, HUD_MODE_STATS);
    }
    if (nowMs - lastSMs_ >= HUD_SEND_TELEMETRY_MS) {
      sendTelemetry(nowMs, in);
    }
  }

  serviceRoute(nowMs);
}

void HudLink::sendTelemetry(unsigned long nowMs, const HudInput& in) {
  HudTelemetry t;
  const float speed = in.speedKmh > 0.0f ? in.speedKmh : 0.0f;
  t.speedKmh = static_cast<uint16_t>(lroundf(speed));
  t.navAngle = in.heading;
  t.averageKmh = in.maxDayKmh;
  t.remaining = 0;  // REM — na razie stałe
  t.totalTenthsKm = hudTenthsKm(in.totalKm);
  t.frame = true;
  t.segmentIndex = in.segmentIndex;

  uint8_t packet[HUD_PKT_TELEMETRY_SIZE];
  if (encodeHudTelemetry(packet, sizeof(packet), seqS_++, t)) {
    esp_now_send(kBroadcast, packet, HUD_PKT_TELEMETRY_SIZE);
  }
  lastSMs_ = nowMs;
}

bool HudLink::sendLocation(unsigned long nowMs, uint8_t mode) {
  HudLocation loc;
  loc.mode = mode;
  loc.zoom = HUD_LOCATION_ZOOM;
  loc.latE7 = lastLatE7_;
  loc.lonE7 = lastLonE7_;
  loc.heading = lastHeading_;
  loc.fisheye = HUD_FISHEYE;
  loc.segmentIndex = haveFix_ ? lastSegmentIndex_ : HUD_SEGMENT_NONE;

  uint8_t packet[HUD_PKT_LOCATION_SIZE];
  if (!encodeHudLocation(packet, sizeof(packet), seqL_++, loc)) return false;
  esp_now_send(kBroadcast, packet, HUD_PKT_LOCATION_SIZE);
  lastLMs_ = nowMs;
  return true;
}

void HudLink::serviceRoute(unsigned long nowMs) {
  if (routeData_ == nullptr || routeLen_ == 0) return;
  const bool peerFresh = peerSeen_ && (nowMs - lastHeartbeatMs_ <= HUD_HEARTBEAT_TIMEOUT_MS);
  if (!peerFresh) {
    routeSending_ = false;
    routeCycle_ = 0;
    return;
  }
  if (peerHasRoute_ && peerRouteCrc_ == routeCrc_) {
    routeSending_ = false;
    routeCycle_ = 0;
    return;  // odbiornik ma już tę wersję
  }

  const uint8_t chunkCount = static_cast<uint8_t>(
      (static_cast<uint32_t>(routeLen_) + HUD_ROUTE_CHUNK_BYTES - 1) / HUD_ROUTE_CHUNK_BYTES);
  if (!routeSending_) {
    routeSending_ = true;
    routeChunk_ = 0;
    routeCycle_ = 0;
    lastChunkMs_ = 0;
  }
  if (nowMs - lastChunkMs_ < HUD_ROUTE_CHUNK_MS) return;
  if (routeChunk_ >= chunkCount) {
    routeChunk_ = 0;
    routeCycle_++;
    if (routeCycle_ >= HUD_ROUTE_MAX_CYCLES) {
      routeSending_ = false;  // brak potwierdzenia — czekamy na kolejny heartbeat
      return;
    }
  }

  const uint16_t offset = static_cast<uint16_t>(routeChunk_) * HUD_ROUTE_CHUNK_BYTES;
  uint16_t payloadLen = static_cast<uint16_t>(routeLen_ - offset);
  if (payloadLen > HUD_ROUTE_CHUNK_BYTES) payloadLen = HUD_ROUTE_CHUNK_BYTES;
  uint8_t packet[HUD_PKT_ROUTE_SIZE];
  const size_t len = encodeHudRouteChunk(packet, sizeof(packet), routeSeq_++, routeChunk_,
                                         chunkCount, routeLen_, routeCrc_, routeData_ + offset,
                                         payloadLen);
  if (len) esp_now_send(kBroadcast, packet, len);
  routeChunk_++;
  lastChunkMs_ = nowMs;
}
