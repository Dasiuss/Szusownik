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
  szLogf("SD: open %s", currentName_.c_str());
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
  // File::flush() = fflush + fsync; fsync na VFS FAT (vfs_fat_fsync) woła
  // FATFS f_sync, czyli domyka wpis katalogowy i FAT na karcie. Sam flush
  // wystarcza — okresowe close()+open() nic nie dodaje poza ponownym
  // przejściem łańcucha FAT przy następnym dopisaniu (koszt rośnie z plikiem).
  if (!fileOpen_) return;
  uint32_t t0 = millis();
  logFile.flush();
  uint32_t dt = millis() - t0;
  if (dt >= 20) szLogf("SD: sync %lu ms", (unsigned long)dt);
}

void Storage::close() {
  if (fileOpen_) {
    logFile.flush();
    logFile.close();
    fileOpen_ = false;
  }
}

void Storage::updateFileRotation(float kmh, bool fixValid) {
  // Rolka na postoju: domyka plik, gdy stoimy. Bez poprawnego fixa nie znamy
  // prędkości (przy braku fixa kmh = 0), więc nie rolujemy — inaczej zanik fixa
  // w ruchu (tunel, garaż) fałszywie ciąłby przejazd.
  if (!fixValid) {
    stoppedSince_ = 0;
    movingSince_ = 0;
    return;
  }
  const unsigned long now = millis();
  if (kmh < SZ_ROLL_STOP_BELOW_KMH) {
    movingSince_ = 0;
    if (stoppedSince_ == 0) stoppedSince_ = now;
    if (fileRotationArmed_ && now - stoppedSince_ >= SZ_ROLL_HOLD_MS) {
      szLogf("SD: rolka (postoj) zamyka %s", currentName_.c_str());
      close();  // main otworzy nowy plik przy kolejnej próbce
      fileRotationArmed_ = false;
    }
  } else if (kmh > SZ_ROLL_REARM_ABOVE_KMH) {
    stoppedSince_ = 0;
    if (movingSince_ == 0) movingSince_ = now;
    if (!fileRotationArmed_ && now - movingSince_ >= SZ_ROLL_HOLD_MS) {
      fileRotationArmed_ = true;
    }
  } else {
    // Strefa histerezy (STOP_BELOW .. REARM_ABOVE): ani bezruch, ani uzbrajający
    // ruch — zeruj liczniki, ale nie zmieniaj stanu uzbrojenia.
    stoppedSince_ = 0;
    movingSince_ = 0;
  }
}

uint32_t Storage::countCsv() const {
  uint32_t count = 0;
  File root = SD.open("/");
  if (!root) return 0;
  while (true) {
    File f = root.openNextFile();
    if (!f) break;
    if (!f.isDirectory()) {
      String n = String(f.name());
      if (n.endsWith(".csv") || n.endsWith(".CSV")) count++;
    }
    f.close();
  }
  root.close();
  return count;
}

bool Storage::csvAt(uint32_t index, String& name, unsigned long& size) const {
  uint32_t seen = 0;
  File root = SD.open("/");
  if (!root) return false;
  bool found = false;
  while (true) {
    File f = root.openNextFile();
    if (!f) break;
    if (!f.isDirectory()) {
      String n = String(f.name());
      if (n.endsWith(".csv") || n.endsWith(".CSV")) {
        if (seen == index) {
          name = n;
          size = (unsigned long)f.size();
          found = true;
          f.close();
          break;
        }
        seen++;
      }
    }
    f.close();
  }
  root.close();
  return found;
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
  readName_ = p;
  szLogf("SD: openRead %s size=%lu pos=%lu", p.c_str(), (unsigned long)readSize_,
         (unsigned long)readFile.position());
  readFile.seek(0);  // size() może przestawić pozycję VFS na koniec
  return true;
}

size_t Storage::readBytes(uint8_t* buf, size_t maxLen) {
  if (!readOpen_) {
    szLog("SD: readBytes bez otwartego pliku");
    return 0;
  }
  size_t pos = readFile.position();
  size_t n = readFile.read(buf, maxLen);
  if (n == 0 && pos < readSize_) {
    // Realny błąd odczytu (nie normalny EOF na końcu pliku).
    File probe = SD.open(readName_, FILE_READ);
    uint8_t one = 0;
    size_t pn = probe ? probe.read(&one, 1) : 0;
    szLogf("SD: read=0 pos=%lu size=%lu fileOpen=%d log=%s probe=%d pn=%lu",
           (unsigned long)pos, (unsigned long)readSize_, fileOpen_ ? 1 : 0,
           currentName_.c_str(), probe ? 1 : 0, (unsigned long)pn);
    if (probe) probe.close();
    File root = SD.open("/");
    if (root) {
      int tested = 0;
      while (tested < 3) {
        File f = root.openNextFile();
        if (!f) break;
        if (!f.isDirectory()) {
          String n2 = String(f.name());
          if (n2.endsWith(".csv") || n2.endsWith(".CSV")) {
            uint8_t b2 = 0;
            size_t r2 = f.read(&b2, 1);
            szLogf("SD: probe2 %s size=%lu read1=%lu", n2.c_str(),
                   (unsigned long)f.size(), (unsigned long)r2);
            tested++;
          }
        }
        f.close();
      }
      root.close();
    }
  }
  return n;
}

void Storage::closeRead() {
  if (readOpen_) {
    szLogf("SD: closeRead size=%lu", (unsigned long)readSize_);
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
