import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DEVICE_CSV_V2_HEADER,
  parseDeviceCsv,
  type Sample,
} from "./csv.ts";
import { analyzeDay, analyzeMergedSamples, evaluatePeakQuality, localDayKey, mergeSamples } from "./runs.ts";

const BASE_TIME = Date.parse("2026-09-15T17:23:06.000Z");

function sample(index: number, speed: number, overrides: Partial<Sample> = {}): Sample {
  return {
    t: new Date(BASE_TIME + index * 200).toISOString(),
    lat: 51.05,
    lon: 17.03,
    speed,
    altGps: 128,
    hdg: 190,
    altBaro: 128,
    gnssFixValid: true,
    gnssFixAgeMs: 100,
    gnssSatellites: 8,
    gnssSatellitesAgeMs: 100,
    gnssHdop: 0.9,
    gnssHdopAgeMs: 100,
    ...overrides,
  };
}

function smoothPeak(): Sample[] {
  return Array.from({ length: 11 }, (_, index) => {
    const secondsFromPeak = (index - 5) * 0.2;
    return sample(index, 60 - 16 * secondsFromPeak * secondsFromPeak);
  });
}

test("a CSV without the v2 header is rejected", () => {
  assert.throws(() =>
    parseDeviceCsv([
      "timestamp,lat,lon,speed,altitude_gps,heading,altitude_baro",
      "2026-09-15T17:23:06Z,51.05,17.03,6.4,128.1,189,128.5",
    ].join("\n")),
  );
});

test("CSV v2 maps blank optional quality fields to null and keeps explicit zero", () => {
  const samples = parseDeviceCsv([
    DEVICE_CSV_V2_HEADER,
    "2026-09-15T17:23:06Z,51.05,17.03,6.4,128.1,189,128.5,1,0,8,100,0.9,",
  ].join("\n"));

  assert.equal(samples[0].gnssFixAgeMs, 0);
  assert.equal(samples[0].gnssHdopAgeMs, null);
});

test("the real demo trace is v2 with the device's own GNSS measurements", async () => {
  const fixture = await readFile(new URL("../../public/fixtures/ride.csv", import.meta.url), "utf8");
  const samples = parseDeviceCsv(fixture);

  assert.ok(samples.length > 0);
  assert.ok(samples.every((sample) => sample.gnssFixValid !== null));

  const analysis = analyzeDay(samples);
  assert.ok(analysis.runs.length >= 2);
  assert.ok(analysis.runs.every((run) => run.rawMaxQuality.gnssOk));
  assert.ok(analysis.runs.every((run) => run.confirmedMaxSpeed !== null));
});

test("a smooth measured peak passes all three checks", () => {
  const quality = evaluatePeakQuality(smoothPeak(), 5);
  assert.deepEqual(quality, { accelerationOk: true, gnssOk: true, shapeOk: true });
});

test("a single unrealistic speed spike is rejected and the next real sample can be confirmed", () => {
  const samples = smoothPeak();
  samples[5] = sample(5, 182);
  const run = analyzeDay(samples).runs[0];

  assert.ok(run);
  assert.equal(run.rawMaxSpeed, 182);
  assert.equal(run.rawMaxSampleIndex, 5);
  assert.equal(run.rawMaxQuality.shapeOk, false);
  assert.notEqual(run.confirmedMaxSpeed, null);
  assert.ok(run.confirmedMaxSpeed! < run.rawMaxSpeed);
  assert.deepEqual(run.confirmedQuality, { accelerationOk: true, gnssOk: true, shapeOk: true });
});

test("positive acceleration above 1 g fails even when the local shape and GNSS pass", () => {
  const samples = Array.from({ length: 11 }, (_, index) => sample(index, 20 + index * 10));
  const quality = evaluatePeakQuality(samples, 5);

  assert.equal(quality.accelerationOk, false);
  assert.equal(quality.gnssOk, true);
  assert.equal(quality.shapeOk, true);
});

test("strong deceleration after the candidate does not fail the positive-acceleration check", () => {
  const speeds = [50, 51, 52, 53, 54, 55, 20, 20, 20, 20, 20];
  const quality = evaluatePeakQuality(speeds.map((speed, index) => sample(index, speed)), 5);

  assert.equal(quality.accelerationOk, true);
});

test("missing or stale GNSS metadata fails only the GNSS check", () => {
  const missing = smoothPeak();
  missing[5] = sample(5, 60, { gnssHdop: null });
  const stale = smoothPeak();
  stale[5] = sample(5, 60, { gnssFixAgeMs: 401 });

  assert.equal(evaluatePeakQuality(missing, 5).gnssOk, false);
  assert.equal(evaluatePeakQuality(stale, 5).gnssOk, false);
  assert.equal(evaluatePeakQuality(missing, 5).accelerationOk, true);
  assert.equal(evaluatePeakQuality(missing, 5).shapeOk, true);
});

test("GNSS thresholds are inclusive at five satellites, HDOP 2.5, and the freshness limit", () => {
  const samples = smoothPeak();
  samples[5] = sample(5, 60, {
    gnssSatellites: 5,
    gnssHdop: 2.5,
    gnssFixAgeMs: 400,
    gnssSatellitesAgeMs: 400,
    gnssHdopAgeMs: 400,
  });
  assert.equal(evaluatePeakQuality(samples, 5).gnssOk, true);
});

test("a non-positive sample interval fails the acceleration check", () => {
  const samples = smoothPeak();
  samples[4] = sample(5, samples[4].speed);
  assert.equal(evaluatePeakQuality(samples, 5).accelerationOk, false);
});

test("a local window without two samples on both sides cannot pass shape", () => {
  const samples = Array.from({ length: 5 }, (_, index) => sample(index, 40 + index));
  assert.equal(evaluatePeakQuality(samples, 1).shapeOk, false);
});

const MERGE_BASE = Date.parse("2026-01-15T10:00:00.000Z");

function mergeSample(second: number, altitude: number, latitude: number, overrides: Partial<Sample> = {}): Sample {
  return {
    t: new Date(MERGE_BASE + second * 1000).toISOString(),
    lat: latitude,
    lon: 17.03,
    speed: 30,
    altGps: altitude,
    hdg: 180,
    altBaro: altitude,
    gnssFixValid: true,
    gnssFixAgeMs: 100,
    gnssSatellites: 8,
    gnssSatellitesAgeMs: 100,
    gnssHdop: 0.9,
    gnssHdopAgeMs: 100,
    ...overrides,
  };
}

test("a ride split by file rotation plus a stop file merges into exactly one run", () => {
  // Jeden ciągły zjazd: wysokość monotonicznie maleje, więc reguła 5 m nie tnie.
  const altitudeAt = (index: number) => 1000 - index * 2;
  const latitudeAt = (index: number) => 51.05 + index * 0.0002;

  const fileA = Array.from({ length: 9 }, (_, index) =>
    mergeSample(index, altitudeAt(index), latitudeAt(index)),
  ); // sekundy 0..8
  // Plik postojowy: stoi w miejscu (ta sama pozycja i wysokość), sekundy 9..11.
  const stop = Array.from({ length: 3 }, (_, offset) =>
    mergeSample(9 + offset, altitudeAt(8), latitudeAt(8)),
  );
  // Rotacja powtarza skrajną próbkę: pierwsza próbka kolejnego pliku == ostatnia postojowa.
  const boundary = { ...stop[stop.length - 1] };
  const fileB = [
    boundary,
    ...Array.from({ length: 8 }, (_, offset) =>
      mergeSample(12 + offset, altitudeAt(8) - (offset + 1) * 2, latitudeAt(8) + (offset + 1) * 0.0002),
    ),
  ]; // sekundy 12..19

  const sources = [
    { file: "20260115_100000.csv", samples: fileA },
    { file: "20260115_100009.csv", samples: stop },
    { file: "20260115_100011.csv", samples: fileB },
  ];

  const merged = mergeSamples(sources);
  // Powtórzona na styku próbka znika, reszta zostaje.
  assert.equal(merged.length, fileA.length + stop.length + fileB.length - 1);

  const days = analyzeMergedSamples(sources);

  assert.equal(days.length, 1, "cały ślad jest jednego lokalnego dnia");
  assert.equal(days[0].runs.length, 1, "rotacja + postój nie tworzą osobnych zjazdów");
  assert.equal(days[0].runs[0].endT, fileB[fileB.length - 1].t);
});

test("samples sharing a timestamp but differing in data are all kept", () => {
  const first = mergeSample(5, 100, 51.0);
  const second = mergeSample(5, 100, 51.001, { gnssHdop: 0.5 });
  const merged = mergeSamples([
    { file: "a.csv", samples: [mergeSample(4, 102, 51.0), first] },
    { file: "b.csv", samples: [second, mergeSample(6, 98, 51.002)] },
  ]);

  assert.equal(merged.length, 4);
});

test("a sustained uphill of at least 5 m still splits the merged trace", () => {
  const descent = Array.from({ length: 10 }, (_, index) =>
    mergeSample(index, 1000 - index * 3, 51.05 + index * 0.0002),
  );
  const climb = Array.from({ length: 6 }, (_, index) =>
    mergeSample(10 + index, 1000 - 27 + index * 3, 51.05 + (10 + index) * 0.0002),
  );
  const secondDescent = Array.from({ length: 10 }, (_, index) =>
    mergeSample(16 + index, 1000 - 27 + 15 - index * 3, 51.05 + (16 + index) * 0.0002),
  );

  const days = analyzeMergedSamples([
    { file: "20260115_100000.csv", samples: [...descent, ...climb, ...secondDescent] },
  ]);

  assert.equal(days.length, 1);
  assert.equal(days[0].runs.length, 2);
});

test("merged samples are grouped per local day, not into one global run", () => {
  const firstDay = Array.from({ length: 5 }, (_, index) => mergeSample(index, 1000 - index * 2, 51.05));
  // +30 h gwarantuje inny dzień kalendarzowy w dowolnej strefie.
  const secondDay = Array.from({ length: 5 }, (_, index) =>
    mergeSample(30 * 3600 + index, 1000 - index * 2, 51.05),
  );

  const days = analyzeMergedSamples([
    { file: "20260115_100000.csv", samples: firstDay },
    { file: "20260116_160000.csv", samples: secondDay },
  ]);

  assert.equal(days.length, 2);
  assert.equal(new Set(days.map((day) => day.dayKey)).size, 2);
  assert.ok(days.every((day) => day.runs.length === 1));
  assert.equal(localDayKey(firstDay[0].t) === localDayKey(secondDay[0].t), false);
});
