#include "gnss_rate.h"

namespace core {

int gnssBandOf(float kmh) {
  if (kmh < 20.0f) return 0;
  if (kmh < 50.0f) return 1;
  if (kmh < 70.0f) return 2;
  if (kmh < 80.0f) return 3;
  return 4;
}

unsigned long gnssBandIntervalMs(int band) {
  static const unsigned long iv[5] = {2000, 1000, 333, 166, 100};
  if (band < 0) band = 0;
  if (band > 4) band = 4;
  return iv[band];
}

int gnssBandRateHz(int band) {
  static const int hz[5] = {0, 1, 3, 6, 10};  // 0 = 0.5 Hz
  if (band < 0) band = 0;
  if (band > 4) band = 4;
  return hz[band];
}

int gnssNextBand(int currentBand, float kmh, float hysteresisKmh) {
  static const float bounds[4] = {20.0f, 50.0f, 70.0f, 80.0f};
  int want = gnssBandOf(kmh);
  if (want == currentBand) return -1;
  bool cross = want > currentBand ? (kmh >= bounds[want - 1] + hysteresisKmh)
                                  : (kmh <= bounds[want] - hysteresisKmh);
  return cross ? want : -1;
}

}  // namespace core
