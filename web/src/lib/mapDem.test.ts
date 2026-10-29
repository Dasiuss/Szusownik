// Pilnuje, żeby DEM miał komplet sąsiadów wokół obszaru danych (z10+).
//
// maplibre-contour generuje kafelek poziomic z 3×3 kafelków DEM. Brak
// któregokolwiek sąsiada wywala CAŁY kafelek („source image could not be
// decoded") i w środku obszaru powstaje dziura w poziomicach. Dlatego
// `scripts/build-map-assets.mjs` dokłada wokół bboxa pierścień „pustych"
// kafelków (biały PNG = brak danych, więc nie rysuje poziomic poza bboxem).

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SOLDEN_BOUNDS } from "./mapData.ts";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEM = path.join(WEB_ROOT, "public", "dem");
// Od tego zoomu poziomice są generowane, więc sąsiedzi muszą istnieć.
const MIN_CONTOUR_ZOOM = 10;
const MAX_CONTOUR_ZOOM = 13;

const lon2tile = (lon: number, z: number): number => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2tile = (lat: number, z: number): number => {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
};

const hasTile = (z: number, x: number, y: number): boolean =>
  existsSync(path.join(DEM, String(z), String(x), `${y}.png`));

describe("DEM dla poziomic", () => {
  it("każdy kafelek obszaru z10+ ma komplet 8 sąsiadów", () => {
    const [west, south, east, north] = SOLDEN_BOUNDS;
    const missing: string[] = [];
    for (let z = MIN_CONTOUR_ZOOM; z <= MAX_CONTOUR_ZOOM; z += 1) {
      const max = 2 ** z - 1;
      const x0 = lon2tile(west, z);
      const x1 = lon2tile(east, z);
      const y0 = lat2tile(north, z);
      const y1 = lat2tile(south, z);
      for (let x = x0; x <= x1; x += 1) {
        for (let y = y0; y <= y1; y += 1) {
          if (!hasTile(z, x, y)) missing.push(`z${z}/${x}/${y}`);
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              if (dx === 0 && dy === 0) continue;
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx > max || ny > max) continue;
              if (!hasTile(z, nx, ny)) missing.push(`z${z}/${nx}/${ny}`);
            }
          }
        }
      }
    }
    expect([...new Set(missing)].sort()).toEqual([]);
  });
});
