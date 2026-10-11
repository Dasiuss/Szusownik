#include "storage.h"
#include "../config/pins.h"
#include "../config/config.h"
#include "../config/log.h"
#include "../core/csv_line.h"
#include <SPI.h>
#include <SD.h>
#include <dirent.h>
#include <sys/stat.h>

static File logFile;
static File readFile;

bool Storage::begin() {
  SPI.begin(PIN_SD_SCK, PIN_SD_MISO, PIN_SD_MOSI, PIN_SD_CS);
  ready_ = SD.begin(PIN_SD_CS, SPI, 20000000);
  return ready_;
}

bool Storage::openLog(const String& stamp) {
  // Bez poprawnego czasu GNSS nie ma jak nazwać pliku — nie logujemy.
  if (!ready_ || !stamp.length()) return false;
  ensureFreeSpace();
  char name[32];
  snprintf(name, sizeof(name), "/%s.csv", stamp.c_str());
  currentName_ = String(name);
  logFile = SD.open(currentName_, FILE_APPEND);
  if (!logFile) {
    SZ_LOGEF("SD open fail %s", currentName_.c_str());
    return false;
  }
  if (logFile.size() == 0) logFile.println(SZ_CSV_HEADER);
  fileOpen_ = true;
  metaWritten_ = false;  // nowy plik: .meta dopiero po potwierdzonym ruchu
  SZ_LOGIF("SD open %s", currentName_.c_str());
  return true;
}

void Storage::writeSample(const String& utc, double lat, double lon, float kmh, float altGps,
                          float hdg, float altBaro, const GnssSampleQuality& quality) {
  if (!ready_ || !fileOpen_) return;
  core::CsvQuality q{};
  q.fixValid = quality.fixValid;
  q.fixAgeValid = quality.fixAgeValid;
  q.fixAgeMs = quality.fixAgeMs;
  q.satellitesValid = quality.satellitesValid;
  q.satellites = quality.satellites;
  q.satellitesAgeValid = quality.satellitesAgeValid;
  q.satellitesAgeMs = quality.satellitesAgeMs;
  q.hdopValid = quality.hdopValid;
  q.hdop = quality.hdop;
  q.hdopAgeValid = quality.hdopAgeValid;
  q.hdopAgeMs = quality.hdopAgeMs;

  char line[256];
  core::csvLine(line, sizeof(line), utc.c_str(), lat, lon, kmh, altGps, hdg, altBaro, q);
  size_t want = strlen(line) + 2;  // println dopisuje CRLF
  size_t got = logFile.println(line);
  if (got != want) {
    writeErrors_++;
    if (writeErrors_ == 1 || (writeErrors_ % 50) == 0) {
      SZ_LOGEF("SD write error #%lu (got=%u want=%u)", (unsigned long)writeErrors_,
               (unsigned)got, (unsigned)want);
    }
  }
}

void Storage::sync() {
  // File::flush() = fflush + fsync; fsync na VFS FAT (vfs_fat_fsync) woła
  // FATFS f_sync, czyli domyka wpis katalogowy i FAT na karcie. Sam flush
  // wystarcza — okresowe close()+open() nic nie dodaje poza ponownym
  // przejściem łańcucha FAT przy następnym dopisaniu (koszt rośnie z plikiem).
  if (!ready_ || !fileOpen_) return;
  uint32_t t0 = millis();
  logFile.flush();
  uint32_t dt = millis() - t0;
  if (dt > syncMaxMs_) syncMaxMs_ = dt;
  if (dt >= SZ_SD_SYNC_WARN_MS) SZ_LOGWF("SD sync wolny %lums", (unsigned long)dt);
}

void Storage::close() {
  if (fileOpen_) {
    logFile.flush();
    logFile.close();
    fileOpen_ = false;
    metaWritten_ = false;
  }
}

void Storage::updateFileRotation(float kmh, bool fixValid) {
  const core::RotationConfig config{SZ_ROLL_STOP_BELOW_KMH, SZ_ROLL_REARM_ABOVE_KMH, SZ_ROLL_HOLD_MS};
  if (rotation_.update(kmh, fixValid, millis(), config)) {
    SZ_LOGIF("SD rolka (postoj) zamyka %s", currentName_.c_str());
    close();  // main otworzy nowy plik przy kolejnej próbce
  }
}

void Storage::ensureMeta() {
  // Warunek: otwarty plik + potwierdzony ruch (uzbrojenie rolki) + brak .meta.
  // Kolejność jest istotna: .meta powstaje i jest domykane (flush) w chwili
  // potwierdzenia ruchu, więc brak .meta niezawodnie znaczy "brak jazdy".
  if (!ready_ || !fileOpen_ || !rotation_.armed || metaWritten_) return;
  String p = currentName_;
  if (!p.startsWith("/")) p = "/" + p;
  String metaPath = p + SZ_CSV_META_SUFFIX;
  File m = SD.open(metaPath, FILE_WRITE);
  if (!m) {
    SZ_LOGEF("SD meta open fail %s", metaPath.c_str());
    return;
  }
  m.printf("v=1\ncsv=%s\n", currentName_.c_str());
  m.flush();
  m.close();
  metaWritten_ = true;
  SZ_LOGIF("SD meta %s", metaPath.c_str());
}

uint32_t Storage::countCsv() const {
  if (!ready_) return 0;
  // Liczymy pliki ".meta" tanim iterowaniem (opendir/readdir) — bez otwierania
  // każdego wpisu (openNextFile otwiera plik, ~O(n^2) na tej karcie).
  uint32_t count = 0;
  DIR* dir = opendir("/");
  if (!dir) return 0;
  struct dirent* ent;
  while ((ent = readdir(dir)) != nullptr) {
    if (String(ent->d_name).endsWith(SZ_CSV_META_SUFFIX)) count++;
  }
  closedir(dir);
  return count;
}

uint32_t Storage::listCsv(const String& since, uint32_t maxCount, StorageEntry* out) const {
  if (!ready_ || maxCount == 0) return 0;
  // Skan katalogu na tej karcie jest wolny, a `openNextFile()`/`SD.open()` na
  // wpisie dokłada O(n) pracy (otwiera każdy plik) — razem ~O(n^2): przy
  // kilkudziesięciu plikach `LIST` trwał sekundy i przekraczał timeout w PWA.
  // Iterujemy tanio (`opendir`/`readdir`, bez otwierania plików) i pobieramy
  // rozmiar tylko dla wybranych (<= maxCount) przez `stat()`.
  static const size_t kCap = 256;  // zapas; karta FIFO trzyma rozsądną liczbę
  static char s_csv[kCap][sizeof(out[0].name)];
  static char s_meta[kCap][sizeof(out[0].name)];
  size_t csvCount = 0, metaCount = 0;
  DIR* dir = opendir("/");
  if (!dir) return 0;
  const size_t suffixLen = strlen(SZ_CSV_META_SUFFIX);
  struct dirent* ent;
  while ((ent = readdir(dir)) != nullptr) {
    String n = String(ent->d_name);
    if (n.endsWith(SZ_CSV_META_SUFFIX)) {
      String csv = n.substring(0, n.length() - suffixLen);
      if (csv > since && metaCount < kCap) {
        strncpy(s_meta[metaCount], csv.c_str(), sizeof(s_meta[0]) - 1);
        s_meta[metaCount][sizeof(s_meta[0]) - 1] = '\0';
        metaCount++;
      }
    } else if ((n.endsWith(".csv") || n.endsWith(".CSV")) && n > since && csvCount < kCap) {
      strncpy(s_csv[csvCount], n.c_str(), sizeof(s_csv[0]) - 1);
      s_csv[csvCount][sizeof(s_csv[0]) - 1] = '\0';
      csvCount++;
    }
  }
  closedir(dir);

  uint32_t count = 0;
  for (size_t i = 0; i < csvCount; i++) {
    bool visible = false;
    for (size_t j = 0; j < metaCount; j++) {
      if (strcmp(s_csv[i], s_meta[j]) == 0) {
        visible = true;
        break;
      }
    }
    if (visible) {
      // Wstaw do posortowanego bufora (rosnąco), zachowując maxCount NAJSTARSZYCH.
      count = (uint32_t)core::listInsert(out, count, maxCount, s_csv[i], 0);
    }
  }
  // Rozmiar tylko dla wybranych (<= maxCount) — stat nie otwiera danych pliku.
  for (uint32_t k = 0; k < count; k++) {
    String p = "/";
    p += out[k].name;
    struct stat st;
    if (stat(p.c_str(), &st) == 0) out[k].size = (unsigned long)st.st_size;
  }
  return count;
}

bool Storage::openRead(const String& name) {
  closeRead();
  if (!ready_) return false;
  readError_ = false;
  String p = name;
  p.trim();
  if (!p.startsWith("/")) p = "/" + p;
  readFile = SD.open(p, FILE_READ);
  if (!readFile || readFile.isDirectory()) {
    closeRead();
    return false;
  }
  // Bufor stdio 512 B wymusza odczyt pojedynczych sektorów (CMD17). Domyślny
  // bufor 4096 B sprawia, że FatFs scala odczyt w multi-sektorowy transfer
  // (CMD18, disk_read z count>1), który na tej karcie/złączu zawodzi: pliki
  // >= 1 KB zwracały read=0, a <=1 KB (jeden sektor na raz) czytały się.
  readFile.setBufferSize(512);
  readSize_ = readFile.size();
  readOpen_ = true;
  readName_ = p;
  SZ_LOGIF("SD openRead %s size=%lu pos=%lu", p.c_str(), (unsigned long)readSize_,
           (unsigned long)readFile.position());
  readFile.seek(0);  // size() może przestawić pozycję VFS na koniec
  return true;
}

size_t Storage::readBytes(uint8_t* buf, size_t maxLen) {
  if (!ready_ || !readOpen_) {
    SZ_LOGW("SD readBytes bez otwartego pliku");
    return 0;
  }
  size_t pos = readFile.position();
  size_t n = readFile.read(buf, maxLen);
  if (n == 0 && pos < readSize_) {
    // Realny błąd odczytu (nie normalny EOF na końcu pliku).
    readError_ = true;
    File probe = SD.open(readName_, FILE_READ);
    uint8_t one = 0;
    size_t pn = probe ? probe.read(&one, 1) : 0;
    SZ_LOGEF("SD read=0 pos=%lu size=%lu fileOpen=%d log=%s probe=%d pn=%lu",
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
            SZ_LOGWF("SD probe2 %s size=%lu read1=%lu", n2.c_str(),
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
    SZ_LOGIF("SD closeRead size=%lu", (unsigned long)readSize_);
    readFile.close();
    readOpen_ = false;
  }
  readSize_ = 0;
}

void Storage::ensureFreeSpace() {
  if (!ready_) return;
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
      SZ_LOGWF("SD FIFO kasuje %s", oldest.c_str());
      String mp = oldest;
      if (!mp.startsWith("/")) mp = "/" + mp;
      SD.remove(mp + SZ_CSV_META_SUFFIX);  // plik towarzyszący
    } else {
      return;
    }
  }
}
