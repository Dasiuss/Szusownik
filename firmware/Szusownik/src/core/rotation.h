#pragma once
#include <stdint.h>

// Czysta maszyna stanu rolki pliku na postoju (bez Arduino/SD).
// Rolka domyka plik po postoju, żeby przy odcięciu zasilania otwarty był tylko
// bezwartościowy plik z próbkami z postoju. Uzbrojenie następuje dopiero po
// potwierdzonym ruchu, więc jeden postój = jedna rolka.

namespace core {

struct RotationConfig {
  float stopBelowKmh;
  float rearmAboveKmh;
  unsigned long holdMs;
};

struct RotationState {
  bool armed = false;             // false na starcie: pierwsza rolka po realnym ruchu
  unsigned long stoppedSince = 0;  // 0 = brak warunku bezruchu
  unsigned long movingSince = 0;   // 0 = brak warunku ruchu

  // Zwraca true, gdy należy teraz domknąć bieżący plik.
  bool update(float kmh, bool fixValid, unsigned long now, const RotationConfig& config);
};

}  // namespace core
