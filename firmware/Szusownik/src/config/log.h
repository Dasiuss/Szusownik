#pragma once
#include <Arduino.h>
#include <stdarg.h>

// Logowanie z timestampem [ms od startu] — do debugowania tempa pomiarów.
// Używać zamiast gołego Serial.print/printf przy logach diagnostycznych.
inline void szLogPrefix() { Serial.printf("[%10lu] ", (unsigned long)millis()); }
inline void szLog(const char* s) {
  szLogPrefix();
  Serial.println(s);
}
inline void szLog(const __FlashStringHelper* s) {
  szLogPrefix();
  Serial.println(s);
}
inline void szLogf(const char* fmt, ...) {
  szLogPrefix();
  char b[160];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(b, sizeof(b), fmt, ap);
  va_end(ap);
  Serial.println(b);
}
