#pragma once
#include <Arduino.h>

// CRC32 (IEEE 802.3, zgodny z zlib) do walidacji transferu BLE end-to-end.
// PWA liczy CRC32 po dekompresji i porównuje z wartością ze STATUS "done".
// Tablica generowana w runtime standardowym algorytmem (bez ryzyka literówki
// w przepisywanej tabeli).
static const uint32_t SZ_CRC32_INIT = 0xFFFFFFFFu;

inline uint32_t szCrc32Update(uint32_t crc, const uint8_t* data, size_t len) {
  static uint32_t table[256];
  static bool tableInit = false;
  if (!tableInit) {
    for (uint32_t i = 0; i < 256; i++) {
      uint32_t c = i;
      for (int k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
      }
      table[i] = c;
    }
    tableInit = true;
  }
  for (size_t i = 0; i < len; i++) {
    crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >> 8);
  }
  return crc;
}

inline uint32_t szCrc32Final(uint32_t crc) { return crc ^ 0xFFFFFFFFu; }
