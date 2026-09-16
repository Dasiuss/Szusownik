import Dexie, { type Table } from "dexie";
import type { EnrichedSample } from "./runs.ts";

export interface StoredFile {
  name: string; // klucz: nazwa pliku z urządzenia (sync po nazwie)
  size: number;
  receivedAt: string; // ISO
  userId: string; // lokalna izolacja użytkowników (docelowo Supabase uid)
  raw: string; // surowy CSV — analiza zawsze z surowego, nigdy z pochodnych
}

export interface StoredRun {
  id: string;
  sourceFile: string;
  sourceIndex: number;
  dayKey: string;
  startT: string;
  endT: string;
  distanceM: number;
  maxSpeed: number;
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

class SzusownikDb extends Dexie {
  files!: Table<StoredFile, string>;
  runs!: Table<StoredRun, string>;
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
  }
}

export const db = new SzusownikDb();
