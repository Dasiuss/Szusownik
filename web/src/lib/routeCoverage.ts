// Pokrycie tras: które trasy OSM zostały już przejechane (w oknie czasu).
// Czysta logika: bez sieci, bez IndexedDB, bez DOM — testowalna hostowo.
//
// Uniwersum tras to trasy-pisty z geometrią liniową (dokładnie te, które widzi
// map-matching). Trasy zamknięte (polygon) są pomijane, bo obecny matcher ich
// nie dopasuje, więc zawsze byłyby „nieodwiedzone". Tożsamość trasy jest ta
// sama co przy dopasowaniu zjazdów (`routeKeyFor`): grupa OSM po `site + label`,
// a odcinki bez nazwy osobno per `uid`. Szczegóły: docs/mapy-routing.md §9.

import { localDayKey } from "./runs.ts";
import { routeKeyFor, type RouteSpan } from "./routeMatching.ts";
import type { SkiData } from "./mapData.ts";

/** Okno „przejechane": zjazdy z ostatnich ~30 dni (po lokalnym dniu telefonu). */
export const COVERAGE_WINDOW_DAYS = 30;

/** Minimalny kształt zjazdu potrzebny do policzenia pokrycia. */
export interface CoverageRun {
  dayKey: string;
  routeSpans: RouteSpan[];
}

export interface RouteCoverage {
  /** uid elementu OSM (trasy liniowej) -> klucz trasy. */
  keyByUid: Map<string, string>;
  /** Klucze tras w uniwersum (trasy-pisty liniowe). */
  universe: Set<string>;
  /** Przejechane klucze tras: okno + część wspólna z uniwersum. */
  visited: Set<string>;
  /** X: liczba przejechanych tras z uniwersum. */
  visitedCount: number;
  /** Y: liczba tras w uniwersum. */
  total: number;
}

/** Lokalny dzień graniczny okna: „teraz" minus 30 dni. */
export function coverageCutoffDayKey(nowMs: number): string {
  return localDayKey(new Date(nowMs - COVERAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString());
}

/** Trasy-pisty z geometrią liniową: klucze uniwersum i mapowanie uid -> klucz. */
export function routeUniverse(data: SkiData): { universe: Set<string>; keyByUid: Map<string, string> } {
  const universe = new Set<string>();
  const keyByUid = new Map<string, string>();
  for (const feature of data.lines) {
    if (feature.properties.routeKind !== "piste") continue;
    const key = routeKeyFor(feature.properties);
    universe.add(key);
    keyByUid.set(feature.properties.uid, key);
  }
  return { universe, keyByUid };
}

/**
 * Klucze tras przejechanych w oknie: unia `routeSpans` zjazdów z ostatnich
 * ~30 dni. Porównanie dni jest tekstowe (ISO `YYYY-MM-DD`), więc dzień równy
 * granicy liczy się jako w oknie. Nie tniemy tu jeszcze do uniwersum.
 */
export function visitedRouteKeys(runs: CoverageRun[], cutoffDayKey: string): Set<string> {
  const visited = new Set<string>();
  for (const run of runs) {
    if (run.dayKey < cutoffDayKey) continue;
    for (const span of run.routeSpans) visited.add(span.routeKey);
  }
  return visited;
}

/**
 * Pokrycie tras: ile tras z uniwersum zostało przejechanych w oknie.
 * `visitedCount` (X) liczy tylko klucze obecne w uniwersum, więc trasa, której
 * nie ma już w danych OSM (zmiana nazwy/geometrii), nie zawyża licznika.
 */
export function routeCoverage(runs: CoverageRun[], data: SkiData, nowMs: number): RouteCoverage {
  const { universe, keyByUid } = routeUniverse(data);
  const reached = visitedRouteKeys(runs, coverageCutoffDayKey(nowMs));
  const visited = new Set([...reached].filter((key) => universe.has(key)));
  return { keyByUid, universe, visited, visitedCount: visited.size, total: universe.size };
}
