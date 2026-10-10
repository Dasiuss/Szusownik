#include "hud_packet.h"

namespace {

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

uint32_t getU32(const uint8_t* in) {
  return static_cast<uint32_t>(in[0]) | (static_cast<uint32_t>(in[1]) << 8) |
         (static_cast<uint32_t>(in[2]) << 16) | (static_cast<uint32_t>(in[3]) << 24);
}

}  // namespace

size_t decodeHudTelemetry(const uint8_t* in, size_t len, HudTelemetry& out) {
  if (in == nullptr || len < HUD_PKT_TELEMETRY_SIZE) return 0;
  if (in[0] != static_cast<uint8_t>(HUD_PKT_TELEMETRY)) return 0;
  out.speed = getU16(in + 2);
  out.navAngle = getI16(in + 4);
  if (out.navAngle < HUD_ANGLE_MIN) out.navAngle = static_cast<int16_t>(HUD_ANGLE_MIN);
  if (out.navAngle > HUD_ANGLE_MAX) out.navAngle = static_cast<int16_t>(HUD_ANGLE_MAX);
  out.average = getU16(in + 6);
  out.remaining = getU16(in + 8);
  out.totalTenthsKm = getU16(in + 10);
  out.frame = (in[12] & 0x01) != 0;
  out.segmentIndex = in[13];
  return HUD_PKT_TELEMETRY_SIZE;
}

size_t decodeHudLocation(const uint8_t* in, size_t len, HudLocation& out) {
  if (in == nullptr || len < HUD_PKT_LOCATION_SIZE) return 0;
  if (in[0] != static_cast<uint8_t>(HUD_PKT_LOCATION)) return 0;
  out.mode = in[2];
  out.zoom = in[3];
  out.latE7 = getI32(in + 4);
  out.lonE7 = getI32(in + 8);
  out.heading = getI16(in + 12);
  out.fisheye = getU16(in + 14);
  if (out.fisheye < HUD_FISHEYE_MIN) out.fisheye = static_cast<uint16_t>(HUD_FISHEYE_MIN);
  if (out.fisheye > HUD_FISHEYE_MAX) out.fisheye = static_cast<uint16_t>(HUD_FISHEYE_MAX);
  out.segmentIndex = in[16];
  return HUD_PKT_LOCATION_SIZE;
}

size_t encodeHudHeartbeat(uint8_t* out, size_t outLen, uint8_t seq, uint32_t crc, bool hasRoute) {
  if (out == nullptr || outLen < HUD_PKT_HEARTBEAT_SIZE) return 0;
  out[0] = static_cast<uint8_t>(HUD_PKT_HEARTBEAT);
  out[1] = seq;
  out[2] = static_cast<uint8_t>(crc & 0xFF);
  out[3] = static_cast<uint8_t>((crc >> 8) & 0xFF);
  out[4] = static_cast<uint8_t>((crc >> 16) & 0xFF);
  out[5] = static_cast<uint8_t>((crc >> 24) & 0xFF);
  out[6] = hasRoute ? 0x01 : 0x00;
  out[7] = 0;
  return HUD_PKT_HEARTBEAT_SIZE;
}

size_t decodeHudRouteChunk(const uint8_t* in, size_t len, HudRouteChunk& out) {
  if (in == nullptr || len < HUD_PKT_ROUTE_HEADER_SIZE) return 0;
  if (in[0] != static_cast<uint8_t>(HUD_PKT_ROUTE)) return 0;
  out.seq = in[1];
  out.chunkIndex = in[2];
  out.chunkCount = in[3];
  out.totalLen = static_cast<uint16_t>(in[4]) | (static_cast<uint16_t>(in[5]) << 8);
  out.crc = getU32(in + 6);
  out.payloadLen = static_cast<uint16_t>(len - HUD_PKT_ROUTE_HEADER_SIZE);
  out.payload = in + HUD_PKT_ROUTE_HEADER_SIZE;
  return len;
}
