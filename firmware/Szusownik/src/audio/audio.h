#pragma once
#include <Arduino.h>

// Pasywny buzzer piezo (GPIO10). Sygnał co 1 s wg tabeli z koncepcji:
// <60 cisza; 60-100: 4->1 piknięć; >=100: ciągły + piknięcia;
// kolejny ciągły co 50 km/h. Nieblokujące (tone z czasem + scheduler).
class Beeper {
 public:
  void begin();
  void tick(float kmh, unsigned long nowMs);

 private:
  struct Step {
    uint16_t freq;
    uint16_t ms;
    uint16_t gapAfter;
  };
  Step seq_[8];
  uint8_t seqLen_ = 0;
  uint8_t seqIdx_ = 0;
  unsigned long stepEnd_ = 0;
  unsigned long nextTick_ = 0;
  bool toneOn_ = false;
  void buildPattern(float kmh);
};
