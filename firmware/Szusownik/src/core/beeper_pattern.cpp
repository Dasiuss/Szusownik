#include "beeper_pattern.h"

namespace core {

uint8_t beeperVolumeFor(float kmh, uint8_t volLow, uint8_t volHigh, float lowKmh, float highKmh) {
  if (kmh <= lowKmh) return volLow;
  if (kmh >= highKmh) return volHigh;
  float t = (kmh - lowKmh) / (highKmh - lowKmh);
  return (uint8_t)(volLow + t * (volHigh - volLow) + 0.5f);
}

size_t beeperBuildPattern(float kmh, const BeeperPatternSettings& settings, ToneStep* out,
                          size_t maxSteps) {
  size_t len = 0;
  if (kmh < (float)settings.minBeepKmh) return 0;

  uint8_t cont = 0;
  uint8_t beeps = 0;
  if (kmh < 100.0f) {
    // Im szybciej, tym więcej: 60-69:1, 70-79:2, 80-89:3, 90-99:4.
    beeps = kmh < 70.0f ? 1 : kmh < 80.0f ? 2 : kmh < 90.0f ? 3 : 4;
  } else {
    cont = (uint8_t)((kmh - 100.0f) / 50.0f) + 1;
    if (cont > 3) cont = 3;
    beeps = (uint8_t)(((int)kmh % 50) / 10);
  }

  for (uint8_t i = 0; i < cont && len < maxSteps; i++) {
    out[len++] = {settings.freqLong, settings.beepLongMs, settings.beepGapMs};
  }
  for (uint8_t i = 0; i < beeps && len < maxSteps; i++) {
    out[len++] = {settings.freqShort, settings.beepShortMs, settings.beepGapMs};
  }
  if (len > 0) out[len - 1].gapAfter = 0;
  return len;
}

}  // namespace core
