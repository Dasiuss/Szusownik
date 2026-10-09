#include <catch_amalgamated.hpp>

#include <string>

#include "core/hud_format.h"

TEST_CASE("HudRekaw TOT: km z jednym miejscem po przecinku") {
  char buffer[10];
  REQUIRE(hudFormatTenthsKm(1234, buffer, sizeof(buffer)) == 5);
  REQUIRE(std::string(buffer) == "123.4");

  REQUIRE(hudFormatTenthsKm(0, buffer, sizeof(buffer)) == 3);
  REQUIRE(std::string(buffer) == "0.0");

  REQUIRE(hudFormatTenthsKm(5, buffer, sizeof(buffer)) == 3);
  REQUIRE(std::string(buffer) == "0.5");

  REQUIRE(hudFormatTenthsKm(65535, buffer, sizeof(buffer)) == 6);
  REQUIRE(std::string(buffer) == "6553.5");
}
