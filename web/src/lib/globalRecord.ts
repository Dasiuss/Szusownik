/** Globalny wynik liczony wyłącznie z aktualnie zmaterializowanych realnych zjazdów. */
export interface GlobalRecordRun {
  confirmedMaxSpeed: number | null;
  demo?: boolean;
}

export interface TimedSample {
  t: string;
}

export const DEMO_SOURCE_FILE = "demo-ride.csv";

export function isDemoFile(name: string): boolean {
  return name.replace(/^\/+/, "") === DEMO_SOURCE_FILE;
}

export function isUtcSampleTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

export interface ParsedGlobalRecordPayload {
  confirmedTenthsKmh: number;
  analyzedThrough: string;
}

/** Parsuje payload CTRL po prefiksie SETRECORD:. */
export function parseGlobalRecordPayload(payload: string): ParsedGlobalRecordPayload | null {
  const separator = payload.indexOf(":");
  if (separator <= 0) return null;
  const speedText = payload.slice(0, separator);
  if (!/^\d+$/.test(speedText)) return null;
  const confirmedTenthsKmh = Number(speedText);
  if (!Number.isInteger(confirmedTenthsKmh) || confirmedTenthsKmh < 500 || confirmedTenthsKmh > 65535) {
    return null;
  }
  const watermark = payload.slice(separator + 1);
  if (watermark === "-") return { confirmedTenthsKmh, analyzedThrough: "" };
  if (!isUtcSampleTimestamp(watermark)) return null;
  return { confirmedTenthsKmh, analyzedThrough: watermark };
}

export function confirmedGlobalRecord(runs: readonly GlobalRecordRun[]): number {
  let best = 50;
  for (const run of runs) {
    const speed = run.confirmedMaxSpeed;
    if (run.demo || speed === null || !Number.isFinite(speed)) continue;
    if (speed > best) best = speed;
  }
  return best;
}

/** Ostatni czas z próbek przeanalizowanych przez PWA, używany do cofania pików. */
export function latestAnalyzedTimestamp(samples: readonly TimedSample[]): string {
  let latest = "";
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const sample of samples) {
    if (!isUtcSampleTimestamp(sample.t)) continue;
    const timestamp = Date.parse(sample.t);
    if (Number.isFinite(timestamp) && timestamp > latestMs) {
      latest = sample.t;
      latestMs = timestamp;
    }
  }
  return latest;
}
