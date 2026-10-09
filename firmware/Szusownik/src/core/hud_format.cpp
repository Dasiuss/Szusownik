#include "hud_format.h"

#include <stdio.h>

namespace core {

void formatLocalHm(int utcHour, int utcMinute, int offsetMin, char* out, size_t n) {
  if (!out || n == 0) return;
  if (utcHour < 0 || utcMinute < 0) {
    snprintf(out, n, "--:--");
    return;
  }
  int total = utcHour * 60 + utcMinute + offsetMin;
  total %= 1440;
  if (total < 0) total += 1440;
  snprintf(out, n, "%02d:%02d", total / 60, total % 60);
}

void formatUint(char* out, size_t n, float value, int maxValue) {
  if (!out || n == 0) return;
  int v = (int)(value + 0.5f);
  if (v < 0) v = 0;
  if (maxValue >= 0 && v > maxValue) v = maxValue;
  snprintf(out, n, "%d", v);
}

void formatTenthsKm(char* out, size_t n, float km) {
  if (!out || n == 0) return;
  if (km < 0.0f) km = 0.0f;
  if (km > 999.9f) km = 999.9f;
  snprintf(out, n, "%.1f", km);
}

void formatMeters(char* out, size_t n, float meters) {
  if (!out || n == 0) return;
  int v = (int)(meters + 0.5f);
  if (v < 0) v = 0;
  if (v > 99999) v = 99999;
  snprintf(out, n, "%dm", v);
}

void truncateName(const char* in, char* out, size_t n, unsigned maxLen) {
  if (!out || n == 0) return;
  if (!in) {
    out[0] = '\0';
    return;
  }
  unsigned i = 0;
  for (; in[i] != '\0' && i < maxLen && i + 1 < n; i++) out[i] = in[i];
  out[i] = '\0';
}

}  // namespace core
