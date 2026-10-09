#pragma once
#include <stdint.h>

// Czysta, strumieniowa detekcja zjazdu — port algorytmu z PWA
// (`web/src/lib/runs.ts`): filtr komplementarny wysokości baro+GPS -> średnia
// ruchoma MA5 -> ZigZag z histerezą (zwroty na szczycie/dołku).
//
// Do wyświetlania na OLED daje:
//  - `displayMaxKmh()`: hero "max zjazdu" — LIVE w trakcie schodzenia (trend
//    malejący albo jeszcze nierozpoznany), ZAMROŻONY na podejściu (wyciąg),
//  - `altitudeM()`: wygładzona wysokość z fuzji baro+GPS (do wyświetlenia).
//
// Bez Arduino: czas podaje wywołujący (millis), więc moduł jest testowalny
// hostowo. Wejście: jedna próbka na epokę GNSS.

namespace core {

struct RunTrackerConfig {
  float reversalM = 5.0f;         // T: minimalny zwrot wysokości w ZigZagu
  float altTauS = 10.0f;          // stała czasowa dosuwania baro do GPS
  unsigned long maxGapMs = 3600000UL;  // przerwa >= 1 h = twarda granica
  uint8_t maWindow = 5;           // okno średniej ruchomej wysokości
};

class RunTracker {
 public:
  RunTracker() = default;
  explicit RunTracker(const RunTrackerConfig& config) : cfg_(config) {}

  void reset();

  // Przetwarza jedną próbkę GNSS. Zwraca true, gdy w tej próbce zamknięto
  // zjazd (wykryto dołek / twardą granicę). Bez fixa nic nie zmienia.
  bool update(float speedKmh, float altGpsM, float altBaroM, bool fixValid,
              unsigned long nowMs);

  // Hero: maksimum bieżącego zjazdu na żywo, zamrożone po jego zakończeniu.
  float displayMaxKmh() const { return trend_ == 1 ? lastRunMax_ : currentRunMax_; }
  float lastRunMaxKmh() const { return lastRunMax_; }
  bool descending() const { return trend_ == -1; }
  bool started() const { return started_; }

  // Wygładzona wysokość z fuzji (metry), do wyświetlenia. 0 przed pierwszą próbką.
  float altitudeM() const { return altSm_; }

 private:
  float pushMovingAverage(float value);

  RunTrackerConfig cfg_;
  bool started_ = false;
  unsigned long prevMs_ = 0;
  float prevBaro_ = 0.0f;
  float fused_ = 0.0f;
  float altSm_ = 0.0f;

  float maBuf_[8] = {0.0f};
  float maSum_ = 0.0f;
  uint8_t maCount_ = 0;
  uint8_t maHead_ = 0;

  int trend_ = 0;  // 0 = brak, 1 = rośnie (szczyt), -1 = spada (dołek)
  float highVal_ = 0.0f;
  float lowVal_ = 0.0f;

  float currentRunMax_ = 0.0f;
  float lastRunMax_ = 0.0f;
};

}  // namespace core
