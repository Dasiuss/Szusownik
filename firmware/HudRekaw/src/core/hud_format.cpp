#include "hud_format.h"

#include <stdio.h>

size_t hudFormatTenthsKm(uint16_t tenthsKm, char* out, size_t outLen) {
  if (out == nullptr || outLen == 0) return 0;
  const int written = snprintf(out, outLen, "%u.%u", static_cast<unsigned>(tenthsKm / 10),
                               static_cast<unsigned>(tenthsKm % 10));
  if (written < 0) {
    out[0] = '\0';
    return 0;
  }
  if (static_cast<size_t>(written) >= outLen) return outLen - 1;
  return static_cast<size_t>(written);
}
