#pragma once
#include <stddef.h>

// Czyste formatowanie pól HUD (bez Arduino) — testowane hostowo.
// Font Adafruit GFX jest ASCII, więc etykiety są transliterowane wyżej
// (np. "WYSOKOSC"); tu tylko liczby i czas.

namespace core {

// "HH:MM" z UTC + offsetMin (minuty mogą być ujemne). hour < 0 => "--:--".
void formatLocalHm(int utcHour, int utcMinute, int offsetMin, char* out, size_t n);

// Liczba całkowita z zakresu [0, maxValue], format "%d".
void formatUint(char* out, size_t n, float value, int maxValue);

// Dystans w km z jednym miejscem po przecinku, "%.1f", zakres [0, 999.9].
void formatTenthsKm(char* out, size_t n, float km);

// Wysokość w metrach z przyrostkiem "m", zakres [0, 99999].
void formatMeters(char* out, size_t n, float meters);

// Pierwsze maxLen znaków nazwy (na potrzeby linii trasy).
void truncateName(const char* in, char* out, size_t n, unsigned maxLen);

}  // namespace core
