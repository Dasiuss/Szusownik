// HudRekaw v1 — ESP8266 (NodeMCU) + ST7789 240x240. Odbiornik ESP-NOW od
// Szusownika: rysuje mapę z bieżącą pozycją (postój/wolno) albo statystyki
// (w ruchu). Szczegóły: docs/hud-rekaw.md.
#include <Arduino.h>

#include "src/config/config.h"
#include "src/display/display.h"
#include "src/link/link.h"
#include "src/web/web.h"

static Display display;
static Link link;
static Web web;

static uint8_t lastMode = 0xFF;
static bool lastFresh = false;

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\nHudRekaw %s\n", HUDREKAW_VERSION);

  display.begin();
  display.drawStatsLayout();
  link.begin();
  web.begin(&link);
}

void loop() {
  web.poll();
  link.poll();

  const uint8_t mode = link.mode();
  const bool fresh = link.linkFresh();

  if (mode == HUD_MODE_MAP) {
    if (link.locationValid() && (link.takeLocationDirty() || mode != lastMode)) {
      // Zmiana trybu wymusza rysunek; inaczej decyduje martwa strefa w drawMap.
      display.drawMap(link.location(), mode != lastMode);
    }
  } else {
    if (mode != lastMode) display.invalidateStats();
    const bool dirty = link.takeTelemetryDirty();
    if (dirty || mode != lastMode || fresh != lastFresh) {
      display.updateStats(link.telemetry(), fresh);
    }
  }

  lastMode = mode;
  lastFresh = fresh;
  delay(1);
}
