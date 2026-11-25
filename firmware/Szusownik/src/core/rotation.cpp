#include "rotation.h"

namespace core {

bool RotationState::update(float kmh, bool fixValid, unsigned long now, const RotationConfig& config) {
  // Bez poprawnego fixa nie znamy prędkości (przy braku fixa kmh = 0), więc nie
  // rolujemy — inaczej zanik fixa w ruchu fałszywie ciąłby przejazd.
  if (!fixValid) {
    stoppedTiming = false;
    movingTiming = false;
    return false;
  }
  if (kmh < config.stopBelowKmh) {
    movingTiming = false;
    if (!stoppedTiming) {
      stoppedSince = now;
      stoppedTiming = true;
    }
    if (armed && now - stoppedSince >= config.holdMs) {
      armed = false;
      stoppedTiming = false;
      return true;
    }
  } else if (kmh > config.rearmAboveKmh) {
    stoppedTiming = false;
    if (!movingTiming) {
      movingSince = now;
      movingTiming = true;
    }
    if (!armed && now - movingSince >= config.holdMs) {
      armed = true;
    }
  } else {
    // Strefa histerezy: ani bezruch, ani uzbrajający ruch — zeruj liczniki,
    // ale nie zmieniaj stanu uzbrojenia.
    stoppedTiming = false;
    movingTiming = false;
  }
  return false;
}

}  // namespace core
