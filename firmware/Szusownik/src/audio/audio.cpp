#include "audio.h"
#include <Preferences.h>
#include "../config/pins.h"
#include "../config/config.h"

static Preferences audioPrefs;

void Beeper::begin() {
  audioPrefs.begin("szusownik", false);
  volLow_ = audioPrefs.getUChar("volLow", SZ_VOL_LOW_DEFAULT);
  volHigh_ = audioPrefs.getUChar("volHigh", SZ_VOL_HIGH_DEFAULT);
  freqShort_ = audioPrefs.getUShort("freqShort", SZ_FREQ_SHORT_DEFAULT);
  freqLong_ = audioPrefs.getUShort("freqLong", SZ_FREQ_LONG_DEFAULT);
  beepShortMs_ = audioPrefs.getUShort("beepShort", SZ_BEEP_SHORT_DEFAULT_MS);
  beepLongMs_ = audioPrefs.getUShort("beepLong", SZ_BEEP_LONG_DEFAULT_MS);
  beepGapMs_ = audioPrefs.getUShort("beepGap", SZ_BEEP_GAP_DEFAULT_MS);
  signalGapMs_ = audioPrefs.getUShort("signalGap", SZ_BEEP_INTERVAL_DEFAULT_MS);
  audioPrefs.end();
  if (freqShort_ < SZ_FREQ_MIN_HZ || freqShort_ > SZ_FREQ_MAX_HZ)
    freqShort_ = SZ_FREQ_SHORT_DEFAULT;
  if (freqLong_ < SZ_FREQ_MIN_HZ || freqLong_ > SZ_FREQ_MAX_HZ)
    freqLong_ = SZ_FREQ_LONG_DEFAULT;
  if (beepShortMs_ < SZ_BEEP_SHORT_MIN_MS || beepShortMs_ > SZ_BEEP_SHORT_MAX_MS)
    beepShortMs_ = SZ_BEEP_SHORT_DEFAULT_MS;
  if (beepLongMs_ < SZ_BEEP_LONG_MIN_MS || beepLongMs_ > SZ_BEEP_LONG_MAX_MS)
    beepLongMs_ = SZ_BEEP_LONG_DEFAULT_MS;
  if (beepGapMs_ < SZ_BEEP_GAP_MIN_MS || beepGapMs_ > SZ_BEEP_GAP_MAX_MS)
    beepGapMs_ = SZ_BEEP_GAP_DEFAULT_MS;
  if (signalGapMs_ < SZ_BEEP_INTERVAL_MIN_MS || signalGapMs_ > SZ_BEEP_INTERVAL_MAX_MS)
    signalGapMs_ = SZ_BEEP_INTERVAL_DEFAULT_MS;
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
  audioPrefs.begin("szusownik", false);
  audioPrefs.putUChar("volLow", volLow_);
  audioPrefs.end();
  playShort();  // feedback: sygnał 60 przy głośności 60
  return volLow_;
}

uint8_t Beeper::setVolHigh(int v) {
  volHigh_ = clampVol(v);
  audioPrefs.begin("szusownik", false);
  audioPrefs.putUChar("volHigh", volHigh_);
  audioPrefs.end();
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
  audioPrefs.begin("szusownik", false);
  audioPrefs.putUShort("freqShort", freqShort_);
  audioPrefs.end();
  playFreqPreview();  // feedback nowymi częstotliwościami
  return freqShort_;
}

uint16_t Beeper::setFreqLong(int hz) {
  freqLong_ = clampFreq(hz);
  audioPrefs.begin("szusownik", false);
  audioPrefs.putUShort("freqLong", freqLong_);
  audioPrefs.end();
  playFreqPreview();  // feedback nowymi częstotliwościami
  return freqLong_;
}

static uint16_t clampMs(int value, int minValue, int maxValue) {
  if (value < minValue) return (uint16_t)minValue;
  if (value > maxValue) return (uint16_t)maxValue;
  return (uint16_t)value;
}

uint16_t Beeper::setBeepShortMs(int ms) {
  beepShortMs_ = clampMs(ms, SZ_BEEP_SHORT_MIN_MS, SZ_BEEP_SHORT_MAX_MS);
  audioPrefs.begin("szusownik", false);
  audioPrefs.putUShort("beepShort", beepShortMs_);
  audioPrefs.end();
  playTimingPreview();
  return beepShortMs_;
}

uint16_t Beeper::setBeepLongMs(int ms) {
  beepLongMs_ = clampMs(ms, SZ_BEEP_LONG_MIN_MS, SZ_BEEP_LONG_MAX_MS);
  audioPrefs.begin("szusownik", false);
  audioPrefs.putUShort("beepLong", beepLongMs_);
  audioPrefs.end();
  playTimingPreview();
  return beepLongMs_;
}

uint16_t Beeper::setBeepGapMs(int ms) {
  beepGapMs_ = clampMs(ms, SZ_BEEP_GAP_MIN_MS, SZ_BEEP_GAP_MAX_MS);
  audioPrefs.begin("szusownik", false);
  audioPrefs.putUShort("beepGap", beepGapMs_);
  audioPrefs.end();
  playTimingPreview();
  return beepGapMs_;
}

uint16_t Beeper::setSignalGapMs(int ms) {
  signalGapMs_ = clampMs(ms, SZ_BEEP_INTERVAL_MIN_MS, SZ_BEEP_INTERVAL_MAX_MS);
  audioPrefs.begin("szusownik", false);
  audioPrefs.putUShort("signalGap", signalGapMs_);
  audioPrefs.end();
  playTimingPreview();
  return signalGapMs_;
}

void Beeper::buildPattern(float kmh) {
  seqLen_ = 0;
  seqIdx_ = 0;
  playVol_ = volumeFor(kmh);
  patternLoaded_ = true;
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
    seq_[seqLen_++] = {freqLong_, beepLongMs_, 0};
  }
  for (uint8_t i = 0; i < beeps && seqLen_ < 8; i++) {
    seq_[seqLen_++] = {freqShort_, beepShortMs_, 0};
  }
  for (uint8_t i = 0; i + 1 < seqLen_; i++) {
    seq_[i].gapAfter = beepGapMs_;
  }
}

void Beeper::build120Pattern() {
  seqLen_ = 0;
  seq_[seqLen_++] = {freqLong_, beepLongMs_, 0};
  seq_[seqLen_++] = {freqShort_, beepShortMs_, beepGapMs_};
  seq_[seqLen_++] = {freqShort_, beepShortMs_, 0};
  seqIdx_ = 0;
  patternLoaded_ = true;
}

void Beeper::startOneShot(uint8_t vol, uint8_t repeats) {
  ledcWrite(PIN_BUZZER, 0);
  toneOn_ = false;
  playVol_ = vol;
  seqIdx_ = 0;
  patternLoaded_ = true;
  oneShot_ = true;
  patternsRemaining_ = repeats;
  unsigned long now = millis();
  stepEnd_ = now;  // start natychmiast w najbliższym tick()
  nextTick_ = now;
}

void Beeper::playShort() {
  seqLen_ = 0;
  seq_[seqLen_++] = {freqShort_, beepShortMs_, 0};
  startOneShot(volLow_);
}

void Beeper::playLong2() {
  build120Pattern();
  startOneShot(volHigh_);
}

void Beeper::playFreqPreview() {
  // Podgląd po SETFREQ: ten sam kształt co sygnał 120, ale zawsze nowymi
  // częstotliwościami i przy głośności HIGH (słyszalny na stoku).
  build120Pattern();
  startOneShot(volHigh_);
}

void Beeper::playTimingPreview() {
  build120Pattern();
  startOneShot(volHigh_, 3);
}

void Beeper::playBoot() {
  // Setup, blokująco: sygnał identyczny do 120 (1 długi + 2 krótkie,
  // te same czasy/odstępy/częstotliwości), ale głośność z 60.
  uint8_t d = dutyFromVol(volLow_);
  ledcWriteTone(PIN_BUZZER, freqLong_);
  ledcWrite(PIN_BUZZER, d);
  delay(beepLongMs_);
  ledcWrite(PIN_BUZZER, 0);
  delay(beepGapMs_);
  ledcWriteTone(PIN_BUZZER, freqShort_);
  ledcWrite(PIN_BUZZER, d);
  delay(beepShortMs_);
  ledcWrite(PIN_BUZZER, 0);
  delay(beepGapMs_);
  ledcWriteTone(PIN_BUZZER, freqShort_);
  ledcWrite(PIN_BUZZER, d);
  delay(beepShortMs_);
  ledcWrite(PIN_BUZZER, 0);
}

void Beeper::tick(float kmh, unsigned long nowMs) {
  if (toneOn_ && nowMs >= stepEnd_) {
    ledcWrite(PIN_BUZZER, 0);
    toneOn_ = false;
    stepEnd_ = nowMs + seq_[seqIdx_ - 1].gapAfter;
  }
  if (patternLoaded_ && !toneOn_ && seqIdx_ < seqLen_ && nowMs >= stepEnd_) {
    Step& s = seq_[seqIdx_++];
    if (playVol_ > 0) {
      ledcWriteTone(PIN_BUZZER, s.freq);
      ledcWrite(PIN_BUZZER, dutyFromVol(playVol_));
    }
    toneOn_ = true;
    stepEnd_ = nowMs + s.ms;
    return;
  }
  if (patternLoaded_ && seqIdx_ >= seqLen_ && !toneOn_ && nowMs >= stepEnd_) {
    patternLoaded_ = false;
    if (oneShot_ && patternsRemaining_ > 1) {
      patternsRemaining_--;
      nextTick_ = nowMs + signalGapMs_;
      return;
    }
    oneShot_ = false;
    patternsRemaining_ = 0;
    nextTick_ = nowMs + signalGapMs_;
  }
  if (!patternLoaded_ && nowMs >= nextTick_) {
    if (oneShot_) {
      build120Pattern();
    } else {
      buildPattern(kmh);
    }
  }
}
