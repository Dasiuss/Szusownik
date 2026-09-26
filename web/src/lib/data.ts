import { db, type StoredFile, type StoredRun } from "./db.ts";
import { parseDeviceCsv, serializeDeviceCsvV2, type Sample } from "./csv.ts";
import {
  analyzeDay,
  analyzeMergedSamples,
  localDayKey,
  mergeSamples,
  QUALITY_ANALYSIS_VERSION,
  type DayStats,
  type Run,
} from "./runs.ts";

export { localDayKey };

export const DEMO_SOURCE_FILE = "demo-ride.csv";
const DEMO_SEEDED_KEY = "demo-seeded-v3";
const MATERIALIZED_KEY = "materialized-v1";

/** Stabilny identyfikator zjazdu: lokalny dzień + czas startu. Przeżywa
 *  scalenie plików i ponowną analizę (etykiety i tombstone'y kluczują się nim). */
export function stableRunId(dayKey: string, startT: string): string {
  return `${dayKey}::${startT}`;
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

function parseFileSamples(file: StoredFile): Sample[] {
  try {
    return parseDeviceCsv(file.raw);
  } catch (error) {
    // Uszkodzony plik nie może wywalić całej analizy.
    console.error(`[data] pomijam nieparsowalny plik ${file.name}`, error);
    return [];
  }
}

function hashSignature(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/** Podpis zbioru plików + wersja analizy. Zmiana któregokolwiek wymusza
 *  jednorazowe przeliczenie całości; bez zmian materializacja jest pomijana. */
function filesSignature(files: StoredFile[]): string {
  const parts = files
    .map((file) => `${file.name}\u0001${file.size}\u0001${file.receivedAt}`)
    .sort();
  return `v${QUALITY_ANALYSIS_VERSION}:${files.length}:${hashSignature(parts.join("\u0002"))}`;
}

function storedRun(
  run: Run,
  dayKey: string,
  receivedAt: string,
  demo: boolean,
  label: string | undefined,
): StoredRun {
  return {
    id: stableRunId(dayKey, run.startT),
    dayKey,
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
    ...(label ? { label } : {}),
    ...(demo ? { demo: true } : {}),
    receivedAt,
  };
}

/**
 * Materializuje zjazdy z **całego** zbioru surowych plików: scala je w jedną
 * wspólną oś czasu, grupuje po lokalnym dniu i tnie raz na dzień. Dzięki temu
 * zjazd rozbity rotacją pliku składa się w jeden. Pliki demo mają osobną oś,
 * żeby nie mieszały się z realnym śladem.
 *
 * Idempotentne: przy niezmienionym zbiorze plików i wersji analizy nic nie robi,
 * a etykiety i tombstone'y (kluczowane stabilnym id) przeżywają re-analizę.
 */
export async function materializeAll(force = false): Promise<void> {
  await db.open();
  const files = await db.files.toArray();
  const signature = filesSignature(files);
  const marker = await db.meta.get(MATERIALIZED_KEY);
  if (!force && marker?.value === signature) return;

  const labels = new Map((await db.runLabels.toArray()).map((entry) => [entry.id, entry.label]));
  const deleted = new Set((await db.deletedRuns.toArray()).map((entry) => entry.id));
  const receivedAt = files.reduce(
    (latest, file) => (file.receivedAt > latest ? file.receivedAt : latest),
    "",
  );

  const records: StoredRun[] = [];
  const realFiles = files.filter((file) => file.name !== DEMO_SOURCE_FILE);
  const realDays = analyzeMergedSamples(
    realFiles.map((file) => ({ file: file.name, samples: parseFileSamples(file) })),
  );
  for (const day of realDays) {
    for (const run of day.runs) {
      const id = stableRunId(day.dayKey, run.startT);
      if (deleted.has(id)) continue;
      records.push(storedRun(run, day.dayKey, receivedAt, false, labels.get(id)));
    }
  }

  const demoFile = files.find((file) => file.name === DEMO_SOURCE_FILE);
  if (demoFile) {
    for (const run of analyzeDay(parseFileSamples(demoFile)).runs) {
      const dayKey = localDayKey(run.startT);
      const id = stableRunId(dayKey, run.startT);
      if (deleted.has(id)) continue;
      records.push(storedRun(run, dayKey, demoFile.receivedAt, true, labels.get(id) ?? "Demo"));
    }
  }

  await db.transaction("rw", db.runs, db.meta, async () => {
    await db.runs.clear();
    if (records.length > 0) await db.runs.bulkPut(records);
    await db.meta.put({ key: MATERIALIZED_KEY, value: signature });
  });
}

async function purgeStaleDemoData(): Promise<void> {
  const stale = (await db.files.toArray()).filter(
    (file) => file.name.startsWith("demo-") && file.name !== DEMO_SOURCE_FILE,
  );
  // Zjazdy przeliczy materializeAll (podpis zbioru się zmieni).
  for (const file of stale) await db.files.delete(file.name);
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

  await materializeAll(reseededDemo);
}

export async function getAllRuns(): Promise<StoredRun[]> {
  const runs = (await db.runs.toArray()).filter(
    (run) => run.analysisVersion === QUALITY_ANALYSIS_VERSION,
  );
  return runs.sort((a, b) => Date.parse(b.startT) - Date.parse(a.startT));
}

export async function getAllStoredSamples(): Promise<Sample[]> {
  const files = await db.files.toArray();
  // Ta sama scalona, posortowana i zdeduplikowana oś co przy cięciu zjazdów.
  return mergeSamples(files.map((file) => ({ file: file.name, samples: parseFileSamples(file) })));
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
  const trimmed = label.trim().slice(0, 40);
  if (trimmed) {
    await db.runLabels.put({ id, label: trimmed });
    await db.runs.update(id, { label: trimmed });
  } else {
    await db.runLabels.delete(id);
    await db.runs.update(id, { label: undefined });
  }
}

export async function deleteRun(id: string): Promise<void> {
  // Trwały tombstone: przy scalonej re-analizie usunięty zjazd nie wróci.
  // Usunięcie zjazdu NIE usuwa surowego pliku.
  await db.deletedRuns.put({ id, deletedAt: new Date().toISOString() });
  await db.runs.delete(id);
}
