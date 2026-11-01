#include "record_signal.h"

namespace core {

size_t recordSignalBuildPattern(ToneStep* out, size_t maxSteps) {
  static const ToneStep pattern[] = {
      {659, 65, 28}, {784, 65, 28}, {988, 65, 28}, {1175, 65, 28},
      {988, 65, 28}, {1175, 65, 28}, {1480, 65, 0},
  };
  constexpr size_t count = sizeof(pattern) / sizeof(pattern[0]);
  if (!out || maxSteps < count) return 0;
  for (size_t index = 0; index < count; index++) out[index] = pattern[index];
  return count;
}

}  // namespace core
