#include "rotation.h"

namespace core {

bool RotationState::update(float kmh, bool fixValid, unsigned long now, const RotationConfig& config) {
  // Bez poprawnego fixa nie znamy prędkości (przy braku fixa kmh = 0), więc nie
  // rolujemy — inaczej zanik fixa w ruchu fałszywie ciąłby przejazd.
  if (!fixValid) {
    stoppedSince = 0;
    movingSince = 0;
    return false;
  }
  if (kmh < config.stopBelowKmh) {
    movingSince = 0;
    if (stoppedSince == 0) stoppedSince = now;
    if (armed && now - stoppedSince >= config.holdMs) {
      armed = false;
      return true;
    }
  } else if (kmh > config.rearmAboveKmh) {
    stoppedSince = 0;
    if (movingSince == 0) movingSince = now;
    if (!armed && now - movingSince >= config.holdMs) {
      armed = true;
    }
  } else {
    // Strefa histerezy: ani bezruch, ani uzbrajający ruch — zeruj liczniki,
    // ale nie zmieniaj stanu uzbrojenia.
    stoppedSince = 0;
    movingSince = 0;
  }
  return false;
}

}  // namespace core
