#include <catch_amalgamated.hpp>

#include <cstdint>
#include <cstdio>
#include <string>

#include "core/route.h"

namespace {

// Golden blob wygenerowany przez PWA (web/src/lib/routeTransfer.test.ts), trasa
// piste "1" + lift "Gaislachkogl": 6 punktow, 2 odcinki, 2020 m, CRC 26EA8EF9.
const uint8_t kGolden[] = {
    0x01, 0x00, 0x60, 0x00, 0xfc, 0x1b, 0x80, 0x77, 0x8e, 0x06, 0x06, 0x00, 0x02, 0x00,
    0xe4, 0x07, 0x00, 0x00, 0x00, 0x00, 0x98, 0x00, 0x23, 0xff, 0x30, 0x01, 0xd7, 0xfd,
    0xc8, 0x01, 0x8c, 0xfc, 0x30, 0x01, 0xb4, 0xfe, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x22, 0x06, 0x31, 0x01, 0x0c, 0x22, 0x06, 0xe4, 0x07, 0x47, 0x61, 0x69,
    0x73, 0x6c, 0x61, 0x63, 0x68, 0x6b, 0x6f, 0x67, 0x6c, 0xf9, 0x8e, 0xea, 0x26};

}  // namespace

TEST_CASE("trasa: golden blob z PWA dekoduje sie i waliduje CRC") {
  RouteData route;
  REQUIRE(routeDecode(kGolden, sizeof(kGolden), &route));
  REQUIRE(route.valid);
  REQUIRE(route.crc == 0x26EA8EF9u);
  REQUIRE(route.pointCount == 6);
  REQUIRE(route.segmentCount == 2);
  REQUIRE(route.totalDistanceM == 2020);
  REQUIRE(route.originLatE7 == 469500000);  // 46.95
  REQUIRE(route.originLonE7 == 110000000);  // 11.0

  REQUIRE(route.steps[0].kind == ROUTE_KIND_PISTE);
  REQUIRE(route.steps[0].startDistM == 0);
  REQUIRE(route.steps[0].endDistM == 1570);
  REQUIRE(route.steps[1].kind == ROUTE_KIND_LIFT);
  REQUIRE(route.steps[1].startDistM == 1570);
  REQUIRE(route.steps[1].endDistM == 2020);
  REQUIRE(std::string(route.steps[0].label) == "1");
  REQUIRE(std::string(route.steps[1].label) == "Gaislachkogl");
}

TEST_CASE("trasa: uszkodzony CRC odrzucony") {
  uint8_t corrupt[sizeof(kGolden)];
  for (size_t i = 0; i < sizeof(kGolden); i++) corrupt[i] = kGolden[i];
  corrupt[20] ^= 0xFF;  // psuje zawartosc, CRC bez zmian
  RouteData route;
  REQUIRE_FALSE(routeDecode(corrupt, sizeof(corrupt), &route));
  REQUIRE_FALSE(route.valid);
}

TEST_CASE("trasa: pusty blob (CLEAR)") {
  uint8_t out[ROUTE_MAX_BLOB] = {0};
  const size_t len = routeBuildEmpty(out, sizeof(out));
  REQUIRE(len == ROUTE_HEADER_SIZE + ROUTE_CRC_SIZE);
  RouteData route;
  REQUIRE(routeDecode(out, len, &route));
  REQUIRE(route.valid);
  REQUIRE(route.pointCount == 0);
  REQUIRE(route.segmentCount == 0);
  REQUIRE(route.crc != 0);
}

TEST_CASE("trasa: indeks odcinka i dystans do celu") {
  RouteData route;
  REQUIRE(routeDecode(kGolden, sizeof(kGolden), &route));

  // Start trasy = pierwszy punkt = odcinek 0.
  REQUIRE(routeSegmentIndex(route, 46.95, 11.0) == 0);
  // Srodek zjazdu (punkt 2) nadal odcinek 0.
  REQUIRE(routeSegmentIndex(route, 46.945, 11.004) == 0);
  // Srodek wyciagu -> odcinek 1.
  REQUIRE(routeSegmentIndex(route, 46.947, 11.004) == 1);

  // Koniec trasy pokrywa sie ze startem, wiec dystans do celu ~ 0.
  REQUIRE(routeDistanceToEndM(route, 46.95, 11.0) < 5.0f);
  // Srodek wyciagu jest setki metrow od konca.
  REQUIRE(routeDistanceToEndM(route, 46.947, 11.004) > 100.0f);
}

TEST_CASE("trasa: linia krokow od biezacego odcinka, nazwy skrocone") {
  RouteData route;
  REQUIRE(routeDecode(kGolden, sizeof(kGolden), &route));
  char b[24];
  routeFormatLine(route, 0, b, sizeof b);
  REQUIRE(std::string(b) == "1->Gai.gl");
  routeFormatLine(route, 1, b, sizeof b);
  REQUIRE(std::string(b) == "Gai.gl");
  routeFormatLine(route, 2, b, sizeof b);  // poza zakresem
  REQUIRE(std::string(b) == "");
}

TEST_CASE("trasa: linia krokow urywana bez wiszacej strzalki") {
  RouteData route;
  route.valid = true;
  route.segmentCount = 3;
  for (uint16_t index = 0; index < route.segmentCount; index++) {
    std::snprintf(route.steps[index].label, sizeof(route.steps[index].label), "111111%d", index);
  }

  char b[13];  // 12 widocznych znakow
  routeFormatLine(route, 0, b, sizeof b);
  const std::string line(b);
  REQUIRE(line.size() == 12);
  REQUIRE(line.substr(line.size() - 2) != "->");  // brak wiszacej strzalki na koncu
  REQUIRE(line == "111.10->111.");

  char narrow[9];  // 8 widocznych — strzalka juz sie nie zmiesci
  routeFormatLine(route, 0, narrow, sizeof narrow);
  REQUIRE(std::string(narrow) == "111.10");
}

TEST_CASE("trasa: brak trasy zwraca sentinel") {
  RouteData route;  // valid == false
  REQUIRE(routeSegmentIndex(route, 46.95, 11.0) == HUD_SEGMENT_NONE);
  REQUIRE(routeDistanceToEndM(route, 46.95, 11.0) < 0.0f);
}
