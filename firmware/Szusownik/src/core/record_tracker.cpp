#include "record_tracker.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

namespace core {
namespace {

uint16_t parseTenths(const char* text, bool& ok) {
  if (!text || !*text) {
    ok = false;
    return 0;
  }
  char* end = nullptr;
  const unsigned long value = strtoul(text, &end, 10);
  if (!end || *end != '\0' || value > 65535UL) {
    ok = false;
    return 0;
  }
  ok = true;
  return static_cast<uint16_t>(value);
}

bool parseCandidate(uint16_t speed, const char* timestamp, RecordCandidate& out) {
  if (speed == 0) {
    if (!timestamp || strcmp(timestamp, "-") != 0) return false;
    out = RecordCandidate{};
    return true;
  }
  if (!recordTimestampValid(timestamp)) return false;
  out.speedTenthsKmh = speed;
  memcpy(out.timestamp, timestamp, RECORD_TIMESTAMP_CHARS + 1);
  return true;
}

bool parseBool(const char* text, bool& value) {
  if (text && strcmp(text, "0") == 0) {
    value = false;
    return true;
  }
  if (text && strcmp(text, "1") == 0) {
    value = true;
    return true;
  }
  return false;
}

const char* candidateTimestamp(const RecordCandidate& candidate) {
  return candidate.speedTenthsKmh == 0 ? "-" : candidate.timestamp;
}

}  // namespace

uint16_t recordSpeedTenths(float speedKmh) {
  if (!isfinite(speedKmh) || speedKmh <= 0.0f) return 0;
  const float scaled = speedKmh * 10.0f;
  if (scaled >= 65535.0f) return 65535;
  return static_cast<uint16_t>(lroundf(scaled));
}

bool recordTimestampValid(const char* timestamp) {
  if (!timestamp || strlen(timestamp) != RECORD_TIMESTAMP_CHARS) return false;
  // CSV ISO time is fixed width: YYYY-MM-DDTHH:MM:SS.mmmZ.
  for (size_t index = 0; index < RECORD_TIMESTAMP_CHARS; index++) {
    const bool separator = index == 4 || index == 7 || index == 13 || index == 16 || index == 19;
    if (separator) {
      const char expected = index == 4 || index == 7 ? '-' : index == 19 ? '.' : ':';
      if (timestamp[index] != expected) return false;
    } else if (index == 10) {
      if (timestamp[index] != 'T') return false;
    } else if (index == 23) {
      if (timestamp[index] != 'Z') return false;
    } else if (timestamp[index] < '0' || timestamp[index] > '9') {
      return false;
    }
  }
  return true;
}

bool recordCommandParse(const char* payload, PwaRecordUpdate& out) {
  if (!payload || !*payload) return false;
  const char* separator = strchr(payload, ':');
  if (!separator || separator == payload) return false;
  const size_t speedLength = static_cast<size_t>(separator - payload);
  if (speedLength >= 8) return false;

  char speedText[8];
  memcpy(speedText, payload, speedLength);
  speedText[speedLength] = '\0';
  for (size_t index = 0; index < speedLength; index++) {
    if (speedText[index] < '0' || speedText[index] > '9') return false;
  }

  bool ok = false;
  const uint16_t speed = parseTenths(speedText, ok);
  if (!ok || speed < RECORD_INITIAL_TENTHS_KMH) return false;
  const char* through = separator + 1;
  PwaRecordUpdate parsed;
  parsed.confirmedTenthsKmh = speed;
  if (strcmp(through, "-") != 0) {
    if (!recordTimestampValid(through)) return false;
    memcpy(parsed.analyzedThrough, through, RECORD_TIMESTAMP_CHARS + 1);
  }
  out = parsed;
  return true;
}

void RecordTracker::reset(const RecordState& state) {
  state_ = state;
  if (state_.confirmedTenthsKmh < RECORD_INITIAL_TENTHS_KMH) {
    state_.confirmedTenthsKmh = RECORD_INITIAL_TENTHS_KMH;
  }
  hasSignaled_ = false;
  lastSignalTenthsKmh_ = 0;
  lastSignalMs_ = 0;
}

uint16_t RecordTracker::maxRecordTenths() const {
  uint16_t best = state_.confirmedTenthsKmh;
  if (state_.provisional.speedTenthsKmh > best) best = state_.provisional.speedTenthsKmh;
  if (state_.syncing.speedTenthsKmh > best) best = state_.syncing.speedTenthsKmh;
  if (best < RECORD_INITIAL_TENTHS_KMH) best = RECORD_INITIAL_TENTHS_KMH;
  return best;
}

void RecordTracker::assignCandidate(RecordCandidate& candidate, uint16_t speedTenthsKmh,
                                    const char* timestamp) {
  candidate.speedTenthsKmh = speedTenthsKmh;
  memcpy(candidate.timestamp, timestamp, RECORD_TIMESTAMP_CHARS + 1);
}

RecordUpdate RecordTracker::update(float speedKmh, const char* timestamp, unsigned long nowMs) {
  RecordUpdate result;
  const uint16_t speedTenths = recordSpeedTenths(speedKmh);
  if (speedTenths == 0 || !recordTimestampValid(timestamp)) return result;

  const uint16_t previousBest = maxRecordTenths();
  RecordCandidate& bucket = state_.syncActive ? state_.syncing : state_.provisional;
  if (speedTenths > bucket.speedTenthsKmh) {
    assignCandidate(bucket, speedTenths, timestamp);
    result.changed = true;
  }

  result.newRecord = speedTenths > previousBest;
  if (!result.newRecord) return result;

  const bool cooldownExpired = hasSignaled_ &&
                               static_cast<unsigned long>(nowMs - lastSignalMs_) >=
                                   RECORD_SIGNAL_COOLDOWN_MS;
  const bool reachedHysteresis = hasSignaled_ &&
                                 static_cast<uint32_t>(speedTenths) >=
                                     static_cast<uint32_t>(lastSignalTenthsKmh_) +
                                         RECORD_HYSTERESIS_TENTHS_KMH;
  if (!hasSignaled_ || cooldownExpired || reachedHysteresis) {
    hasSignaled_ = true;
    lastSignalTenthsKmh_ = speedTenths;
    lastSignalMs_ = nowMs;
    result.signal = true;
  }
  return result;
}

void RecordTracker::mergeSyncIntoProvisional() {
  if (state_.syncing.speedTenthsKmh > state_.provisional.speedTenthsKmh) {
    state_.provisional = state_.syncing;
  }
  state_.syncing = RecordCandidate{};
}

void RecordTracker::beginSync() {
  if (state_.syncActive) mergeSyncIntoProvisional();
  state_.syncActive = true;
  state_.syncing = RecordCandidate{};
}

bool RecordTracker::candidateAfter(const RecordCandidate& candidate, const char* analyzedThrough) {
  if (candidate.speedTenthsKmh == 0) return false;
  if (!analyzedThrough || !*analyzedThrough) return true;
  if (!recordTimestampValid(analyzedThrough)) return true;
  return strcmp(candidate.timestamp, analyzedThrough) > 0;
}

bool RecordTracker::reconcilePwaRecord(uint16_t confirmedTenthsKmh, const char* analyzedThrough) {
  if (confirmedTenthsKmh < RECORD_INITIAL_TENTHS_KMH ||
      (analyzedThrough && *analyzedThrough && !recordTimestampValid(analyzedThrough))) {
    return false;
  }

  const RecordCandidate previous = state_.provisional;
  const RecordCandidate duringSync = state_.syncing;
  state_.confirmedTenthsKmh = confirmedTenthsKmh;
  state_.needsPwaSync = false;
  state_.provisional = RecordCandidate{};
  state_.syncing = RecordCandidate{};
  state_.syncActive = false;

  if (candidateAfter(previous, analyzedThrough) &&
      previous.speedTenthsKmh > state_.confirmedTenthsKmh) {
    state_.provisional = previous;
  }
  if (candidateAfter(duringSync, analyzedThrough) &&
      duringSync.speedTenthsKmh > maxRecordTenths()) {
    state_.provisional = duringSync;
  }
  return true;
}

size_t recordStateFormat(const RecordState& state, char* out, size_t capacity) {
  if (!out || capacity == 0 || state.confirmedTenthsKmh < RECORD_INITIAL_TENTHS_KMH) return 0;
  const int written = snprintf(out, capacity, "1,%u,%u,%u,%s,%u,%u,%s",
                               static_cast<unsigned>(state.confirmedTenthsKmh),
                               state.needsPwaSync ? 1U : 0U,
                               static_cast<unsigned>(state.provisional.speedTenthsKmh),
                               candidateTimestamp(state.provisional), state.syncActive ? 1U : 0U,
                               static_cast<unsigned>(state.syncing.speedTenthsKmh),
                               candidateTimestamp(state.syncing));
  if (written < 0 || static_cast<size_t>(written) >= capacity) return 0;
  return static_cast<size_t>(written);
}

bool recordStateParse(const char* text, RecordState& out) {
  if (!text || !*text || strlen(text) >= RECORD_STATE_BUFFER_SIZE) return false;
  char copy[RECORD_STATE_BUFFER_SIZE];
  strcpy(copy, text);
  char* fields[8] = {};
  size_t count = 0;
  char* start = copy;
  for (char* cursor = copy;; cursor++) {
    if (*cursor == ',' || *cursor == '\0') {
      if (count >= 8) return false;
      fields[count++] = start;
      if (*cursor == '\0') break;
      *cursor = '\0';
      start = cursor + 1;
    }
  }
  if (count != 8 || strcmp(fields[0], "1") != 0) return false;

  bool ok = false;
  RecordState parsed;
  parsed.confirmedTenthsKmh = parseTenths(fields[1], ok);
  if (!ok || parsed.confirmedTenthsKmh < RECORD_INITIAL_TENTHS_KMH) return false;
  if (!parseBool(fields[2], parsed.needsPwaSync)) return false;
  const uint16_t provisionalSpeed = parseTenths(fields[3], ok);
  if (!ok || !parseCandidate(provisionalSpeed, fields[4], parsed.provisional)) return false;
  if (!parseBool(fields[5], parsed.syncActive)) return false;
  const uint16_t syncingSpeed = parseTenths(fields[6], ok);
  if (!ok || !parseCandidate(syncingSpeed, fields[7], parsed.syncing)) return false;
  if (!parsed.syncActive && parsed.syncing.speedTenthsKmh != 0) return false;
  out = parsed;
  return true;
}

}  // namespace core
