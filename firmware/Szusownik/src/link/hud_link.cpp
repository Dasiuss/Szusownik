#include "hud_link.h"

#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <math.h>

#include "../config/log.h"

namespace {

const uint8_t kBroadcast[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

}  // namespace

bool HudLink::begin() {
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
  esp_wifi_set_channel(HUD_LINK_CHANNEL, WIFI_SECOND_CHAN_NONE);
  ready_ = true;
  SZ_LOGIF("HUD esp-now ready ch=%d", HUD_LINK_CHANNEL);
  return true;
}

void HudLink::tick(unsigned long nowMs, const HudInput& in, bool paused) {
  if (!ready_ || paused) return;

  const uint8_t mode = hudModeForSpeed(in.speedKmh);
  const bool modeChanged = static_cast<int>(mode) != lastMode_;
  lastMode_ = mode;

  if (mode == HUD_MODE_MAP) {
    const bool firstFix = in.fix && !haveFix_;
    if (in.fix) {
      haveFix_ = true;
      lastLatE7_ = in.latE7;
      lastLonE7_ = in.lonE7;
      lastHeading_ = in.heading;
    }
    if (!haveFix_) return;  // bez żadnej pozycji nie ma czego rysować
    if (modeChanged || firstFix || nowMs - lastLMs_ >= HUD_SEND_LOCATION_MS) {
      sendLocation(nowMs, HUD_MODE_MAP);
    }
    return;
  }

  if (modeChanged && haveFix_) {
    // Jednorazowy `L` z mode=STATS — odbiornik przełącza się na statystyki.
    sendLocation(nowMs, HUD_MODE_STATS);
  }
  if (nowMs - lastSMs_ >= HUD_SEND_TELEMETRY_MS) {
    sendTelemetry(nowMs, in);
  }
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

  uint8_t packet[HUD_PKT_LOCATION_SIZE];
  if (!encodeHudLocation(packet, sizeof(packet), seqL_++, loc)) return false;
  esp_now_send(kBroadcast, packet, HUD_PKT_LOCATION_SIZE);
  lastLMs_ = nowMs;
  return true;
}
