#include <catch_amalgamated.hpp>

#include "core/rotation.h"

using namespace core;

static const RotationConfig CONFIG{0.3f, 5.0f, 3000};

TEST_CASE("rotacja: uzbraja sie po potwierdzonym ruchu i domyka po postoju") {
  RotationState state;
  REQUIRE_FALSE(state.update(10.0f, true, 1000, CONFIG));  // start ruchu
  REQUIRE_FALSE(state.armed);
  REQUIRE_FALSE(state.update(10.0f, true, 4000, CONFIG));  // 3 s ruchu -> uzbrojona
  REQUIRE(state.armed);

  REQUIRE_FALSE(state.update(0.0f, true, 5000, CONFIG));  // start postoju
  REQUIRE(state.update(0.0f, true, 8000, CONFIG));        // 3 s postoju -> rolka
  REQUIRE_FALSE(state.armed);
}

TEST_CASE("rotacja: bez poprawnego fixa nie roluje") {
  RotationState state;
  state.armed = true;
  state.stoppedSince = 1000;
  REQUIRE_FALSE(state.update(0.0f, false, 90000, CONFIG));
  REQUIRE(state.stoppedSince == 0);
  REQUIRE(state.armed);  // uzbrojenie nietkniete
}

TEST_CASE("rotacja: strefa histerezy nie uzbraja") {
  RotationState state;
  REQUIRE_FALSE(state.update(1.0f, true, 0, CONFIG));  // miedzy 0.3 i 5.0
  REQUIRE_FALSE(state.update(1.0f, true, 100000, CONFIG));
  REQUIRE_FALSE(state.armed);
}

TEST_CASE("rotacja: jeden postoj = jedna rolka") {
  RotationState state;
  state.armed = true;
  state.stoppedSince = 1000;
  REQUIRE(state.update(0.0f, true, 4000, CONFIG));
  REQUIRE_FALSE(state.update(0.0f, true, 9000, CONFIG));  // juz rozbrojona
}
