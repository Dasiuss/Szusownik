#include "link.h"

#include <ESP8266WiFi.h>
#include <espnow.h>

#include "../config/config.h"
#include "../config/wifi_secrets.h"

namespace {

Link* gLink = nullptr;
const uint8_t kBroadcast[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

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
  // Peer broadcast, żeby móc nadawać heartbeat do Szusownika (kanał 1).
  esp_now_add_peer(const_cast<uint8_t*>(kBroadcast), ESP_NOW_ROLE_COMBO, HUD_LINK_CHANNEL,
                   nullptr, 0);
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
  } else if (data[0] == static_cast<uint8_t>(HUD_PKT_ROUTE)) {
    HudRouteChunk chunk;
    if (decodeHudRouteChunk(data, len, chunk) == 0) return;
    applyRouteChunk(chunk);
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

bool Link::takeRouteDirty() {
  const bool dirty = routeDirty_;
  routeDirty_ = false;
  return dirty;
}

bool Link::linkFresh() const {
  return linkSeen_ && (millis() - lastPacketMs_ < LINK_TIMEOUT_MS);
}

unsigned long Link::lastPacketAgeMs() const {
  return linkSeen_ ? (millis() - lastPacketMs_) : 0;
}

// Składanie chunków trasy. Bufor i dekodowanie poza kontekstem callbacku
// (w poll()), żeby nie przepełnić małego stosu zadania WiFi/loop na ESP8266.
void Link::applyRouteChunk(const HudRouteChunk& chunk) {
  if (chunk.totalLen < ROUTE_HEADER_SIZE + ROUTE_CRC_SIZE || chunk.totalLen > ROUTE_MAX_BLOB) return;
  if (chunk.chunkIndex == 0) {
    routeStageTotal_ = chunk.totalLen;
    routeStageCrc_ = chunk.crc;
    routeStageReceived_ = 0;
  }
  if (chunk.totalLen != routeStageTotal_ || chunk.crc != routeStageCrc_) return;
  const uint32_t offset = static_cast<uint32_t>(chunk.chunkIndex) * HUD_ROUTE_CHUNK_BYTES;
  if (offset + chunk.payloadLen > routeStageTotal_) return;
  memcpy(routeStage_ + offset, chunk.payload, chunk.payloadLen);
  const uint16_t end = static_cast<uint16_t>(offset + chunk.payloadLen);
  if (end > routeStageReceived_) routeStageReceived_ = end;
  if (routeStageReceived_ >= routeStageTotal_) routeCommitPending_ = true;
}

void Link::commitRoute() {
  routeCommitPending_ = false;
  if (!hudRouteDecode(routeStage_, routeStageTotal_, &route_)) {
    Serial.printf("[%s] route decode fail len=%u\n", HUDREKAW_VERSION, routeStageTotal_);
    return;
  }
  routeCrc_ = route_.crc;
  routeHasRoute_ = route_.pointCount > 0;
  routeDirty_ = true;
  Serial.printf("[%s] route crc=%08X points=%u steps=%u\n", HUDREKAW_VERSION, route_.crc,
                route_.pointCount, route_.segmentCount);
}

void Link::sendHeartbeat(unsigned long nowMs) {
  if (!espNowReady_) return;
  if (nowMs - lastHeartbeatMs_ < HUD_HEARTBEAT_MS) return;
  lastHeartbeatMs_ = nowMs;
  uint8_t packet[HUD_PKT_HEARTBEAT_SIZE];
  const size_t len =
      encodeHudHeartbeat(packet, sizeof(packet), heartbeatSeq_++, routeCrc_, routeHasRoute_);
  if (len) esp_now_send(const_cast<uint8_t*>(kBroadcast), packet, len);
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
  if (routeCommitPending_) commitRoute();
  sendHeartbeat(millis());

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
