#pragma once
#include <stddef.h>
#include <stdint.h>

#include "../config/hud_protocol.h"
#include "../config/route_protocol.h"

// Czysta logika trasy nawigacyjnej (SSOT: protocol/route-v1.json): dekodowanie
// bloba, postęp wzdłuż trasy i odległość do celu. Bez Arduino.h — testy hostowe.

struct RouteStep {
  char label[ROUTE_MAX_LABEL + 1];
  uint8_t labelLength;
  uint8_t kind;  // ROUTE_KIND_PISTE / ROUTE_KIND_LIFT
  uint16_t startDistM;
  uint16_t endDistM;
};

struct RouteData {
  bool valid = false;
  int32_t originLatE7 = 0;
  int32_t originLonE7 = 0;
  uint16_t pointCount = 0;
  uint16_t segmentCount = 0;
  uint16_t totalDistanceM = 0;
  uint32_t crc = 0;
  int16_t east[ROUTE_MAX_POINTS];
  int16_t north[ROUTE_MAX_POINTS];
  RouteStep steps[ROUTE_MAX_SEGMENTS];
};

// Buduje kanoniczny pusty blob (CLEAR) i zwraca jego długość (albo 0 przy
// zbyt małym buforze).
size_t routeBuildEmpty(uint8_t* out, size_t outLen);

// Dekoduje i waliduje blob (wersja, rozmiary, CRC32). Przy powodzeniu wypełnia
// `out` (w tym etykiety odcinków). Zwraca false przy błędzie.
bool routeDecode(const uint8_t* data, size_t len, RouteData* out);

// Indeks odcinka dla pozycji GNSS (najbliższy punkt trasy -> dystans wzdłuż).
// HUD_SEGMENT_NONE, gdy brak trasy.
uint8_t routeSegmentIndex(const RouteData& route, double lat, double lon);

// Odległość w metrach od końca trasy (odcinek prosty do ostatniego punktu).
// Wartość ujemna, gdy brak trasy.
float routeDistanceToEndM(const RouteData& route, double lat, double lon);
