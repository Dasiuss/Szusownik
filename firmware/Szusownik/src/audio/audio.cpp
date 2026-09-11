#include "audio.h"
#include "../config/pins.h"
#include "../config/config.h"

void Beeper::begin() {
  pinMode(PIN_BUZZER, OUTPUT);
  noTone(PIN_BUZZER);
}

void Beeper::buildPattern(float kmh) {
  seqLen_ = 0;
  seqIdx_ = 0;
  if (kmh < SZ_SILENCE_BELOW_KMH) return;
  uint8_t cont = 0, beeps = 0;
  if (kmh < 100.0f) {
    beeps = (uint8_t)((100.0f - kmh + 9.9f) / 10.0f);
    if (beeps < 1) beeps = 1;
    if (beeps > 4) beeps = 4;
  } else {
    cont = (uint8_t)((kmh - 100.0f) / 50.0f) + 1;
    if (cont > 3) cont = 3;
    beeps = (uint8_t)(((int)kmh % 50) / 10);
  }
  uint16_t fLong = SZ_RECORD_FREQ_HZ;
  for (uint8_t i = 0; i < cont && seqLen_ < 8; i++) {
    seq_[seqLen_++] = {fLong, 200, 120};
  }
  for (uint8_t i = 0; i < beeps && seqLen_ < 8; i++) {
    seq_[seqLen_++] = {(uint16_t)SZ_BEEP_FREQ_HZ, 80, 120};
  }
}

void Beeper::tick(float kmh, unsigned long nowMs) {
  if (toneOn_ && nowMs >= stepEnd_) {
    noTone(PIN_BUZZER);
    toneOn_ = false;
  }
  if (!toneOn_ && seqIdx_ < seqLen_ && nowMs >= stepEnd_) {
    Step& s = seq_[seqIdx_++];
    tone(PIN_BUZZER, s.freq, s.ms);
    toneOn_ = true;
    stepEnd_ = nowMs + s.ms + s.gapAfter;
    return;
  }
  if (seqIdx_ >= seqLen_ && !toneOn_ && nowMs >= nextTick_) {
    buildPattern(kmh);
    nextTick_ = nowMs + SZ_BEEP_INTERVAL_MS;
  }
}
