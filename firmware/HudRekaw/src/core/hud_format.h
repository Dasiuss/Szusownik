#pragma once
#include <stddef.h>
#include <stdint.h>

// Formatowanie wartości HUD do tekstu (czysta logika, testy hostowe).

// TOT (km * HUD_TOT_SCALE) -> "km z jednym miejscem po przecinku", np. 1234 ->
// "123.4". Zapisuje zakończony '\0' łańcuch i zwraca jego długość (bez '\0').
size_t hudFormatTenthsKm(uint16_t tenthsKm, char* out, size_t outLen);
