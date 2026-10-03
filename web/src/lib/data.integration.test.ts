// Testy integracyjne warstwy danych: seed demo, scalanie plików w jeden zjazd,
// stabilne id zjazdu i przeżycie etykiet/tombstone'ów przez re-analizę.

import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoRideCsv, syntheticSample } from "../../test/fixtures.ts";
import {
  DEMO_SOURCE_FILE,
  deleteRun,
  ensureLocalData,
  getAllRuns,
  materializeAll,
  renameRun,
  stableRunId,
} from "./data.ts";
import { serializeDeviceCsvV2 } from "./csv.ts";
import { db } from "./db.ts";
import { localDayKey } from "./runs.ts";

async function freshDb(): Promise<void> {
  db.close();
  await db.delete();
  await db.open();
}

async function seed(name: string, csv: string, receivedAt: string): Promise<void> {
  await db.files.put({ name, size: csv.length, receivedAt, userId: "local", raw: csv });
}

const RECEIVED = "2026-01-15T12:00:00.000Z";

beforeEach(async () => {
  await freshDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("materializeAll", () => {
  it("scala rotację pliku w jeden zjazd (jedna oś, dedup styku)", async () => {
    const altitude = (index: number) => 1000 - index * 2;
    const latitude = (index: number) => 51.05 + index * 0.0002;
    const first = Array.from({ length: 9 }, (_, index) =>
      syntheticSample(index, { lat: latitude(index), altGps: altitude(index), altBaro: altitude(index) }),
    );
    const boundary = { ...first[first.length - 1] };
    const second = [
      boundary,
      ...Array.from({ length: 8 }, (_, offset) =>
        syntheticSample(9 + offset, {
          lat: latitude(9 + offset),
          altGps: altitude(9 + offset),
          altBaro: altitude(9 + offset),
        }),
      ),
    ];

    await seed("20260115_100000.csv", serializeDeviceCsvV2(first), RECEIVED);
    await seed("20260115_100010.csv", serializeDeviceCsvV2(second), "2026-01-15T12:00:01.000Z");
    await materializeAll();

    const runs = await getAllRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].samples.length).toBe(first.length + second.length - 1);
  });

  it("grupuje po lokalnym dniu i tnie osobno", async () => {
    const dayOne = Array.from({ length: 6 }, (_, index) =>
      syntheticSample(index, { lat: 51.05 + index * 0.0002, altGps: 1000 - index * 2 }),
    );
    const dayTwo = Array.from({ length: 6 }, (_, index) =>
      syntheticSample(30 * 3600 + index, { lat: 51.05 + index * 0.0002, altGps: 1000 - index * 2 }),
    );
    await seed("20260115_100000.csv", serializeDeviceCsvV2(dayOne), RECEIVED);
    await seed("20260116_160000.csv", serializeDeviceCsvV2(dayTwo), "2026-01-16T16:00:00.000Z");
    await materializeAll();

    const runs = await getAllRuns();
    expect(new Set(runs.map((run) => run.dayKey)).size).toBe(2);
    expect(runs.every((run) => run.samples.length > 0)).toBe(true);
  });

  it("nie przelicza, gdy podpis plików się nie zmienił", async () => {
    await seed("20260115_100000.csv", serializeDeviceCsvV2([
      syntheticSample(0, { lat: 51.05, altGps: 1000 }),
      syntheticSample(1, { lat: 51.0502, altGps: 998 }),
      syntheticSample(2, { lat: 51.0504, altGps: 996 }),
    ]), RECEIVED);
    await materializeAll();
    const firstPass = await getAllRuns();

    // Ręcznie "psujemy" wynik; kolejna materializacja bez zmian nie może go tknąć.
    await db.runs.update(firstPass[0].id, { label: "ręcznie" });
    await materializeAll();
    const second = await getAllRuns();
    expect(second).toHaveLength(1);
  });

  it("etykiety i tombstone'y przeżywają ponowną analizę (stabilne id)", async () => {
    await seed("20260115_100000.csv", serializeDeviceCsvV2(
      Array.from({ length: 8 }, (_, index) =>
        syntheticSample(index, { lat: 51.05 + index * 0.0002, altGps: 1000 - index * 2 }),
      ),
    ), RECEIVED);
    await materializeAll();
    const [run] = await getAllRuns();
    expect(run.id).toBe(stableRunId(run.dayKey, run.startT));

    await renameRun(run.id, "Poranny");
    // Zmiana zbioru plików wymusza re-analizę o innym podpisie.
    await seed("20260117_100000.csv", serializeDeviceCsvV2([
      syntheticSample(0, { lat: 52.0, altGps: 800 }),
      syntheticSample(1, { lat: 52.0002, altGps: 798 }),
      syntheticSample(2, { lat: 52.0004, altGps: 796 }),
    ]), "2026-01-17T10:00:00.000Z");
    await materializeAll(true);

    const after = (await getAllRuns()).find((candidate) => candidate.id === run.id);
    expect(after?.label).toBe("Poranny");

    await deleteRun(run.id);
    await materializeAll(true);
    expect((await getAllRuns()).some((candidate) => candidate.id === run.id)).toBe(false);
  });

  it("pomija nieparsowalny plik nie wywalając całej analizy", async () => {
    await seed("20260115_100000.csv", "zepsuty,naglowek\n1,2\n", RECEIVED);
    await seed("20260115_101000.csv", serializeDeviceCsvV2([
      syntheticSample(0, { lat: 51.05, altGps: 1000 }),
      syntheticSample(1, { lat: 51.0502, altGps: 998 }),
      syntheticSample(2, { lat: 51.0504, altGps: 996 }),
    ]), "2026-01-15T12:00:02.000Z");
    await materializeAll();

    const runs = await getAllRuns();
    expect(runs.length).toBeGreaterThanOrEqual(1);
  });
});

describe("ensureLocalData", () => {
  it("seeduje demo z fixture i materializuje zjazd demo", async () => {
    const csv = demoRideCsv();
    vi.stubGlobal("fetch", async () => new Response(csv, { status: 200 }));

    await ensureLocalData();

    const demoFile = await db.files.get(DEMO_SOURCE_FILE);
    expect(demoFile).toBeDefined();
    const runs = await getAllRuns();
    expect(runs.some((run) => run.demo === true)).toBe(true);
  });

  it("nie seeduje dwa razy", async () => {
    const csv = demoRideCsv();
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return new Response(csv, { status: 200 });
    });

    await ensureLocalData();
    await ensureLocalData();
    expect(calls).toBe(1);
    expect(await db.files.count()).toBe(1);
  });

  it("localDayKey jest deterministyczny dla próbki", () => {
    const sample = syntheticSample(0);
    expect(localDayKey(sample.t)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
