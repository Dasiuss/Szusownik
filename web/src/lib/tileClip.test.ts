// Przycinanie kafelków wektorowych (poziomice i podkład) do bboxa.
//
// Bez tego geometria wystaje poza obszar: kafelek DEM na niskim zoomie obejmuje
// ~1,4° szerokości, a `pmtiles extract --bbox` przycina tylko do całych
// kafelków. Clip działa na współrzędnych kafelka (0..4096).

import { VectorTile } from "@mapbox/vector-tile";
import { fromGeojsonVt } from "@maplibre/vt-pbf";
import { PbfReader } from "pbf";
import { describe, expect, it } from "vitest";
import {
  clipLineToRect,
  clipRingToRect,
  clipVectorTile,
  isEmptyRect,
  tileRect,
} from "./tileClip.ts";

const BOUNDS: [number, number, number, number] = [10.905, 46.886957, 11.028039, 46.999242];
const EXTENT = 4096;
// z13: bbox obejmuje x 4344–4346, y 2881–2885. (4345, 2883) leży w całości
// w środku, (4346, 2883) jest kafelkiem krawędziowym.
const INSIDE_TILE = { z: 13, x: 4345, y: 2883 };
const EDGE_TILE = { z: 13, x: 4346, y: 2883 };

type Point = [number, number];

function encodeTile(
  layers: Record<string, { type: 1 | 2 | 3; geometry: Point[][] | Point[]; tags: Record<string, number | string> }[]>,
): ArrayBuffer {
  const features = Object.fromEntries(
    Object.entries(layers).map(([name, list]) => [
      name,
      { features: list.map((item) => ({ type: item.type, geometry: item.geometry, tags: item.tags, id: 1 })) },
    ]),
  );
  const encoded = fromGeojsonVt(features as never, { extent: EXTENT, version: 2 });
  return encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
}

function decode(data: ArrayBuffer): VectorTile {
  return new VectorTile(new PbfReader(new Uint8Array(data)));
}

describe("tileRect", () => {
  it("kafelek wewnątrz bboxa daje pełny prostokąt", () => {
    expect(tileRect(INSIDE_TILE.z, INSIDE_TILE.x, INSIDE_TILE.y, BOUNDS)).toEqual({
      minX: 0,
      minY: 0,
      maxX: EXTENT,
      maxY: EXTENT,
    });
  });

  it("kafelek krawędziowy jest przycięty", () => {
    const rect = tileRect(EDGE_TILE.z, EDGE_TILE.x, EDGE_TILE.y, BOUNDS);
    expect(rect.minX).toBe(0);
    expect(rect.maxX).toBeGreaterThan(0);
    expect(rect.maxX).toBeLessThan(EXTENT);
    expect(isEmptyRect(rect)).toBe(false);
  });

  it("kafelek poza bboxem daje pusty prostokąt", () => {
    expect(isEmptyRect(tileRect(13, 1, 1, BOUNDS))).toBe(true);
  });
});

describe("clipLineToRect", () => {
  const rect = { minX: 100, minY: 100, maxX: 200, maxY: 200 };

  it("przecina linię do wnętrza prostokąta", () => {
    expect(clipLineToRect([[0, 150], [300, 150]], rect)).toEqual([[[100, 150], [200, 150]]]);
  });

  it("dzieli linię wychodzącą i wracającą do prostokąta", () => {
    const parts = clipLineToRect([[0, 150], [150, 150], [150, 300], [150, 150], [300, 150]], rect);
    expect(parts).toHaveLength(2);
    for (const part of parts) {
      for (const [x, y] of part) {
        expect(x).toBeGreaterThanOrEqual(99.999);
        expect(x).toBeLessThanOrEqual(200.001);
        expect(y).toBeGreaterThanOrEqual(99.999);
        expect(y).toBeLessThanOrEqual(200.001);
      }
    }
  });

  it("pomija linię całkowicie poza prostokątem", () => {
    expect(clipLineToRect([[0, 0], [50, 50]], rect)).toEqual([]);
  });
});

describe("clipRingToRect", () => {
  const rect = { minX: 100, minY: 100, maxX: 200, maxY: 200 };

  it("przycina kwadrat większy od prostokąta do samego prostokąta", () => {
    const clipped = clipRingToRect([[0, 0], [300, 0], [300, 300], [0, 300], [0, 0]], rect);
    const xs = clipped.map(([x]) => x);
    const ys = clipped.map(([, y]) => y);
    expect(Math.min(...xs)).toBe(100);
    expect(Math.max(...xs)).toBe(200);
    expect(Math.min(...ys)).toBe(100);
    expect(Math.max(...ys)).toBe(200);
  });

  it("pomija pierścień całkowicie poza prostokątem", () => {
    expect(clipRingToRect([[0, 0], [50, 0], [50, 50], [0, 0]], rect)).toEqual([]);
  });
});

describe("clipVectorTile", () => {
  it("zostawia tylko geometrię wewnątrz bboxa i zachowuje właściwości", () => {
    const rect = tileRect(EDGE_TILE.z, EDGE_TILE.x, EDGE_TILE.y, BOUNDS);
    const insideX = Math.round((rect.minX + rect.maxX) / 2);
    const outsideX = Math.min(EXTENT - 10, Math.round(rect.maxX + 200));

    const tile = encodeTile({
      contours: [
        { type: 2, geometry: [[[insideX, 0], [insideX, EXTENT]]], tags: { ele: 2000, level: 1 } },
        { type: 2, geometry: [[[outsideX, 0], [outsideX, EXTENT]]], tags: { ele: 2100, level: 1 } },
      ],
      roads: [
        { type: 2, geometry: [[[0, 10], [EXTENT, 10]]], tags: { kind: "road" } },
      ],
      pois: [
        { type: 1, geometry: [[insideX, 20]], tags: { name: "w środku" } },
        { type: 1, geometry: [[outsideX, 20]], tags: { name: "poza" } },
      ],
      water: [
        { type: 3, geometry: [[[0, 0], [EXTENT, 0], [EXTENT, EXTENT], [0, EXTENT], [0, 0]]], tags: { kind: "water" } },
      ],
    });

    const result = decode(clipVectorTile(tile, EDGE_TILE.z, EDGE_TILE.x, EDGE_TILE.y, BOUNDS));

    for (const ring of result.layers.contours.feature(0).loadGeometry()) {
      for (const point of ring) {
        expect(point.x).toBeGreaterThanOrEqual(rect.minX - 1);
        expect(point.x).toBeLessThanOrEqual(rect.maxX + 1);
      }
    }
    expect(result.layers.contours.length).toBe(1);
    expect(result.layers.contours.feature(0).properties.ele).toBe(2000);
    // Punkty: zostaje tylko ten w obszarze.
    expect(result.layers.pois.length).toBe(1);
    expect(result.layers.pois.feature(0).properties.name).toBe("w środku");
    // Poligony: przycięte do krawędzi kafelka, nie poza nią.
    for (const ring of result.layers.water.feature(0).loadGeometry()) {
      for (const point of ring) {
        expect(point.x).toBeLessThanOrEqual(rect.maxX + 1);
      }
    }
  });

  it("kafelek całkowicie poza bboxem daje pusty kafelek", () => {
    const tile = encodeTile({ contours: [{ type: 2, geometry: [[[10, 10], [20, 20]]], tags: { ele: 2000 } }] });
    expect(clipVectorTile(tile, 13, 1, 1, BOUNDS).byteLength).toBe(0);
  });
});
