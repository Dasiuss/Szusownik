// Przygotowanie śladu GPS do mini-mapy 2D: pomijanie (i przerywanie na) złych
// współrzędnych, decymacja gęstych śladów, kolor linii wg prędkości oraz
// bounding box do dopasowania widoku. Czysta logika — bez DOM i MapLibre.

import type { Position } from "./mapData.ts";

/** Minimalny kształt próbki potrzebny mini-mapie (spełnia go `EnrichedSample`). */
export interface TracePoint {
  lat: number;
  lon: number;
  speedSm: number;
}

export interface SpeedColorStop {
  speed: number;
  color: string;
}

// Zielony (wolno) → niebieski → pomarańczowy → czerwony → ciemna czerwień
// (szybko). Wyciąg (~18 km/h) wypada na granicy zieleni i błękitu, jednolicie.
export const SPEED_COLOR_STOPS: SpeedColorStop[] = [
  { speed: 0, color: "#22c55e" },
  { speed: 30, color: "#3b82f6" },
  { speed: 60, color: "#f59e0b" },
  { speed: 85, color: "#ef4444" },
  { speed: 105, color: "#7f1d1d" },
];

export const DEFAULT_MAX_POINTS_PER_TRACE = 4000;
/** Szerokość przedziału prędkości, w którym scalamy odcinki w jedną linię. */
export const SPEED_BUCKET_KMH = 5;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function hexToRgb(hex: string): Rgb {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function toHex(channel: number): string {
  return Math.round(Math.max(0, Math.min(255, channel))).toString(16).padStart(2, "0");
}

function mix(a: string, b: string, ratio: number): string {
  const from = hexToRgb(a);
  const to = hexToRgb(b);
  return `#${toHex(from.r + (to.r - from.r) * ratio)}${toHex(from.g + (to.g - from.g) * ratio)}${toHex(from.b + (to.b - from.b) * ratio)}`;
}

/** Kolor śladu dla prędkości w km/h (interpolacja liniowa między progami). */
export function speedColor(speedKmh: number): string {
  const first = SPEED_COLOR_STOPS[0];
  const last = SPEED_COLOR_STOPS[SPEED_COLOR_STOPS.length - 1];
  if (speedKmh <= first.speed) return first.color;
  if (speedKmh >= last.speed) return last.color;
  for (let index = 1; index < SPEED_COLOR_STOPS.length; index += 1) {
    const previous = SPEED_COLOR_STOPS[index - 1];
    const current = SPEED_COLOR_STOPS[index];
    if (speedKmh <= current.speed) {
      const ratio = (speedKmh - previous.speed) / (current.speed - previous.speed);
      return mix(previous.color, current.color, ratio);
    }
  }
  return last.color;
}

export interface TraceFeature {
  type: "Feature";
  properties: { color: string; speed: number };
  geometry: { type: "LineString"; coordinates: Position[] };
}

export interface TraceCollection {
  type: "FeatureCollection";
  features: TraceFeature[];
}

export interface BuildTraceOptions {
  /** Limit punktów na pojedynczy ślad (decymacja równomierna, zachowuje końce). */
  maxPointsPerTrace?: number;
}

function isValidPoint(point: TracePoint): boolean {
  return Number.isFinite(point.lat) && Number.isFinite(point.lon);
}

/** Dzieli ślad na spójne odcinki poprawnych punktów (zły punkt przerywa ciąg). */
function validRuns(trace: TracePoint[]): TracePoint[][] {
  const runs: TracePoint[][] = [];
  let current: TracePoint[] = [];
  for (const point of trace) {
    if (isValidPoint(point)) {
      current.push(point);
    } else if (current.length > 0) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

function decimate(points: TracePoint[], maxPoints: number): TracePoint[] {
  if (points.length <= maxPoints || maxPoints < 2) return points;
  const stride = Math.max(1, Math.ceil((points.length - 1) / (maxPoints - 1)));
  const kept: TracePoint[] = [];
  for (let index = 0; index < points.length; index += stride) kept.push(points[index]);
  const last = points[points.length - 1];
  if (kept[kept.length - 1] !== last) kept.push(last);
  return kept;
}

function bucketIndex(speedKmh: number): number {
  return Math.max(0, Math.floor(speedKmh / SPEED_BUCKET_KMH));
}

function bucketSpeed(index: number): number {
  return index * SPEED_BUCKET_KMH + SPEED_BUCKET_KMH / 2;
}

/**
 * Buduje kolekcję linii śladu. Kolejne odcinki o tym samym przedziale
 * prędkości są scalane w jedną polilinię (mniej, dłuższych elementów), więc
 * ślad nie rozpada się na „fasolki" przy oddaleniu. Osobne ślady nie są łączone.
 */
export function buildTraceCollection(
  traces: TracePoint[][],
  options: BuildTraceOptions = {},
): TraceCollection {
  const maxPoints = options.maxPointsPerTrace ?? DEFAULT_MAX_POINTS_PER_TRACE;
  const features: TraceFeature[] = [];
  for (const trace of traces) {
    for (const run of validRuns(trace)) {
      const points = decimate(run, maxPoints);
      if (points.length < 2) continue;
      const buckets: number[] = [];
      for (let index = 1; index < points.length; index += 1) {
        buckets.push(bucketIndex((points[index - 1].speedSm + points[index].speedSm) / 2));
      }
      let start = 0;
      for (let index = 1; index <= buckets.length; index += 1) {
        if (index < buckets.length && buckets[index] === buckets[start]) continue;
        const speed = bucketSpeed(buckets[start]);
        features.push({
          type: "Feature",
          properties: { color: speedColor(speed), speed },
          geometry: {
            type: "LineString",
            coordinates: points.slice(start, index + 1).map((point) => [point.lon, point.lat]),
          },
        });
        start = index;
      }
    }
  }
  return { type: "FeatureCollection", features };
}

/** Bounding box wszystkich śladów jako [[zachód, południe], [wschód, północ]]. */
export function traceBounds(traces: TracePoint[][]): [Position, Position] | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const trace of traces) {
    for (const point of trace) {
      if (!isValidPoint(point)) continue;
      west = Math.min(west, point.lon);
      south = Math.min(south, point.lat);
      east = Math.max(east, point.lon);
      north = Math.max(north, point.lat);
    }
  }
  if (!Number.isFinite(west)) return null;
  return [
    [west, south],
    [east, north],
  ];
}
