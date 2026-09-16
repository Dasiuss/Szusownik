#include "audio.h"
#include <Preferences.h>
#include "../config/pins.h"
#include "../config/config.h"

static Preferences volPrefs;

void Beeper::begin() {
  volPrefs.begin("szusownik", false);
  volLow_ = volPrefs.getUChar("volLow", SZ_VOL_LOW_DEFAULT);
  volHigh_ = volPrefs.getUChar("volHigh", SZ_VOL_HIGH_DEFAULT);
  freqShort_ = volPrefs.getUShort("freqShort", SZ_FREQ_SHORT_DEFAULT);
  freqLong_ = volPrefs.getUShort("freqLong", SZ_FREQ_LONG_DEFAULT);
  volPrefs.end();
  if (freqShort_ < SZ_FREQ_MIN_HZ || freqShort_ > SZ_FREQ_MAX_HZ)
    freqShort_ = SZ_FREQ_SHORT_DEFAULT;
  if (freqLong_ < SZ_FREQ_MIN_HZ || freqLong_ > SZ_FREQ_MAX_HZ)
    freqLong_ = SZ_FREQ_LONG_DEFAULT;
  pinMode(PIN_BUZZER, OUTPUT);
  ledcAttach(PIN_BUZZER, freqShort_, 8);
  ledcWrite(PIN_BUZZER, 0);
}

uint8_t Beeper::volumeFor(float kmh) const {
  if (kmh <= SZ_VOL_LOW_KMH) return volLow_;
  if (kmh >= SZ_VOL_HIGH_KMH) return volHigh_;
  float t = (kmh - SZ_VOL_LOW_KMH) / (SZ_VOL_HIGH_KMH - SZ_VOL_LOW_KMH);
  return (uint8_t)(volLow_ + t * (volHigh_ - volLow_) + 0.5f);
}

static uint8_t clampVol(int v) {
  if (v < 0) return 0;
  if (v > 100) return 100;
  return (uint8_t)v;
}

uint8_t Beeper::setVolLow(int v) {
  volLow_ = clampVol(v);
  volPrefs.begin("szusownik", false);
  volPrefs.putUChar("volLow", volLow_);
  volPrefs.end();
  playShort();  // feedback: sygnał 60 przy głośności 60
  return volLow_;
}

uint8_t Beeper::setVolHigh(int v) {
  volHigh_ = clampVol(v);
  volPrefs.begin("szusownik", false);
  volPrefs.putUChar("volHigh", volHigh_);
  volPrefs.end();
  playLong2();  // feedback: sygnał 120 przy głośności 120
  return volHigh_;
}

static uint16_t clampFreq(int hz) {
  if (hz < SZ_FREQ_MIN_HZ) return SZ_FREQ_MIN_HZ;
  if (hz > SZ_FREQ_MAX_HZ) return SZ_FREQ_MAX_HZ;
  return (uint16_t)hz;
}

uint16_t Beeper::setFreqShort(int hz) {
  freqShort_ = clampFreq(hz);
  volPrefs.begin("szusownik", false);
  volPrefs.putUShort("freqShort", freqShort_);
  volPrefs.end();
  playFreqPreview();  // feedback nowymi częstotliwościami
  return freqShort_;
}

uint16_t Beeper::setFreqLong(int hz) {
  freqLong_ = clampFreq(hz);
  volPrefs.begin("szusownik", false);
  volPrefs.putUShort("freqLong", freqLong_);
  volPrefs.end();
  playFreqPreview();  // feedback nowymi częstotliwościami
  return freqLong_;
}

void Beeper::buildPattern(float kmh) {
  seqLen_ = 0;
  seqIdx_ = 0;
  playVol_ = volumeFor(kmh);
  if (kmh < SZ_SILENCE_BELOW_KMH) return;
  uint8_t cont = 0, beeps = 0;
  if (kmh < 100.0f) {
    // Im szybciej, tym więcej: 60-69:1, 70-79:2, 80-89:3, 90-99:4.
    beeps = kmh < 70.0f ? 1 : kmh < 80.0f ? 2 : kmh < 90.0f ? 3 : 4;
  } else {
    cont = (uint8_t)((kmh - 100.0f) / 50.0f) + 1;
    if (cont > 3) cont = 3;
    beeps = (uint8_t)(((int)kmh % 50) / 10);
  }
  for (uint8_t i = 0; i < cont && seqLen_ < 8; i++) {
    seq_[seqLen_++] = {freqLong_, SZ_BEEP_LONG_MS, SZ_BEEP_GAP_MS};
  }
  for (uint8_t i = 0; i < beeps && seqLen_ < 8; i++) {
    seq_[seqLen_++] = {freqShort_, SZ_BEEP_SHORT_MS, SZ_BEEP_GAP_MS};
  }
}

void Beeper::startOneShot(uint8_t vol) {
  playVol_ = vol;
  seqIdx_ = 0;
  unsigned long now = millis();
  stepEnd_ = now;  // start natychmiast w najbliższym tick()
  // Strażnik, żeby zwykły rebuild nie przerwał odtwarzania one-shot:
  unsigned long total = 0;
  for (uint8_t i = 0; i < seqLen_; i++) total += seq_[i].ms + seq_[i].gapAfter;
  nextTick_ = now + total + 500;
}

void Beeper::playShort() {
  seqLen_ = 0;
  seq_[seqLen_++] = {freqShort_, SZ_BEEP_SHORT_MS, SZ_BEEP_GAP_MS};
  startOneShot(volLow_);
}

void Beeper::playLong2() {
  seqLen_ = 0;
  seq_[seqLen_++] = {freqLong_, SZ_BEEP_LONG_MS, SZ_BEEP_GAP_MS};
  for (uint8_t i = 0; i < 2; i++) {
    seq_[seqLen_++] = {freqShort_, SZ_BEEP_SHORT_MS, SZ_BEEP_GAP_MS};
  }
  startOneShot(volHigh_);
}

void Beeper::playFreqPreview() {
  // Podgląd po SETFREQ: ten sam kształt co sygnał 120, ale zawsze nowymi
  // częstotliwościami i przy głośności HIGH (słyszalny na stoku).
  seqLen_ = 0;
  seq_[seqLen_++] = {freqLong_, SZ_BEEP_LONG_MS, SZ_BEEP_GAP_MS};
  for (uint8_t i = 0; i < 2; i++) {
    seq_[seqLen_++] = {freqShort_, SZ_BEEP_SHORT_MS, SZ_BEEP_GAP_MS};
  }
  startOneShot(volHigh_);
}

void Beeper::playBoot() {
  // Setup, blokująco: sygnał identyczny do 120 (1 długi + 2 krótkie,
  // te same czasy/odstępy/częstotliwości), ale głośność z 60.
  uint8_t d = dutyFromVol(volLow_);
  ledcWriteTone(PIN_BUZZER, freqLong_);
  ledcWrite(PIN_BUZZER, d);
  delay(SZ_BEEP_LONG_MS);
  ledcWrite(PIN_BUZZER, 0);
  delay(SZ_BEEP_GAP_MS);
  for (uint8_t i = 0; i < 2; i++) {
    ledcWriteTone(PIN_BUZZER, freqShort_);
    ledcWrite(PIN_BUZZER, d);
    delay(SZ_BEEP_SHORT_MS);
    ledcWrite(PIN_BUZZER, 0);
    delay(SZ_BEEP_GAP_MS);
  }
}

void Beeper::tick(float kmh, unsigned long nowMs) {
  if (toneOn_ && nowMs >= stepEnd_) {
    ledcWrite(PIN_BUZZER, 0);
    toneOn_ = false;
  }
  if (!toneOn_ && seqIdx_ < seqLen_ && nowMs >= stepEnd_) {
    Step& s = seq_[seqIdx_++];
    if (playVol_ > 0) {
      ledcWriteTone(PIN_BUZZER, s.freq);
      ledcWrite(PIN_BUZZER, dutyFromVol(playVol_));
    }
    toneOn_ = true;
    stepEnd_ = nowMs + s.ms + s.gapAfter;
    return;
  }
  if (seqIdx_ >= seqLen_ && !toneOn_ && nowMs >= nextTick_) {
    buildPattern(kmh);
    nextTick_ = nowMs + SZ_BEEP_INTERVAL_MS;
  }
}
