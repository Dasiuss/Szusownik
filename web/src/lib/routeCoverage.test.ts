// Testy pokrycia tras: uniwersum, okno 30 dni, licznik X z Y.
// Render MapLibre pozostaje bez testu jednostkowego (jak całe MapView) — cała
// logika decyzyjna siedzi w tym czystym module.

import { describe, expect, it } from "vitest";
import { lineFeature } from "../../test/skiArea.ts";
import type { SkiData, SkiFeature, SkiLineFeature } from "./mapData.ts";
import { localDayKey } from "./runs.ts";
import { routeKeyFor, type RouteSpan } from "./routeMatching.ts";
import {
  COVERAGE_WINDOW_DAYS,
  coverageCutoffDayKey,
  routeCoverage,
  routeUniverse,
  visitedRouteKeys,
  type CoverageRun,
} from "./routeCoverage.ts";

const NOW = Date.parse("2026-02-15T12:00:00.000Z");
const dayAgo = (days: number): string => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

function lineWithin(): SkiLineFeature {
  return lineFeature("way/1", [[10.98, 46.97], [10.984, 46.966]], { site: "Sölden", label: "15" });
}

function skiData(lines: SkiLineFeature[], pistes: SkiFeature[] = lines): SkiData {
  return {
    pistes: { type: "FeatureCollection", features: pistes },
    lifts: { type: "FeatureCollection", features: [] },
    lines,
  };
}

function span(routeKey: string): RouteSpan {
  return { routeKey, label: routeKey, difficulty: "easy", startT: "", endT: "", distanceM: 200, durationS: 10, maxSpeed: 30 };
}

function run(dayKey: string, routeKeys: string[]): CoverageRun {
  return { dayKey, routeSpans: routeKeys.map(span) };
}

describe("routeUniverse", () => {
  it("grupuje trasy po `site + label` i mapuje każdy element na klucz trasy", () => {
    const data = skiData([
      lineFeature("way/1", [[10.98, 46.97], [10.984, 46.966]], { site: "Sölden", label: "15", ref: "15" }),
      lineFeature("way/2", [[10.99, 46.96], [10.994, 46.956]], { site: "Sölden", label: "15", ref: "15" }),
      lineFeature("way/3", [[10.95, 46.97], [10.955, 46.965]], { site: "Sölden", label: "8", ref: "8" }),
    ]);
    const { universe, keyByUid } = routeUniverse(data);
    expect([...universe].sort()).toEqual(["Sölden::15", "Sölden::8"]);
    expect(keyByUid.get("way/1")).toBe("Sölden::15");
    expect(keyByUid.get("way/2")).toBe("Sölden::15");
    expect(keyByUid.get("way/3")).toBe("Sölden::8");
  });

  it("pomija wyciągi", () => {
    const lift = lineFeature("way/5", [[10.98, 46.97], [10.984, 46.966]], { site: "Sölden", routeKind: "lift", label: "A" });
    const data = skiData([lineWithin(), lift]);
    const { universe, keyByUid } = routeUniverse(data);
    expect(universe.has(routeKeyFor(lift.properties))).toBe(false);
    expect(keyByUid.has("way/5")).toBe(false);
  });

  it("pomija trasy zamknięte (polygon), których nie widzi `lines`", () => {
    const loop: SkiFeature = {
      type: "Feature",
      id: "way/6",
      properties: { ...lineWithin().properties, uid: "way/6", label: "Pętla" },
      geometry: { type: "Polygon", coordinates: [[[10.99, 46.965], [10.991, 46.965], [10.991, 46.964], [10.99, 46.965]]] },
    };
    // `lines` dostaje tylko liniową trasę; polygon jest w `pistes`, ale nie w `lines`.
    const data = skiData([lineWithin()], [loop]);
    const { universe, keyByUid } = routeUniverse(data);
    expect(universe.has("Sölden::Pętla")).toBe(false);
    expect(universe.has("Sölden::15")).toBe(true);
    expect(keyByUid.has("way/6")).toBe(false);
  });
});

describe("coverageCutoffDayKey", () => {
  it("wskazuje dzień sprzed 30 dni", () => {
    const cutoff = coverageCutoffDayKey(NOW);
    const expected = new Date(NOW - COVERAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    // Różnica może wynikać tylko ze strefy czasowej, nie z liczby dni.
    expect(Math.abs(Date.parse(`${cutoff}T12:00:00Z`) - Date.parse(`${expected}T12:00:00Z`))).toBeLessThanOrEqual(24 * 60 * 60 * 1000);
  });
});

describe("visitedRouteKeys", () => {
  it("wlicza dzień równy granicy, a pomija starsze", () => {
    const keys = visitedRouteKeys(
      [run("2026-01-16", ["Sölden::15"]), run("2026-01-15", ["Sölden::8"]), run("2026-02-10", ["Sölden::1"])],
      "2026-01-16",
    );
    expect(keys.has("Sölden::15")).toBe(true); // równy granicy -> w oknie
    expect(keys.has("Sölden::8")).toBe(false); // dzień starszy
    expect(keys.has("Sölden::1")).toBe(true);
  });

  it("skleja klucze z wielu zjazdów", () => {
    const keys = visitedRouteKeys([run("2026-02-10", ["Sölden::15", "Sölden::8"])], "2026-01-16");
    expect([...keys].sort()).toEqual(["Sölden::15", "Sölden::8"]);
  });
});

describe("routeCoverage", () => {
  const data = skiData([
    lineFeature("way/1", [[10.98, 46.97], [10.984, 46.966]], { site: "Sölden", label: "15" }),
    lineFeature("way/2", [[10.99, 46.96], [10.994, 46.956]], { site: "Sölden", label: "8" }),
    lineFeature("way/3", [[10.95, 46.97], [10.955, 46.965]], { site: "Sölden", label: "9" }),
  ]);

  it("liczy X jako część wspólną przejechanych z uniwersum", () => {
    const coverage = routeCoverage([run(localDayKey(dayAgo(5)), ["Sölden::15", "Sölden::Nieistnieje"])], data, NOW);
    expect(coverage.total).toBe(3);
    expect(coverage.visitedCount).toBe(1);
    expect([...coverage.visited]).toEqual(["Sölden::15"]);
  });

  it("pomija zjazdy starsze niż okno", () => {
    const coverage = routeCoverage([run(localDayKey(dayAgo(60)), ["Sölden::15"])], data, NOW);
    expect(coverage.visitedCount).toBe(0);
  });

  it("liczy zjazd demo (świeży dzień) jak normalny przejazd", () => {
    const coverage = routeCoverage([run(localDayKey(dayAgo(0)), ["Sölden::8"])], data, NOW);
    expect(coverage.visitedCount).toBe(1);
    expect(coverage.visited.has("Sölden::8")).toBe(true);
  });

  it("Y to liczba tras w uniwersum (bez wyciągów i polygonów)", () => {
    const coverage = routeCoverage([], data, NOW);
    expect(coverage.total).toBe(3);
    expect(coverage.visitedCount).toBe(0);
  });
});
