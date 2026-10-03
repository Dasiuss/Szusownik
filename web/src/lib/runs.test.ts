import { describe, expect, it } from "vitest";
import { syntheticRollingSamples, syntheticSample } from "../../test/fixtures.ts";
import type { Sample } from "./csv.ts";
import { analyzeDay, enrich, runNumbers, splitRuns } from "./runs.ts";

function descent(count: number, startSecond = 0) {
  return Array.from({ length: count }, (_, index) =>
    syntheticSample(startSecond + index, {
      lat: 51.05 + index * 0.0002,
      speed: 20 + index,
      altGps: 1000 - index * 2,
      altBaro: 1000 - index * 2,
    }),
  );
}

describe("enrich", () => {
  it("liczy dystans i odrzuca pojedynczy skok > 200 m", () => {
    const samples = [
      syntheticSample(0, { lat: 51.05 }),
      syntheticSample(1, { lat: 51.051 }),
      syntheticSample(2, { lat: 52.0 }), // ~100 km: skok
      syntheticSample(3, { lat: 52.001 }),
    ];
    const enriched = enrich(samples);
    expect(enriched[1].distM).toBeGreaterThan(100);
    expect(enriched[2].distM).toBe(0);
    expect(enriched[3].distM).toBeGreaterThan(100);
  });

  it("bez barometru (altBaro=0) wysokość zbiega do GPS", () => {
    const samples = Array.from({ length: 30 }, (_, index) =>
      syntheticSample(index, { altGps: 900, altBaro: 0 }),
    );
    const enriched = enrich(samples);
    expect(enriched[enriched.length - 1].altSm).toBeCloseTo(900, 0);
  });

  it("prędkość i nachylenie są wygładzone", () => {
    const enriched = enrich(descent(10));
    expect(enriched[0].speedSm).toBeGreaterThan(0);
    expect(enriched[5].speedSm).toBeLessThan(enriched[9].speedSm);
  });
});

describe("splitRuns", () => {
  it("monotoniczny zjazd to jeden zjazd z deterministycznym id", () => {
    const runs = splitRuns(enrich(descent(20)));
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe("zjazd-1");
    expect(runs[0].distanceM).toBeGreaterThan(0);
  });

  it("ciągły podjazd >= 5 m rozdziela dwa zjazdy", () => {
    const down = descent(10);
    const climb = Array.from({ length: 8 }, (_, index) =>
      syntheticSample(10 + index, {
        lat: 51.05 + (10 + index) * 0.0002,
        speed: 10,
        altGps: 1000 - 18 + index * 3,
        altBaro: 1000 - 18 + index * 3,
      }),
    );
    const down2 = Array.from({ length: 10 }, (_, index) =>
      syntheticSample(18 + index, {
        lat: 51.05 + (18 + index) * 0.0002,
        speed: 20 + index,
        altGps: 1000 - 18 + 21 - index * 2,
        altBaro: 1000 - 18 + 21 - index * 2,
      }),
    );
    const runs = splitRuns(enrich([...down, ...climb, ...down2]));
    expect(runs).toHaveLength(2);
  });

  it("generator z K wyciągami daje K+1 ciągłych zjazdów (wyciąg + zjazd)", () => {
    for (const lifts of [1, 2, 3, 5]) {
      const enriched = enrich(syntheticRollingSamples({ lifts }));
      const runs = splitRuns(enriched);
      expect(runs).toHaveLength(lifts + 1);

      // Jedno cięcie na dołku: odcinki są ciągłe i pokrywają cały ślad.
      const total = runs.reduce((sum, run) => sum + run.distanceM, 0);
      expect(total).toBeCloseTo(enriched[enriched.length - 1].cumDistM, 3);

      // Każdy zjazd po pierwszym zaczyna się na dole i zawiera podejście.
      for (const run of runs.slice(1)) {
        const start = run.samples[0].altSm;
        const highest = Math.max(...run.samples.map((sample) => sample.altSm));
        expect(highest).toBeGreaterThan(start + 5);
      }
    }
  });

  it("wynik nie zależy od częstotliwości próbkowania", () => {
    const samples = syntheticRollingSamples({ lifts: 4 });
    const count = (subset: Sample[]) => splitRuns(enrich(subset)).length;
    const base = count(samples);
    expect(base).toBe(5);
    for (const stride of [2, 3, 5]) {
      expect(count(samples.filter((_, index) => index % stride === 0))).toBe(base);
    }
  });

  it("przerwa >= 1 h rozdziela aktywności zamiast scalać w jeden zjazd", () => {
    const first = Array.from({ length: 10 }, (_, index) =>
      syntheticSample(index, {
        lat: 51.05 + index * 0.0002,
        altGps: 1000 - index * 2,
        altBaro: 1000 - index * 2,
      }),
    );
    const gap = 2 * 3600;
    const second = Array.from({ length: 10 }, (_, index) =>
      syntheticSample(gap + index, {
        lat: 51.05 + (10 + index) * 0.0002,
        altGps: 1000 - index * 2,
        altBaro: 1000 - index * 2,
      }),
    );
    const runs = splitRuns(enrich([...first, ...second]));
    expect(runs).toHaveLength(2);
  });
});

describe("analyzeDay", () => {
  it("agreguje dystans i najszybszy potwierdzony zjazd", () => {
    const day = analyzeDay(descent(30));
    expect(day.runs).toHaveLength(1);
    expect(day.downhillM).toBeCloseTo(day.runs[0].distanceM, 3);
    expect(day.confirmedMaxSpeed).toBe(day.runs[0].confirmedMaxSpeed);
  });
});

describe("runNumbers", () => {
  it("numeruje chronologicznie niezależnie od kolejności wejścia (Zjazd 1 = pierwszy)", () => {
    const numbers = runNumbers([
      { id: "późniejszy", startT: "2026-01-15T15:00:00.000Z" },
      { id: "pierwszy", startT: "2026-01-15T09:00:00.000Z" },
      { id: "środkowy", startT: "2026-01-15T12:00:00.000Z" },
    ]);
    expect(numbers.get("pierwszy")).toBe(1);
    expect(numbers.get("środkowy")).toBe(2);
    expect(numbers.get("późniejszy")).toBe(3);
  });

  it("pusta lista nie tworzy numerów", () => {
    expect(runNumbers([]).size).toBe(0);
  });
});
