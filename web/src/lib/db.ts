import Dexie, { type Table } from "dexie";
import type { EnrichedSample, PeakQuality } from "./runs.ts";

export interface StoredFile {
  name: string; // klucz: nazwa pliku z urządzenia (sync po nazwie)
  size: number;
  receivedAt: string; // ISO
  userId: string; // lokalna izolacja użytkowników (docelowo Supabase uid)
  raw: string; // surowy CSV — analiza zawsze z surowego, nigdy z pochodnych
}

export interface StoredRun {
  id: string; // stabilny: `${dayKey}::${startT}` — przeżywa scalenie i re-analizę
  dayKey: string;
  startT: string;
  endT: string;
  distanceM: number;
  analysisVersion: number;
  rawMaxSpeed: number;
  rawMaxSampleIndex: number;
  rawMaxQuality: PeakQuality;
  confirmedMaxSpeed: number | null;
  confirmedSampleIndex: number | null;
  confirmedQuality: PeakQuality | null;
  maxGradeDown: number;
  samples: EnrichedSample[];
  label?: string;
  demo?: boolean;
  receivedAt: string;
}

export interface StoredMeta {
  key: string;
  value: string;
}

/** Trwała etykieta użytkownika, kluczowana stabilnym id zjazdu (przeżywa re-analizę). */
export interface StoredRunLabel {
  id: string;
  label: string;
}

/** Tombstone usuniętego zjazdu — materializacja pomija takie id (nie usuwa pliku). */
export interface StoredDeletedRun {
  id: string;
  deletedAt: string;
}

/** Trwale pominięty plik (uszkodzony na karcie) — nigdy nie ponawiamy pobierania.
 *  Zostaje na SD jako backup; wpis znika dopiero z resetem danych PWA. */
export interface StoredIgnoredFile {
  name: string;
  reason: string;
  ignoredAt: string;
}

class SzusownikDb extends Dexie {
  files!: Table<StoredFile, string>;
  runs!: Table<StoredRun, string>;
  runLabels!: Table<StoredRunLabel, string>;
  deletedRuns!: Table<StoredDeletedRun, string>;
  ignoredFiles!: Table<StoredIgnoredFile, string>;
  meta!: Table<StoredMeta, string>;

  constructor() {
    super("szusownik");
    // Schemat v1. Migracje przez version(). Wipe przeglądarki nie może być
    // wymagany (ustalenia §6).
    this.version(1).stores({
      files: "name, receivedAt, userId",
    });
    this.version(2).stores({
      files: "name, receivedAt, userId",
      runs: "id, dayKey, startT, sourceFile, label, demo",
      meta: "key",
    });
    this.version(3).stores({
      files: "name, receivedAt, userId",
      runs: "id, dayKey, startT, sourceFile, label, demo",
      meta: "key",
    });
    // v4: analiza ze scalonego śladu. `runs` traci sourceFile/sourceIndex,
    // dochodzą trwałe etykiety i tombstone'y kluczowane stabilnym id.
    this.version(4)
      .stores({
        files: "name, receivedAt, userId",
        runs: "id, dayKey, startT, label, demo",
        runLabels: "id",
        deletedRuns: "id",
        meta: "key",
      })
      .upgrade(async (tx) => {
        // Przenieś etykiety starych zjazdów na nowy stabilny klucz. Zjazdy,
        // które po scaleniu zmieniły granicę, mogą stracić etykietę — to
        // najlepsze możliwe odwzorowanie bez czyszczenia IndexedDB.
        const previous = (await tx.table("runs").toArray()) as Array<{
          dayKey?: string;
          startT?: string;
          label?: string;
        }>;
        const labels = previous
          .filter((run) => run.label && run.dayKey && run.startT)
          .map((run) => ({ id: `${run.dayKey}::${run.startT}`, label: run.label as string }));
        if (labels.length > 0) await tx.table("runLabels").bulkPut(labels);
        // Wymuś jednorazowe przeliczenie na nowym, scalonym pipeline.
        await tx.table("runs").clear();
      });
    // v5: trwale pominięte pliki (uszkodzone na karcie) — zero ponowień.
    this.version(5).stores({
      files: "name, receivedAt, userId",
      runs: "id, dayKey, startT, label, demo",
      runLabels: "id",
      deletedRuns: "id",
      ignoredFiles: "name",
      meta: "key",
    });
  }
}

export const db = new SzusownikDb();
