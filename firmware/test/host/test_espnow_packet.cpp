#include <catch_amalgamated.hpp>

#include <cstdint>

#include "core/espnow_packet.h"

namespace {

bool bytesEqual(const uint8_t* data, size_t len, const uint8_t* expected) {
  for (size_t i = 0; i < len; i++) {
    if (data[i] != expected[i]) return false;
  }
  return true;
}

}  // namespace

TEST_CASE("HUD S: golden bajty (LE, TOT w 0,1 km)") {
  HudTelemetry t;
  t.speedKmh = 42;
  t.navAngle = 123;
  t.averageKmh = 88;
  t.remaining = 0;
  t.totalTenthsKm = 1234;  // 123,4 km
  t.frame = true;

  uint8_t out[16] = {0};
  const size_t len = encodeHudTelemetry(out, sizeof(out), 7, t);
  const uint8_t expected[13] = {
      0x53,              // 'S'
      0x07,              // seq
      0x2A, 0x00,        // speed 42
      0x7B, 0x00,        // navAngle 123
      0x58, 0x00,        // average 88
      0x00, 0x00,        // remaining 0
      0xD2, 0x04,        // total 1234
      0x01,              // frame
  };
  REQUIRE(len == 13);
  REQUIRE(bytesEqual(out, len, expected));
}

TEST_CASE("HUD S: angle clamp i flaga frame") {
  HudTelemetry t;
  t.navAngle = -400;
  t.frame = false;
  uint8_t out[16] = {0};
  REQUIRE(encodeHudTelemetry(out, sizeof(out), 0, t) == 13);
  REQUIRE(out[4] == static_cast<uint8_t>(-359 & 0xFF));
  REQUIRE(out[5] == static_cast<uint8_t>((-359 >> 8) & 0xFF));
  REQUIRE(out[12] == 0x00);

  t.navAngle = 400;
  REQUIRE(encodeHudTelemetry(out, sizeof(out), 0, t) == 13);
  REQUIRE(out[4] == static_cast<uint8_t>(359 & 0xFF));
  REQUIRE(out[5] == static_cast<uint8_t>((359 >> 8) & 0xFF));
}

TEST_CASE("HUD L: golden bajty (lat/lon/heading/fisheye LE)") {
  HudLocation loc;
  loc.mode = 1;
  loc.zoom = 1;
  loc.latE7 = 100000000;    // 0x05F5E100
  loc.lonE7 = -200000000;   // 0xF4143E00
  loc.heading = -45;
  loc.fisheye = 220;

  uint8_t out[16] = {0};
  const size_t len = encodeHudLocation(out, sizeof(out), 3, loc);
  const uint8_t expected[16] = {
      0x4C,              // 'L'
      0x03,              // seq
      0x01,              // mode
      0x01,              // zoom
      0x00, 0xE1, 0xF5, 0x05,  // lat 100000000
      0x00, 0x3E, 0x14, 0xF4,  // lon -200000000
      0xD3, 0xFF,        // heading -45
      0xDC, 0x00,        // fisheye 220
  };
  REQUIRE(len == 16);
  REQUIRE(bytesEqual(out, len, expected));
}

TEST_CASE("HUD: za maly bufor zwraca 0 bez zapisu") {
  HudTelemetry t;
  HudLocation loc;
  uint8_t out[4] = {0xAA, 0xAA, 0xAA, 0xAA};
  REQUIRE(encodeHudTelemetry(out, sizeof(out), 1, t) == 0);
  REQUIRE(encodeHudLocation(out, sizeof(out), 1, loc) == 0);
  REQUIRE(out[0] == 0xAA);
}

TEST_CASE("HUD: TOT (0,1 km) z obcieciem") {
  REQUIRE(hudTenthsKm(0.0f) == 0);
  REQUIRE(hudTenthsKm(-5.0f) == 0);
  REQUIRE(hudTenthsKm(12.34f) == 123);
  REQUIRE(hudTenthsKm(12.36f) == 124);
  REQUIRE(hudTenthsKm(123.4f) == 1234);
  REQUIRE(hudTenthsKm(100000.0f) == 65535);
}

TEST_CASE("HUD: prog trybu 5 km/h") {
  REQUIRE(hudModeForSpeed(0.0f) == HUD_MODE_MAP);
  REQUIRE(hudModeForSpeed(5.0f) == HUD_MODE_MAP);
  REQUIRE(hudModeForSpeed(5.01f) == HUD_MODE_STATS);
  REQUIRE(hudModeForSpeed(80.0f) == HUD_MODE_STATS);
}
