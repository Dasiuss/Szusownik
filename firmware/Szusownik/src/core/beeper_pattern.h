#pragma once
#include <stddef.h>
#include <stdint.h>

// Czyste wzorce buzzera (bez LEDC/Arduino): głośność adaptacyjna i sekwencja
// tonów dla prędkości. Firmware (src/audio) deleguje tutaj; testy hostowe
// sprawdzają progi i kształt wzoru.

namespace core {

struct ToneStep {
  uint16_t freq;
  uint16_t ms;
  uint16_t gapAfter;
};

struct BeeperPatternSettings {
  uint16_t freqShort;
  uint16_t freqLong;
  uint16_t beepShortMs;
  uint16_t beepLongMs;
  uint16_t beepGapMs;
  uint8_t minBeepKmh;
};

// Głośność 0..100: volLow @ lowKmh, volHigh @ highKmh, liniowo między, clamp poza.
uint8_t beeperVolumeFor(float kmh, uint8_t volLow, uint8_t volHigh, float lowKmh, float highKmh);

// Buduje sekwencję tonów dla prędkości. Zwraca liczbę kroków (0 = cisza, gdy
// kmh < minBeepKmh). Ostatni krok ma gapAfter = 0. `maxSteps` ogranicza bufor.
size_t beeperBuildPattern(float kmh, const BeeperPatternSettings& settings, ToneStep* out,
                          size_t maxSteps);

}  // namespace core
