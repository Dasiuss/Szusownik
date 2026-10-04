import { describe, expect, it } from "vitest";
import {
  SPEED_COLOR_STOPS,
  buildTraceCollection,
  speedColor,
  traceBounds,
  type TracePoint,
} from "./traceMap.ts";

function point(lat: number, lon: number, speedSm: number): TracePoint {
  return { lat, lon, speedSm };
}

describe("speedColor", () => {
  it("zwraca dokładne kolory w progach", () => {
    for (const stop of SPEED_COLOR_STOPS) {
      expect(speedColor(stop.speed)).toBe(stop.color);
    }
  });

  it("ściska wartości poza zakresem do skrajnych kolorów", () => {
    expect(speedColor(-20)).toBe(SPEED_COLOR_STOPS[0].color);
    expect(speedColor(500)).toBe(SPEED_COLOR_STOPS[SPEED_COLOR_STOPS.length - 1].color);
  });

  it("interpoluje między progami", () => {
    const between = speedColor(45); // między niebieskim (30) a pomarańczowym (60)
    expect(between).toMatch(/^#[0-9a-f]{6}$/);
    expect(between).not.toBe(SPEED_COLOR_STOPS[1].color);
    expect(between).not.toBe(SPEED_COLOR_STOPS[2].color);
  });
});

describe("buildTraceCollection", () => {
  it("tworzy segmenty z kolorem i prędkością oraz nie skleja osobnych śladów", () => {
    const collection = buildTraceCollection([
      [point(46.97, 10.98, 10), point(46.971, 10.981, 60), point(46.972, 10.982, 90)],
      [point(47.0, 11.0, 5), point(47.001, 11.001, 20)],
    ]);

    // 3 punkty -> 2 segmenty; 2 punkty -> 1 segment.
    expect(collection.features).toHaveLength(3);
    for (const feature of collection.features) {
      expect(feature.geometry.type).toBe("LineString");
      expect(feature.properties.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(Number.isFinite(feature.properties.speed)).toBe(true);
    }
    // Kolejność współrzędnych to [lon, lat].
    expect(collection.features[0].geometry.coordinates[0]).toEqual([10.98, 46.97]);
    // Żaden segment nie łączy dwóch różnych śladów.
    for (const feature of collection.features) {
      const [a, b] = feature.geometry.coordinates;
      const jumped = Math.abs(a[0] - b[0]) > 0.05 || Math.abs(a[1] - b[1]) > 0.05;
      expect(jumped).toBe(false);
    }
  });

  it("decymuje gęste ślady, zachowując końce", () => {
    const dense = Array.from({ length: 100 }, (_, index) => point(46.97 + index * 0.0001, 10.98, 50));
    const collection = buildTraceCollection([dense], { maxPointsPerTrace: 10 });
    expect(collection.features.length).toBeLessThanOrEqual(9);
    const first = collection.features[0].geometry.coordinates[0];
    const last = collection.features[collection.features.length - 1].geometry.coordinates.at(-1)!;
    expect(first).toEqual([10.98, 46.97]);
    expect(last[1]).toBeCloseTo(46.97 + 99 * 0.0001, 6);
  });

  it("pomija punkty bez poprawnych współrzędnych", () => {
    const collection = buildTraceCollection([
      [point(46.97, 10.98, 10), point(NaN, 10.981, 20), point(46.972, 10.982, 30)],
    ]);
    // NaN przerywa ciąg — zostają dwa pojedyncze punkty, więc brak segmentów.
    expect(collection.features).toHaveLength(0);
  });

  it("scala kolejne odcinki o tym samym przedziale prędkości w jedną linię", () => {
    // Wszystkie prędkości w tym samym przedziale (5 km/h) — jeden ciągły feature.
    const steady = buildTraceCollection([
      [point(46.97, 10.98, 50), point(46.971, 10.981, 51), point(46.972, 10.982, 52), point(46.973, 10.983, 51)],
    ]);
    expect(steady.features).toHaveLength(1);
    expect(steady.features[0].geometry.coordinates).toHaveLength(4);

    // Skok prędkości przez kilka przedziałów dzieli ślad na osobne linie.
    const jumpy = buildTraceCollection([
      [point(46.97, 10.98, 20), point(46.971, 10.981, 20), point(46.972, 10.982, 90), point(46.973, 10.983, 90)],
    ]);
    expect(jumpy.features.length).toBeGreaterThan(1);
  });
});

describe("traceBounds", () => {
  it("zwraca bounding box wszystkich śladów", () => {
    const bounds = traceBounds([
      [point(46.97, 10.98, 10), point(46.99, 11.0, 30)],
      [point(46.95, 10.95, 40)],
    ]);
    expect(bounds).toEqual([[10.95, 46.95], [11.0, 46.99]]);
  });

  it("zwraca null dla pustego wejścia", () => {
    expect(traceBounds([])).toBeNull();
    expect(traceBounds([[]])).toBeNull();
    expect(traceBounds([[point(NaN, NaN, 10)]])).toBeNull();
  });
});
