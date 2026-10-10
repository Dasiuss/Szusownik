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

TEST_CASE("HUD S: golden bajty (LE, TOT w 0,1 km, segmentIndex)") {
  HudTelemetry t;
  t.speedKmh = 42;
  t.navAngle = 123;
  t.averageKmh = 88;
  t.remaining = 0;
  t.totalTenthsKm = 1234;  // 123,4 km
  t.frame = true;
  t.segmentIndex = 3;

  uint8_t out[16] = {0};
  const size_t len = encodeHudTelemetry(out, sizeof(out), 7, t);
  const uint8_t expected[14] = {
      0x53,              // 'S'
      0x07,              // seq
      0x2A, 0x00,        // speed 42
      0x7B, 0x00,        // navAngle 123
      0x58, 0x00,        // average 88
      0x00, 0x00,        // remaining 0
      0xD2, 0x04,        // total 1234
      0x01,              // frame
      0x03,              // segmentIndex
  };
  REQUIRE(len == 14);
  REQUIRE(bytesEqual(out, len, expected));
}

TEST_CASE("HUD S: angle clamp i flaga frame") {
  HudTelemetry t;
  t.navAngle = -400;
  t.frame = false;
  uint8_t out[16] = {0};
  REQUIRE(encodeHudTelemetry(out, sizeof(out), 0, t) == 14);
  REQUIRE(out[4] == static_cast<uint8_t>(-359 & 0xFF));
  REQUIRE(out[5] == static_cast<uint8_t>((-359 >> 8) & 0xFF));
  REQUIRE(out[12] == 0x00);
  REQUIRE(out[13] == HUD_SEGMENT_NONE);

  t.navAngle = 400;
  REQUIRE(encodeHudTelemetry(out, sizeof(out), 0, t) == 14);
  REQUIRE(out[4] == static_cast<uint8_t>(359 & 0xFF));
  REQUIRE(out[5] == static_cast<uint8_t>((359 >> 8) & 0xFF));
}

TEST_CASE("HUD L: golden bajty (lat/lon/heading/fisheye/segmentIndex LE)") {
  HudLocation loc;
  loc.mode = 1;
  loc.zoom = 1;
  loc.latE7 = 100000000;    // 0x05F5E100
  loc.lonE7 = -200000000;   // 0xF4143E00
  loc.heading = -45;
  loc.fisheye = 220;
  loc.segmentIndex = 2;

  uint8_t out[20] = {0};
  const size_t len = encodeHudLocation(out, sizeof(out), 3, loc);
  const uint8_t expected[17] = {
      0x4C,              // 'L'
      0x03,              // seq
      0x01,              // mode
      0x01,              // zoom
      0x00, 0xE1, 0xF5, 0x05,  // lat 100000000
      0x00, 0x3E, 0x14, 0xF4,  // lon -200000000
      0xD3, 0xFF,        // heading -45
      0xDC, 0x00,        // fisheye 220
      0x02,              // segmentIndex
  };
  REQUIRE(len == 17);
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

TEST_CASE("HUD: prog trybu 30 km/h") {
  REQUIRE(hudModeForSpeed(0.0f) == HUD_MODE_MAP);
  REQUIRE(hudModeForSpeed(30.0f) == HUD_MODE_MAP);
  REQUIRE(hudModeForSpeed(30.01f) == HUD_MODE_STATS);
  REQUIRE(hudModeForSpeed(80.0f) == HUD_MODE_STATS);
}

TEST_CASE("HUD: heartbeat (dekodowanie)") {
  const uint8_t packet[8] = {'H', 4, 0x44, 0x33, 0x22, 0x11, 0x01, 0};
  HudHeartbeat heartbeat;
  REQUIRE(decodeHudHeartbeat(packet, sizeof(packet), heartbeat) == HUD_PKT_HEARTBEAT_SIZE);
  REQUIRE(heartbeat.seq == 4);
  REQUIRE(heartbeat.crc == 0x11223344u);
  REQUIRE(heartbeat.hasRoute == true);
  REQUIRE(decodeHudHeartbeat(packet, 4, heartbeat) == 0);

  const uint8_t wrong[8] = {'S', 0, 0, 0, 0, 0, 0, 0};
  REQUIRE(decodeHudHeartbeat(wrong, sizeof(wrong), heartbeat) == 0);
}

TEST_CASE("HUD: chunk trasy (kodowanie)") {
  const uint8_t payload[3] = {0x11, 0x22, 0x33};
  uint8_t out[HUD_PKT_ROUTE_SIZE] = {0};
  const size_t len = encodeHudRouteChunk(out, sizeof(out), 8, 0, 2, 2500, 0x11223344u, payload,
                                         sizeof(payload));
  REQUIRE(len == HUD_PKT_ROUTE_HEADER_SIZE + 3);
  REQUIRE(out[0] == static_cast<uint8_t>(HUD_PKT_ROUTE));
  REQUIRE(out[1] == 8);
  REQUIRE(out[2] == 0);
  REQUIRE(out[3] == 2);
  REQUIRE(out[4] == static_cast<uint8_t>(2500 & 0xFF));
  REQUIRE(out[5] == static_cast<uint8_t>((2500 >> 8) & 0xFF));
  REQUIRE(out[6] == 0x44);
  REQUIRE(out[10] == 0x11);
  REQUIRE(out[12] == 0x33);
  // Za mały bufor.
  REQUIRE(encodeHudRouteChunk(out, 11, 0, 0, 0, 0, 0, payload, sizeof(payload)) == 0);
}
