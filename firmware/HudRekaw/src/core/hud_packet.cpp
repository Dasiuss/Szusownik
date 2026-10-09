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
  return HUD_PKT_LOCATION_SIZE;
}
