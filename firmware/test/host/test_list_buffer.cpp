#include <catch_amalgamated.hpp>

#include <string>

#include "core/list_buffer.h"

using namespace core;

TEST_CASE("lista: trzyma maxCount najstarszych nazw, rosnaco") {
  ListEntry out[3];
  size_t count = 0;
  const char* names[] = {"20260103_000000.csv", "20260101_000000.csv", "20260104_000000.csv",
                         "20260102_000000.csv"};
  const unsigned long sizes[] = {30, 10, 40, 20};
  for (int index = 0; index < 4; index++) {
    count = listInsert(out, count, 3, names[index], sizes[index]);
  }

  REQUIRE(count == 3);
  REQUIRE(std::string(out[0].name) == "20260101_000000.csv");
  REQUIRE(std::string(out[1].name) == "20260102_000000.csv");
  REQUIRE(std::string(out[2].name) == "20260103_000000.csv");
  REQUIRE(out[0].size == 10);
  REQUIRE(out[2].size == 30);
}

TEST_CASE("lista: nowszy niz okno nie wypycha najstarszych") {
  ListEntry out[2];
  size_t count = 0;
  count = listInsert(out, count, 2, "20260101_000000.csv", 1);
  count = listInsert(out, count, 2, "20260102_000000.csv", 2);
  count = listInsert(out, count, 2, "20260109_000000.csv", 9);  // poza oknem
  REQUIRE(count == 2);
  REQUIRE(std::string(out[1].name) == "20260102_000000.csv");
}
