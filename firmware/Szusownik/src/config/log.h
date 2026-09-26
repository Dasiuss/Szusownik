#pragma once
#include <Arduino.h>
#include <stdarg.h>

// Logowanie z timestampem [ms od startu] i poziomem.
// Poziomy: E=blad, W=ostrzezenie, I=zdarzenie (domyslny prog), D=debug.
//
// Zasada projektu (patrz docs/wymagania-ESP.md §9 i AGENTS.md):
//   INFO  = zdarzenia i cykl zycia (fix acquired/lost, SD, BLE, HEALTH, boot)
//           oraz szczegolowy przebieg transferu BLE (rzadki, stac nas na detal).
//   DEBUG = wszystko cykliczne/strumieniowe: status okresowy SYS, per-probka
//           GNSS, diagnostyka UBX/INFO/BLE. Domyslnie niewidoczne.
//
// Wywolania ponizej progu SZ_LOG_LEVEL sa wycinane KOMPILACYJNIE (zero kosztu
// flash i CPU). Prog ustawia SZ_LOG_LEVEL w config.h; tu tylko fallback, gdy
// plik nie widzi config.h.
#ifndef SZ_LOG_LEVEL
#define SZ_LOG_LEVEL 2
#endif

inline void szLogPrefix(char lvl) {
  Serial.printf("[%10lu] %c ", (unsigned long)millis(), lvl);
}
inline void szLogLine(char lvl, const char* s) {
  szLogPrefix(lvl);
  Serial.println(s);
}
inline void szLogLine(char lvl, const __FlashStringHelper* s) {
  szLogPrefix(lvl);
  Serial.println(s);
}
inline void szLogLinef(char lvl, const char* fmt, ...) {
  szLogPrefix(lvl);
  char b[256];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(b, sizeof(b), fmt, ap);
  va_end(ap);
  Serial.println(b);
}

#if SZ_LOG_LEVEL >= 3
#define SZ_LOGD(m) szLogLine('D', m)
#define SZ_LOGDF(...) szLogLinef('D', __VA_ARGS__)
#else
#define SZ_LOGD(m) ((void)0)
#define SZ_LOGDF(...) ((void)0)
#endif

#if SZ_LOG_LEVEL >= 2
#define SZ_LOGI(m) szLogLine('I', m)
#define SZ_LOGIF(...) szLogLinef('I', __VA_ARGS__)
#else
#define SZ_LOGI(m) ((void)0)
#define SZ_LOGIF(...) ((void)0)
#endif

#if SZ_LOG_LEVEL >= 1
#define SZ_LOGW(m) szLogLine('W', m)
#define SZ_LOGWF(...) szLogLinef('W', __VA_ARGS__)
#else
#define SZ_LOGW(m) ((void)0)
#define SZ_LOGWF(...) ((void)0)
#endif

// Bledy logujemy zawsze (najnizszy prog).
#define SZ_LOGE(m) szLogLine('E', m)
#define SZ_LOGEF(...) szLogLinef('E', __VA_ARGS__)

// Uwaga: stare szLog()/szLogf() zostaly zastapione makrami poziomow powyzej.
