#include <catch_amalgamated.hpp>

#include <cmath>

#include "core/ble_adv.h"

using namespace core;

TEST_CASE("ble: prog szybkiego reklamowania z histereza") {
  const float below = 5.0f;
  const float hyst = 3.0f;

  // Z wolnego przechodzimy na szybkie ponizej progu (postoj).
  REQUIRE(bleAdvFastNext(false, 0.0f, below, hyst));
  REQUIRE(bleAdvFastNext(false, 4.9f, below, hyst));
  REQUIRE_FALSE(bleAdvFastNext(false, 5.0f, below, hyst));
  REQUIRE_FALSE(bleAdvFastNext(false, 40.0f, below, hyst));

  // Z szybkiego wracamy na wolne dopiero powyzej progu + histereza (5 + 3).
  REQUIRE(bleAdvFastNext(true, 7.9f, below, hyst));
  REQUIRE_FALSE(bleAdvFastNext(true, 8.0f, below, hyst));

  // Brak fixu (0), NaN i predkosc ujemna to postoj.
  REQUIRE(bleAdvFastNext(false, -1.0f, below, hyst));
  REQUIRE(bleAdvFastNext(false, std::nanf(""), below, hyst));
  REQUIRE(bleAdvFastNext(true, std::nanf(""), below, hyst));

  // Bez histerezy (0) granica jest ostra.
  REQUIRE_FALSE(bleAdvFastNext(true, below, below, 0.0f));
}
