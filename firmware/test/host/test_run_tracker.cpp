#include <catch_amalgamated.hpp>

#include "core/run_tracker.h"

using Catch::Approx;
using namespace core;

namespace {

// Baro == GPS => filtr komplementarny zwraca dokładnie GPS, więc ZigZag
// działa na MA5 z zadanego profilu wysokości.
void step(RunTracker& t, float speed, float alt, unsigned long now) {
  t.update(speed, alt, alt, true, now);
}

}  // namespace

TEST_CASE("run_tracker: hero live w zjeździe, zamrożony na wyciągu") {
  RunTracker t;

  // Zjazd A: 2000 -> 1820 (10 próbek), prędkość rośnie 20..110.
  for (int i = 0; i < 10; i++) step(t, 20.0f + i * 10.0f, 2000.0f - i * 20.0f, i * 1000UL);
  REQUIRE(t.displayMaxKmh() == Approx(110.0f).margin(1.0f));  // live
  REQUIRE(t.lastRunMaxKmh() == Approx(0.0f));                 // dołka jeszcze nie było

  // Wyciąg B: 1840 -> 2000, prędkość 12. W trakcie podejścia wykryty dołek.
  for (int i = 1; i <= 9; i++) step(t, 12.0f, 1820.0f + i * 20.0f, (9 + i) * 1000UL);
  REQUIRE_FALSE(t.descending());
  REQUIRE(t.lastRunMaxKmh() == Approx(110.0f).margin(1.0f));  // zjazd A zamknięty
  REQUIRE(t.displayMaxKmh() == Approx(110.0f).margin(1.0f));  // zamrożony mimo SPD 12

  // Zjazd C: 1980 -> 1820, prędkość 30..110. W trakcie szczyt -> trend malejący.
  for (int i = 1; i <= 9; i++) step(t, 20.0f + i * 10.0f, 2000.0f - i * 20.0f, (18 + i) * 1000UL);
  REQUIRE(t.descending());
  REQUIRE(t.displayMaxKmh() == Approx(110.0f).margin(1.0f));  // live w zjeździe C

  // Wyciąg D domyka zjazd C.
  for (int i = 1; i <= 4; i++) step(t, 12.0f, 1820.0f + i * 20.0f, (27 + i) * 1000UL);
  REQUIRE(t.lastRunMaxKmh() == Approx(110.0f).margin(1.0f));
  REQUIRE(t.displayMaxKmh() == Approx(110.0f).margin(1.0f));
}

TEST_CASE("run_tracker: bez fixa zamraża stan") {
  RunTracker t;
  for (int i = 0; i < 6; i++) step(t, 80.0f, 2000.0f - i * 20.0f, i * 1000UL);
  const float before = t.displayMaxKmh();
  REQUIRE_FALSE(t.update(0.0f, 1000.0f, 1000.0f, false, 6000UL));
  REQUIRE(t.displayMaxKmh() == Approx(before));
}

TEST_CASE("run_tracker: przerwa >= 1 h zamyka zjazd") {
  RunTracker t;
  for (int i = 0; i < 6; i++) step(t, 100.0f, 2000.0f - i * 20.0f, i * 1000UL);
  const bool closed = t.update(0.0f, 1800.0f, 1800.0f, true, 5000UL + 3600000UL);
  REQUIRE(closed);
  REQUIRE(t.lastRunMaxKmh() == Approx(100.0f).margin(1.0f));
}

TEST_CASE("run_tracker: wysokość z fuzji jest dostępna po pierwszej próbce") {
  RunTracker t;
  step(t, 10.0f, 1234.0f, 0);
  REQUIRE(t.altitudeM() == Approx(1234.0f));
}
