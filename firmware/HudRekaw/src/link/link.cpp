#include "link.h"

#include <ESP8266WiFi.h>
#include <espnow.h>

#include "../config/config.h"
#include "../config/wifi_secrets.h"

namespace {

Link* gLink = nullptr;

void onEspNowRecv(uint8_t* mac, uint8_t* data, uint8_t len) {
  (void)mac;
  if (gLink != nullptr) gLink->handlePacket(data, len);
}

}  // namespace

void Link::begin() {
  gLink = this;

  WiFi.persistent(false);
  WiFi.mode(WIFI_AP_STA);
  WiFi.setAutoReconnect(false);
  WiFi.hostname(HUDREKAW_DEVICE_NAME);
  WiFi.softAP(HUDREKAW_AP_SSID, HUDREKAW_AP_PASSWORD, HUD_LINK_CHANNEL);
  Serial.printf("[%s] SoftAP '%s' at %s\n", HUDREKAW_VERSION, HUDREKAW_AP_SSID,
                WiFi.softAPIP().toString().c_str());

  startEspNow();
  wifiStartNext();
}

void Link::startEspNow() {
  if (esp_now_init() != 0) {
    Serial.printf("[%s] ESP-NOW init failed\n", HUDREKAW_VERSION);
    return;
  }
  esp_now_set_self_role(ESP_NOW_ROLE_COMBO);
  esp_now_register_recv_cb(onEspNowRecv);
  espNowReady_ = true;
  Serial.printf("[%s] ESP-NOW ready (receiver), ch=%d\n", HUDREKAW_VERSION, HUD_LINK_CHANNEL);
}

void Link::handlePacket(const uint8_t* data, uint8_t len) {
  if (data == nullptr || len < 3) return;

  if (data[0] == static_cast<uint8_t>(HUD_PKT_TELEMETRY)) {
    HudTelemetry decoded;
    if (decodeHudTelemetry(data, len, decoded) == 0) return;
    telemetry_ = decoded;
    telemetryValid_ = true;
    telemetryDirty_ = true;
    linkSeen_ = true;
    lastPacketMs_ = millis();
  } else if (data[0] == static_cast<uint8_t>(HUD_PKT_LOCATION)) {
    HudLocation decoded;
    if (decodeHudLocation(data, len, decoded) == 0) return;
    location_ = decoded;
    locationValid_ = true;
    locationDirty_ = true;
    linkSeen_ = true;
    lastPacketMs_ = millis();
  }
}

bool Link::takeTelemetryDirty() {
  const bool dirty = telemetryDirty_;
  telemetryDirty_ = false;
  return dirty;
}

bool Link::takeLocationDirty() {
  const bool dirty = locationDirty_;
  locationDirty_ = false;
  return dirty;
}

bool Link::linkFresh() const {
  return linkSeen_ && (millis() - lastPacketMs_ < LINK_TIMEOUT_MS);
}

unsigned long Link::lastPacketAgeMs() const {
  return linkSeen_ ? (millis() - lastPacketMs_) : 0;
}

void Link::useFallbackChannel() {
  wifi_set_channel(HUD_LINK_CHANNEL);
  channel_ = HUD_LINK_CHANNEL;
  Serial.printf("[%s] ESP-NOW fallback channel %d\n", HUDREKAW_VERSION, HUD_LINK_CHANNEL);
}

void Link::wifiStartNext() {
#if WIFI_NETWORK_COUNT > 0
  WiFi.disconnect();
  WiFi.begin(WIFI_SSIDS[wifiNetIndex_], WIFI_PASSES[wifiNetIndex_]);
  Serial.printf("[%s] WiFi: trying %s\n", HUDREKAW_VERSION, WIFI_SSIDS[wifiNetIndex_]);
  wifiNetIndex_ = (wifiNetIndex_ + 1) % WIFI_NETWORK_COUNT;
  wifiAttemptStart_ = millis();
  wifiSearching_ = true;
#else
  useFallbackChannel();
  wifiAttemptStart_ = millis();
  wifiSearching_ = false;
#endif
}

void Link::poll() {
  if (wifiConnected_) {
    if (WiFi.status() != WL_CONNECTED) {
      wifiConnected_ = false;
      wifiSearching_ = false;
      wifiAttemptStart_ = millis();
      useFallbackChannel();
    }
    return;
  }
  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected_ = true;
    wifiSearching_ = false;
    channel_ = WiFi.channel();
    Serial.printf("[%s] WiFi connected: %s channel=%d rssi=%d ip=%s\n", HUDREKAW_VERSION,
                  WiFi.SSID().c_str(), WiFi.channel(), WiFi.RSSI(),
                  WiFi.localIP().toString().c_str());
    return;
  }
  const unsigned long elapsed = millis() - wifiAttemptStart_;
  if (wifiSearching_) {
    if (elapsed > NET_ATTEMPT_TIMEOUT_MS) {
      wifiSearching_ = false;
      wifiAttemptStart_ = millis();
      useFallbackChannel();
    }
  } else if (elapsed > NET_SEARCH_INTERVAL_MS) {
    wifiStartNext();
  }
}
