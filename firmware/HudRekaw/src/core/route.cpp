#include "route.h"

#include <string.h>

namespace {

uint32_t crc32(const uint8_t* data, size_t len) {
  static uint32_t table[256];
  static bool init = false;
  if (!init) {
    for (uint32_t i = 0; i < 256; i++) {
      uint32_t c = i;
      for (int k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
      table[i] = c;
    }
    init = true;
  }
  uint32_t crc = 0xFFFFFFFFu;
  for (size_t i = 0; i < len; i++) crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >> 8);
  return crc ^ 0xFFFFFFFFu;
}

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

}  // namespace

bool hudRouteDecode(const uint8_t* data, size_t len, HudRoute* out) {
  if (out) out->valid = false;
  if (data == nullptr || out == nullptr || len < ROUTE_HEADER_SIZE + ROUTE_CRC_SIZE) return false;
  if (getU16(data + 0) != ROUTE_FORMAT_VERSION) return false;

  const uint16_t pointCount = getU16(data + 10);
  const uint16_t segmentCount = getU16(data + 12);
  if (pointCount > ROUTE_MAX_POINTS || segmentCount > ROUTE_MAX_SEGMENTS) return false;

  const size_t contentLen = len - ROUTE_CRC_SIZE;
  const uint32_t storedCrc =
      static_cast<uint32_t>(getI32(data + contentLen));
  if (crc32(data, contentLen) != storedCrc) return false;

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
    HudRouteStep& step = out->steps[index];
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

const char* hudRouteStepLabel(const HudRoute& route, uint8_t index) {
  if (!route.valid || index >= route.segmentCount) return nullptr;
  return route.steps[index].label;
}
