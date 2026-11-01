#include <catch_amalgamated.hpp>

#include "core/record_signal.h"
#include "core/record_tracker.h"

#include <cstring>

using namespace core;

TEST_CASE("record signal: wybrana melodyjka ma siedem stałych tonów") {
  ToneStep steps[8]{};

  REQUIRE(recordSignalBuildPattern(steps, 8) == 7);
  const uint16_t expectedHz[] = {659, 784, 988, 1175, 988, 1175, 1480};
  for (size_t index = 0; index < 7; index++) {
    REQUIRE(steps[index].freq == expectedHz[index]);
    REQUIRE(steps[index].ms == 65);
    REQUIRE(steps[index].gapAfter == (index == 6 ? 0 : 28));
  }
  REQUIRE(recordSignalBuildPattern(steps, 6) == 0);
}

TEST_CASE("record tracker: startuje od 50 km/h i sygnalizuje pierwsze przekroczenie") {
  RecordTracker tracker;
  REQUIRE(tracker.maxRecordTenths() == 500);

  const auto atThreshold = tracker.update(50.0f, "2026-10-29T10:00:00.000Z", 1000);
  REQUIRE_FALSE(atThreshold.newRecord);
  REQUIRE_FALSE(atThreshold.signal);

  const auto first = tracker.update(50.1f, "2026-10-29T10:00:00.100Z", 1100);
  REQUIRE(first.newRecord);
  REQUIRE(first.signal);
  REQUIRE(tracker.maxRecordTenths() == 501);
}

TEST_CASE("record tracker: aktualizuje rekord, ale histereza wymaga 5 km/h") {
  RecordState initial;
  initial.confirmedTenthsKmh = 1000;
  RecordTracker tracker(initial);

  const auto first = tracker.update(101.0f, "2026-10-29T10:00:00.000Z", 0);
  REQUIRE(first.signal);
  REQUIRE(tracker.maxRecordTenths() == 1010);

  const auto smallIncrease = tracker.update(103.0f, "2026-10-29T10:00:01.000Z", 1000);
  REQUIRE(smallIncrease.newRecord);
  REQUIRE_FALSE(smallIncrease.signal);
  REQUIRE(tracker.maxRecordTenths() == 1030);

  const auto belowHysteresis = tracker.update(105.9f, "2026-10-29T10:00:02.000Z", 2000);
  REQUIRE(belowHysteresis.newRecord);
  REQUIRE_FALSE(belowHysteresis.signal);

  const auto atHysteresis = tracker.update(106.0f, "2026-10-29T10:00:03.000Z", 3000);
  REQUIRE(atHysteresis.newRecord);
  REQUIRE(atHysteresis.signal);
}

TEST_CASE("record tracker: po 60 sekundach nowy rekord sygnalizuje mniejszy wzrost") {
  RecordState initial;
  initial.confirmedTenthsKmh = 1000;
  RecordTracker tracker(initial);

  REQUIRE(tracker.update(101.0f, "2026-10-29T10:00:00.000Z", 0).signal);
  REQUIRE_FALSE(tracker.update(103.0f, "2026-10-29T10:00:20.000Z", 20000).signal);

  const auto afterCooldown = tracker.update(104.0f, "2026-10-29T10:01:00.000Z", 60000);
  REQUIRE(afterCooldown.newRecord);
  REQUIRE(afterCooldown.signal);
}

TEST_CASE("record tracker: sync PWA potwierdza próbki do watermarka i zachowuje nowsze") {
  RecordState initial;
  initial.confirmedTenthsKmh = 1000;
  RecordTracker tracker(initial);
  REQUIRE(tracker.update(120.0f, "2026-10-29T10:00:00.100Z", 0).signal);

  tracker.beginSync();
  const auto duringSync = tracker.update(120.5f, "2026-10-29T10:00:01.100Z", 1000);
  REQUIRE(duringSync.newRecord);
  REQUIRE_FALSE(duringSync.signal);

  REQUIRE(tracker.reconcilePwaRecord(1100, "2026-10-29T10:00:00.500Z"));
  REQUIRE(tracker.confirmedRecordTenths() == 1100);
  REQUIRE(tracker.maxRecordTenths() == 1205);

  REQUIRE(tracker.reconcilePwaRecord(1210, "2026-10-29T10:00:01.100Z"));
  REQUIRE(tracker.confirmedRecordTenths() == 1210);
  REQUIRE(tracker.maxRecordTenths() == 1210);
}

TEST_CASE("record tracker: stan na SD przechodzi round-trip i odrzuca uszkodzenie") {
  RecordState state;
  state.confirmedTenthsKmh = 1234;
  state.needsPwaSync = true;
  state.provisional = {1500, "2026-10-29T10:00:00.100Z"};
  state.syncActive = true;
  state.syncing = {1490, "2026-10-29T10:00:01.100Z"};
  char text[RECORD_STATE_BUFFER_SIZE]{};

  const size_t size = recordStateFormat(state, text, sizeof(text));
  REQUIRE(size > 0);
  RecordState parsed;
  REQUIRE(recordStateParse(text, parsed));
  REQUIRE(parsed.confirmedTenthsKmh == 1234);
  REQUIRE(parsed.needsPwaSync);
  REQUIRE(parsed.provisional.speedTenthsKmh == 1500);
  REQUIRE(std::strcmp(parsed.provisional.timestamp, state.provisional.timestamp) == 0);
  REQUIRE(parsed.syncActive);
  REQUIRE(parsed.syncing.speedTenthsKmh == 1490);
  REQUIRE_FALSE(recordStateParse("broken", parsed));
  REQUIRE_FALSE(recordStateParse("1,499,0,0,-,0,0,-", parsed));
  REQUIRE_FALSE(recordStateParse("1,500,0,1000,broken,0,0,-", parsed));
  REQUIRE_FALSE(recordStateParse("1,500,0,0,-,0,1490,2026-10-29T10:00:01.100Z", parsed));
  REQUIRE_FALSE(recordTimestampValid("2026-XX-29T10:00:00.000Z"));
}

TEST_CASE("record tracker: pusty watermark zachowuje kandydatow do werdyktu PWA") {
  RecordState initial;
  initial.confirmedTenthsKmh = 1000;
  initial.needsPwaSync = true;
  initial.provisional = {1200, "2026-10-29T10:00:00.100Z"};
  RecordTracker tracker(initial);

  REQUIRE_FALSE(tracker.reconcilePwaRecord(499, ""));
  REQUIRE_FALSE(tracker.reconcilePwaRecord(1100, "nie-ISO"));
  REQUIRE(tracker.reconcilePwaRecord(1100, ""));
  REQUIRE(tracker.confirmedRecordTenths() == 1100);
  REQUIRE_FALSE(tracker.state().needsPwaSync);
  REQUIRE(tracker.maxRecordTenths() == 1200);
}

TEST_CASE("record tracker: bezpiecznie konwertuje prędkość do dziesiątych km/h") {
  REQUIRE(recordSpeedTenths(NAN) == 0);
  REQUIRE(recordSpeedTenths(-1.0f) == 0);
  REQUIRE(recordSpeedTenths(123.4f) == 1234);
  REQUIRE(recordSpeedTenths(6553.5f) == 65535);
}

TEST_CASE("record tracker: parser komendy PWA waliduje rekord i watermark") {
  PwaRecordUpdate parsed;
  REQUIRE(recordCommandParse("1234:2026-10-29T10:00:03.200Z", parsed));
  REQUIRE(parsed.confirmedTenthsKmh == 1234);
  REQUIRE(std::strcmp(parsed.analyzedThrough, "2026-10-29T10:00:03.200Z") == 0);

  REQUIRE(recordCommandParse("500:-", parsed));
  REQUIRE(parsed.analyzedThrough[0] == '\0');
  REQUIRE_FALSE(recordCommandParse("499:-", parsed));
  REQUIRE_FALSE(recordCommandParse("1234.5:-", parsed));
  REQUIRE_FALSE(recordCommandParse("1234:bad-time", parsed));
  REQUIRE_FALSE(recordCommandParse("1234", parsed));
}
