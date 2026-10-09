#include "web.h"

#include <ArduinoOTA.h>
#include <ESP8266HTTPUpdateServer.h>
#include <ESP8266WebServer.h>
#include <ESP8266mDNS.h>

#include "../config/config.h"
#include "../config/wifi_secrets.h"
#include "../core/hud_format.h"
#include "../link/link.h"

namespace {

ESP8266WebServer httpServer(80);
ESP8266HTTPUpdateServer httpUpdater;

}  // namespace

void Web::begin(Link* link) {
  link_ = link;
  httpServer.on("/", [this]() { handleRoot(); });
  httpUpdater.setup(&httpServer, "/update", "admin", OTA_PASSWORD);
  httpServer.begin();

  ArduinoOTA.setHostname(HUDREKAW_DEVICE_NAME);
  ArduinoOTA.setPassword(OTA_PASSWORD);
  ArduinoOTA.onStart([]() { Serial.printf("[%s] OTA update starting\n", HUDREKAW_VERSION); });
  ArduinoOTA.onEnd([]() { Serial.printf("[%s] OTA update finished\n", HUDREKAW_VERSION); });
  ArduinoOTA.begin();
}

void Web::poll() {
  httpServer.handleClient();
  ArduinoOTA.handle();

  if (link_ != nullptr && link_->wifiConnected() && !mdnsStarted_) {
    MDNS.begin(HUDREKAW_DEVICE_NAME);
    MDNS.addService("http", "tcp", 80);
    mdnsStarted_ = true;
  }
  if (mdnsStarted_) MDNS.update();
}

void Web::handleRoot() {
  const bool fresh = link_ != nullptr && link_->linkFresh();
  String html = F("<!DOCTYPE html><html><head><meta charset='utf-8'>");
  html += F("<meta name='viewport' content='width=device-width,initial-scale=1'>");
  html += F("<title>HudRekaw</title></head><body style='font-family:sans-serif'>");
  html += F("<h2>HudRekaw</h2>");
  html += "<p>Version: " + String(HUDREKAW_VERSION) + "</p>";
  if (link_ != nullptr) {
    html += "<p>WiFi: " +
            (link_->wifiConnected() ? WiFi.SSID() : String("disconnected")) +
            " channel: " + String(link_->channel()) + "</p>";
    html += "<p>ESP-NOW: " + String(link_->espNowReady() ? "ready" : "off") + ", link: " +
            (fresh ? String("fresh") : String("stale")) + ", last packet: " +
            (link_->linkSeen() ? String(link_->lastPacketAgeMs()) + " ms ago" : String("never")) +
            "</p>";
    const HudTelemetry& t = link_->telemetry();
    char total[10];
    hudFormatTenthsKm(t.totalTenthsKm, total, sizeof(total));
    html += "<ul>";
    html += "<li>SPD " + String(t.speed) + "</li>";
    html += "<li>REM " + String(t.remaining) + "</li>";
    html += "<li>MAX " + String(t.average) + "</li>";
    html += "<li>TOT " + String(total) + " km</li>";
    html += "<li>NAV " + String(t.navAngle) + "</li>";
    html += "</ul>";
  }
  html += F("<p><a href='/update'>Firmware update</a></p></body></html>");
  httpServer.send(200, "text/html", html);
}
