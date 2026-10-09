#include <catch_amalgamated.hpp>

#include <cstdint>

#include "core/hud_packet.h"

TEST_CASE("HudRekaw S: dekodowanie") {
  const uint8_t packet[13] = {0x53, 0x07, 0x2A, 0x00, 0x7B, 0x00, 0x58,
                              0x00, 0x00, 0x00, 0xD2, 0x04, 0x01};
  HudTelemetry t;
  REQUIRE(decodeHudTelemetry(packet, sizeof(packet), t) == 13);
  REQUIRE(t.speed == 42);
  REQUIRE(t.navAngle == 123);
  REQUIRE(t.average == 88);
  REQUIRE(t.remaining == 0);
  REQUIRE(t.totalTenthsKm == 1234);
  REQUIRE(t.frame == true);
}

TEST_CASE("HudRekaw L: dekodowanie") {
  const uint8_t packet[16] = {0x4C, 0x03, 0x01, 0x01, 0x00, 0xE1, 0xF5, 0x05,
                              0x00, 0x3E, 0x14, 0xF4, 0xD3, 0xFF, 0xDC, 0x00};
  HudLocation l;
  REQUIRE(decodeHudLocation(packet, sizeof(packet), l) == 16);
  REQUIRE(l.mode == 1);
  REQUIRE(l.zoom == 1);
  REQUIRE(l.latE7 == 100000000);
  REQUIRE(l.lonE7 == -200000000);
  REQUIRE(l.heading == -45);
  REQUIRE(l.fisheye == 220);
}

TEST_CASE("HudRekaw: zly typ i za krotki pakiet odrzucone") {
  uint8_t packet[16] = {0};
  HudTelemetry t;
  HudLocation l;
  REQUIRE(decodeHudTelemetry(packet, sizeof(packet), t) == 0);
  packet[0] = 0x4C;
  REQUIRE(decodeHudTelemetry(packet, 12, t) == 0);
  REQUIRE(decodeHudLocation(packet, 15, l) == 0);
}

TEST_CASE("HudRekaw: klampowanie kata i fisheye") {
  uint8_t telemetry[13] = {0x53, 0, 0, 0, 0x10, 0x27, 0, 0, 0, 0, 0, 0, 0};
  HudTelemetry t;
  REQUIRE(decodeHudTelemetry(telemetry, 13, t) == 13);
  REQUIRE(t.navAngle == 359);  // 10000 -> clamp

  uint8_t location[16] = {0x4C, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x32, 0x00};
  HudLocation l;
  REQUIRE(decodeHudLocation(location, 16, l) == 16);
  REQUIRE(l.fisheye == 100);  // 50 -> clamp do min

  location[14] = 0xFF;
  location[15] = 0xFF;
  REQUIRE(decodeHudLocation(location, 16, l) == 16);
  REQUIRE(l.fisheye == 500);  // 65535 -> clamp do max
}
