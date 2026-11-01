#pragma once

#include <stddef.h>
#include <stdint.h>

namespace core {

constexpr uint16_t RECORD_INITIAL_TENTHS_KMH = 500;  // 50,0 km/h
constexpr uint16_t RECORD_HYSTERESIS_TENTHS_KMH = 50;  // 5,0 km/h
constexpr unsigned long RECORD_SIGNAL_COOLDOWN_MS = 60000UL;
constexpr size_t RECORD_TIMESTAMP_CHARS = 24;
constexpr size_t RECORD_STATE_BUFFER_SIZE = 160;

struct RecordCandidate {
  uint16_t speedTenthsKmh = 0;
  char timestamp[RECORD_TIMESTAMP_CHARS + 1] = {};
};

// Trwały stan urządzenia. `confirmedTenthsKmh` pochodzi z globalnej analizy PWA;
// pozostałe pola przechowują surowy, jeszcze prowizoryczny rekord.
struct RecordState {
  uint16_t confirmedTenthsKmh = RECORD_INITIAL_TENTHS_KMH;
  bool needsPwaSync = false;  // uszkodzony stan na starcie: nie pikaj przed werdyktem PWA
  RecordCandidate provisional;
  bool syncActive = false;
  RecordCandidate syncing;
};

struct PwaRecordUpdate {
  uint16_t confirmedTenthsKmh = RECORD_INITIAL_TENTHS_KMH;
  char analyzedThrough[RECORD_TIMESTAMP_CHARS + 1] = {};
};

struct RecordUpdate {
  bool changed = false;
  bool newRecord = false;
  bool signal = false;
};

uint16_t recordSpeedTenths(float speedKmh);
bool recordTimestampValid(const char* timestamp);
bool recordCommandParse(const char* payload, PwaRecordUpdate& out);

// Czysta logika rekordu. Timer histerezy jest celowo efemeryczny (RAM), a
// RecordState można zapisać na SD i odtworzyć po restarcie.
class RecordTracker {
 public:
  RecordTracker() = default;
  explicit RecordTracker(const RecordState& state) { reset(state); }

  void reset(const RecordState& state = RecordState{});
  const RecordState& state() const { return state_; }
  uint16_t confirmedRecordTenths() const { return state_.confirmedTenthsKmh; }
  uint16_t maxRecordTenths() const;

  // Przetwarza jedną próbkę Dopplera. Sygnał jest emitowany dla nowego maksimum,
  // gdy nie ma blokady, minęło 60 s albo wzrost od ostatniego sygnału wynosi ≥5.
  RecordUpdate update(float speedKmh, const char* timestamp, unsigned long nowMs);

  // Granica syncu powstaje przy ROTATE. Pozwala zachować surowe próbki powstałe
  // już w trakcie pobierania CSV, gdy PWA odsyła swój globalny wynik.
  void beginSync();
  bool reconcilePwaRecord(uint16_t confirmedTenthsKmh, const char* analyzedThrough);

 private:
  static void assignCandidate(RecordCandidate& candidate, uint16_t speedTenthsKmh,
                              const char* timestamp);
  static bool candidateAfter(const RecordCandidate& candidate, const char* analyzedThrough);
  void mergeSyncIntoProvisional();

  RecordState state_;
  bool hasSignaled_ = false;
  uint16_t lastSignalTenthsKmh_ = 0;
  unsigned long lastSignalMs_ = 0;
};

// Tekstowy format stanu na microSD, niezależny od Arduino/FS i hostowo testowalny.
size_t recordStateFormat(const RecordState& state, char* out, size_t capacity);
bool recordStateParse(const char* text, RecordState& out);

}  // namespace core
