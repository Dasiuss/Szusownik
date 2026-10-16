#include <catch_amalgamated.hpp>

#include <string>

#include "core/meta_name.h"

using namespace core;

TEST_CASE("meta: z nazwy .meta odtwarza baze CSV") {
  char buf[24];
  REQUIRE(csvNameFromMeta("20260101_120000.csv.meta", ".meta", buf, sizeof(buf)));
  REQUIRE(std::string(buf) == "20260101_120000.csv");
}

TEST_CASE("meta: odrzuca nie-meta i pusta baze") {
  char buf[24];
  REQUIRE_FALSE(csvNameFromMeta("20260101_120000.csv", ".meta", buf, sizeof(buf)));
  REQUIRE_FALSE(csvNameFromMeta(".meta", ".meta", buf, sizeof(buf)));
  REQUIRE_FALSE(csvNameFromMeta("x.metafoo", ".meta", buf, sizeof(buf)));
  REQUIRE_FALSE(csvNameFromMeta("", ".meta", buf, sizeof(buf)));
}

TEST_CASE("meta: obcina dluga nazwe do pojemnosci bufora") {
  char buf[8];
  REQUIRE(csvNameFromMeta("0123456789.csv.meta", ".meta", buf, sizeof(buf)));
  REQUIRE(std::string(buf) == "0123456");
}
