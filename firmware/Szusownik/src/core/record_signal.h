#pragma once

#include "beeper_pattern.h"

namespace core {

// Dedykowany sygnał rekordu: ustalona, stała siedmionutowa
// sekwencja. Nie zależy od nastaw długości i odstępów zwykłego beepera.
size_t recordSignalBuildPattern(ToneStep* out, size_t maxSteps);

}  // namespace core
