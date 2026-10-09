#include "run_tracker.h"

namespace core {

void RunTracker::reset() {
  started_ = false;
  prevMs_ = 0;
  prevBaro_ = 0.0f;
  fused_ = 0.0f;
  altSm_ = 0.0f;
  maSum_ = 0.0f;
  maCount_ = 0;
  maHead_ = 0;
  for (uint8_t i = 0; i < 8; i++) maBuf_[i] = 0.0f;
  trend_ = 0;
  highVal_ = 0.0f;
  lowVal_ = 0.0f;
  currentRunMax_ = 0.0f;
  lastRunMax_ = 0.0f;
}

float RunTracker::pushMovingAverage(float value) {
  uint8_t w = cfg_.maWindow;
  if (w < 1) w = 1;
  if (w > 8) w = 8;
  if (maCount_ < w) {
    maBuf_[(maHead_ + maCount_) % w] = value;
    maSum_ += value;
    maCount_++;
  } else {
    maSum_ -= maBuf_[maHead_];
    maBuf_[maHead_] = value;
    maSum_ += value;
    maHead_ = (uint8_t)((maHead_ + 1) % w);
  }
  return maSum_ / (float)maCount_;
}

bool RunTracker::update(float speedKmh, float altGpsM, float altBaroM, bool fixValid,
                        unsigned long nowMs) {
  // Bez poprawnego fixa nie znamy ani prędkości, ani wysokości — zamrażamy
  // stan (analogicznie do rolki pliku w core/rotation).
  if (!fixValid) return false;

  const bool first = !started_;
  const unsigned long dtMs = first ? 0UL : (nowMs - prevMs_);
  const bool gap = !first && dtMs >= cfg_.maxGapMs;

  // --- filtr komplementarny wysokości (baro daje kształt, GPS kotwiczy) ---
  float fused;
  if (first) {
    fused = altGpsM;
  } else {
    const float dt = (float)dtMs / 1000.0f;
    const float baroStep = altBaroM - prevBaro_;
    if (dt <= 0.0f) {
      fused = fused_ + baroStep;  // ten sam znacznik czasu: tylko baro
    } else if (gap) {
      fused = altGpsM;  // długa przerwa: reset do GPS
    } else {
      const float alpha = cfg_.altTauS / (cfg_.altTauS + dt);
      fused = alpha * (fused_ + baroStep) + (1.0f - alpha) * altGpsM;
    }
  }
  fused_ = fused;
  prevBaro_ = altBaroM;
  prevMs_ = nowMs;
  started_ = true;
  altSm_ = pushMovingAverage(fused);

  // --- ZigZag na wygładzonej wysokości ---
  bool closed = false;
  if (first || gap) {
    // Start albo twarda granica: zamykamy bieżący zjazd i zaczynamy od nowa
    // (przerwa >= 1 h nie może przenieść zjazdu przez lukę w danych).
    if (gap) {
      lastRunMax_ = currentRunMax_;
      closed = true;
    }
    currentRunMax_ = 0.0f;
    trend_ = 0;
    highVal_ = altSm_;
    lowVal_ = altSm_;
  } else if (trend_ == 0) {
    if (altSm_ > highVal_) highVal_ = altSm_;
    if (altSm_ < lowVal_) lowVal_ = altSm_;
    if (altSm_ >= lowVal_ + cfg_.reversalM) {  // dołek = początek podejścia
      lastRunMax_ = currentRunMax_;
      currentRunMax_ = 0.0f;
      closed = true;
      trend_ = 1;
      highVal_ = altSm_;
    } else if (altSm_ <= highVal_ - cfg_.reversalM) {  // szczyt = początek zjazdu
      trend_ = -1;
      lowVal_ = altSm_;
      currentRunMax_ = 0.0f;
    }
  } else if (trend_ == 1) {
    if (altSm_ > highVal_) {
      highVal_ = altSm_;
    } else if (altSm_ <= highVal_ - cfg_.reversalM) {
      trend_ = -1;
      lowVal_ = altSm_;
      currentRunMax_ = 0.0f;
    }
  } else {  // trend_ == -1
    if (altSm_ < lowVal_) {
      lowVal_ = altSm_;
    } else if (altSm_ >= lowVal_ + cfg_.reversalM) {
      lastRunMax_ = currentRunMax_;
      currentRunMax_ = 0.0f;
      closed = true;
      trend_ = 1;
      highVal_ = altSm_;
    }
  }

  if (speedKmh > currentRunMax_) currentRunMax_ = speedKmh;
  return closed;
}

}  // namespace core
