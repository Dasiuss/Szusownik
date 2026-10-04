// Testy dopasowania zjazdu do tras (map-matching uproszczony).
// Syntetyczna geometria tras + ślad; weryfikacja na realnym urządzeniu
// narciarskim pozostaje manualna (demo jest generowane).

import { describe, expect, it } from "vitest";
import { lineFeature, straightPiste } from "../../test/skiArea.ts";
import { syntheticSample } from "../../test/fixtures.ts";
import type { Sample } from "./csv.ts";
import { enrich, type EnrichedSample } from "./runs.ts";
import {
  MIN_ROUTE_DISTANCE_M,
  matchRunRoutes,
  previousRidesForSequence,
  routeHistories,
  routeSequenceKey,
  type RouteSequenceItem,
  type RouteSpan,
  type RunRouteRecord,
} from "./routeMatching.ts";
import type { Position } from "./mapData.ts";

const A0: Position = [10.98, 46.97];
const A1: Position = [10.984, 46.966];
const B1: Position = [10.988, 46.96];

function interpolate(start: Position, end: Position, count: number): Position[] {
  return Array.from({ length: count }, (_, index) => [
    start[0] + (end[0] - start[0]) * (index / (count - 1)),
    start[1] + (end[1] - start[1]) * (index / (count - 1)),
  ]);
}

function trace(
  points: Position[],
  options: { dtS?: number; speed?: number; altStart?: number; altStep?: number } = {},
): EnrichedSample[] {
  const dtS = options.dtS ?? 1;
  const speed = options.speed ?? 40;
  const altStart = options.altStart ?? 1000;
  const altStep = options.altStep ?? -1;
  const samples: Sample[] = points.map(([lon, lat], index) =>
    syntheticSample(index * dtS, {
      lat,
      lon,
      speed,
      altGps: altStart + altStep * index,
      altBaro: altStart + altStep * index,
    }),
  );
  return enrich(samples);
}

function piste(uid: string, start: Position, end: Position, overrides: Parameters<typeof straightPiste>[3] = {}) {
  return straightPiste(uid, start, end, { site: "Sölden", ...overrides });
}

describe("matchRunRoutes", () => {
  it("przypisuje zjazd do jednej trasy i liczy dystans wzdłuż niej", () => {
    const match = matchRunRoutes([piste("piste/A", A0, A1, { label: "15", difficulty: "intermediate" })], trace(interpolate(A0, A1, 40)));
    expect(match.spans).toHaveLength(1);
    expect(match.spans[0].routeKey).toBe("Sölden::15");
    expect(match.spans[0].distanceM).toBeGreaterThan(400);
    expect(match.sequence.map((item) => item.key)).toEqual(["Sölden::15"]);
    expect(match.routeName).toBe("15");
  });

  it("nie zalicza fragmentu krótszego niż 100 m", () => {
    const short = trace(interpolate(A0, A1, 40).slice(0, 6));
    const match = matchRunRoutes([piste("piste/A", A0, A1, { label: "15" })], short);
    expect(match.spans).toHaveLength(0);
    expect(match.routeName).toBeNull();
  });

  it("nie łapie trasy dalej niż promień 50 m", () => {
    // Trasa pozioma, żeby przesunięcie na północ było dokładnie prostopadłe.
    const start: Position = [10.98, 46.968];
    const end: Position = [10.988, 46.968];
    const offset = interpolate(start, end, 40).map(([lon, lat]): Position => [lon, lat + 0.0006]);
    const match = matchRunRoutes([piste("piste/H", start, end, { label: "15" })], trace(offset));
    expect(match.spans).toHaveLength(0);
  });

  it("buduje sekwencję z dwóch tras", () => {
    const features = [
      piste("piste/A", A0, A1, { label: "15", difficulty: "intermediate" }),
      piste("piste/B", A1, B1, { label: "8", difficulty: "advanced" }),
    ];
    const path = [...interpolate(A0, A1, 30), ...interpolate(A1, B1, 30).slice(1)];
    const match = matchRunRoutes(features, trace(path));
    expect(match.sequence.map((item) => item.key)).toEqual(["Sölden::15", "Sölden::8"]);
    expect(match.routeName).toBe("15 → 8");
    expect(match.spans.length).toBe(2);
  });

  it("grupuje odcinki OSM o tym samym site+label w jedną trasę", () => {
    const features = [
      piste("piste/A1", A0, [10.982, 46.968], { label: "15" }),
      piste("piste/A2", [10.982, 46.968], A1, { label: "15" }),
    ];
    const match = matchRunRoutes(features, trace(interpolate(A0, A1, 40)));
    expect(match.spans).toHaveLength(1);
    expect(match.spans[0].routeKey).toBe("Sölden::15");
    expect(match.spans[0].distanceM).toBeGreaterThan(400);
  });

  it("bez nazwy trzyma osobno każdy odcinek OSM", () => {
    const features = [
      piste("piste/A1", A0, [10.982, 46.968], { label: "", name: "", ref: "" }),
      piste("piste/A2", [10.982, 46.968], A1, { label: "", name: "", ref: "" }),
    ];
    const match = matchRunRoutes(features, trace(interpolate(A0, A1, 40)));
    expect(match.sequence.map((item) => item.key)).toEqual(["uid:piste/A1", "uid:piste/A2"]);
    expect(match.spans.every((span) => span.label === "Bez nazwy")).toBe(true);
  });

  it("scala krótką przerwę (jedna zła próbka) w jeden odcinek", () => {
    const points = interpolate(A0, A1, 40);
    points[20] = [points[20][0], points[20][1] + 0.001]; // ~111 m od trasy -> brak dopasowania
    const match = matchRunRoutes([piste("piste/A", A0, A1, { label: "15" })], trace(points));
    expect(match.spans).toHaveLength(1);
    expect(match.spans[0].distanceM).toBeGreaterThan(400);
  });

  it("pomija podejście wyciągiem (bierze zjazd od najwyższego punktu w dół)", () => {
    const up = interpolate(A1, A0, 20);
    const down = interpolate(A0, A1, 20).slice(1);
    const points = [...up, ...down];
    const samples: Sample[] = points.map(([lon, lat], index) => {
      const altitude = index < up.length
        ? 800 + index * 2
        : 800 + up.length * 2 - (index - up.length) * 2;
      return syntheticSample(index, { lat, lon, speed: 40, altGps: altitude, altBaro: altitude });
    });
    const match = matchRunRoutes([piste("piste/A", A0, A1, { label: "15" })], enrich(samples));
    expect(match.spans).toHaveLength(1);
    // Bez wycięcia podejścia dystans byłby ~2x większy.
    expect(match.spans[0].distanceM).toBeLessThan(700);
    expect(match.spans[0].distanceM).toBeGreaterThan(400);
  });

  it("zwraca puste dopasowanie bez tras", () => {
    const match = matchRunRoutes([], trace(interpolate(A0, A1, 40)));
    expect(match.spans).toHaveLength(0);
    expect(match.routeName).toBeNull();
  });

  it("nie dopasowuje wyciągów jako tras", () => {
    const lift = lineFeature("lift/L", [A0, A1], { routeKind: "lift", label: "Krzesełko", site: "Sölden" });
    const match = matchRunRoutes([lift], trace(interpolate(A0, A1, 40)));
    expect(match.spans).toHaveLength(0);
  });
});

function span(routeKey: string, label: string, startT: string, endT: string, distanceM: number, maxSpeed: number): RouteSpan {
  return {
    routeKey,
    label,
    difficulty: "intermediate",
    startT,
    endT,
    distanceM,
    durationS: (Date.parse(endT) - Date.parse(startT)) / 1000,
    maxSpeed,
  };
}

const R15: RouteSequenceItem = { key: "Sölden::15", label: "15", difficulty: "intermediate" };
const R8: RouteSequenceItem = { key: "Sölden::8", label: "8", difficulty: "advanced" };

describe("statystyki tras", () => {
  const records: RunRouteRecord[] = [
    {
      id: "r1",
      startT: "2026-03-01T10:00:00.000Z",
      routeSpans: [span("Sölden::15", "15", "2026-03-01T10:00:00.000Z", "2026-03-01T10:00:41.000Z", 800, 80)],
      routeSequence: [R15],
    },
    {
      id: "r2",
      startT: "2026-03-02T10:00:00.000Z",
      routeSpans: [span("Sölden::15", "15", "2026-03-02T10:00:00.000Z", "2026-03-02T10:00:38.000Z", 820, 85)],
      routeSequence: [R15],
    },
    {
      id: "r3",
      startT: "2026-03-03T10:00:00.000Z",
      routeSpans: [
        span("Sölden::15", "15", "2026-03-03T10:00:00.000Z", "2026-03-03T10:00:44.000Z", 780, 78),
        span("Sölden::8", "8", "2026-03-03T10:00:50.000Z", "2026-03-03T10:01:23.000Z", 600, 88),
      ],
      routeSequence: [R15, R8],
    },
  ];

  it("routeSequenceKey grupuje identyczną sekwencję", () => {
    expect(routeSequenceKey([R15, R8])).toBe("Sölden::15>Sölden::8");
    expect(routeSequenceKey([R15])).not.toBe(routeSequenceKey([R15, R8]));
  });

  it("poprzednie przejazdy tej samej sekwencji bez bieżącego, od najnowszego", () => {
    const rides = previousRidesForSequence(records, [R15], "r1");
    expect(rides.map((ride) => ride.runId)).toEqual(["r2"]);
    expect(rides[0].maxSpeed).toBe(85);
    expect(rides[0].durationS).toBe(38);
    expect(rides[0].distanceM).toBe(820);
  });

  it("historia per trasa liczy przejazdy, najlepszy czas i max", () => {
    const [group15, group8] = routeHistories(records, [R15, R8], "r1");
    expect(group15.rideCount).toBe(2); // r2 i r3 (bez bieżącego r1)
    expect(group15.bestDurationS).toBe(38);
    expect(group15.maxSpeed).toBe(85);
    expect(group15.rides.map((ride) => ride.runId)).toEqual(["r3", "r2"]);
    expect(group8.rideCount).toBe(1);
    expect(group8.rides[0].runId).toBe("r3");
  });

  it("na stałą MIN_ROUTE_DISTANCE_M nie zaliczymy krótkiego odcinka", () => {
    expect(MIN_ROUTE_DISTANCE_M).toBe(100);
  });
});
