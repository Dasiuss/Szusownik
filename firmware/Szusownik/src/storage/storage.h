#pragma once
#include <Arduino.h>

// Zapis SUROWEGO CSV na microSD (bez filtrowania). Rotacja co ~5 zjazdów
// (heurystyka wyciągu) oraz na żądanie sync z PWA. Bez kasowania po wysyłce.
class Storage {
 public:
  bool begin();
  bool openLog(const String& stampOrEmpty);
  void writeSample(const String& utc, double lat, double lon, float kmh, float altGps,
                   float hdg, float altBaro);
  void sync();
  void close();
  bool isOpen() const { return fileOpen_; }
  String currentName() const { return currentName_; }
  String listJsonArray() const;  // [{"name":..,"size":..},..]
  void rotateForSync() { close(); }  // nowy otworzy się przy kolejnej próbce
  void noteSample(float kmh, float altM);
  int runsInFile() const { return runsInFile_; }
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
  unsigned long readSize_ = 0;
  bool readOpen_ = false;
  int runsInFile_ = 0;
  float lastAlt_ = 0.0f;
  bool haveLastAlt_ = false;
  float climbAcc_ = 0.0f;
};
