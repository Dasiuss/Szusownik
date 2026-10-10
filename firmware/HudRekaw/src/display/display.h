#pragma once
#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <Arduino.h>

#include "../config/config.h"
#include "../core/hud_packet.h"
#include "../core/route.h"

// ST7789 240x240: statystyki (SPD/REM/MAX/TOT) albo mapa z pozycją. Rysowanie
// jest przyrostowe dla statystyk; mapa przerysowuje całość, ale tylko po
// przekroczeniu martwej strefy (ruch/kurs/zoom/fisheye albo force). Zwraca true
// gdy faktycznie przerysowała.
//
// Gdy Szusownik przekazał trasę, mapa rysuje ją wyróżnioną (gruba niebieska
// linia), a na dole pojawiają się bieżący i następne odcinki trasy.
class Display {
 public:
  bool begin();
  void drawStatsLayout();
  void invalidateStats() { layoutDrawn_ = false; }
  void updateStats(const HudTelemetry& telemetry, const HudRoute& route, bool fresh);
  bool drawMap(const HudLocation& location, const HudRoute& route, bool force);
  Adafruit_ST7789& tft() { return tft_; }

 private:
  Adafruit_ST7789 tft_{TFT_CS_PIN, TFT_DC_PIN, TFT_RST_PIN};

  // Stan renderowania statystyk (przyrostowo).
  bool layoutDrawn_ = false;
  bool layoutWithRoute_ = false;
  int16_t statTotBaseline_ = 226;
  int16_t lastSegmentIndex_ = -1;
  bool lastRouteActive_ = false;
  int16_t lastSpeed_ = -1;
  int16_t lastRemaining_ = -1;
  int16_t lastAverage_ = -1;
  int16_t lastTotal_ = -1;
  int16_t lastAngle_ = -1000;
  bool lastFresh_ = false;

  // Stan mapy.
  int16_t mapBearing_ = 0;
  float metersPerDegLon_ = 0.0f;
  // Ostatnio narysowany widok — podstawa martwej strefy przerysowania.
  bool mapDrawn_ = false;
  float mapDrawnEast_ = 0.0f;
  float mapDrawnNorth_ = 0.0f;
  int16_t mapDrawnBearing_ = 0;
  uint8_t mapDrawnZoom_ = 0;
  uint16_t mapDrawnFisheye_ = 0;
  uint32_t mapDrawnRouteCrc_ = 0;

  int16_t findNearestDownhillBearing(float riderEast, float riderNorth, bool* found);
  // Odcinek niskopoziomowy (writePixel) — tylko wewnątrz jednej transakcji SPI.
  void drawMapLine(int16_t x0, int16_t y0, int16_t x1, int16_t y1, uint16_t color);
  void drawMapPolyline(uint16_t firstPoint, uint16_t pointCount, uint16_t color, float riderEast,
                       float riderNorth, float cosBearing, float sinBearing, float fisheyeK,
                       uint16_t fisheyeRadius);
  void drawRoute(const HudRoute& route, float riderEast, float riderNorth, float cosBearing,
                 float sinBearing, float fisheyeK, uint16_t fisheyeRadius);
  void drawMapLabels(float riderEast, float riderNorth, float cosBearing, float sinBearing,
                     float fisheyeK, uint16_t fisheyeRadius);
  void drawRouteSteps(const HudRoute& route, uint8_t segmentIndex, int16_t firstY,
                      int16_t lineStep);
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
