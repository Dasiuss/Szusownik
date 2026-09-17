#pragma once
#include <Arduino.h>
#include "../config/config.h"

// Pasywny buzzer piezo (GPIO10, LEDC 8-bit, głośność przez duty).
// Mapowanie prędkości: poniżej ustawionego progu cisza; 60-69:1, 70-79:2,
// 80-89:3, 90-99:4 krótkie;
// >=100: długie + krótkie (1 długi na każde 50 km/h, reszta dziesiątek krótkimi).
// Głośność adaptacyjna: volLow @60 km/h -> volHigh @120 km/h liniowo,
// powyżej 120 wartość z 120. Ustawiane z PWA, trzymane w NVS.
// Częstotliwości tonów (krótki/długi, niezależne): ustawiane z PWA przez
// SETFREQ, trzymane w NVS (defaulty 880/1100 Hz, zakres 600-1500 Hz).
// Czasy krótkiego/długiego tonu, przerwy we wzorze i przerwy między wzorami
// również są ustawiane z PWA przez SETTIMING i trzymane w NVS.
// Nieblokujące (scheduler na millis), poza playBoot() (setup).
class Beeper {
 public:
  void begin();  // wczytuje audio z NVS, podpina LEDC
  void tick(float kmh, unsigned long nowMs);
  void playBoot();  // blokujące, setup: sygnał 120 (1 długi + 2 krótkie)
                    // przy głośności 60. Wywołać PO begin().
  // Ustawienia z PWA (0..100, zapis do NVS + feedback one-shot).
  // Zwracają przyjętą wartość po clamp.
  uint8_t setVolLow(int v);
  uint8_t setVolHigh(int v);
  uint8_t volLow() const { return volLow_; }
  uint8_t volHigh() const { return volHigh_; }
  // Częstotliwości z PWA (Hz, clamp do SZ_FREQ_MIN/MAX_HZ, zapis do NVS +
  // feedback one-shot: 1 długi + 2 krótkie nowymi częstotliwościami).
  // Zwracają przyjętą wartość po clamp.
  uint16_t setFreqShort(int hz);
  uint16_t setFreqLong(int hz);
  uint16_t freqShort() const { return freqShort_; }
  uint16_t freqLong() const { return freqLong_; }
  uint16_t beepShortMs() const { return beepShortMs_; }
  uint16_t beepLongMs() const { return beepLongMs_; }
  uint16_t beepGapMs() const { return beepGapMs_; }
  uint16_t signalGapMs() const { return signalGapMs_; }
  uint8_t minBeepKmh() const { return minBeepKmh_; }
  uint16_t setBeepShortMs(int ms);
  uint16_t setBeepLongMs(int ms);
  uint16_t setBeepGapMs(int ms);
  uint16_t setSignalGapMs(int ms);
  uint8_t setMinBeepKmh(int kmh);
  // Głośność dla danej prędkości (kotwice 60/120, liniowo, clamp powyżej 120).
  uint8_t volumeFor(float kmh) const;

 private:
  struct Step {
    uint16_t freq;
    uint16_t ms;
    uint16_t gapAfter;
  };
  Step seq_[8];
  uint8_t seqLen_ = 0;
  uint8_t seqIdx_ = 0;
  unsigned long stepEnd_ = 0;
  unsigned long nextTick_ = 0;
  bool toneOn_ = false;
  bool patternLoaded_ = false;
  bool oneShot_ = false;
  uint8_t patternsRemaining_ = 0;
  uint8_t volLow_ = 20;
  uint8_t volHigh_ = 70;
  uint16_t freqShort_ = 880;
  uint16_t freqLong_ = 1100;
  uint16_t beepShortMs_ = SZ_BEEP_SHORT_DEFAULT_MS;
  uint16_t beepLongMs_ = SZ_BEEP_LONG_DEFAULT_MS;
  uint16_t beepGapMs_ = SZ_BEEP_GAP_DEFAULT_MS;
  uint16_t signalGapMs_ = SZ_BEEP_INTERVAL_DEFAULT_MS;
  uint8_t minBeepKmh_ = SZ_BEEP_MIN_KMH_DEFAULT;
  uint8_t playVol_ = 20;  // głośność bieżącej sekwencji
  void buildPattern(float kmh);
  void build120Pattern();
  void playShort();  // one-shot: 1 krótki (sygnał 60)
  void playLong2();  // one-shot: 1 długi + 2 krótkie (sygnał 120)
  void playFreqPreview();  // one-shot po SETFREQ: 1 długi + 2 krótkie
                            // nowymi częstotliwościami, przy głośności HIGH
  void playTimingPreview();  // trzy sygnały 120 po zmianie czasu
  void startOneShot(uint8_t vol, uint8_t repeats = 1);
  static uint8_t dutyFromVol(uint8_t v) {
    // Kwadratowa krzywa daje realnie cichszy dół skali; przy 1% duty = 0.
    return (uint8_t)(((uint32_t)v * v * 128U) / 10000U);
  }
};
