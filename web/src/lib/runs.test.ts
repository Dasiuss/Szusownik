import { describe, expect, it } from "vitest";
import { syntheticSample } from "../../test/fixtures.ts";
import { analyzeDay, enrich, splitRuns } from "./runs.ts";

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
});

describe("analyzeDay", () => {
  it("agreguje dystans i najszybszy potwierdzony zjazd", () => {
    const day = analyzeDay(descent(30));
    expect(day.runs).toHaveLength(1);
    expect(day.downhillM).toBeCloseTo(day.runs[0].distanceM, 3);
    expect(day.confirmedMaxSpeed).toBe(day.runs[0].confirmedMaxSpeed);
  });
});
