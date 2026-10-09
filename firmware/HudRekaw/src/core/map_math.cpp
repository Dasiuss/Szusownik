#include "map_math.h"

#include <math.h>

#include "../config/config.h"

namespace {

const int32_t CLAMP_MIN = -400;
const int32_t CLAMP_MAX = 640;

int16_t clampCoord(int32_t value) {
  if (value < CLAMP_MIN) return static_cast<int16_t>(CLAMP_MIN);
  if (value > CLAMP_MAX) return static_cast<int16_t>(CLAMP_MAX);
  return static_cast<int16_t>(value);
}

}  // namespace

void mapProjectPoint(int16_t east, int16_t north, float riderEast, float riderNorth, float cosBearing,
                     float sinBearing, uint16_t fisheyeRadius, float fisheyeK, int16_t* outX,
                     int16_t* outY) {
  const float dx = static_cast<float>(east) - riderEast;
  const float dy = static_cast<float>(north) - riderNorth;
  const float rotatedX = dx * cosBearing - dy * sinBearing;
  const float rotatedY = -dx * sinBearing - dy * cosBearing;
  const float worldRadius = sqrtf(rotatedX * rotatedX + rotatedY * rotatedY);
  const float factor = static_cast<float>(fisheyeRadius) / (worldRadius + fisheyeK);
  *outX = clampCoord(MAP_RIDER_X + static_cast<int32_t>(rotatedX * factor));
  *outY = clampCoord(MAP_RIDER_Y + static_cast<int32_t>(rotatedY * factor));
}

uint16_t mapWayColor(uint8_t kind, uint8_t difficulty) {
  if (kind == 1) return COLOR_SNOWPARK;
  if (kind == 2) return COLOR_CONNECTION;
  switch (difficulty) {
    case 0: return COLOR_NOVICE;
    case 1: return COLOR_EASY;
    case 2: return COLOR_INTERMEDIATE;
    case 3: return COLOR_ADVANCED;
    case 4: return COLOR_FREERIDE;
    default: return COLOR_UNKNOWN;
  }
}

bool mapLabelOverlaps(const MapLabelBox& label, const MapLabelBox* placed, int placedCount) {
  if (placed == nullptr) return false;
  for (int index = 0; index < placedCount; index++) {
    const MapLabelBox& other = placed[index];
    if (other.width == 0) continue;
    if (!(label.x + label.width <= other.x || other.x + other.width <= label.x ||
          label.y + label.height <= other.y || other.y + other.height <= label.y)) {
      return true;
    }
  }
  return false;
}

void mapSortLabelsByDistance(MapLabelBox* labels, int count) {
  if (labels == nullptr) return;
  for (int i = 1; i < count; i++) {
    const MapLabelBox key = labels[i];
    int j = i - 1;
    while (j >= 0 && labels[j].distanceSq > key.distanceSq) {
      labels[j + 1] = labels[j];
      j--;
    }
    labels[j + 1] = key;
  }
}
