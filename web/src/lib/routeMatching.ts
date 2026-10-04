// Dopasowanie śladu zjazdu do tras OSM (map-matching uproszczony).
// Czysta logika: bez sieci, bez IndexedDB, bez DOM — testowalna hostowo.
//
// Model: bierzemy schodzącą część zjazdu (od najwyższego punktu w dół),
// przypisujemy każdą próbkę do najbliższej trasy w promieniu ~50 m, scalmy
// krótkie przebitki, a trasę zaliczamy dopiero po przejechaniu wzdłuż niej
// min. 100 m. Wynikiem są odcinki (spany) tras i sekwencja tras zjazdu.
// Szczegóły: docs/mapy-routing.md §9 i docs/wymagania-PWA.md §6.

import { haversineM } from "./geo.ts";
import type { EnrichedSample } from "./runs.ts";
import type { Position, SkiLineFeature, SkiProperties } from "./mapData.ts";

/** Promień dopasowania próbki do geometrii trasy. */
export const ROUTE_MATCH_RADIUS_M = 50;
/** Minimalny dystans wzdłuż trasy, żeby ją zaliczyć. */
export const MIN_ROUTE_DISTANCE_M = 100;
/** Krótsza przerwa w dopasowaniu (po śladzie) jest scalana z sąsiadami. */
export const ROUTE_MATCH_MERGE_M = 60;

const METERS_PER_DEGREE = 111320;
const UNNAMED_LABEL = "Bez nazwy";

type BBox = [number, number, number, number];

export interface RouteSequenceItem {
  key: string;
  label: string;
  difficulty: string;
}

export interface RouteSpan {
  routeKey: string;
  label: string;
  difficulty: string;
  startT: string;
  endT: string;
  /** Dystans przejechany wzdłuż geometrii trasy. */
  distanceM: number;
  durationS: number;
  maxSpeed: number;
}

export interface RunRouteMatch {
  spans: RouteSpan[];
  sequence: RouteSequenceItem[];
  /** Nazwa auto, np. "15 → 8"; null, gdy brak dopasowania. */
  routeName: string | null;
}

/** Zapisane przypisanie zjazdu do tras (do dalszych statystyk). */
export interface RunRouteRecord {
  id: string;
  startT: string;
  routeSpans: RouteSpan[];
  routeSequence: RouteSequenceItem[];
}

export interface PreviousRide {
  runId: string;
  startT: string;
  maxSpeed: number;
  durationS: number;
  distanceM: number;
}

export interface RouteHistoryGroup {
  route: RouteSequenceItem;
  rideCount: number;
  bestDurationS: number | null;
  maxSpeed: number;
  rides: PreviousRide[];
}

/** Stabilna tożsamość trasy: grupa OSM po `site + label`, bez nazwy osobno per uid. */
export function routeKeyFor(properties: SkiProperties): string {
  const label = properties.label.trim() || properties.name.trim();
  if (label) return `${properties.site ?? ""}::${label}`;
  return `uid:${properties.uid}`;
}

export function routeLabelFor(properties: SkiProperties): string {
  return properties.label.trim() || properties.name.trim() || UNNAMED_LABEL;
}

interface Segment {
  start: Position;
  end: Position;
  location: number;
  bbox: BBox;
}

interface PisteEntry {
  key: string;
  label: string;
  difficulty: string;
  segments: Segment[];
  bbox: BBox;
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function longitudeScale(latitude: number): number {
  return METERS_PER_DEGREE * Math.max(Math.cos(toRadians(latitude)), 0.1);
}

function coordinateDistance(a: Position, b: Position): number {
  const latitude = (a[1] + b[1]) / 2;
  const x = (b[0] - a[0]) * longitudeScale(latitude);
  const y = (b[1] - a[1]) * METERS_PER_DEGREE;
  return Math.hypot(x, y);
}

function buildIndex(features: SkiLineFeature[]): PisteEntry[] {
  const entries: PisteEntry[] = [];
  for (const feature of features) {
    if (feature.properties.routeKind !== "piste") continue;
    if (feature.geometry.type !== "LineString" || feature.geometry.coordinates.length < 2) continue;
    const coordinates = feature.geometry.coordinates;
    const segments: Segment[] = [];
    let location = 0;
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (let index = 0; index < coordinates.length; index += 1) {
      const coordinate = coordinates[index];
      west = Math.min(west, coordinate[0]);
      south = Math.min(south, coordinate[1]);
      east = Math.max(east, coordinate[0]);
      north = Math.max(north, coordinate[1]);
      if (index === 0) continue;
      const start = coordinates[index - 1];
      const length = coordinateDistance(start, coordinate);
      segments.push({
        start,
        end: coordinate,
        location,
        bbox: [
          Math.min(start[0], coordinate[0]),
          Math.min(start[1], coordinate[1]),
          Math.max(start[0], coordinate[0]),
          Math.max(start[1], coordinate[1]),
        ],
      });
      location += length;
    }
    if (location <= 0) continue;
    entries.push({
      key: routeKeyFor(feature.properties),
      label: routeLabelFor(feature.properties),
      difficulty: feature.properties.difficulty,
      segments,
      bbox: [west, south, east, north],
    });
  }
  return entries;
}

interface NearestMatch {
  key: string;
  location: number;
  distance: number;
}

function withinBBox(entry: PisteEntry, longitude: number, latitude: number, radius: number): boolean {
  const latitudeRadius = radius / METERS_PER_DEGREE;
  const longitudeRadius = radius / longitudeScale(latitude);
  return (
    longitude >= entry.bbox[0] - longitudeRadius &&
    longitude <= entry.bbox[2] + longitudeRadius &&
    latitude >= entry.bbox[1] - latitudeRadius &&
    latitude <= entry.bbox[3] + latitudeRadius
  );
}

function projectOnEntry(entry: PisteEntry, longitude: number, latitude: number): { distance: number; location: number } {
  const lngScale = longitudeScale(latitude);
  let bestDistanceSquared = Infinity;
  let bestLocation = 0;
  for (const segment of entry.segments) {
    const ax = (segment.start[0] - longitude) * lngScale;
    const ay = (segment.start[1] - latitude) * METERS_PER_DEGREE;
    const bx = (segment.end[0] - longitude) * lngScale;
    const by = (segment.end[1] - latitude) * METERS_PER_DEGREE;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const projection = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
    const closestX = ax + dx * projection;
    const closestY = ay + dy * projection;
    const distanceSquared = closestX * closestX + closestY * closestY;
    if (distanceSquared < bestDistanceSquared) {
      bestDistanceSquared = distanceSquared;
      const segmentLength = Math.hypot(
        (segment.end[0] - segment.start[0]) * lngScale,
        (segment.end[1] - segment.start[1]) * METERS_PER_DEGREE,
      );
      bestLocation = segment.location + segmentLength * projection;
    }
  }
  return { distance: Math.sqrt(bestDistanceSquared), location: bestLocation };
}

function nearestMatch(entries: PisteEntry[], longitude: number, latitude: number, radius: number): NearestMatch | null {
  let best: NearestMatch | null = null;
  for (const entry of entries) {
    if (!withinBBox(entry, longitude, latitude, radius)) continue;
    const projection = projectOnEntry(entry, longitude, latitude);
    if (projection.distance > radius) continue;
    if (!best || projection.distance < best.distance) {
      best = { key: entry.key, location: projection.location, distance: projection.distance };
    }
  }
  return best;
}

function peakIndex(samples: EnrichedSample[]): number {
  let peak = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if (samples[index].altSm > samples[peak].altSm) peak = index;
  }
  return peak;
}

interface Group {
  key: string | null;
  start: number;
  end: number; // wyłączny
}

function traceLength(samples: EnrichedSample[], group: Group): number {
  let length = 0;
  for (let index = group.start + 1; index < group.end; index += 1) {
    length += haversineM(
      samples[index - 1].lat, samples[index - 1].lon,
      samples[index].lat, samples[index].lon,
    );
  }
  return length;
}

function alongDistance(keys: Array<string | null>, locations: number[], group: Group): number {
  let distance = 0;
  for (let index = group.start + 1; index < group.end; index += 1) {
    // Po scaleniu grupa może zawierać obce próbki (przebitki) — liczymy tylko
    // przejścia wewnątrz tej samej trasy.
    if (keys[index] !== group.key || keys[index - 1] !== group.key) continue;
    distance += Math.abs(locations[index] - locations[index - 1]);
  }
  return distance;
}

/** Scala krótkie przerwy (po śladzie) rozdzielające ten sam fragment trasy. */
function mergeShortGroups(groups: Group[], samples: EnrichedSample[]): Group[] {
  const merged = groups.slice();
  let changed = true;
  while (changed && merged.length >= 3) {
    changed = false;
    for (let index = 1; index < merged.length - 1; index += 1) {
      const previous = merged[index - 1];
      const current = merged[index];
      const next = merged[index + 1];
      if (current.key === previous.key || previous.key !== next.key || previous.key === null) continue;
      if (traceLength(samples, current) >= ROUTE_MATCH_MERGE_M) continue;
      merged.splice(index - 1, 3, { key: previous.key, start: previous.start, end: next.end });
      changed = true;
      break;
    }
  }
  return merged;
}

function emptyMatch(): RunRouteMatch {
  return { spans: [], sequence: [], routeName: null };
}

/**
 * Dopasowuje zjazd do tras. Bierze schodzącą część śladu (od najwyższego
 * punktu w dół), więc jazda wyciągiem nie trafia do tras. Zwraca puste
 * dopasowanie, gdy nie ma tras albo śladu.
 */
export function matchRunRoutes(pistes: SkiLineFeature[], samples: EnrichedSample[]): RunRouteMatch {
  if (samples.length < 2) return emptyMatch();
  const entries = buildIndex(pistes);
  if (entries.length === 0) return emptyMatch();

  const start = peakIndex(samples);
  const meta = new Map<string, { label: string; difficulty: string }>();
  for (const entry of entries) if (!meta.has(entry.key)) meta.set(entry.key, { label: entry.label, difficulty: entry.difficulty });

  const keys: Array<string | null> = [];
  const locations: number[] = [];
  for (let index = start; index < samples.length; index += 1) {
    const match = nearestMatch(entries, samples[index].lon, samples[index].lat, ROUTE_MATCH_RADIUS_M);
    keys.push(match?.key ?? null);
    locations.push(match?.location ?? 0);
  }
  if (keys.length < 2) return emptyMatch();

  const groups: Group[] = [];
  for (let index = 0; index < keys.length; index += 1) {
    const last = groups[groups.length - 1];
    if (last && last.key === keys[index]) last.end = index + 1;
    else groups.push({ key: keys[index], start: index, end: index + 1 });
  }

  const merged = mergeShortGroups(groups, samples);

  const spans: RouteSpan[] = [];
  for (const group of merged) {
    if (group.key === null) continue;
    const distanceM = alongDistance(keys, locations, group);
    if (distanceM < MIN_ROUTE_DISTANCE_M) continue;
    const info = meta.get(group.key) ?? { label: UNNAMED_LABEL, difficulty: "unknown" };
    let maxSpeed = -Infinity;
    for (let index = group.start; index < group.end; index += 1) {
      maxSpeed = Math.max(maxSpeed, samples[index].speed);
    }
    const startSample = samples[start + group.start];
    const endSample = samples[start + group.end - 1];
    spans.push({
      routeKey: group.key,
      label: info.label,
      difficulty: info.difficulty,
      startT: startSample.t,
      endT: endSample.t,
      distanceM,
      durationS: Math.max(0, (Date.parse(endSample.t) - Date.parse(startSample.t)) / 1000),
      maxSpeed: Number.isFinite(maxSpeed) ? maxSpeed : 0,
    });
  }

  const sequence: RouteSequenceItem[] = [];
  for (const span of spans) {
    const last = sequence[sequence.length - 1];
    if (last && last.key === span.routeKey) continue;
    sequence.push({ key: span.routeKey, label: span.label, difficulty: span.difficulty });
  }

  return {
    spans,
    sequence,
    routeName: sequence.length > 0 ? sequence.map((item) => item.label).join(" → ") : null,
  };
}

/** Klucz grupowania „ta sama sekwencja tras". */
export function routeSequenceKey(sequence: RouteSequenceItem[]): string {
  return sequence.map((item) => item.key).join(">");
}

function sequenceDuration(record: RunRouteRecord): number {
  const { routeSpans } = record;
  if (routeSpans.length === 0) return 0;
  const first = routeSpans[0];
  const last = routeSpans[routeSpans.length - 1];
  return Math.max(0, (Date.parse(last.endT) - Date.parse(first.startT)) / 1000);
}

function sequenceMaxSpeed(record: RunRouteRecord): number {
  return record.routeSpans.reduce((max, span) => Math.max(max, span.maxSpeed), 0);
}

function sequenceDistance(record: RunRouteRecord): number {
  return record.routeSpans.reduce((sum, span) => sum + span.distanceM, 0);
}

/** Poprzednie przejazdy o tej samej sekwencji tras (bez bieżącego), od najnowszego. */
export function previousRidesForSequence(
  records: RunRouteRecord[],
  sequence: RouteSequenceItem[],
  currentId: string,
): PreviousRide[] {
  if (sequence.length === 0) return [];
  const key = routeSequenceKey(sequence);
  return records
    .filter((record) =>
      record.id !== currentId &&
      record.routeSpans.length > 0 &&
      routeSequenceKey(record.routeSequence) === key,
    )
    .map((record) => ({
      runId: record.id,
      startT: record.startT,
      maxSpeed: sequenceMaxSpeed(record),
      durationS: sequenceDuration(record),
      distanceM: sequenceDistance(record),
    }))
    .sort((first, second) => Date.parse(second.startT) - Date.parse(first.startT));
}

/**
 * Historia per trasa dla tras bieżącego zjazdu: ile razy, najlepszy czas
 * odcinka i max prędkość. Per zjazd bierzemy najdłuższy odcinek danej trasy.
 */
export function routeHistories(
  records: RunRouteRecord[],
  routes: RouteSequenceItem[],
  currentId: string,
): RouteHistoryGroup[] {
  const unique = [...new Map(routes.map((route) => [route.key, route])).values()];
  return unique.map((route) => {
    const representatives: Array<{ record: RunRouteRecord; span: RouteSpan }> = [];
    for (const record of records) {
      if (record.id === currentId) continue;
      const spans = record.routeSpans.filter((span) => span.routeKey === route.key);
      if (spans.length === 0) continue;
      const span = spans.reduce((longest, candidate) => candidate.distanceM > longest.distanceM ? candidate : longest);
      representatives.push({ record, span });
    }
    representatives.sort((first, second) => Date.parse(second.record.startT) - Date.parse(first.record.startT));
    return {
      route,
      rideCount: representatives.length,
      bestDurationS: representatives.length > 0
        ? Math.min(...representatives.map(({ span }) => span.durationS))
        : null,
      maxSpeed: representatives.reduce((max, { span }) => Math.max(max, span.maxSpeed), 0),
      rides: representatives.map(({ record, span }) => ({
        runId: record.id,
        startT: record.startT,
        maxSpeed: span.maxSpeed,
        durationS: span.durationS,
        distanceM: span.distanceM,
      })),
    };
  });
}
