#include <catch_amalgamated.hpp>

#include "core/beeper_pattern.h"

using namespace core;

static const BeeperPatternSettings SETTINGS{880, 1100, 56, 140, 60, 60};

TEST_CASE("buzzer: cisza ponizej progu pikania") {
  ToneStep out[8];
  REQUIRE(beeperBuildPattern(59.0f, SETTINGS, out, 8) == 0);
}

TEST_CASE("buzzer: 60-99 km/h => 1..4 krotkie") {
  ToneStep out[8];
  REQUIRE(beeperBuildPattern(65.0f, SETTINGS, out, 8) == 1);
  REQUIRE(beeperBuildPattern(75.0f, SETTINGS, out, 8) == 2);
  REQUIRE(beeperBuildPattern(85.0f, SETTINGS, out, 8) == 3);
  REQUIRE(beeperBuildPattern(95.0f, SETTINGS, out, 8) == 4);
}

TEST_CASE("buzzer: 120 km/h = 1 dlugi + 2 krotkie") {
  ToneStep out[8];
  const size_t count = beeperBuildPattern(120.0f, SETTINGS, out, 8);
  REQUIRE(count == 3);
  REQUIRE(out[0].freq == 1100);
  REQUIRE(out[0].ms == 140);
  REQUIRE(out[1].freq == 880);
  REQUIRE(out[2].freq == 880);
  REQUIRE(out[2].gapAfter == 0);
}

TEST_CASE("buzzer: glosnosc liniowa 60..120 z clampem") {
  REQUIRE(beeperVolumeFor(60.0f, 20, 70, 60, 120) == 20);
  REQUIRE(beeperVolumeFor(90.0f, 20, 70, 60, 120) == 45);
  REQUIRE(beeperVolumeFor(120.0f, 20, 70, 60, 120) == 70);
  REQUIRE(beeperVolumeFor(200.0f, 20, 70, 60, 120) == 70);
}
