import { describe, expect, it } from "vitest";
import {
  accelerationKmhPerS,
  accelDomain,
  buildDayProfile,
  buildRunProfile,
  findNearestIndex,
  MIN_ACCEL_RANGE_KMH_S,
} from "./chartSeries.ts";

function iso(second: number): string {
  return new Date(Date.parse("2026-01-15T10:00:00.000Z") + second * 1000).toISOString();
}

function sample(second: number, speedSm: number) {
  return { t: iso(second), speedSm };
}

describe("accelerationKmhPerS", () => {
  it("liczy stałe przyspieszenie w km/h na sekundę", () => {
    const samples = [0, 1, 2, 3, 4].map((s) => sample(s, 20 + 10 * s));
    const a = accelerationKmhPerS(samples, { smoothWindow: 3 });

    expect(a[0]).toBeNull();
    for (let index = 1; index < samples.length; index++) {
      expect(a[index]).toBeCloseTo(10, 6);
    }
  });

  it("zwraca null gdy odstęp czasu jest niedodatni (powtórzony timestamp)", () => {
    const samples = [sample(0, 10), sample(0, 20), sample(1, 30)];
    const a = accelerationKmhPerS(samples, { smoothWindow: 1 });

    expect(a[0]).toBeNull();
    expect(a[1]).toBeNull();
    expect(a[2]).toBeCloseTo(10, 6);
  });

  it("przerywa linię (null) na zbyt dużej luce czasowej", () => {
    const samples = [sample(0, 10), sample(1, 20), sample(2, 30), sample(10, 90)];
    const a = accelerationKmhPerS(samples, { smoothWindow: 1, maxGapS: 5 });

    expect(a[3]).toBeNull();
  });

  it("okno 1 pozostawia surowe wartości, a okno 3 wygładza stałą bez zmiany", () => {
    const step = [sample(0, 0), sample(1, 30), sample(2, 30), sample(3, 30)];
    expect(accelerationKmhPerS(step, { smoothWindow: 1 })).toEqual([null, 30, 0, 0]);

    const constant = [0, 1, 2, 3, 4].map((s) => sample(s, 20 + 10 * s));
    const smoothed = accelerationKmhPerS(constant, { smoothWindow: 3 });
    for (let index = 1; index < constant.length; index++) {
      expect(smoothed[index]).toBeCloseTo(10, 6);
    }
  });
});

describe("buildRunProfile", () => {
  it("normalizuje dystans do zera i zachowuje lat/lon oraz przyspieszenie", () => {
    const samples = [0, 1, 2].map((s) => ({
      ...sample(s, 10 + 5 * s),
      lat: 51 + s * 0.001,
      lon: 17 + s * 0.001,
      altSm: 1000 - s * 3,
      cumDistM: 500 + s * 100,
    }));
    const profile = buildRunProfile({ samples } as never, { smoothWindow: 1 });

    expect(profile.map((point) => point.d)).toEqual([0, 0.1, 0.2]);
    expect(profile[0].lat).toBe(51);
    expect(profile[profile.length - 1].lon).toBeCloseTo(17.002, 6);
    expect(profile[0].a).toBeNull();
    expect(profile[1].a).toBeCloseTo(5, 6);
  });

  it("zwraca pustą tablicę bez próbek", () => {
    expect(buildRunProfile({ samples: [] } as never)).toEqual([]);
  });
});

describe("buildDayProfile", () => {
  it("liczy przyspieszenie osobno na każdym zjeździe (brak skoku na styku)", () => {
    const first = [0, 1, 2].map((s) => ({
      ...sample(s, 10 + 5 * s),
      altSm: 1000,
      lat: 51,
      lon: 17,
      cumDistM: s * 100,
    }));
    // Drugi zjazd zaczyna się daleko w dystansie i z inną prędkością.
    const second = [0, 1, 2].map((s) => ({
      ...sample(100 + s, 80 - 5 * s),
      altSm: 900,
      lat: 51.1,
      lon: 17.1,
      cumDistM: 1000 + s * 100,
    }));
    const profile = buildDayProfile([{ samples: first } as never, { samples: second } as never], {
      smoothWindow: 1,
    });

    expect(profile).toHaveLength(6);
    // Pierwsza próbka drugiego zjazdu nie dostaje przyspieszenia z granicy.
    expect(profile[3].a).toBeNull();
    expect(profile[4].a).toBeCloseTo(-5, 6);
    // Wspólna oś rośnie monotonicznie przez granicę zjazdów.
    for (let index = 1; index < profile.length; index++) {
      expect(profile[index].d).toBeGreaterThanOrEqual(profile[index - 1].d);
    }
  });
});

describe("accelDomain", () => {
  it("jest symetryczna wokół zera z podłogą", () => {
    expect(accelDomain([1, -2, 3])).toEqual([-MIN_ACCEL_RANGE_KMH_S, MIN_ACCEL_RANGE_KMH_S]);
  });

  it("rozszerza się do największej wartości bezwzględnej", () => {
    expect(accelDomain([12, -3])).toEqual([-12, 12]);
  });

  it("radzi sobie z brakiem danych", () => {
    expect(accelDomain([])).toEqual([-MIN_ACCEL_RANGE_KMH_S, MIN_ACCEL_RANGE_KMH_S]);
    expect(accelDomain([null, null])).toEqual([-MIN_ACCEL_RANGE_KMH_S, MIN_ACCEL_RANGE_KMH_S]);
  });
});

describe("findNearestIndex", () => {
  const points = [{ d: 0 }, { d: 0.5 }, { d: 1.2 }, { d: 2 }];

  it("zwraca najbliższą próbkę", () => {
    expect(findNearestIndex(points, 0.6)).toBe(1);
    expect(findNearestIndex(points, 1.0)).toBe(2);
    expect(findNearestIndex(points, -1)).toBe(0);
    expect(findNearestIndex(points, 99)).toBe(3);
  });

  it("zwraca null dla pustych danych", () => {
    expect(findNearestIndex([], 1)).toBeNull();
  });
});

