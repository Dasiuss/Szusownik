// Wspólne dane testowe: realne nagranie z urządzenia i generatory syntetyczne.
// Realne pliki czytamy z `test data/` (repo root) i `public/fixtures/`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serializeDeviceCsvV2, type Sample } from "../src/lib/csv.ts";

function repoPath(relative: string): string {
  return fileURLToPath(new URL(`../../${relative}`, import.meta.url));
}

/** Realne nagranie z urządzenia (golden referencyjny ślad). */
export const REAL_RIDE_FILE = "20260926_181420.csv";

export function realRideCsv(): string {
  return readFileSync(repoPath(`test data/${REAL_RIDE_FILE}`), "utf8");
}

export function realRideBytes(): Uint8Array {
  return new Uint8Array(readFileSync(repoPath(`test data/${REAL_RIDE_FILE}`)));
}

/** Fixture demo seedowana do PWA przy pierwszym uruchomieniu. */
export function demoRideCsv(): string {
  return readFileSync(fileURLToPath(new URL("../public/fixtures/ride.csv", import.meta.url)), "utf8");
}

export interface GoldenDone {
  file: string;
  raw: number;
  comp: number;
  frames: number;
  crc: string;
  line: string;
}

/** Golden z prawdziwego urządzenia: linia `BLE done ...` z monitora. */
export function goldenDone(): GoldenDone {
  return JSON.parse(
    readFileSync(fileURLToPath(new URL("./golden/device-done.json", import.meta.url)), "utf8"),
  ) as GoldenDone;
}

const SYNTHETIC_BASE = Date.parse("2026-01-15T10:00:00.000Z");

export function syntheticSample(second: number, overrides: Partial<Sample> = {}): Sample {
  return {
    t: new Date(SYNTHETIC_BASE + second * 1000).toISOString(),
    lat: 51.05,
    lon: 17.03,
    speed: 30,
    altGps: 1000,
    hdg: 180,
    altBaro: 1000,
    gnssFixValid: true,
    gnssFixAgeMs: 100,
    gnssSatellites: 8,
    gnssSatellitesAgeMs: 100,
    gnssHdop: 0.9,
    gnssHdopAgeMs: 100,
    ...overrides,
  };
}

/** Jeden ciągły zjazd: prędkość rośnie, wysokość i pozycja maleją/rosną monotonicznie. */
export function syntheticDescentCsv(count = 30, startSecond = 0): string {
  const samples = Array.from({ length: count }, (_, index) =>
    syntheticSample(startSecond + index, {
      speed: 20 + index,
      altGps: 1000 - index * 2,
      altBaro: 1000 - index * 2,
      lat: 51.05 + index * 0.0002,
    }),
  );
  return serializeDeviceCsvV2(samples);
}

/** Plik "postojowy": te same pozycja i wysokość, zerowa prędkość. */
export function syntheticStandstillCsv(count = 5, startSecond = 0): string {
  const samples = Array.from({ length: count }, (_, index) =>
    syntheticSample(startSecond + index, { speed: 0, altGps: 900, altBaro: 900 }),
  );
  return serializeDeviceCsvV2(samples);
}

export function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
