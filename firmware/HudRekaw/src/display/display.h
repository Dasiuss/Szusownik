#pragma once
#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <Arduino.h>

#include "../config/config.h"
#include "../core/hud_packet.h"

// ST7789 240x240: statystyki (SPD/REM/MAX/TOT) albo mapa z pozycją. Rysowanie
// jest przyrostowe dla statystyk; mapa przerysowuje całość.
class Display {
 public:
  bool begin();
  void drawStatsLayout();
  void invalidateStats() { layoutDrawn_ = false; }
  void updateStats(const HudTelemetry& telemetry, bool fresh);
  void drawMap(const HudLocation& location);
  Adafruit_ST7789& tft() { return tft_; }

 private:
  Adafruit_ST7789 tft_{TFT_CS_PIN, TFT_DC_PIN, TFT_RST_PIN};

  // Stan renderowania statystyk (przyrostowo).
  bool layoutDrawn_ = false;
  int16_t lastSpeed_ = -1;
  int16_t lastRemaining_ = -1;
  int16_t lastAverage_ = -1;
  int16_t lastTotal_ = -1;
  int16_t lastAngle_ = -1000;
  bool lastFresh_ = false;

  // Stan mapy.
  int16_t mapBearing_ = 0;
  float metersPerDegLon_ = 0.0f;

  int16_t findNearestDownhillBearing(float riderEast, float riderNorth, bool* found);
  void drawMapPolyline(uint16_t firstPoint, uint16_t pointCount, uint16_t color, float riderEast,
                       float riderNorth, float cosBearing, float sinBearing, float fisheyeK,
                       uint16_t fisheyeRadius);
  void drawMapLabels(float riderEast, float riderNorth, float cosBearing, float sinBearing,
                     float fisheyeK, uint16_t fisheyeRadius);
  void drawRiderDot();

  void drawArrow(int16_t centerX, int16_t centerY, int16_t angle, float tipLength, float baseLength,
                 uint16_t color);
  void drawLabel(const char* text, int16_t x, int16_t baseline, uint16_t color);
  void drawValueRight(const char* text, int16_t right, int16_t baseline, uint16_t color);
  void drawSpeedValue(uint16_t color);
  void drawRowValue(uint16_t value, int16_t baseline, uint16_t color);
  void drawTotalValue(uint16_t tenthsKm, int16_t baseline, uint16_t color);
  void drawNavArrow(bool fresh);
  void drawLinkDot(bool fresh);
};
