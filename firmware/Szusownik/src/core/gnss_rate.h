#pragma once
#include <stdint.h>

// Czysta logika adaptacyjnego próbkowania GNSS (bez Arduino).
// Firmware (src/gnss) deleguje tutaj; testy hostowe linkują tylko src/core.

namespace core {

// Pasmo prędkości: 0:<20 1:20-50 2:50-70 3:70-80 4:>=80 km/h.
int gnssBandOf(float kmh);

// Docelowy interwał zapisu/meas rate dla pasma (ms).
unsigned long gnssBandIntervalMs(int band);

// Docelowa częstotliwość dla pasma (Hz); 0 oznacza 0.5 Hz.
int gnssBandRateHz(int band);

// Nowe pasmo po uwzględnieniu histerezy (+/- hysteresisKmh) albo -1, gdy pasmo
// się nie zmienia. `currentBand` musi być w zakresie 0..4.
int gnssNextBand(int currentBand, float kmh, float hysteresisKmh);

}  // namespace core
