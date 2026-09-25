#include "storage.h"
#include "../config/pins.h"
#include "../config/config.h"
#include "../config/log.h"
#include <SPI.h>
#include <SD.h>

static File logFile;
static File readFile;

bool Storage::begin() {
  SPI.begin(PIN_SD_SCK, PIN_SD_MISO, PIN_SD_MOSI, PIN_SD_CS);
  return SD.begin(PIN_SD_CS, SPI, 20000000);
}

bool Storage::openLog(const String& stamp) {
  // Bez poprawnego czasu GNSS nie ma jak nazwać pliku — nie logujemy.
  if (!stamp.length()) return false;
  ensureFreeSpace();
  char name[32];
  snprintf(name, sizeof(name), "/%s.csv", stamp.c_str());
  currentName_ = String(name);
  logFile = SD.open(currentName_, FILE_APPEND);
  if (!logFile) return false;
  if (logFile.size() == 0) logFile.println(SZ_CSV_HEADER);
  fileOpen_ = true;
  runsInFile_ = 0;
  climbAcc_ = 0.0f;
  haveLastAlt_ = false;
  return true;
}

void Storage::writeSample(const String& utc, double lat, double lon, float kmh, float altGps,
                          float hdg, float altBaro, const GnssSampleQuality& quality) {
  if (!fileOpen_) return;
  char fixAge[16] = "";
  char satellites[16] = "";
  char satellitesAge[16] = "";
  char hdop[16] = "";
  char hdopAge[16] = "";
  if (quality.fixAgeValid) snprintf(fixAge, sizeof(fixAge), "%lu", (unsigned long)quality.fixAgeMs);
  if (quality.satellitesValid) {
    snprintf(satellites, sizeof(satellites), "%lu", (unsigned long)quality.satellites);
  }
  if (quality.satellitesAgeValid) {
    snprintf(satellitesAge, sizeof(satellitesAge), "%lu", (unsigned long)quality.satellitesAgeMs);
  }
  if (quality.hdopValid) snprintf(hdop, sizeof(hdop), "%.2f", quality.hdop);
  if (quality.hdopAgeValid) snprintf(hdopAge, sizeof(hdopAge), "%lu", (unsigned long)quality.hdopAgeMs);

  char line[256];
  snprintf(line, sizeof(line), "%s,%.6f,%.6f,%.1f,%.1f,%.0f,%.1f,%d,%s,%s,%s,%s,%s",
           utc.c_str(), lat, lon, kmh, altGps, hdg, altBaro, quality.fixValid ? 1 : 0, fixAge,
           satellites, satellitesAge, hdop, hdopAge);
  logFile.println(line);
}

void Storage::sync() {
  if (fileOpen_) logFile.flush();
}

void Storage::close() {
  if (fileOpen_) {
    logFile.flush();
    logFile.close();
    fileOpen_ = false;
  }
}

void Storage::noteSample(float kmh, float altM) {
  // Heurystyka wyciągu: wspinaczka przy niskiej prędkości. Progi do strojenia.
  if (haveLastAlt_ && kmh < SZ_LIFT_SPEED_KMH && altM > lastAlt_) {
    climbAcc_ += altM - lastAlt_;
  } else if (kmh >= SZ_LIFT_SPEED_KMH) {
    climbAcc_ = 0.0f;
  }
  lastAlt_ = altM;
  haveLastAlt_ = true;
  if (climbAcc_ >= SZ_LIFT_ALT_GAIN_M) {
    climbAcc_ = 0.0f;
    runsInFile_++;
    if (runsInFile_ >= SZ_RUNS_PER_FILE) close();  // main otworzy nowy sam
  }
}

String Storage::listJsonArray() const {
  String out = "[";
  File root = SD.open("/");
  if (!root) return "[]";
  bool first = true;
  while (true) {
    File f = root.openNextFile();
    if (!f) break;
    if (!f.isDirectory()) {
      String n = String(f.name());
      if (n.endsWith(".csv") || n.endsWith(".CSV")) {
        if (!first) out += ",";
        first = false;
        out += "{\"name\":\"" + n + "\",\"size\":" + String((unsigned long)f.size()) + "}";
      }
    }
    f.close();
  }
  root.close();
  out += "]";
  return out;
}

bool Storage::openRead(const String& name) {
  closeRead();
  String p = name;
  p.trim();
  if (!p.startsWith("/")) p = "/" + p;
  readFile = SD.open(p, FILE_READ);
  if (!readFile || readFile.isDirectory()) {
    closeRead();
    return false;
  }
  readSize_ = readFile.size();
  readOpen_ = true;
  return true;
}

size_t Storage::readBytes(uint8_t* buf, size_t maxLen) {
  if (!readOpen_) return 0;
  return readFile.read(buf, maxLen);
}

void Storage::closeRead() {
  if (readOpen_) {
    readFile.close();
    readOpen_ = false;
  }
  readSize_ = 0;
}

void Storage::ensureFreeSpace() {
  unsigned long total = SD.totalBytes();
  if (total == 0) return;  // brak karty — nie ma czego sprzątać
  while (SD.totalBytes() - SD.usedBytes() < SZ_SD_MIN_FREE_BYTES) {
    // Znajdź najstarszy CSV (nazwa = timestamp, więc leksykograficznie).
    File root = SD.open("/");
    if (!root) return;
    String oldest;
    while (true) {
      File f = root.openNextFile();
      if (!f) break;
      if (!f.isDirectory()) {
        String n = String(f.name());
        if (n.endsWith(".csv") || n.endsWith(".CSV")) {
          if (oldest.length() == 0 || n < oldest) oldest = n;
        }
      }
      f.close();
    }
    root.close();
    if (oldest.length() == 0) return;  // nic do skasowania
    if (fileOpen_ && currentName_.endsWith(oldest)) return;  // nie rusz bieżącego
    if (SD.remove(oldest)) {
      szLogf("SD: FIFO kasuje %s", oldest.c_str());
    } else {
      return;
    }
  }
}
