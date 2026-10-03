#include <catch_amalgamated.hpp>

#include "core/gnss_rate.h"

using namespace core;

TEST_CASE("gnss: granice pasm i interwaly") {
  REQUIRE(gnssBandOf(0.0f) == 0);
  REQUIRE(gnssBandOf(19.9f) == 0);
  REQUIRE(gnssBandOf(20.0f) == 1);
  REQUIRE(gnssBandOf(49.9f) == 1);
  REQUIRE(gnssBandOf(50.0f) == 2);
  REQUIRE(gnssBandOf(70.0f) == 3);
  REQUIRE(gnssBandOf(80.0f) == 4);

  REQUIRE(gnssBandIntervalMs(0) == 2000);
  REQUIRE(gnssBandIntervalMs(2) == 333);
  REQUIRE(gnssBandIntervalMs(4) == 100);
  REQUIRE(gnssBandRateHz(0) == 0);  // 0.5 Hz
  REQUIRE(gnssBandRateHz(4) == 10);
}

TEST_CASE("gnss: histereza 3 km/h przy zmianie pasma") {
  REQUIRE(gnssNextBand(0, 21.0f, 3.0f) == -1);  // 21 < 20 + 3
  REQUIRE(gnssNextBand(0, 23.0f, 3.0f) == 1);
  REQUIRE(gnssNextBand(1, 49.0f, 3.0f) == -1);  // to samo pasmo
  REQUIRE(gnssNextBand(1, 18.0f, 3.0f) == -1);  // 18 > 20 - 3
  REQUIRE(gnssNextBand(1, 16.0f, 3.0f) == 0);
}
