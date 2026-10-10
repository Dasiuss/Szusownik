#include "route.h"

#include <math.h>
#include <string.h>

#include "../ble/crc32.h"

namespace {

constexpr double kPi = 3.14159265358979323846;

uint16_t getU16(const uint8_t* in) {
  return static_cast<uint16_t>(in[0]) | (static_cast<uint16_t>(in[1]) << 8);
}

int16_t getI16(const uint8_t* in) {
  return static_cast<int16_t>(getU16(in));
}

int32_t getI32(const uint8_t* in) {
  return static_cast<int32_t>(static_cast<uint32_t>(in[0]) |
                              (static_cast<uint32_t>(in[1]) << 8) |
                              (static_cast<uint32_t>(in[2]) << 16) |
                              (static_cast<uint32_t>(in[3]) << 24));
}

void putU16(uint8_t* out, uint16_t value) {
  out[0] = static_cast<uint8_t>(value & 0xFF);
  out[1] = static_cast<uint8_t>((value >> 8) & 0xFF);
}

void putU32(uint8_t* out, uint32_t value) {
  out[0] = static_cast<uint8_t>(value & 0xFF);
  out[1] = static_cast<uint8_t>((value >> 8) & 0xFF);
  out[2] = static_cast<uint8_t>((value >> 16) & 0xFF);
  out[3] = static_cast<uint8_t>((value >> 24) & 0xFF);
}

// Pozycja GNSS -> metry względem origin trasy (te same stałe co PWA/HudRekaw).
void toLocalMeters(const RouteData& route, double lat, double lon, double* east, double* north) {
  const double originLat = static_cast<double>(route.originLatE7) / 1e7;
  const double originLon = static_cast<double>(route.originLonE7) / 1e7;
  const double lonScale =
      static_cast<double>(ROUTE_METERS_PER_DEG_LON) * cos(originLat * kPi / 180.0);
  *east = (lon - originLon) * lonScale;
  *north = (lat - originLat) * static_cast<double>(ROUTE_METERS_PER_DEG_LAT);
}

}  // namespace

size_t routeBuildEmpty(uint8_t* out, size_t outLen) {
  const size_t size = ROUTE_HEADER_SIZE + ROUTE_CRC_SIZE;
  if (out == nullptr || outLen < size) return 0;
  memset(out, 0, size);
  putU16(out + 0, ROUTE_FORMAT_VERSION);
  const uint32_t crc = szCrc32Final(szCrc32Update(SZ_CRC32_INIT, out, ROUTE_HEADER_SIZE));
  putU32(out + ROUTE_HEADER_SIZE, crc);
  return size;
}

bool routeDecode(const uint8_t* data, size_t len, RouteData* out) {
  if (out) out->valid = false;
  if (data == nullptr || out == nullptr || len < ROUTE_HEADER_SIZE + ROUTE_CRC_SIZE) return false;
  if (getU16(data + 0) != ROUTE_FORMAT_VERSION) return false;

  const uint16_t pointCount = getU16(data + 10);
  const uint16_t segmentCount = getU16(data + 12);
  if (pointCount > ROUTE_MAX_POINTS || segmentCount > ROUTE_MAX_SEGMENTS) return false;

  const size_t contentLen = len - ROUTE_CRC_SIZE;
  const uint32_t storedCrc = getI32(data + contentLen) & 0xFFFFFFFFu;
  const uint32_t actualCrc = szCrc32Final(szCrc32Update(SZ_CRC32_INIT, data, contentLen));
  if (storedCrc != actualCrc) return false;

  out->valid = true;
  out->crc = storedCrc;
  out->originLatE7 = getI32(data + 2);
  out->originLonE7 = getI32(data + 6);
  out->pointCount = pointCount;
  out->segmentCount = segmentCount;
  out->totalDistanceM = getU16(data + 14);

  size_t offset = ROUTE_HEADER_SIZE;
  if (offset + static_cast<size_t>(pointCount) * ROUTE_POINT_SIZE > contentLen) {
    out->valid = false;
    return false;
  }
  for (uint16_t index = 0; index < pointCount; index++) {
    out->east[index] = getI16(data + offset);
    out->north[index] = getI16(data + offset + 2);
    offset += ROUTE_POINT_SIZE;
  }

  for (uint16_t index = 0; index < segmentCount; index++) {
    if (offset + ROUTE_SEGMENT_HEADER_SIZE > contentLen) {
      out->valid = false;
      return false;
    }
    RouteStep& step = out->steps[index];
    step.kind = data[offset];
    const uint8_t labelLength = data[offset + 1];
    step.startDistM = getU16(data + offset + 2);
    step.endDistM = getU16(data + offset + 4);
    offset += ROUTE_SEGMENT_HEADER_SIZE;
    if (labelLength > ROUTE_MAX_LABEL || offset + labelLength > contentLen) {
      out->valid = false;
      return false;
    }
    memcpy(step.label, data + offset, labelLength);
    step.label[labelLength] = '\0';
    step.labelLength = labelLength;
    offset += labelLength;
  }
  return true;
}

uint8_t routeSegmentIndex(const RouteData& route, double lat, double lon) {
  if (!route.valid || route.pointCount < 2) return HUD_SEGMENT_NONE;
  double riderEast = 0.0;
  double riderNorth = 0.0;
  toLocalMeters(route, lat, lon, &riderEast, &riderNorth);

  double best = 1e18;
  double cumulative = 0.0;
  double bestCumulative = 0.0;
  for (uint16_t index = 0; index < route.pointCount; index++) {
    if (index > 0) {
      const double dx = static_cast<double>(route.east[index]) - route.east[index - 1];
      const double dy = static_cast<double>(route.north[index]) - route.north[index - 1];
      cumulative += sqrt(dx * dx + dy * dy);
    }
    const double dx = static_cast<double>(route.east[index]) - riderEast;
    const double dy = static_cast<double>(route.north[index]) - riderNorth;
    const double distanceSq = dx * dx + dy * dy;
    if (distanceSq < best) {
      best = distanceSq;
      bestCumulative = cumulative;
    }
  }

  for (uint16_t index = 0; index < route.segmentCount; index++) {
    if (bestCumulative >= route.steps[index].startDistM &&
        bestCumulative < route.steps[index].endDistM) {
      return static_cast<uint8_t>(index);
    }
  }
  return route.segmentCount > 0 ? static_cast<uint8_t>(route.segmentCount - 1) : HUD_SEGMENT_NONE;
}

float routeDistanceToEndM(const RouteData& route, double lat, double lon) {
  if (!route.valid || route.pointCount == 0) return -1.0f;
  double riderEast = 0.0;
  double riderNorth = 0.0;
  toLocalMeters(route, lat, lon, &riderEast, &riderNorth);
  const double last = route.pointCount - 1;
  const double dx = static_cast<double>(route.east[static_cast<uint16_t>(last)]) - riderEast;
  const double dy = static_cast<double>(route.north[static_cast<uint16_t>(last)]) - riderNorth;
  return static_cast<float>(sqrt(dx * dx + dy * dy));
}
