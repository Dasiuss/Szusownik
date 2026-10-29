// Pilnuje zawartości snapshotu OSM w `web/public/overpass-solden.json`:
//  - elementy leżą w obszarze mapy (albo przynajmniej go przecinają),
//  - w danych są trasy i wyciągi z południowo-zachodniej części ośrodka
//    (regresja: źródło HudRekawa miało mniejszy bbox i gubiło ten rejon),
//  - nie ma wyciągów w statusie projektu/budowy.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { normalizeSkiData, SOLDEN_BOUNDS } from "./mapData.ts";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SNAPSHOT = path.join(WEB_ROOT, "public", "overpass-solden.json");

interface SnapshotElement {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lon: number; lat: number }[];
  members?: { geometry?: { lon: number; lat: number }[] }[];
}

const elements: SnapshotElement[] = JSON.parse(readFileSync(SNAPSHOT, "utf8")).elements;

function pointsOf(element: SnapshotElement): [number, number][] {
  const points: [number, number][] = [];
  for (const point of element.geometry ?? []) points.push([point.lon, point.lat]);
  for (const member of element.members ?? []) {
    for (const point of member.geometry ?? []) points.push([point.lon, point.lat]);
  }
  return points;
}

const inside = ([lon, lat]: [number, number]): boolean =>
  lon >= SOLDEN_BOUNDS[0] && lon <= SOLDEN_BOUNDS[2] && lat >= SOLDEN_BOUNDS[1] && lat <= SOLDEN_BOUNDS[3];

describe("snapshot tras", () => {
  it("każdy element z geometrią dotyka obszaru mapy", () => {
    const outside = elements
      .filter((element) => {
        const points = pointsOf(element);
        return points.length > 0 && !points.some(inside);
      })
      .map((element) => `${element.type}/${element.id}`);
    expect(outside).toEqual([]);
  });

  it("zawiera trasy i wyciągi z południowo-zachodniej części ośrodka", () => {
    const refs = new Set(elements.map((element) => element.tags?.ref).filter(Boolean));
    for (const ref of ["36", "38", "39", "40"]) expect(refs.has(ref)).toBe(true);
    const lifts = elements.filter((element) => element.tags?.aerialway).map((element) => element.tags?.name ?? "");
    expect(lifts).toContain("Mutkogl");
  });

  it("normalizacja odsiewa wyciągi w statusie projektu i budowy", () => {
    const data = normalizeSkiData(elements as never);
    const inactive = data.lifts.features
      .filter((feature) => ["proposed", "construction", "abandoned", "disused", "razed"].includes(feature.properties.aerialway))
      .map((feature) => feature.properties.uid);
    expect(inactive).toEqual([]);
    expect(data.lifts.features.some((feature) => /Projekt/i.test(feature.properties.name))).toBe(false);
  });
});
