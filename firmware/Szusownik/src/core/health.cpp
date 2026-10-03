#include "health.h"

namespace core {

HealthAction healthEvaluate(float dieC, const HealthConfig& config, HealthState& state) {
  if (dieC >= config.critC) return HealthAction::Critical;

  if (dieC >= config.warnC) {
    if (state.overCount < 255) state.overCount++;
    if (state.overCount >= config.warnConfirm) return HealthAction::Warning;
    return HealthAction::None;
  }

  if (dieC < config.warnC - config.hystC) {
    bool wasWarned = state.overCount >= config.warnConfirm;
    state.overCount = 0;
    return wasWarned ? HealthAction::Cooldown : HealthAction::None;
  }

  return HealthAction::None;
}

}  // namespace core
