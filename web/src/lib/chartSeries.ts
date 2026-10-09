// Serie wspólnego wykresu profilu (prędkość, wysokość, przyspieszenie) na
// wspólnej osi dystansu. Czysta logika bez DOM/Recharts — testowana hostowo.

import type { StoredRun } from "./db.ts";

export interface ProfilePoint {
  d: number; // dystans na wspólnej osi [km]
  v: number; // prędkość [km/h]
  h: number; // wysokość [m]
  a: number | null; // przyspieszenie [km/h na sekundę]; null = brak poprawnego interwału
  lat: number;
  lon: number;
}

export interface AccelOptions {
  /** Szerokość wygładzania przyspieszenia (próbki); 1 = bez wygładzania. */
  smoothWindow?: number;
  /** Maksymalny odstęp czasu [s] dla sensownego przyspieszenia; dłuższy = luka. */
  maxGapS?: number;
}

export const DEFAULT_ACCEL_SMOOTH_WINDOW = 3;
export const DEFAULT_MAX_GAP_S = 5;
export const MIN_ACCEL_RANGE_KMH_S = 5;

function smoothNullable(values: Array<number | null>, window: number): Array<number | null> {
  if (window <= 1) return values.slice();
  const out = values.slice();
  const half = Math.floor(window / 2);
  for (let i = 0; i < values.length; i++) {
    if (values[i] === null) continue;
    let sum = 0;
    let count = 0;
    for (let j = i - half; j <= i + half; j++) {
      if (j < 0 || j >= values.length) continue;
      const value = values[j];
      if (value === null) continue;
      sum += value;
      count += 1;
    }
    out[i] = count > 0 ? sum / count : null;
  }
  return out;
}

/**
 * Przyspieszenie wzdłużne [km/h na sekundę] z wygładzonej prędkości (`speedSm`)
 * po odstępie czasu kolejnych próbek. `null` przy pierwszej próbce, przy
 * niedodatnim odstępie (powtórzony timestamp) i na zbyt dużej luce.
 */
export function accelerationKmhPerS(
  samples: ReadonlyArray<{ t: string; speedSm: number }>,
  options: AccelOptions = {},
): Array<number | null> {
  const window = Math.max(1, Math.floor(options.smoothWindow ?? DEFAULT_ACCEL_SMOOTH_WINDOW));
  const maxGapS = options.maxGapS ?? DEFAULT_MAX_GAP_S;
  const out: Array<number | null> = new Array(samples.length).fill(null);
  for (let i = 1; i < samples.length; i++) {
    const dt = (Date.parse(samples[i].t) - Date.parse(samples[i - 1].t)) / 1000;
    if (!(dt > 0) || dt > maxGapS) continue;
    out[i] = (samples[i].speedSm - samples[i - 1].speedSm) / dt;
  }
  return smoothNullable(out, window);
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function toPoint(
  sample: { cumDistM: number; speedSm: number; altSm: number; lat: number; lon: number },
  baseM: number,
  accel: number | null,
): ProfilePoint {
  return {
    d: (sample.cumDistM - baseM) / 1000,
    v: round(sample.speedSm, 1),
    h: round(sample.altSm, 1),
    a: accel === null ? null : round(accel, 2),
    lat: sample.lat,
    lon: sample.lon,
  };
}

/** Profil jednego zjazdu: dystans liczony od jego pierwszej próbki. */
export function buildRunProfile(
  run: Pick<StoredRun, "samples">,
  options: AccelOptions = {},
): ProfilePoint[] {
  const samples = run.samples;
  if (samples.length === 0) return [];
  const accel = accelerationKmhPerS(samples, options);
  const baseM = samples[0].cumDistM;
  return samples.map((sample, index) => toPoint(sample, baseM, accel[index]));
}

/**
 * Profil całego dnia: wspólna, ciągła oś dystansu (z wyciągami). Przyspieszenie
 * liczone **osobno per zjazd**, żeby na styku zjazdów nie powstał sztuczny skok.
 */
export function buildDayProfile(
  runs: ReadonlyArray<Pick<StoredRun, "samples">>,
  options: AccelOptions = {},
): ProfilePoint[] {
  const firstRun = runs[0];
  if (!firstRun || firstRun.samples.length === 0) return [];
  const baseM = firstRun.samples[0].cumDistM;
  const points: ProfilePoint[] = [];
  for (const run of runs) {
    if (run.samples.length === 0) continue;
    const accel = accelerationKmhPerS(run.samples, options);
    run.samples.forEach((sample, index) => {
      points.push(toPoint(sample, baseM, accel[index]));
    });
  }
  return points;
}

/**
 * Symetryczny zakres osi przyspieszenia wokół zera, z minimalnym zakresem
 * (żeby szum GPS nie rozdmuchiwał skali przy małych ruchach).
 */
export function accelDomain(
  values: ReadonlyArray<number | null>,
  floor = MIN_ACCEL_RANGE_KMH_S,
): [number, number] {
  let maxAbs = 0;
  for (const value of values) {
    if (value === null) continue;
    maxAbs = Math.max(maxAbs, Math.abs(value));
  }
  const bound = Math.max(floor, Math.ceil(maxAbs));
  return [-bound, bound];
}

/** Indeks próbki najbliższej podanemu dystansowi [km]; null dla pustych danych. */
export function findNearestIndex(
  points: ReadonlyArray<{ d: number }>,
  distanceKm: number,
): number | null {
  if (points.length === 0) return null;
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (points[mid].d < distanceKm) low = mid + 1;
    else high = mid;
  }
  if (low > 0 && Math.abs(points[low - 1].d - distanceKm) <= Math.abs(points[low].d - distanceKm)) {
    return low - 1;
  }
  return low;
}

