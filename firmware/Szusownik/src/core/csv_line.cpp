#include "csv_line.h"
#include <stdio.h>
#include <string.h>

namespace core {

size_t csvLine(char* out, size_t outSize, const char* utc, double lat, double lon, float kmh,
               float altGps, float hdg, float altBaro, const CsvQuality& quality) {
  char fixAge[16] = "";
  char satellites[16] = "";
  char satellitesAge[16] = "";
  char hdop[16] = "";
  char hdopAge[16] = "";
  if (quality.fixAgeValid) snprintf(fixAge, sizeof(fixAge), "%lu", quality.fixAgeMs);
  if (quality.satellitesValid) snprintf(satellites, sizeof(satellites), "%lu", quality.satellites);
  if (quality.satellitesAgeValid) {
    snprintf(satellitesAge, sizeof(satellitesAge), "%lu", quality.satellitesAgeMs);
  }
  if (quality.hdopValid) snprintf(hdop, sizeof(hdop), "%.2f", quality.hdop);
  if (quality.hdopAgeValid) snprintf(hdopAge, sizeof(hdopAge), "%lu", quality.hdopAgeMs);

  snprintf(out, outSize, "%s,%.6f,%.6f,%.1f,%.1f,%.0f,%.1f,%d,%s,%s,%s,%s,%s", utc, lat, lon, kmh,
           altGps, hdg, altBaro, quality.fixValid ? 1 : 0, fixAge, satellites, satellitesAge, hdop,
           hdopAge);
  return strlen(out);
}

}  // namespace core
