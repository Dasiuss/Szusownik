#include <catch_amalgamated.hpp>

#include <cstdint>

#include "config/config.h"
#include "core/map_math.h"

TEST_CASE("HudRekaw mapa: punkt rowera trafia w srodek") {
  int16_t x = 0;
  int16_t y = 0;
  mapProjectPoint(0, 0, 0.0f, 0.0f, 1.0f, 0.0f, 220, 500.0f, &x, &y);
  REQUIRE(x == MAP_RIDER_X);
  REQUIRE(y == MAP_RIDER_Y);
}

TEST_CASE("HudRekaw mapa: odlegly punkt jest przyciety do ekranu") {
  int16_t x = 0;
  int16_t y = 0;
  // Punkt daleko na południe (north ujemny) -> w dół ekranu, poza zakres.
  mapProjectPoint(0, -30000, 0.0f, 0.0f, 1.0f, 0.0f, 500, 0.0f, &x, &y);
  REQUIRE(x == MAP_RIDER_X);
  REQUIRE(y == 640);
}

TEST_CASE("HudRekaw mapa: kolor wg rodzaju i trudnosci") {
  REQUIRE(mapWayColor(1, 99) == COLOR_SNOWPARK);
  REQUIRE(mapWayColor(2, 99) == COLOR_CONNECTION);
  REQUIRE(mapWayColor(0, 0) == COLOR_NOVICE);
  REQUIRE(mapWayColor(0, 3) == COLOR_ADVANCED);
  REQUIRE(mapWayColor(3, 4) == COLOR_FREERIDE);  // droga używa bucketów trudności
  REQUIRE(mapWayColor(0, 9) == COLOR_UNKNOWN);
}

TEST_CASE("HudRekaw mapa: nakładanie labeli") {
  MapLabelBox placed[2];
  placed[0].x = 0;
  placed[0].y = 0;
  placed[0].width = 10;
  placed[0].height = 10;

  MapLabelBox label;
  label.x = 5;
  label.y = 5;
  label.width = 10;
  label.height = 10;
  REQUIRE(mapLabelOverlaps(label, placed, 1));

  label.x = 20;
  REQUIRE_FALSE(mapLabelOverlaps(label, placed, 1));

  placed[1].width = 0;  // puste miejsce jest ignorowane
  REQUIRE_FALSE(mapLabelOverlaps(label, &placed[1], 1));
}

TEST_CASE("HudRekaw mapa: sortowanie labeli po odleglosci") {
  MapLabelBox labels[3];
  labels[0].distanceSq = 100;
  labels[1].distanceSq = 5;
  labels[2].distanceSq = 50;
  mapSortLabelsByDistance(labels, 3);
  REQUIRE(labels[0].distanceSq == 5);
  REQUIRE(labels[1].distanceSq == 50);
  REQUIRE(labels[2].distanceSq == 100);
}

TEST_CASE("HudRekaw mapa: brak przerysowania w martwej strefie ruchu") {
  // Bez ruchu i bez zmiany kursu -> nic nie rysujemy.
  REQUIRE_FALSE(mapShouldRedraw(0, 0, 100, 0, 0, 100, 5.0f, 8));
  // 4 m < 5 m -> jeszcze nie.
  REQUIRE_FALSE(mapShouldRedraw(0, 0, 100, 4, 0, 100, 5.0f, 8));
  // 3-4-5 -> dokladnie 5 m -> rysujemy (prog >=).
  REQUIRE(mapShouldRedraw(0, 0, 100, 3, 4, 100, 5.0f, 8));
  // 6 m -> rysujemy.
  REQUIRE(mapShouldRedraw(0, 0, 100, 0, 6, 100, 5.0f, 8));
}

TEST_CASE("HudRekaw mapa: histereza kursu z zawijaniem 0/360") {
  // 5 stopni < 8 -> nie.
  REQUIRE_FALSE(mapShouldRedraw(0, 0, 0, 0, 0, 5, 5.0f, 8));
  // 8 stopni -> rysujemy (prog >=).
  REQUIRE(mapShouldRedraw(0, 0, 0, 0, 0, 8, 5.0f, 8));
  // Zawijanie: 358 -> 2 to 4 stopnie, nie rysujemy.
  REQUIRE_FALSE(mapShouldRedraw(0, 0, 358, 0, 0, 2, 5.0f, 8));
  // Zawijanie: 356 -> 2 to 6 stopni, nie rysujemy.
  REQUIRE_FALSE(mapShouldRedraw(0, 0, 356, 0, 0, 2, 5.0f, 8));
  // Zawijanie: 350 -> 2 to 12 stopni, rysujemy.
  REQUIRE(mapShouldRedraw(0, 0, 350, 0, 0, 2, 5.0f, 8));
}
