#include "health.h"
#include "../config/config.h"
#include "../config/log.h"
#include "../storage/storage.h"
#include "../audio/audio.h"
#include "../hud/hud.h"
#include "../baro/baro.h"
#include <esp_sleep.h>

void Health::begin(Storage* storage, Beeper* beeper, Hud* hud, Baro* baro) {
  storage_ = storage;
  beeper_ = beeper;
  hud_ = hud;
  baro_ = baro;
  nextCheck_ = millis() + SZ_HEALTH_CHECK_MS;  // pierwszy check po interwale
}

void Health::tick(unsigned long nowMs) {
  if ((long)(nowMs - nextCheck_) < 0) return;
  nextCheck_ = nowMs + SZ_HEALTH_CHECK_MS;

  float dieC = temperatureRead();
  float airC = 0.0f;
  if (baro_ && baro_->present() && baro_->read()) airC = baro_->tempC();

  const core::HealthConfig config{SZ_HEALTH_TEMP_WARN_C, SZ_HEALTH_TEMP_CRIT_C, SZ_HEALTH_HYST_C,
                                  SZ_HEALTH_WARN_CONFIRM};
  const core::HealthAction action = core::healthEvaluate(dieC, config, health_);

  if (action == core::HealthAction::Critical) {
    SZ_LOGEF("HEALTH KRYTYCZNE die=%.1fC air=%.1fC -> SD close + deep sleep", dieC, airC);
    if (storage_) storage_->close();
    if (hud_) hud_->drawOverheat(dieC, airC);
    if (beeper_) beeper_->playOverheat();  // blokujacy, zaraz potem sen
    esp_deep_sleep_start();
    return;
  }

  if (action == core::HealthAction::Warning) {
    SZ_LOGWF("HEALTH OSTRZEZENIE die=%.1fC air=%.1fC (potwierdzen=%u)", dieC, airC,
             health_.overCount);
    if (beeper_) beeper_->alarm(SZ_HEALTH_ALARM_MS);
  } else if (action == core::HealthAction::Cooldown) {
    SZ_LOGIF("HEALTH ostyglo die=%.1fC air=%.1fC", dieC, airC);
  }
}
