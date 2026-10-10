#include <catch_amalgamated.hpp>

#include <cstdint>

#include "core/hud_packet.h"

TEST_CASE("HudRekaw S: dekodowanie") {
  const uint8_t packet[14] = {0x53, 0x07, 0x2A, 0x00, 0x7B, 0x00, 0x58,
                              0x00, 0x00, 0x00, 0xD2, 0x04, 0x01, 0x02};
  HudTelemetry t;
  REQUIRE(decodeHudTelemetry(packet, sizeof(packet), t) == 14);
  REQUIRE(t.speed == 42);
  REQUIRE(t.navAngle == 123);
  REQUIRE(t.average == 88);
  REQUIRE(t.remaining == 0);
  REQUIRE(t.totalTenthsKm == 1234);
  REQUIRE(t.frame == true);
  REQUIRE(t.segmentIndex == 2);
}

TEST_CASE("HudRekaw S: brak trasy daje HUD_SEGMENT_NONE") {
  const uint8_t packet[14] = {0x53, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, HUD_SEGMENT_NONE};
  HudTelemetry t;
  REQUIRE(decodeHudTelemetry(packet, sizeof(packet), t) == 14);
  REQUIRE(t.segmentIndex == HUD_SEGMENT_NONE);
}

TEST_CASE("HudRekaw L: dekodowanie") {
  const uint8_t packet[17] = {0x4C, 0x03, 0x01, 0x01, 0x00, 0xE1, 0xF5, 0x05, 0x00,
                              0x3E, 0x14, 0xF4, 0xD3, 0xFF, 0xDC, 0x00, 0x01};
  HudLocation l;
  REQUIRE(decodeHudLocation(packet, sizeof(packet), l) == 17);
  REQUIRE(l.mode == 1);
  REQUIRE(l.zoom == 1);
  REQUIRE(l.latE7 == 100000000);
  REQUIRE(l.lonE7 == -200000000);
  REQUIRE(l.heading == -45);
  REQUIRE(l.fisheye == 220);
  REQUIRE(l.segmentIndex == 1);
}

TEST_CASE("HudRekaw: zly typ i za krotki pakiet odrzucone") {
  uint8_t packet[17] = {0};
  HudTelemetry t;
  HudLocation l;
  REQUIRE(decodeHudTelemetry(packet, sizeof(packet), t) == 0);
  packet[0] = 0x4C;
  REQUIRE(decodeHudTelemetry(packet, 13, t) == 0);
  REQUIRE(decodeHudLocation(packet, 16, l) == 0);
}

TEST_CASE("HudRekaw: klampowanie kata i fisheye") {
  uint8_t telemetry[14] = {0x53, 0, 0, 0, 0x10, 0x27, 0, 0, 0, 0, 0, 0, 0, 0};
  HudTelemetry t;
  REQUIRE(decodeHudTelemetry(telemetry, 14, t) == 14);
  REQUIRE(t.navAngle == 359);  // 10000 -> clamp

  uint8_t location[17] = {0x4C, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x32, 0x00, 0};
  HudLocation l;
  REQUIRE(decodeHudLocation(location, 17, l) == 17);
  REQUIRE(l.fisheye == 100);  // 50 -> clamp do min

  location[14] = 0xFF;
  location[15] = 0xFF;
  REQUIRE(decodeHudLocation(location, 17, l) == 17);
  REQUIRE(l.fisheye == 500);  // 65535 -> clamp do max
}

TEST_CASE("HudRekaw: heartbeat (kodowanie)") {
  uint8_t out[8] = {0};
  REQUIRE(encodeHudHeartbeat(out, sizeof(out), 5, 0x11223344u, true) == HUD_PKT_HEARTBEAT_SIZE);
  REQUIRE(out[0] == static_cast<uint8_t>(HUD_PKT_HEARTBEAT));
  REQUIRE(out[1] == 5);
  REQUIRE(out[2] == 0x44);
  REQUIRE(out[3] == 0x33);
  REQUIRE(out[4] == 0x22);
  REQUIRE(out[5] == 0x11);
  REQUIRE(out[6] == 0x01);
  REQUIRE(encodeHudHeartbeat(out, sizeof(out), 0, 0, false) == HUD_PKT_HEARTBEAT_SIZE);
  REQUIRE(out[6] == 0x00);
}

TEST_CASE("HudRekaw: chunk trasy (dekodowanie)") {
  uint8_t packet[12] = {static_cast<uint8_t>(HUD_PKT_ROUTE), 9, 1, 3, 0x10, 0x27,
                        0x44, 0x33, 0x22, 0x11, 0xAA, 0xBB};
  HudRouteChunk chunk;
  REQUIRE(decodeHudRouteChunk(packet, sizeof(packet), chunk) == sizeof(packet));
  REQUIRE(chunk.seq == 9);
  REQUIRE(chunk.chunkIndex == 1);
  REQUIRE(chunk.chunkCount == 3);
  REQUIRE(chunk.totalLen == 10000);
  REQUIRE(chunk.crc == 0x11223344u);
  REQUIRE(chunk.payloadLen == 2);
  REQUIRE(chunk.payload[0] == 0xAA);
  REQUIRE(chunk.payload[1] == 0xBB);

  uint8_t wrong[10] = {0x53, 0, 0, 0, 0, 0, 0, 0, 0, 0};
  REQUIRE(decodeHudRouteChunk(wrong, sizeof(wrong), chunk) == 0);
  REQUIRE(decodeHudRouteChunk(packet, 4, chunk) == 0);
}
