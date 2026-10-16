#pragma once
#include <stddef.h>

// Czysta logika nazw plików towarzyszących (`.meta`) używanych przy listowaniu
// SD. Wydzielona z `Storage`, żeby dała się przetestować hostowo bez karty.
//
// Kontrakt: plik widoczny dla PWA = CSV z plikiem "<nazwa>.csv.meta". Bazę CSV
// odtwarzamy z nazwy `.meta` jednym przebiegiem katalogu (bez otwierania CSV).

namespace core {

// Jeśli `name` kończy się `suffix` (np. ".meta") i ma niepustą bazę, zapisuje
// bazę (np. "20260101_120000.csv") do `out` (NUL-terminowana, obcięta do
// outLen) i zwraca true. W przeciwnym razie zwraca false i nie rusza `out`.
bool csvNameFromMeta(const char* name, const char* suffix, char* out, size_t outLen);

}  // namespace core
