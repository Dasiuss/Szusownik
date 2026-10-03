#include <catch_amalgamated.hpp>

#include "core/health.h"

using namespace core;

static const HealthConfig CONFIG{95.0f, 100.0f, 2.0f, 3};

TEST_CASE("health: ostrzezenie po 3 kolejnych potwierdzeniach") {
  HealthState state;
  REQUIRE(healthEvaluate(96.0f, CONFIG, state) == HealthAction::None);
  REQUIRE(healthEvaluate(96.0f, CONFIG, state) == HealthAction::None);
  REQUIRE(healthEvaluate(96.0f, CONFIG, state) == HealthAction::Warning);
  REQUIRE(healthEvaluate(96.0f, CONFIG, state) == HealthAction::Warning);
}

TEST_CASE("health: krytyczne natychmiast") {
  HealthState state;
  REQUIRE(healthEvaluate(100.0f, CONFIG, state) == HealthAction::Critical);
}

TEST_CASE("health: histereza zeruje licznik dopiero po ostygnieciu") {
  HealthState state;
  for (int index = 0; index < 3; index++) healthEvaluate(96.0f, CONFIG, state);
  REQUIRE(healthEvaluate(94.0f, CONFIG, state) == HealthAction::None);      // 94 > 93
  REQUIRE(healthEvaluate(92.0f, CONFIG, state) == HealthAction::Cooldown);  // < 93
  REQUIRE(healthEvaluate(96.0f, CONFIG, state) == HealthAction::None);      // licznik wyzerowany
}
