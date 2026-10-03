#pragma once
#include <stdint.h>

// Czysta decyzja termiczna (bez Arduino/esp_sleep). Firmware (src/health)
// wykonuje akcje (alarm, zamknięcie SD, deep sleep), a tutaj jest tylko logika
// progów i histerezy.

namespace core {

enum class HealthAction { None, Warning, Cooldown, Critical };

struct HealthConfig {
  float warnC;
  float critC;
  float hystC;
  uint8_t warnConfirm;
};

struct HealthState {
  uint8_t overCount = 0;
};

// Aktualizuje licznik potwierdzeń i zwraca decyzję dla bieżącego odczytu.
//  - Critical: dieC >= critC (licznik bez zmian),
//  - Warning:  dieC >= warnC po warnConfirm kolejnych potwierdzeniach,
//  - Cooldown: spadek poniżej warnC - hystC po wcześniejszym ostrzeżeniu,
//  - None:     w przeciwnym razie.
HealthAction healthEvaluate(float dieC, const HealthConfig& config, HealthState& state);

}  // namespace core
