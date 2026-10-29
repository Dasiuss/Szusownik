// Przycinanie kafelków wektorowych (MVT) do bboxa mapy.
//
// Poziomice: maplibre-contour generuje geometrię z kafelka DEM, który przy
// niskich zoomach obejmuje teren dużo większy niż bbox (z8 to ~1,4° szerokości).
// Podkład: `pmtiles extract --bbox` przycina do całych kafelków, więc geometria
// wystaje poza obszar przy każdej krawędzi.
//
// Przycinamy w locie, po zdekodowaniu kafelka, jeszcze przed oddaniem go do
// MapLibre. Dzięki temu podkład i poziomice kończą się dokładnie na bboxie.

import { VectorTile } from "@mapbox/vector-tile";
import { fromGeojsonVt } from "@maplibre/vt-pbf";
import { PbfReader } from "pbf";

export interface TileRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

type Point = [number, number];

const EXTENT = 4096;

const lonToTileX = (lon: number, z: number): number => ((lon + 180) / 360) * 2 ** z;
const latToTileY = (lat: number, z: number): number => {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
};
const clamp = (value: number): number => Math.min(EXTENT, Math.max(0, value));

/** Prostokąt bboxa we współrzędnych kafelka (0..4096, oś Y w dół). */
export function tileRect(z: number, x: number, y: number, bounds: [number, number, number, number]): TileRect {
  const [west, south, east, north] = bounds;
  return {
    minX: clamp((lonToTileX(west, z) - x) * EXTENT),
    maxX: clamp((lonToTileX(east, z) - x) * EXTENT),
    minY: clamp((latToTileY(north, z) - y) * EXTENT),
    maxY: clamp((latToTileY(south, z) - y) * EXTENT),
  };
}

export function isEmptyRect(rect: TileRect): boolean {
  return rect.maxX <= rect.minX || rect.maxY <= rect.minY;
}

/** Odcina odcinek do prostokąta (Liang–Barsky). Null, gdy odcinek jest poza. */
function clipSegment(x0: number, y0: number, x1: number, y1: number, rect: TileRect): Point[] | null {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - rect.minX, rect.maxX - x0, y0 - rect.minY, rect.maxY - y0];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i += 1) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
      continue;
    }
    const r = q[i] / p[i];
    if (p[i] < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [
    [x0 + t0 * dx, y0 + t0 * dy],
    [x0 + t1 * dx, y0 + t1 * dy],
  ];
}

/** Przycina polilinię do prostokąta, zwracając ciągłe fragmenty. */
export function clipLineToRect(line: Point[], rect: TileRect): Point[][] {
  const parts: Point[][] = [];
  let current: Point[] | null = null;
  for (let i = 0; i < line.length - 1; i += 1) {
    const [x0, y0] = line[i];
    const [x1, y1] = line[i + 1];
    const segment = clipSegment(x0, y0, x1, y1, rect);
    if (!segment) {
      current = null;
      continue;
    }
    const [start, end] = segment;
    const continues = current !== null
      && Math.abs(current[current.length - 1][0] - start[0]) < 1e-6
      && Math.abs(current[current.length - 1][1] - start[1]) < 1e-6;
    let part: Point[];
    if (continues && current !== null) {
      part = current;
    } else {
      part = [start];
      current = part;
      parts.push(part);
    }
    // Przy kontynuacji `part` już kończy się w `start`, więc nie dublujemy
    // wierzchołka (zerowe odcinki psułyby geometrię i powiększały dane).
    part.push(end);
    // Segment skończył się na wierzchołku? Jeśli nie, linia opuściła prostokąt.
    if (Math.abs(end[0] - x1) > 1e-6 || Math.abs(end[1] - y1) > 1e-6) current = null;
  }
  return parts;
}

const EDGE_TOP = 0;
const EDGE_RIGHT = 1;
const EDGE_BOTTOM = 2;
const EDGE_LEFT = 3;

const isInside = ([x, y]: Point, edge: number, rect: TileRect): boolean => {
  switch (edge) {
    case EDGE_TOP:
      return y >= rect.minY;
    case EDGE_RIGHT:
      return x <= rect.maxX;
    case EDGE_BOTTOM:
      return y <= rect.maxY;
    default:
      return x >= rect.minX;
  }
};

const intersect = (a: Point, b: Point, edge: number, rect: TileRect): Point => {
  const [x0, y0] = a;
  const [x1, y1] = b;
  if (edge === EDGE_TOP || edge === EDGE_BOTTOM) {
    const y = edge === EDGE_TOP ? rect.minY : rect.maxY;
    const t = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
    return [x0 + t * (x1 - x0), y];
  }
  const x = edge === EDGE_LEFT ? rect.minX : rect.maxX;
  const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
  return [x, y0 + t * (y1 - y0)];
};

/** Przycina pierścień/poligon do prostokąta (Sutherland–Hodgman). */
export function clipRingToRect(ring: Point[], rect: TileRect): Point[] {
  let output = ring;
  for (const edge of [EDGE_TOP, EDGE_RIGHT, EDGE_BOTTOM, EDGE_LEFT]) {
    const input = output;
    output = [];
    for (let i = 0; i < input.length; i += 1) {
      const current = input[i];
      const previous = input[(i + input.length - 1) % input.length];
      const currentInside = isInside(current, edge, rect);
      const previousInside = isInside(previous, edge, rect);
      if (currentInside) {
        if (!previousInside) output.push(intersect(previous, current, edge, rect));
        output.push(current);
      } else if (previousInside) {
        output.push(intersect(previous, current, edge, rect));
      }
    }
    if (output.length === 0) return [];
  }
  return output;
}

const inside = ([x, y]: Point, rect: TileRect): boolean =>
  x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY;

/**
 * Przycina kafelek wektorowy (dowolne warstwy i typy geometrii) do bboxa.
 * Zwraca pusty bufor, gdy kafelek nie przecina obszaru.
 */
export function clipVectorTile(
  data: ArrayBuffer,
  z: number,
  x: number,
  y: number,
  bounds: [number, number, number, number],
): ArrayBuffer {
  const rect = tileRect(z, x, y, bounds);
  if (isEmptyRect(rect)) return new ArrayBuffer(0);
  // Kafelek w całości wewnątrz bboxa — nic do przycinania, oddajemy oryginał.
  // Dzięki temu przetwarzane są tylko kafelki na krawędzi obszaru.
  if (rect.minX <= 0 && rect.minY <= 0 && rect.maxX >= EXTENT && rect.maxY >= EXTENT) return data;

  const source = new VectorTile(new PbfReader(new Uint8Array(data)));
  const layers: Record<string, { features: unknown[] }> = {};
  for (const [name, layer] of Object.entries(source.layers)) {
    const scale = EXTENT / layer.extent;
    const features: unknown[] = [];
    for (let index = 0; index < layer.length; index += 1) {
      const feature = layer.feature(index);
      const rings = feature
        .loadGeometry()
        .map((ring: { x: number; y: number }[]) => ring.map((point): Point => [point.x * scale, point.y * scale]));
      let geometry: Point[][] = [];
      if (feature.type === 1) {
        const point = rings[0]?.[0];
        if (point && inside(point, rect)) geometry = [[point]];
      } else if (feature.type === 2) {
        geometry = rings.flatMap((ring) => clipLineToRect(ring, rect)).filter((part) => part.length >= 2);
      } else if (feature.type === 3) {
        geometry = rings
          .map((ring) => clipRingToRect(ring, rect))
          .filter((ring) => ring.length >= 3);
      }
      if (geometry.length === 0) continue;
      features.push({
        geometry,
        type: feature.type,
        tags: feature.properties,
        id: feature.id,
      });
    }
    if (features.length > 0) layers[name] = { features };
  }

  if (Object.keys(layers).length === 0) return new ArrayBuffer(0);
  const encoded = fromGeojsonVt(layers as never, { extent: EXTENT, version: 2 });
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
}
