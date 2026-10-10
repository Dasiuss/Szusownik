#include "espnow_packet.h"

#include <math.h>
#include <string.h>

#include "../config/hud_protocol.h"

namespace {

int16_t clampAngle(int16_t value) {
  if (value < HUD_ANGLE_MIN) return static_cast<int16_t>(HUD_ANGLE_MIN);
  if (value > HUD_ANGLE_MAX) return static_cast<int16_t>(HUD_ANGLE_MAX);
  return value;
}

void putU16(uint8_t* out, uint16_t value) {
  out[0] = static_cast<uint8_t>(value & 0xFF);
  out[1] = static_cast<uint8_t>((value >> 8) & 0xFF);
}

void putI16(uint8_t* out, int16_t value) {
  putU16(out, static_cast<uint16_t>(value));
}

void putI32(uint8_t* out, int32_t value) {
  const uint32_t raw = static_cast<uint32_t>(value);
  out[0] = static_cast<uint8_t>(raw & 0xFF);
  out[1] = static_cast<uint8_t>((raw >> 8) & 0xFF);
  out[2] = static_cast<uint8_t>((raw >> 16) & 0xFF);
  out[3] = static_cast<uint8_t>((raw >> 24) & 0xFF);
}

void putU32(uint8_t* out, uint32_t value) {
  out[0] = static_cast<uint8_t>(value & 0xFF);
  out[1] = static_cast<uint8_t>((value >> 8) & 0xFF);
  out[2] = static_cast<uint8_t>((value >> 16) & 0xFF);
  out[3] = static_cast<uint8_t>((value >> 24) & 0xFF);
}

}  // namespace

size_t encodeHudTelemetry(uint8_t* out, size_t outLen, uint8_t seq, const HudTelemetry& t) {
  if (out == nullptr || outLen < HUD_PKT_TELEMETRY_SIZE) return 0;
  out[0] = static_cast<uint8_t>(HUD_PKT_TELEMETRY);
  out[1] = seq;
  putU16(out + 2, t.speedKmh);
  putI16(out + 4, clampAngle(t.navAngle));
  putU16(out + 6, t.averageKmh);
  putU16(out + 8, t.remaining);
  putU16(out + 10, t.totalTenthsKm);
  out[12] = t.frame ? 0x01 : 0x00;
  out[13] = t.segmentIndex;
  return HUD_PKT_TELEMETRY_SIZE;
}

size_t encodeHudLocation(uint8_t* out, size_t outLen, uint8_t seq, const HudLocation& loc) {
  if (out == nullptr || outLen < HUD_PKT_LOCATION_SIZE) return 0;
  out[0] = static_cast<uint8_t>(HUD_PKT_LOCATION);
  out[1] = seq;
  out[2] = loc.mode;
  out[3] = loc.zoom;
  putI32(out + 4, loc.latE7);
  putI32(out + 8, loc.lonE7);
  putI16(out + 12, loc.heading);
  putU16(out + 14, loc.fisheye);
  out[16] = loc.segmentIndex;
  return HUD_PKT_LOCATION_SIZE;
}

size_t decodeHudHeartbeat(const uint8_t* in, size_t len, HudHeartbeat& out) {
  if (in == nullptr || len < HUD_PKT_HEARTBEAT_SIZE) return 0;
  if (in[0] != static_cast<uint8_t>(HUD_PKT_HEARTBEAT)) return 0;
  out.seq = in[1];
  out.crc = static_cast<uint32_t>(in[2]) | (static_cast<uint32_t>(in[3]) << 8) |
            (static_cast<uint32_t>(in[4]) << 16) | (static_cast<uint32_t>(in[5]) << 24);
  out.hasRoute = (in[6] & 0x01) != 0;
  return HUD_PKT_HEARTBEAT_SIZE;
}

size_t encodeHudRouteChunk(uint8_t* out, size_t outLen, uint8_t seq, uint8_t chunkIndex,
                           uint8_t chunkCount, uint16_t totalLen, uint32_t crc,
                           const uint8_t* payload, uint16_t payloadLen) {
  if (out == nullptr || payloadLen > HUD_ROUTE_CHUNK_BYTES ||
      outLen < static_cast<size_t>(HUD_PKT_ROUTE_HEADER_SIZE) + payloadLen) {
    return 0;
  }
  out[0] = static_cast<uint8_t>(HUD_PKT_ROUTE);
  out[1] = seq;
  out[2] = chunkIndex;
  out[3] = chunkCount;
  putU16(out + 4, totalLen);
  putU32(out + 6, crc);
  if (payloadLen && payload != nullptr) memcpy(out + HUD_PKT_ROUTE_HEADER_SIZE, payload, payloadLen);
  return static_cast<size_t>(HUD_PKT_ROUTE_HEADER_SIZE) + payloadLen;
}

uint16_t hudTenthsKm(float km) {
  if (!(km > 0.0f)) return 0;  // obejmuje też NaN
  const float scaled = km * static_cast<float>(HUD_TOT_SCALE);
  if (scaled >= 65535.0f) return 65535;
  return static_cast<uint16_t>(lroundf(scaled));
}

uint8_t hudModeForSpeed(float kmh) {
  return kmh > HUD_STATS_ABOVE_KMH ? static_cast<uint8_t>(HUD_MODE_STATS)
                                   : static_cast<uint8_t>(HUD_MODE_MAP);
}
