import { db, type StoredFile, type StoredRun } from "./db.ts";
import { parseDeviceCsv, serializeDeviceCsvV2, type Sample } from "./csv.ts";
import { analyzeDay, QUALITY_ANALYSIS_VERSION, type DayStats, type Run } from "./runs.ts";

export const DEMO_SOURCE_FILE = "demo-ride.csv";
const DEMO_SEEDED_KEY = "demo-seeded-v3";

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
    rawMaxSpeed: record.rawMaxSpeed,
    rawMaxSampleIndex: record.rawMaxSampleIndex,
    rawMaxQuality: record.rawMaxQuality,
    confirmedMaxSpeed: record.confirmedMaxSpeed,
    confirmedSampleIndex: record.confirmedSampleIndex,
    confirmedQuality: record.confirmedQuality,
    maxGradeDown: record.maxGradeDown,
  };
}

export function statsFromRuns(records: StoredRun[]): DayStats {
  const confirmedSpeeds = records.flatMap((run) =>
    run.confirmedMaxSpeed === null ? [] : [run.confirmedMaxSpeed],
  );
  return {
    downhillM: records.reduce((sum, run) => sum + run.distanceM, 0),
    confirmedMaxSpeed: confirmedSpeeds.length > 0 ? Math.max(...confirmedSpeeds) : null,
    runs: records.map(toRun),
  };
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
  previousRuns: StoredRun[],
): StoredRun[] {
  const previousLabels = new Map(previousRuns.map((run) => [run.sourceIndex, run.label]));
  return analysis.runs.map((run, sourceIndex) => ({
    id: `${sourceFile}::${sourceIndex}`,
    sourceFile,
    sourceIndex,
    dayKey: localDayKey(run.startT),
    startT: run.startT,
    endT: run.endT,
    distanceM: run.distanceM,
    analysisVersion: QUALITY_ANALYSIS_VERSION,
    rawMaxSpeed: run.rawMaxSpeed,
    rawMaxSampleIndex: run.rawMaxSampleIndex,
    rawMaxQuality: run.rawMaxQuality,
    confirmedMaxSpeed: run.confirmedMaxSpeed,
    confirmedSampleIndex: run.confirmedSampleIndex,
    confirmedQuality: run.confirmedQuality,
    maxGradeDown: run.maxGradeDown,
    samples: run.samples,
    ...(previousLabels.get(sourceIndex)
      ? { label: previousLabels.get(sourceIndex) }
      : demo ? { label: "Demo" } : {}),
    ...(demo ? { demo: true } : {}),
    receivedAt,
  }));
}

export async function materializeFile(file: StoredFile, force = false): Promise<StoredRun[]> {
  const existing = await db.runs.where("sourceFile").equals(file.name).toArray();
  const samples = parseDeviceCsv(file.raw);
  if (!force && existing.length > 0 && existing.every((run) => run.analysisVersion === QUALITY_ANALYSIS_VERSION)) {
    return existing;
  }

  const analysis = analyzeDay(samples);
  const records = recordsFromAnalysis(
    file.name,
    analysis,
    file.receivedAt,
    file.name === DEMO_SOURCE_FILE,
    existing,
  );
  if (existing.length > 0) await db.runs.bulkDelete(existing.map((run) => run.id));
  if (records.length > 0) await db.runs.bulkPut(records);
  return records;
}

async function purgeStaleDemoData(): Promise<void> {
  const stale = (await db.files.toArray()).filter(
    (file) => file.name.startsWith("demo-") && file.name !== DEMO_SOURCE_FILE,
  );
  for (const file of stale) {
    await db.runs.where("sourceFile").equals(file.name).delete();
    await db.files.delete(file.name);
  }
}

export async function ensureLocalData(): Promise<void> {
  await db.open();
  await purgeStaleDemoData();
  const seeded = await db.meta.get(DEMO_SEEDED_KEY);
  const reseededDemo = !seeded;
  if (!seeded) {
    const response = await fetch(`${import.meta.env.BASE_URL}fixtures/ride.csv`);
    if (!response.ok) {
      throw new Error("Nie udało się wczytać danych demonstracyjnych.");
    }
    const source = await response.text();
    const shifted = shiftSamplesToNow(parseDeviceCsv(source));
    const raw = serializeDeviceCsvV2(shifted);
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
  for (const file of files) {
    await materializeFile(file, reseededDemo && file.name === DEMO_SOURCE_FILE);
  }
}

export async function materializeFiles(names: string[]): Promise<void> {
  for (const name of names) {
    const file = await db.files.get(name);
    if (file) await materializeFile(file);
  }
}

export async function getAllRuns(): Promise<StoredRun[]> {
  const runs = (await db.runs.toArray()).filter(
    (run) => run.analysisVersion === QUALITY_ANALYSIS_VERSION,
  );
  return runs.sort((a, b) => Date.parse(b.startT) - Date.parse(a.startT));
}

export async function getAllStoredSamples(): Promise<Sample[]> {
  const files = await db.files.toArray();
  return files.flatMap((file) => parseDeviceCsv(file.raw));
}

export async function getRunsForDay(dayKey: string): Promise<StoredRun[]> {
  const runs = (await db.runs.where("dayKey").equals(dayKey).toArray()).filter(
    (run) => run.analysisVersion === QUALITY_ANALYSIS_VERSION,
  );
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
