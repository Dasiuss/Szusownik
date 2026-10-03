#pragma once
#include <stddef.h>

// Czyste formatowanie jednej linii CSV v2 (bez SD/Arduino). Firmware deleguje
// tutaj z Storage::writeSample, a testy hostowe porównują wynik z nagłówkiem
// DEVICE_CSV_V2_HEADER (protocol.h).

namespace core {

struct CsvQuality {
  bool fixValid;
  bool fixAgeValid;
  unsigned long fixAgeMs;
  bool satellitesValid;
  unsigned long satellites;
  bool satellitesAgeValid;
  unsigned long satellitesAgeMs;
  bool hdopValid;
  double hdop;
  bool hdopAgeValid;
  unsigned long hdopAgeMs;
};

// Zapisuje linię (bez CRLF) do `out`; zwraca długość tekstu (bez NUL).
size_t csvLine(char* out, size_t outSize, const char* utc, double lat, double lon, float kmh,
               float altGps, float hdg, float altBaro, const CsvQuality& quality);

}  // namespace core
