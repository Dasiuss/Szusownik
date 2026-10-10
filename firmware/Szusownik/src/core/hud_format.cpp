#include "hud_format.h"

#include <stdio.h>
#include <string.h>

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

void formatRouteLabel(const char* in, char* out, size_t n) {
  if (!out || n == 0) return;
  if (!in) {
    out[0] = '\0';
    return;
  }
  const size_t len = strlen(in);
  char tmp[8];
  size_t copy = 0;
  if (len <= 6) {
    for (; copy < len; copy++) tmp[copy] = in[copy];
  } else {
    tmp[0] = in[0];
    tmp[1] = in[1];
    tmp[2] = in[2];
    tmp[3] = '.';
    tmp[4] = in[len - 2];
    tmp[5] = in[len - 1];
    copy = 6;
  }
  const size_t outLen = copy < n - 1 ? copy : n - 1;
  memcpy(out, tmp, outLen);
  out[outLen] = '\0';
}

}  // namespace core
