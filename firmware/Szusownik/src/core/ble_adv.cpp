#include "ble_adv.h"

namespace core {

bool bleAdvFastNext(bool fast, float kmh, float fastBelowKmh, float hysteresisKmh) {
  if (!(kmh > 0.0f)) kmh = 0.0f;  // brak fixu (0) oraz NaN => jak postój
  if (fast) return kmh < fastBelowKmh + hysteresisKmh;
  return kmh < fastBelowKmh;
}

}  // namespace core
