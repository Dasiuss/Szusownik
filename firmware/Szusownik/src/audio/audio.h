#pragma once
#include <Arduino.h>

// Pasywny buzzer piezo (GPIO10, LEDC 8-bit, głośność przez duty).
// Mapowanie prędkości: <60 cisza; 60-69:1, 70-79:2, 80-89:3, 90-99:4 krótkie;
// >=100: długie + krótkie (1 długi na każde 50 km/h, reszta dziesiątek krótkimi).
// Głośność adaptacyjna: volLow @60 km/h -> volHigh @120 km/h liniowo,
// powyżej 120 wartość z 120. Ustawiane z PWA, trzymane w NVS.
// Nieblokujące (scheduler na millis), poza playBoot() (setup) i feedbackiem
// one-shot po SETVOL.
class Beeper {
 public:
  void begin();  // wczytuje głośność z NVS, podpina LEDC
  void tick(float kmh, unsigned long nowMs);
  void playBoot();  // blokujące, setup: sygnał 120 (1 długi + 2 krótkie)
                    // przy głośności 60. Wywołać PO begin().
  // Ustawienia z PWA (0..100, zapis do NVS + feedback one-shot).
  // Zwracają przyjętą wartość po clamp.
  uint8_t setVolLow(int v);
  uint8_t setVolHigh(int v);
  uint8_t volLow() const { return volLow_; }
  uint8_t volHigh() const { return volHigh_; }
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
  uint8_t volLow_ = 40;
  uint8_t volHigh_ = 90;
  uint8_t playVol_ = 40;  // głośność bieżącej sekwencji
  void buildPattern(float kmh);
  void playShort();  // one-shot: 1 krótki (sygnał 60)
  void playLong2();  // one-shot: 1 długi + 2 krótkie (sygnał 120)
  void startOneShot(uint8_t vol);
  static uint8_t dutyFromVol(uint8_t v) { return (uint8_t)((v * 128U) / 100U); }
};
