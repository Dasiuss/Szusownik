#pragma once
#include <Arduino.h>
#include "../gnss/gnss.h"

// Zapis SUROWEGO CSV na microSD (bez filtrowania). Rotacja: domknięcie pliku na
// postoju (chroni dane przed odcięciem zasilania) oraz na żądanie sync z PWA.
// Bez kasowania po wysyłce.
class Storage {
 public:
  bool begin();
  bool openLog(const String& stamp);  // stamp = YYYYMMDD_HHMMSS; pusty => nie tworzy pliku
  void writeSample(const String& utc, double lat, double lon, float kmh, float altGps,
                   float hdg, float altBaro, const GnssSampleQuality& quality);
  void sync();
  void close();
  bool isOpen() const { return fileOpen_; }
  String currentName() const { return currentName_; }
  uint32_t countCsv() const;  // liczba plików CSV na karcie (bez katalogów)
  // i-ty plik CSV w stabilnej kolejności katalogu; false gdy brak.
  bool csvAt(uint32_t index, String& name, unsigned long& size) const;
  void rotateForSync() { close(); }  // nowy otworzy się przy kolejnej próbce
  // Rolka na postoju: gdy prędkość < SZ_ROLL_STOP_BELOW_KMH przez SZ_ROLL_HOLD_MS
  // (tylko przy poprawnym fixie), domyka plik; ponowne uzbrojenie po prędkości
  // > SZ_ROLL_REARM_ABOVE_KMH przez SZ_ROLL_HOLD_MS. Wołane z pętli co iterację.
  void updateFileRotation(float kmh, bool fixValid);
  // FIFO: gdy wolne miejsce < SZ_SD_MIN_FREE_BYTES, kasuj najstarsze CSV
  // (nazwy YYYYMMDD_HHMMSS sortują się chronologicznie).
  void ensureFreeSpace();

  // Odczyt do transferu BLE (niezależny uchwyt od zapisu; plik musi być
  // zamknięty przez rotateForSync przed odczytem).
  bool openRead(const String& name);
  size_t readBytes(uint8_t* buf, size_t maxLen);
  unsigned long readSize() const { return readSize_; }
  void closeRead();
  bool readOpen() const { return readOpen_; }

 private:
  bool fileOpen_ = false;
  String currentName_;
  String readName_;
  unsigned long readSize_ = 0;
  bool readOpen_ = false;
  bool fileRotationArmed_ = false;  // false na starcie: pierwsza rolka po realnym ruchu
  unsigned long stoppedSince_ = 0;  // 0 = brak warunku bezruchu; inaczej millis() startu
  unsigned long movingSince_ = 0;   // 0 = brak warunku ruchu; inaczej millis() startu
};
