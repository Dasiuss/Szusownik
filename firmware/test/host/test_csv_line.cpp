#include <catch_amalgamated.hpp>

#include <string>

#include "core/csv_line.h"

using namespace core;

TEST_CASE("CSV: pelne metryki GNSS") {
  const CsvQuality quality{true, true, 25, true, 12, true, 2011, true, 0.80, true, 2011};
  char line[256];
  const size_t length =
      csvLine(line, sizeof(line), "2026-09-26T18:14:20.000Z", 51.050496, 17.031226, 1.6f, 130.8f,
              189.0f, 40.3f, quality);
  const std::string expected =
      "2026-09-26T18:14:20.000Z,51.050496,17.031226,1.6,130.8,189,40.3,1,25,12,2011,0.80,2011";
  REQUIRE(std::string(line) == expected);
  REQUIRE(length == expected.size());
}

TEST_CASE("CSV: brak metryk => puste pola, fix=0") {
  const CsvQuality quality{false, false, 0, false, 0, false, 0, false, 0.0, false, 0};
  char line[256];
  csvLine(line, sizeof(line), "t", 51.0, 17.0, 0.0f, 0.0f, 0.0f, 0.0f, quality);
  REQUIRE(std::string(line) == "t,51.000000,17.000000,0.0,0.0,0,0.0,0,,,,,");
}
