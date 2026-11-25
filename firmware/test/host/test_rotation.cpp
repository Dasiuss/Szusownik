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
  state.stoppedTiming = true;
  REQUIRE_FALSE(state.update(0.0f, false, 90000, CONFIG));
  REQUIRE_FALSE(state.stoppedTiming);
  REQUIRE(state.armed);  // uzbrojenie nietkniete
  REQUIRE_FALSE(state.update(0.0f, true, 91000, CONFIG));  // postoj liczy sie od nowa
  REQUIRE_FALSE(state.update(0.0f, true, 93999, CONFIG));
  REQUIRE(state.update(0.0f, true, 94000, CONFIG));
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
  state.stoppedTiming = true;
  REQUIRE(state.update(0.0f, true, 4000, CONFIG));
  REQUIRE_FALSE(state.update(0.0f, true, 9000, CONFIG));  // juz rozbrojona
}

TEST_CASE("rotacja: progi sa scisle, a warunek trwa pelne 3 sekundy") {
  RotationState state;

  // Dokladnie 5 km/h nie uzbraja. Dopiero >5 km/h rozpoczyna licznik.
  REQUIRE_FALSE(state.update(5.0f, true, 1000, CONFIG));
  REQUIRE_FALSE(state.update(5.01f, true, 3999, CONFIG));
  REQUIRE_FALSE(state.armed);
  REQUIRE_FALSE(state.update(5.01f, true, 6998, CONFIG));
  REQUIRE_FALSE(state.update(5.01f, true, 6999, CONFIG));
  REQUIRE(state.armed);

  // Dokladnie 0.3 km/h nie rozpoczyna rolki; dopiero <0.3 przez 3 s ja wywoluje.
  REQUIRE_FALSE(state.update(0.3f, true, 8000, CONFIG));
  REQUIRE_FALSE(state.update(0.29f, true, 10999, CONFIG));
  REQUIRE(state.update(0.29f, true, 13999, CONFIG));
}

TEST_CASE("rotacja: wejscie w strefe histerezy zeruje licznik postoju") {
  RotationState state;
  state.armed = true;

  REQUIRE_FALSE(state.update(0.0f, true, 1000, CONFIG));
  REQUIRE_FALSE(state.update(0.3f, true, 2500, CONFIG));  // warunek postoju przerwany
  REQUIRE_FALSE(state.update(0.0f, true, 3999, CONFIG));  // nowy licznik
  REQUIRE_FALSE(state.update(0.0f, true, 6998, CONFIG));
  REQUIRE(state.update(0.0f, true, 6999, CONFIG));
}

TEST_CASE("rotacja: utrata fixa zeruje licznik uzbrajania") {
  RotationState state;

  REQUIRE_FALSE(state.update(6.0f, true, 1000, CONFIG));
  REQUIRE_FALSE(state.update(0.0f, false, 2500, CONFIG));
  REQUIRE_FALSE(state.update(6.0f, true, 3999, CONFIG));  // nowy licznik ruchu
  REQUIRE_FALSE(state.update(6.0f, true, 6998, CONFIG));
  REQUIRE_FALSE(state.update(6.0f, true, 6999, CONFIG));
  REQUIRE(state.armed);
}

TEST_CASE("rotacja: timer poprawnie startuje przy millis rownym zero") {
  RotationState state;
  state.armed = true;

  REQUIRE_FALSE(state.update(0.0f, true, 0, CONFIG));
  REQUIRE_FALSE(state.update(0.0f, true, 2999, CONFIG));
  REQUIRE(state.update(0.0f, true, 3000, CONFIG));

  RotationState moving;
  REQUIRE_FALSE(moving.update(6.0f, true, 0, CONFIG));
  REQUIRE_FALSE(moving.update(6.0f, true, 2999, CONFIG));
  REQUIRE_FALSE(moving.update(6.0f, true, 3000, CONFIG));
  REQUIRE(moving.armed);
}

TEST_CASE("rotacja: kolejny postoj roluje dopiero po ponownym uzbrojeniu") {
  RotationState state;
  state.armed = true;

  REQUIRE_FALSE(state.update(0.0f, true, 1000, CONFIG));
  REQUIRE(state.update(0.0f, true, 4000, CONFIG));
  REQUIRE_FALSE(state.update(0.0f, true, 5000, CONFIG));
  REQUIRE_FALSE(state.update(6.0f, true, 6000, CONFIG));
  REQUIRE_FALSE(state.update(6.0f, true, 9000, CONFIG));
  REQUIRE(state.armed);
  REQUIRE_FALSE(state.update(0.0f, true, 10000, CONFIG));
  REQUIRE(state.update(0.0f, true, 13000, CONFIG));
}
