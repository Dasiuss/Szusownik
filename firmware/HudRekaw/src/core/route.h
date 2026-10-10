#pragma once
#include <stddef.h>
#include <stdint.h>

#include "../config/hud_protocol.h"
#include "../config/route_protocol.h"

// Czysta logika trasy po stronie odbiornika: dekodowanie bloba (SSOT:
// protocol/route-v1.json) i wybór etykiet "następnych kroków". Bez Arduino.h —
// testy hostowe w firmware/test/host/hudrekaw/.

struct HudRouteStep {
  char label[ROUTE_MAX_LABEL + 1];
  uint8_t labelLength;
  uint8_t kind;  // ROUTE_KIND_PISTE / ROUTE_KIND_LIFT
  uint16_t startDistM;
  uint16_t endDistM;
};

struct HudRoute {
  bool valid = false;
  int32_t originLatE7 = 0;
  int32_t originLonE7 = 0;
  uint16_t pointCount = 0;
  uint16_t segmentCount = 0;
  uint16_t totalDistanceM = 0;
  uint32_t crc = 0;
  int16_t east[ROUTE_MAX_POINTS];
  int16_t north[ROUTE_MAX_POINTS];
  HudRouteStep steps[ROUTE_MAX_SEGMENTS];
};

// Dekoduje i waliduje blob (wersja, rozmiary, CRC32). Przy powodzeniu wypełnia
// `out`. Zwraca false przy błędzie.
bool hudRouteDecode(const uint8_t* data, size_t len, HudRoute* out);

// Etykieta odcinka `index` albo nullptr poza zakresem.
const char* hudRouteStepLabel(const HudRoute& route, uint8_t index);
