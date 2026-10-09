#include "display.h"

#include <Fonts/FreeSans9pt7b.h>
#include <Fonts/FreeSansBold12pt7b.h>
#include <Fonts/FreeSansBold24pt7b.h>
#include <math.h>

#include "../config/config.h"
#include "../core/hud_format.h"
#include "../core/map_math.h"
#include "../map/map_data.h"

namespace {

void copyLabelText(char* buffer, uint8_t bufferSize, uint16_t offset, uint8_t length) {
  uint8_t count = length;
  if (count > bufferSize - 1) count = bufferSize - 1;
  for (uint8_t index = 0; index < count; index++) {
    buffer[index] = static_cast<char>(pgm_read_byte(&mapNames[offset + index]));
  }
  buffer[count] = '\0';
}

}  // namespace

bool Display::begin() {
  pinMode(TFT_BL_PIN, OUTPUT);
  digitalWrite(TFT_BL_PIN, LOW);  // podświetlenie aktywne w stanie niskim
  tft_.setSPISpeed(TFT_SPI_HZ);
  tft_.init(TFT_WIDTH, TFT_HEIGHT, SPI_MODE3);
  tft_.setRotation(0);
  tft_.invertDisplay(true);
  tft_.fillScreen(COLOR_BG);
  return true;
}

int16_t Display::findNearestDownhillBearing(float riderEast, float riderNorth, bool* found) {
  int32_t best = 0x7FFFFFFF;
  int16_t bearing = 0;
  *found = false;
  for (uint16_t i = 0; i < MAP_WAY_COUNT; i++) {
    MapWay way;
    memcpy_P(&way, &mapWays[i], sizeof(MapWay));
    if (way.kind != 0 || way.pointCount == 0) continue;
    for (uint16_t j = 0; j < way.pointCount; j++) {
      MapPoint point;
      memcpy_P(&point, &mapPoints[way.firstPoint + j], sizeof(MapPoint));
      const int32_t dx = point.east - static_cast<int32_t>(riderEast);
      const int32_t dy = point.north - static_cast<int32_t>(riderNorth);
      const int32_t distance = dx * dx + dy * dy;
      if (distance < best) {
        best = distance;
        bearing = way.bearing;
        *found = true;
      }
    }
  }
  return bearing;
}

void Display::drawMapPolyline(uint16_t firstPoint, uint16_t pointCount, uint16_t color,
                              float riderEast, float riderNorth, float cosBearing, float sinBearing,
                              float fisheyeK, uint16_t fisheyeRadius) {
  if (pointCount < 2) return;
  MapPoint previous;
  memcpy_P(&previous, &mapPoints[firstPoint], sizeof(MapPoint));
  int16_t previousX;
  int16_t previousY;
  mapProjectPoint(previous.east, previous.north, riderEast, riderNorth, cosBearing, sinBearing,
                  fisheyeRadius, fisheyeK, &previousX, &previousY);
  for (uint16_t index = 1; index < pointCount; index++) {
    MapPoint current;
    memcpy_P(&current, &mapPoints[firstPoint + index], sizeof(MapPoint));
    int16_t currentX;
    int16_t currentY;
    mapProjectPoint(current.east, current.north, riderEast, riderNorth, cosBearing, sinBearing,
                    fisheyeRadius, fisheyeK, &currentX, &currentY);
    const bool bothLeft = previousX < -20 && currentX < -20;
    const bool bothRight = previousX > 259 && currentX > 259;
    const bool bothTop = previousY < -20 && currentY < -20;
    const bool bothBottom = previousY > 259 && currentY > 259;
    if (!(bothLeft || bothRight || bothTop || bothBottom)) {
      tft_.drawLine(previousX, previousY, currentX, currentY, color);
    }
    previousX = currentX;
    previousY = currentY;
  }
}

void Display::drawMapLabels(float riderEast, float riderNorth, float cosBearing, float sinBearing,
                            float fisheyeK, uint16_t fisheyeRadius) {
  MapLabelBox candidates[MAP_MAX_CANDIDATES];
  uint16_t count = 0;

  const auto addCandidate = [&](uint16_t nameOffset, uint8_t nameLength, uint8_t textSize,
                                uint16_t color, uint16_t firstPoint, uint16_t pointCount) {
    if (nameLength == 0 || count >= MAP_MAX_CANDIDATES || pointCount == 0) return;
    MapPoint middle;
    memcpy_P(&middle, &mapPoints[firstPoint + pointCount / 2], sizeof(MapPoint));
    int16_t screenX;
    int16_t screenY;
    mapProjectPoint(middle.east, middle.north, riderEast, riderNorth, cosBearing, sinBearing,
                    fisheyeRadius, fisheyeK, &screenX, &screenY);
    if (screenX < 0 || screenX > 239 || screenY < 0 || screenY > 239) return;

    const int16_t width = static_cast<int16_t>(6 * textSize) * nameLength;
    const int16_t height = static_cast<int16_t>(8 * textSize);
    int16_t left = screenX - width / 2;
    int16_t top = screenY - height / 2;
    if (left < 0) left = 0;
    if (top < 0) top = 0;
    if (left + width > 239) left = 239 - width;
    if (top + height > 239) top = 239 - height;

    const float dx = middle.east - riderEast;
    const float dy = middle.north - riderNorth;
    MapLabelBox& label = candidates[count];
    label.x = left;
    label.y = top;
    label.width = width;
    label.height = height;
    label.nameOffset = nameOffset;
    label.nameLength = nameLength;
    label.textSize = textSize;
    label.color = color;
    label.distanceSq = static_cast<int32_t>(dx * dx + dy * dy);
    count++;
  };

  for (uint16_t i = 0; i < MAP_WAY_COUNT; i++) {
    MapWay way;
    memcpy_P(&way, &mapWays[i], sizeof(MapWay));
    addCandidate(way.nameOffset, way.nameLength, 1, mapWayColor(way.kind, way.difficulty),
                 way.firstPoint, way.pointCount);
  }
  for (uint16_t i = 0; i < MAP_LIFT_COUNT; i++) {
    MapLift lift;
    memcpy_P(&lift, &mapLifts[i], sizeof(MapLift));
    addCandidate(lift.nameOffset, lift.nameLength, 1, COLOR_WHITE, lift.firstPoint, lift.pointCount);
  }

  mapSortLabelsByDistance(candidates, count);

  MapLabelBox placed[MAP_MAX_LABELS];
  for (uint8_t index = 0; index < MAP_MAX_LABELS; index++) placed[index].width = 0;

  uint8_t placedCount = 0;
  for (uint16_t i = 0; i < count && placedCount < MAP_MAX_LABELS; i++) {
    const MapLabelBox& candidate = candidates[i];
    if (mapLabelOverlaps(candidate, placed, placedCount)) continue;
    placed[placedCount++] = candidate;

    char buffer[12];
    copyLabelText(buffer, sizeof(buffer), candidate.nameOffset, candidate.nameLength);
    tft_.setFont(NULL);
    tft_.setTextSize(candidate.textSize);
    tft_.setTextColor(candidate.color);
    tft_.fillRect(candidate.x - 1, candidate.y - 1, candidate.width + 2, candidate.height + 2,
                  COLOR_BG);
    tft_.setCursor(candidate.x, candidate.y);
    tft_.print(buffer);
  }
  tft_.setTextSize(1);
}

void Display::drawRiderDot() {
  tft_.fillCircle(MAP_RIDER_X, MAP_RIDER_Y, 5, COLOR_RIDER);
  tft_.drawCircle(MAP_RIDER_X, MAP_RIDER_Y, 6, COLOR_WHITE);
}

void Display::drawMap(const HudLocation& location) {
  if (metersPerDegLon_ == 0.0f) {
    metersPerDegLon_ =
        111320.0f * cosf((static_cast<float>(MAP_ORIGIN_LAT_E7) / 1e7f) * PI / 180.0f);
  }
  uint8_t zoom = location.zoom;
  if (zoom >= MAP_VIEW_COUNT) zoom = MAP_VIEW_COUNT - 1;
  const float fisheyeK = static_cast<float>(MAP_VIEW_METERS[zoom]);
  const uint16_t fisheyeRadius = location.fisheye;

  const float riderEast = (static_cast<float>(location.lonE7) / 1e7f -
                           static_cast<float>(MAP_ORIGIN_LON_E7) / 1e7f) *
                          metersPerDegLon_;
  const float riderNorth = (static_cast<float>(location.latE7) / 1e7f -
                            static_cast<float>(MAP_ORIGIN_LAT_E7) / 1e7f) *
                           MAP_METERS_PER_DEG_LAT;

  bool found = false;
  const int16_t nearest = findNearestDownhillBearing(riderEast, riderNorth, &found);
  if (found) mapBearing_ = nearest;
  const float cosBearing = cosf(static_cast<float>(mapBearing_) * PI / 180.0f);
  const float sinBearing = sinf(static_cast<float>(mapBearing_) * PI / 180.0f);

  tft_.fillScreen(COLOR_BG);

  for (uint16_t i = 0; i < MAP_WAY_COUNT; i++) {
    MapWay way;
    memcpy_P(&way, &mapWays[i], sizeof(MapWay));
    drawMapPolyline(way.firstPoint, way.pointCount, mapWayColor(way.kind, way.difficulty), riderEast,
                    riderNorth, cosBearing, sinBearing, fisheyeK, fisheyeRadius);
  }
  for (uint16_t i = 0; i < MAP_LIFT_COUNT; i++) {
    MapLift lift;
    memcpy_P(&lift, &mapLifts[i], sizeof(MapLift));
    drawMapPolyline(lift.firstPoint, lift.pointCount, COLOR_LIFT, riderEast, riderNorth, cosBearing,
                    sinBearing, fisheyeK, fisheyeRadius);
  }

  drawMapLabels(riderEast, riderNorth, cosBearing, sinBearing, fisheyeK, fisheyeRadius);
  drawRiderDot();
}

void Display::drawArrow(int16_t centerX, int16_t centerY, int16_t angle, float tipLength,
                        float baseLength, uint16_t color) {
  const float radians = angle * PI / 180.0f;
  const int16_t tipX = centerX + static_cast<int16_t>(sinf(radians) * tipLength);
  const int16_t tipY = centerY - static_cast<int16_t>(cosf(radians) * tipLength);
  const int16_t leftX = centerX + static_cast<int16_t>(sinf(radians + 2.45f) * baseLength);
  const int16_t leftY = centerY - static_cast<int16_t>(cosf(radians + 2.45f) * baseLength);
  const int16_t rightX = centerX + static_cast<int16_t>(sinf(radians - 2.45f) * baseLength);
  const int16_t rightY = centerY - static_cast<int16_t>(cosf(radians - 2.45f) * baseLength);

  tft_.drawLine(centerX, centerY, tipX, tipY, color);
  tft_.drawLine(tipX, tipY, leftX, leftY, color);
  tft_.drawLine(tipX, tipY, rightX, rightY, color);
}

void Display::drawLabel(const char* text, int16_t x, int16_t baseline, uint16_t color) {
  tft_.setFont(&FreeSans9pt7b);
  tft_.setTextColor(color);
  tft_.setCursor(x, baseline);
  tft_.print(text);
}

void Display::drawValueRight(const char* text, int16_t right, int16_t baseline, uint16_t color) {
  tft_.setFont(&FreeSansBold12pt7b);
  int16_t boundX = 0;
  int16_t boundY = 0;
  uint16_t boundW = 0;
  uint16_t boundH = 0;
  tft_.getTextBounds(text, 0, 0, &boundX, &boundY, &boundW, &boundH);
  tft_.setTextColor(color);
  tft_.setCursor(right - static_cast<int16_t>(boundW), baseline);
  tft_.print(text);
}

void Display::drawStatsLayout() {
  tft_.fillScreen(COLOR_BG);
  drawLabel("SPD", 14, 36, COLOR_CYAN);
  drawLabel("REM", 14, 150, COLOR_ORANGE);
  drawLabel("MAX", 14, 188, COLOR_VIOLET);
  drawLabel("TOT", 14, 226, COLOR_YELLOW);
  tft_.drawFastHLine(12, 114, TFT_WIDTH - 24, COLOR_DARK);
  layoutDrawn_ = true;
}

void Display::drawSpeedValue(uint16_t color) {
  char buf[8];
  snprintf(buf, sizeof(buf), "%u", static_cast<unsigned>(lastSpeed_));
  tft_.fillRect(4, 50, 138, 54, COLOR_BG);
  tft_.setFont(&FreeSansBold24pt7b);
  tft_.setTextColor(color);
  tft_.setCursor(14, 92);
  tft_.print(buf);
}

void Display::drawRowValue(uint16_t value, int16_t baseline, uint16_t color) {
  char buf[8];
  snprintf(buf, sizeof(buf), "%u", static_cast<unsigned>(value));
  tft_.fillRect(150, baseline - 22, 86, 30, COLOR_BG);
  drawValueRight(buf, 226, baseline, color);
}

void Display::drawTotalValue(uint16_t tenthsKm, int16_t baseline, uint16_t color) {
  char buf[10];
  hudFormatTenthsKm(tenthsKm, buf, sizeof(buf));
  tft_.fillRect(150, baseline - 22, 86, 30, COLOR_BG);
  drawValueRight(buf, 226, baseline, color);
}

void Display::drawNavArrow(bool fresh) {
  tft_.fillRect(140, 18, 94, 92, COLOR_BG);
  tft_.drawCircle(186, 64, 44, fresh ? COLOR_GREEN : COLOR_DARK);
  drawArrow(186, 64, fresh ? lastAngle_ : 0, 30.0f, 22.0f, fresh ? COLOR_GREEN : COLOR_GRAY);
}

void Display::drawLinkDot(bool fresh) {
  tft_.fillRect(10, 8, 16, 16, COLOR_BG);
  tft_.fillCircle(18, 16, 5, fresh ? COLOR_GREEN : COLOR_RED);
}

void Display::updateStats(const HudTelemetry& telemetry, bool fresh) {
  const uint16_t valueColor = fresh ? COLOR_WHITE : COLOR_GRAY;

  if (!layoutDrawn_) {
    drawStatsLayout();
    lastSpeed_ = lastRemaining_ = lastAverage_ = lastTotal_ = -1;
    lastAngle_ = -1000;
    lastFresh_ = !fresh;
  }

  if (telemetry.speed != lastSpeed_ || fresh != lastFresh_) {
    lastSpeed_ = telemetry.speed;
    drawSpeedValue(valueColor);
  }
  if (telemetry.remaining != lastRemaining_ || fresh != lastFresh_) {
    lastRemaining_ = telemetry.remaining;
    drawRowValue(telemetry.remaining, 150, valueColor);
  }
  if (telemetry.average != lastAverage_ || fresh != lastFresh_) {
    lastAverage_ = telemetry.average;
    drawRowValue(telemetry.average, 188, valueColor);
  }
  if (telemetry.totalTenthsKm != lastTotal_ || fresh != lastFresh_) {
    lastTotal_ = telemetry.totalTenthsKm;
    drawTotalValue(telemetry.totalTenthsKm, 226, valueColor);
  }
  if (telemetry.navAngle != lastAngle_ || fresh != lastFresh_) {
    lastAngle_ = telemetry.navAngle;
    drawNavArrow(fresh);
  }
  if (fresh != lastFresh_) {
    drawLinkDot(fresh);
    lastFresh_ = fresh;
  }
}
