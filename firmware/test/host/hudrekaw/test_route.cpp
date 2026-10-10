#include <catch_amalgamated.hpp>

#include <cstdint>
#include <string>

#include "core/route.h"

namespace {

// Ten sam golden blob co po stronie Szusownika i PWA (piste "1" + lift
// "Gaislachkogl": 6 punktow, 2 odcinki, 2020 m, CRC 26EA8EF9).
const uint8_t kGolden[] = {
    0x01, 0x00, 0x60, 0x00, 0xfc, 0x1b, 0x80, 0x77, 0x8e, 0x06, 0x06, 0x00, 0x02, 0x00,
    0xe4, 0x07, 0x00, 0x00, 0x00, 0x00, 0x98, 0x00, 0x23, 0xff, 0x30, 0x01, 0xd7, 0xfd,
    0xc8, 0x01, 0x8c, 0xfc, 0x30, 0x01, 0xb4, 0xfe, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x22, 0x06, 0x31, 0x01, 0x0c, 0x22, 0x06, 0xe4, 0x07, 0x47, 0x61, 0x69,
    0x73, 0x6c, 0x61, 0x63, 0x68, 0x6b, 0x6f, 0x67, 0x6c, 0xf9, 0x8e, 0xea, 0x26};

}  // namespace

TEST_CASE("HudRekaw route: golden blob dekoduje sie") {
  HudRoute route;
  REQUIRE(hudRouteDecode(kGolden, sizeof(kGolden), &route));
  REQUIRE(route.valid);
  REQUIRE(route.crc == 0x26EA8EF9u);
  REQUIRE(route.pointCount == 6);
  REQUIRE(route.segmentCount == 2);
  REQUIRE(route.totalDistanceM == 2020);
  REQUIRE(std::string(hudRouteStepLabel(route, 0)) == "1");
  REQUIRE(std::string(hudRouteStepLabel(route, 1)) == "Gaislachkogl");
  REQUIRE(hudRouteStepLabel(route, 2) == nullptr);
  REQUIRE(route.steps[0].kind == ROUTE_KIND_PISTE);
  REQUIRE(route.steps[1].kind == ROUTE_KIND_LIFT);
}

TEST_CASE("HudRekaw route: uszkodzony CRC odrzucony") {
  uint8_t corrupt[sizeof(kGolden)];
  for (size_t i = 0; i < sizeof(kGolden); i++) corrupt[i] = kGolden[i];
  corrupt[55] ^= 0xFF;
  HudRoute route;
  REQUIRE_FALSE(hudRouteDecode(corrupt, sizeof(corrupt), &route));
  REQUIRE_FALSE(route.valid);
}
