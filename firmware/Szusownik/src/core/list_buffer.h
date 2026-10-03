#pragma once
#include <stddef.h>

// Czysta logika posortowanego bufora listy plików (LIST:<since>).
// Trzyma maxCount NAJSTARSZYCH nazw (rosnąco), więc PWA dopyta o kolejny
// fragment kursorem = ostatnia nazwa.

namespace core {

struct ListEntry {
  char name[24];
  unsigned long size;
};

// Wstawia (name, size) do rosnącego bufora, zachowując maxCount najstarszych.
// Zwraca nową liczbę wpisów (<= maxCount).
size_t listInsert(ListEntry* out, size_t count, size_t maxCount, const char* name, unsigned long size);

}  // namespace core
