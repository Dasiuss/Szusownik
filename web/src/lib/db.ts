import Dexie, { type Table } from "dexie";

export interface StoredFile {
  name: string; // klucz: nazwa pliku z urządzenia (sync po nazwie)
  size: number;
  receivedAt: string; // ISO
  userId: string; // lokalna izolacja użytkowników (docelowo Supabase uid)
  raw: string; // surowy CSV — analiza zawsze z surowego, nigdy z pochodnych
}

class SzusownikDb extends Dexie {
  files!: Table<StoredFile, string>;

  constructor() {
    super("szusownik");
    // Schemat v1. Migracje przez version(). Wipe przeglądarki nie może być
    // wymagany (ustalenia §6).
    this.version(1).stores({
      files: "name, receivedAt, userId",
    });
  }
}

export const db = new SzusownikDb();
