#include <catch_amalgamated.hpp>

#include <string>

#include "core/hud_format.h"

using namespace core;

TEST_CASE("hud_format: czas lokalny z offsetem i zawijaniem") {
  char b[8];
  formatLocalHm(14, 23, 0, b, sizeof b);
  REQUIRE(std::string(b) == "14:23");
  formatLocalHm(23, 30, 60, b, sizeof b);  // UTC+1 przechodzi przez północ
  REQUIRE(std::string(b) == "00:30");
  formatLocalHm(0, 30, -60, b, sizeof b);  // UTC-1 cofa na poprzedni dzień
  REQUIRE(std::string(b) == "23:30");
  formatLocalHm(-1, -1, 60, b, sizeof b);  // brak czasu z GNSS
  REQUIRE(std::string(b) == "--:--");
}

TEST_CASE("hud_format: clamp wartości liczbowych") {
  char b[8];
  formatUint(b, sizeof b, 123.4f, 999);
  REQUIRE(std::string(b) == "123");
  formatUint(b, sizeof b, 123.7f, 999);
  REQUIRE(std::string(b) == "124");
  formatUint(b, sizeof b, 1500.0f, 999);
  REQUIRE(std::string(b) == "999");
  formatUint(b, sizeof b, -5.0f, 999);
  REQUIRE(std::string(b) == "0");
}

TEST_CASE("hud_format: dystans i wysokość z jednostką") {
  char b[8];
  formatTenthsKm(b, sizeof b, 12.34f);
  REQUIRE(std::string(b) == "12.3");
  formatTenthsKm(b, sizeof b, 1234.5f);
  REQUIRE(std::string(b) == "999.9");
  formatMeters(b, sizeof b, 2013.4f);
  REQUIRE(std::string(b) == "2013m");
}

TEST_CASE("hud_format: skrót nazwy trasy (<=6 pełna, >=7 -> 3+.+2)") {
  char b[8];
  formatRouteLabel("1", b, sizeof b);
  REQUIRE(std::string(b) == "1");
  formatRouteLabel("123456", b, sizeof b);  // dokładnie 6 — bez zmian
  REQUIRE(std::string(b) == "123456");
  formatRouteLabel("1234567", b, sizeof b);  // 7 — skracana
  REQUIRE(std::string(b) == "123.67");
  formatRouteLabel("grond.e2", b, sizeof b);  // 8 -> gro.e2
  REQUIRE(std::string(b) == "gro.e2");
  formatRouteLabel("Gaislachkogl", b, sizeof b);  // 12 -> Gai.gl
  REQUIRE(std::string(b) == "Gai.gl");
  formatRouteLabel(nullptr, b, sizeof b);
  REQUIRE(std::string(b) == "");
}
