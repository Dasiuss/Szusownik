import { db, type StoredFile, type StoredRun } from "./db.ts";
import { parseDeviceCsv, type Sample } from "./csv.ts";
import { analyzeDay, type DayStats, type Run } from "./runs.ts";

export const DEMO_SOURCE_FILE = "demo-LOG_1605.csv";
const DEMO_SEEDED_KEY = "demo-seeded-v1";

export function localDayKey(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function formatDayLabel(dayKey: string, includeYear = false): string {
  const date = new Date(`${dayKey}T12:00:00`);
  return date.toLocaleDateString("pl-PL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(includeYear ? { year: "numeric" } : {}),
  });
}

export function formatDayShort(dayKey: string): string {
  return new Date(`${dayKey}T12:00:00`).toLocaleDateString("pl-PL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatDuration(startT: string, endT: string): string {
  const seconds = Math.max(0, Math.round((Date.parse(endT) - Date.parse(startT)) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function formatDistance(meters: number): string {
  return `${(meters / 1000).toFixed(2)} km`;
}

export function toRun(record: StoredRun): Run {
  return {
    id: record.id,
    startT: record.startT,
    endT: record.endT,
    samples: record.samples,
    distanceM: record.distanceM,
    maxSpeed: record.maxSpeed,
    maxGradeDown: record.maxGradeDown,
  };
}

export function statsFromRuns(records: StoredRun[]): DayStats {
  return {
    downhillM: records.reduce((sum, run) => sum + run.distanceM, 0),
    maxSpeed: records.reduce((max, run) => Math.max(max, run.maxSpeed), 0),
    runs: records.map(toRun),
  };
}

function samplesToCsv(samples: Sample[]): string {
  const rows = samples.map((sample) =>
    [sample.t, sample.lat, sample.lon, sample.speed, sample.alt, sample.hdg].join(","),
  );
  return ["timestamp,lat,lon,speed,altitude,heading", ...rows].join("\n") + "\n";
}

function shiftSamplesToNow(samples: Sample[]): Sample[] {
  const first = Date.parse(samples[0]?.t ?? "");
  if (!Number.isFinite(first)) return samples;
  const offset = Date.now() - first;
  return samples.map((sample) => ({
    ...sample,
    t: new Date(Date.parse(sample.t) + offset).toISOString(),
  }));
}

function recordsFromAnalysis(
  sourceFile: string,
  analysis: DayStats,
  receivedAt: string,
  demo: boolean,
): StoredRun[] {
  return analysis.runs.map((run, sourceIndex) => ({
    id: `${sourceFile}::${sourceIndex}`,
    sourceFile,
    sourceIndex,
    dayKey: localDayKey(run.startT),
    startT: run.startT,
    endT: run.endT,
    distanceM: run.distanceM,
    maxSpeed: run.maxSpeed,
    maxGradeDown: run.maxGradeDown,
    samples: run.samples,
    ...(demo ? { label: "Demo" } : {}),
    ...(demo ? { demo: true } : {}),
    receivedAt,
  }));
}

export async function materializeFile(file: StoredFile): Promise<StoredRun[]> {
  const existing = await db.runs.where("sourceFile").equals(file.name).toArray();
  if (existing.length > 0) return existing;

  const samples = parseDeviceCsv(file.raw);
  const analysis = analyzeDay(samples);
  const records = recordsFromAnalysis(
    file.name,
    analysis,
    file.receivedAt,
    file.name === DEMO_SOURCE_FILE,
  );
  if (records.length > 0) await db.runs.bulkPut(records);
  return records;
}

export async function ensureLocalData(): Promise<void> {
  await db.open();
  const seeded = await db.meta.get(DEMO_SEEDED_KEY);
  if (!seeded) {
    const response = await fetch(`${import.meta.env.BASE_URL}fixtures/ride.csv`);
    if (!response.ok) {
      throw new Error("Nie udało się wczytać danych demonstracyjnych.");
    }
    const source = await response.text();
    const shifted = shiftSamplesToNow(parseDeviceCsv(source));
    const raw = samplesToCsv(shifted);
    const receivedAt = new Date().toISOString();
    await db.files.put({
      name: DEMO_SOURCE_FILE,
      size: raw.length,
      receivedAt,
      userId: "local",
      raw,
    });
    await db.meta.put({ key: DEMO_SEEDED_KEY, value: receivedAt });
  }

  const files = await db.files.toArray();
  for (const file of files) await materializeFile(file);
}

export async function materializeFiles(names: string[]): Promise<void> {
  for (const name of names) {
    const file = await db.files.get(name);
    if (file) await materializeFile(file);
  }
}

export async function getAllRuns(): Promise<StoredRun[]> {
  const runs = await db.runs.toArray();
  return runs.sort((a, b) => Date.parse(b.startT) - Date.parse(a.startT));
}

export async function getAllStoredSamples(): Promise<Sample[]> {
  const files = await db.files.toArray();
  return files.flatMap((file) => parseDeviceCsv(file.raw));
}

export async function getRunsForDay(dayKey: string): Promise<StoredRun[]> {
  const runs = await db.runs.where("dayKey").equals(dayKey).toArray();
  return runs.sort((a, b) => Date.parse(b.startT) - Date.parse(a.startT));
}

export async function getDayKeys(): Promise<string[]> {
  const runs = await getAllRuns();
  return [...new Set(runs.map((run) => run.dayKey))].sort((a, b) => b.localeCompare(a));
}

export async function renameRun(id: string, label: string): Promise<void> {
  const trimmed = label.trim();
  await db.runs.update(id, trimmed ? { label: trimmed.slice(0, 40) } : { label: undefined });
}

export async function deleteRun(id: string): Promise<void> {
  await db.runs.delete(id);
}
