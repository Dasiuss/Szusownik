import type { Sample } from "./csv.ts";
import { gradeDeg, haversineM, movingAvg } from "./geo.ts";

export interface EnrichedSample extends Sample {
  distM: number; // dystans od poprzedniej próbki
  cumDistM: number; // dystans skumulowany w pliku
  speedSm: number; // prędkość wygładzona MA3
  altSm: number; // wysokość wygładzona MA5
  gradeSm: number; // nachylenie wygładzone (stopnie, ujemne = w dół)
}

export interface Run {
  id: string;
  startT: string;
  endT: string;
  samples: EnrichedSample[];
  distanceM: number; // suma odcinków zjazdu
  rawMaxSpeed: number; // max z surowej (niewygładzonej) prędkości
  rawMaxSampleIndex: number;
  rawMaxQuality: PeakQuality;
  confirmedMaxSpeed: number | null;
  confirmedSampleIndex: number | null;
  confirmedQuality: PeakQuality | null;
  maxGradeDown: number; // max |nachylenie w dół| w stopniach
}

export interface DayStats {
  downhillM: number; // suma dystansów zjazdów (bez podjazdów)
  confirmedMaxSpeed: number | null;
  runs: Run[];
}

export interface PeakQuality {
  accelerationOk: boolean;
  gnssOk: boolean;
  shapeOk: boolean;
}

export const QUALITY_ANALYSIS_VERSION = 2;

const PEAK_WINDOW_MS = 1000;
const MAX_POSITIVE_ACCELERATION_MPS2 = 9.81;
const MAX_GNSS_AGE_MS = 500;
const MIN_SATELLITES = 5;
const MAX_HDOP = 2.5;
const MIN_SHAPE_SAMPLES = 5;
const MIN_SHAPE_SAMPLES_PER_SIDE = 2;
const HUBER_DELTA = 1.345;
const HUBER_MAX_ITERATIONS = 10;
const HUBER_CONVERGENCE_KMH = 1e-4;
const HUBER_MIN_SCALE_KMH = 0.1;

const ALT_TAU_S = 10; // stała czasowa dosuwania baro do GPS (filtr komplementarny)

/**
 * Filtr komplementarny wysokości: barometr daje precyzyjny kształt (zmiany),
 * GPS powoli kotwiczy wartość absolutną (korekta dryfu baro). alpha liczona
 * z rzeczywistego odstępu czasu, więc działa przy zmiennym tempie 0,5–10 Hz.
 * Gdy altBaro = 0 (brak barometru), baroStep = 0 i wynik zbiega do GPS.
 */
function fuseAltitude(samples: Sample[]): number[] {
  const out = new Array<number>(samples.length).fill(0);
  if (samples.length === 0) return out;
  let fused = samples[0].altGps;
  out[0] = fused;
  for (let i = 1; i < samples.length; i++) {
    const dt = (Date.parse(samples[i].t) - Date.parse(samples[i - 1].t)) / 1000;
    const baroStep = samples[i].altBaro - samples[i - 1].altBaro;
    if (!(dt > 0)) {
      // Ten sam znacznik czasu (np. >1 Hz przy sekundowej rozdzielczości):
      // nie znamy odstępu, więc propagujemy barometr bez korekty GPS (nie reset).
      fused = fused + baroStep;
    } else if (dt >= 3600) {
      fused = samples[i].altGps; // długa przerwa w danych — reset do GPS
    } else {
      const alpha = ALT_TAU_S / (ALT_TAU_S + dt);
      fused = alpha * (fused + baroStep) + (1 - alpha) * samples[i].altGps;
    }
    out[i] = fused;
  }
  return out;
}

/** Wzbogaca próbki: dystanse + wygładzanie (wysokość MA5 z fuzji baro+GPS,
 *  prędkość MA3, nachylenie na oknie ~15 m + MA3). Surowe pola zostają nietknięte. */
export function enrich(samples: Sample[]): EnrichedSample[] {
  const distM = new Array<number>(samples.length).fill(0);
  const cum: number[] = new Array<number>(samples.length).fill(0);
  for (let i = 1; i < samples.length; i++) {
    const d = haversineM(samples[i - 1].lat, samples[i - 1].lon, samples[i].lat, samples[i].lon);
    distM[i] = d < 200 ? d : 0; // odrzuć skoki (tunel / zgubiony fix)
    cum[i] = cum[i - 1] + distM[i];
  }
  const altSm = movingAvg(fuseAltitude(samples), 5);
  const speedSm = movingAvg(samples.map((s) => s.speed), 3);
  const gradeSm = movingAvg(gradeDeg(altSm, cum, 15), 3);
  return samples.map((s, i) => ({
    ...s,
    distM: distM[i],
    cumDistM: cum[i],
    speedSm: speedSm[i],
    altSm: altSm[i],
    gradeSm: gradeSm[i],
  }));
}

interface LocalWindow {
  indices: number[];
  freshLimitMs: number | null;
  hasLargeGap: boolean;
}

interface ShapeCheck {
  ok: boolean;
  outlier: boolean;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function lowerBound(values: number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (values[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(values: number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (values[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function localWindow(
  indices: number[],
  timestamps: number[],
  candidateIndex: number,
  timestampsSorted: boolean,
): LocalWindow | null {
  const center = timestamps[candidateIndex];
  if (!Number.isFinite(center)) return null;
  const low = center - PEAK_WINDOW_MS;
  const high = center + PEAK_WINDOW_MS;
  let windowIndices: number[];

  if (timestampsSorted) {
    const start = lowerBound(timestamps, low);
    const end = upperBound(timestamps, high);
    windowIndices = indices.slice(start, end);
  } else {
    windowIndices = indices.filter((index) => {
      const timestamp = timestamps[index];
      return Number.isFinite(timestamp) && timestamp >= low && timestamp <= high;
    });
  }

  const intervals: number[] = [];
  for (let i = 1; i < windowIndices.length; i++) {
    const dt = timestamps[windowIndices[i]] - timestamps[windowIndices[i - 1]];
    if (dt > 0) intervals.push(dt);
  }
  const medianIntervalMs = median(intervals);
  const freshLimitMs = medianIntervalMs === null
    ? null
    : Math.min(MAX_GNSS_AGE_MS, 2 * medianIntervalMs);
  const hasLargeGap = freshLimitMs === null || intervals.some((interval) => interval > freshLimitMs);
  return { indices: windowIndices, freshLimitMs, hasLargeGap };
}

function solveThreeByThree(matrix: number[][], right: number[]): [number, number, number] | null {
  const augmented = matrix.map((row, index) => [...row, right[index]]);
  for (let column = 0; column < 3; column++) {
    let pivot = column;
    for (let row = column + 1; row < 3; row++) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (Math.abs(augmented[pivot][column]) < 1e-12) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];

    const divisor = augmented[column][column];
    for (let cell = column; cell <= 3; cell++) augmented[column][cell] /= divisor;
    for (let row = 0; row < 3; row++) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let cell = column; cell <= 3; cell++) {
        augmented[row][cell] -= factor * augmented[column][cell];
      }
    }
  }
  return [augmented[0][3], augmented[1][3], augmented[2][3]];
}

function fitQuadratic(xs: number[], ys: number[], weights: number[]): [number, number, number] | null {
  const matrix = Array.from({ length: 3 }, () => [0, 0, 0]);
  const right = [0, 0, 0];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const row = [1, x, x * x];
    const weight = weights[i];
    for (let r = 0; r < 3; r++) {
      right[r] += weight * row[r] * ys[i];
      for (let c = 0; c < 3; c++) matrix[r][c] += weight * row[r] * row[c];
    }
  }
  return solveThreeByThree(matrix, right);
}

function predictQuadratic(coefficients: [number, number, number], x: number): number {
  return coefficients[0] + coefficients[1] * x + coefficients[2] * x * x;
}

function robustQuadraticFit(xs: number[], ys: number[]): [number, number, number] | null {
  let coefficients = fitQuadratic(xs, ys, xs.map(() => 1));
  if (!coefficients) return null;

  for (let iteration = 0; iteration < HUBER_MAX_ITERATIONS; iteration++) {
    const residuals = ys.map((speed, index) => speed - predictQuadratic(coefficients!, xs[index]));
    const residualMedian = median(residuals) ?? 0;
    const mad = median(residuals.map((residual) => Math.abs(residual - residualMedian))) ?? 0;
    const scale = Math.max(1.4826 * mad, HUBER_MIN_SCALE_KMH);
    const weights = residuals.map((residual) => {
      const standardized = Math.abs(residual) / scale;
      return standardized <= HUBER_DELTA ? 1 : HUBER_DELTA / standardized;
    });
    const next = fitQuadratic(xs, ys, weights);
    if (!next) return null;
    const maxPredictionChange = Math.max(
      ...xs.map((x) => Math.abs(predictQuadratic(next, x) - predictQuadratic(coefficients!, x))),
    );
    coefficients = next;
    if (maxPredictionChange < HUBER_CONVERGENCE_KMH) break;
  }
  return coefficients;
}

function checkShape(
  samples: Sample[],
  timestamps: number[],
  candidateIndex: number,
  window: LocalWindow | null,
): ShapeCheck {
  if (!window) return { ok: false, outlier: false };
  const candidateTime = timestamps[candidateIndex];
  const before = window.indices.filter((index) => timestamps[index] < candidateTime).length;
  const after = window.indices.filter((index) => timestamps[index] > candidateTime).length;
  const enoughSamples = window.indices.length >= MIN_SHAPE_SAMPLES &&
    before >= MIN_SHAPE_SAMPLES_PER_SIDE && after >= MIN_SHAPE_SAMPLES_PER_SIDE;

  const xs = window.indices.map((index) => (timestamps[index] - candidateTime) / 1000);
  const ys = window.indices.map((index) => samples[index].speed);
  const coefficients = xs.length >= 3 ? robustQuadraticFit(xs, ys) : null;
  if (!coefficients) return { ok: false, outlier: false };

  const residuals = ys.map((speed, index) => speed - predictQuadratic(coefficients, xs[index]));
  const residualMedian = median(residuals) ?? 0;
  const mad = median(residuals.map((residual) => Math.abs(residual - residualMedian))) ?? 0;
  const shapeLimitKmh = Math.max(1, 3 * 1.4826 * mad);
  const candidatePosition = window.indices.indexOf(candidateIndex);
  if (candidatePosition < 0) return { ok: false, outlier: false };
  const outlier = Math.abs(residuals[candidatePosition]) > shapeLimitKmh;
  return {
    ok: enoughSamples && !window.hasLargeGap && !outlier,
    outlier,
  };
}

function checkGnss(sample: Sample, window: LocalWindow | null): boolean {
  if (!window || window.freshLimitMs === null) return false;
  const freshLimit = window.freshLimitMs;
  const ages = [sample.gnssFixAgeMs, sample.gnssSatellitesAgeMs, sample.gnssHdopAgeMs];
  return sample.gnssFixValid === true &&
    sample.gnssSatellites !== null && sample.gnssSatellites >= MIN_SATELLITES &&
    sample.gnssHdop !== null && sample.gnssHdop <= MAX_HDOP &&
    ages.every((age) => age !== null && age <= freshLimit);
}

function checkAcceleration(
  samples: Sample[],
  timestamps: number[],
  candidateIndex: number,
  window: LocalWindow | null,
  shapeChecks: ShapeCheck[],
): boolean {
  if (!window || !Number.isFinite(timestamps[candidateIndex])) return false;
  const usableIndices = window.indices.filter(
    (index) => index === candidateIndex || !shapeChecks[index].outlier,
  );
  const candidatePosition = usableIndices.indexOf(candidateIndex);
  if (candidatePosition <= 0) return false;

  for (let i = 1; i < usableIndices.length; i++) {
    const previousIndex = usableIndices[i - 1];
    const currentIndex = usableIndices[i];
    const dtSeconds = (timestamps[currentIndex] - timestamps[previousIndex]) / 1000;
    if (!(dtSeconds > 0)) return false;
    const deltaSpeed = samples[currentIndex].speed - samples[previousIndex].speed;
    const positiveAcceleration = Math.max(0, deltaSpeed / 3.6 / dtSeconds);
    if (positiveAcceleration > MAX_POSITIVE_ACCELERATION_MPS2) return false;
  }
  return true;
}

export function evaluatePeakQuality(samples: Sample[], candidateIndex: number): PeakQuality {
  const indices = samples.map((_, index) => index);
  const timestamps = samples.map((sample) => Date.parse(sample.t));
  const timestampsSorted = timestamps.every(
    (timestamp, index) => Number.isFinite(timestamp) && (index === 0 || timestamp >= timestamps[index - 1]),
  );
  const windows = samples.map((_, index) => localWindow(indices, timestamps, index, timestampsSorted));
  const shapeChecks = samples.map((_, index) => checkShape(samples, timestamps, index, windows[index]));
  const window = windows[candidateIndex] ?? null;
  const sample = samples[candidateIndex];
  if (!sample) return { accelerationOk: false, gnssOk: false, shapeOk: false };
  return {
    accelerationOk: checkAcceleration(samples, timestamps, candidateIndex, window, shapeChecks),
    gnssOk: checkGnss(sample, window),
    shapeOk: shapeChecks[candidateIndex]?.ok ?? false,
  };
}

function analyzePeak(samples: Sample[]): Pick<Run,
  "rawMaxSpeed" | "rawMaxSampleIndex" | "rawMaxQuality" |
  "confirmedMaxSpeed" | "confirmedSampleIndex" | "confirmedQuality"
> {
  const indices = samples.map((_, index) => index);
  const timestamps = samples.map((sample) => Date.parse(sample.t));
  const timestampsSorted = timestamps.every(
    (timestamp, index) => Number.isFinite(timestamp) && (index === 0 || timestamp >= timestamps[index - 1]),
  );
  const windows = samples.map((_, index) => localWindow(indices, timestamps, index, timestampsSorted));
  const shapeChecks = samples.map((_, index) => checkShape(samples, timestamps, index, windows[index]));
  const qualityFor = (index: number): PeakQuality => ({
    accelerationOk: checkAcceleration(samples, timestamps, index, windows[index], shapeChecks),
    gnssOk: checkGnss(samples[index], windows[index]),
    shapeOk: shapeChecks[index].ok,
  });

  const candidates = indices.sort((a, b) => samples[b].speed - samples[a].speed || a - b);
  const rawMaxSampleIndex = candidates[0] ?? 0;
  const rawMaxSpeed = samples[rawMaxSampleIndex]?.speed ?? 0;
  const rawMaxQuality = qualityFor(rawMaxSampleIndex);
  for (const candidateIndex of candidates) {
    const quality = qualityFor(candidateIndex);
    if (quality.accelerationOk && quality.gnssOk && quality.shapeOk) {
      return {
        rawMaxSpeed,
        rawMaxSampleIndex,
        rawMaxQuality,
        confirmedMaxSpeed: samples[candidateIndex].speed,
        confirmedSampleIndex: candidateIndex,
        confirmedQuality: quality,
      };
    }
  }
  return {
    rawMaxSpeed,
    rawMaxSampleIndex,
    rawMaxQuality,
    confirmedMaxSpeed: null,
    confirmedSampleIndex: null,
    confirmedQuality: null,
  };
}

const UPHILL_CUT_GAIN_M = 5;
const UPHILL_TREND_EPSILON_M = 0.05;

/**
 * Cięcie na zjazdy v1: ciągły ruch W GÓRĘ osiągający co najmniej 5 m
 * rozdziela dwa zjazdy (wymagania-PWA §6). Wysokość jest już wygładzona,
 * więc próg dotyczy skumulowanego wzrostu, a epsilon tylko trendu między próbkami.
 * Próg jest wykrywany na końcu podjazdu, ale granica trafia na jego początek,
 * dzięki czemu poprzedni zjazd kończy się przed wyciągiem.
 */
export function splitRuns(enriched: EnrichedSample[], uphillGainM = UPHILL_CUT_GAIN_M): Run[] {
  const cuts: number[] = [0];
  let climbStart = -1;
  let waitingForDescent = false;
  for (let i = 1; i < enriched.length; i++) {
    const dt = (Date.parse(enriched[i].t) - Date.parse(enriched[i - 1].t)) / 1000;
    if (dt < 0 || dt >= 3600) {
      climbStart = -1;
      waitingForDescent = false;
      continue;
    }
    if (dt === 0) continue;

    const altDelta = enriched[i].altSm - enriched[i - 1].altSm;
    if (waitingForDescent) {
      if (altDelta < -UPHILL_TREND_EPSILON_M) waitingForDescent = false;
      else continue;
    }

    if (altDelta > UPHILL_TREND_EPSILON_M) {
      if (climbStart < 0) climbStart = i - 1;
      const climbGain = enriched[i].altSm - enriched[climbStart].altSm;
      if (climbGain >= uphillGainM) {
        if (climbStart > cuts[cuts.length - 1]) cuts.push(climbStart);
        climbStart = -1;
        waitingForDescent = true;
      }
    } else if (altDelta < -UPHILL_TREND_EPSILON_M) {
      climbStart = -1;
    }
  }
  cuts.push(enriched.length);
  const runs: Run[] = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    const part = enriched.slice(cuts[k], cuts[k + 1]);
    if (part.length < 2) continue;
    let distanceM = 0;
    let maxGradeDown = 0;
    for (const s of part) {
      distanceM += s.distM;
      if (-s.gradeSm > maxGradeDown) maxGradeDown = -s.gradeSm;
    }
    const peak = analyzePeak(part);
    runs.push({
      id: `zjazd-${k + 1}`,
      startT: part[0].t,
      endT: part[part.length - 1].t,
      samples: part,
      distanceM,
      ...peak,
      maxGradeDown,
    });
  }
  return runs;
}

export function analyzeDay(samples: Sample[]): DayStats {
  const enriched = enrich(samples);
  const runs = splitRuns(enriched);
  const confirmedSpeeds = runs.flatMap((run) => run.confirmedMaxSpeed === null ? [] : [run.confirmedMaxSpeed]);
  return {
    downhillM: runs.reduce((a, r) => a + r.distanceM, 0),
    confirmedMaxSpeed: confirmedSpeeds.length > 0 ? Math.max(...confirmedSpeeds) : null,
    runs,
  };
}
