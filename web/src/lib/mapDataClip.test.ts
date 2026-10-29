// Zachowanie danych tras względem obszaru mapy:
//  - trasy i wyciągi są przycinane do bboxa (żeby nie rysowały się poza mapą),
//  - wyciągi w statusie „projekt"/„w budowie"/„nieczynny" nie są pokazywane.

import { describe, expect, it } from "vitest";
import { clipSkiDataToBounds, normalizeSkiData, SOLDEN_BOUNDS, type SkiData } from "./mapData.ts";

const BOUNDS: [number, number, number, number] = SOLDEN_BOUNDS;

function element(id: number, tags: Record<string, string>, coordinates: [number, number][]) {
  return {
    type: "way" as const,
    id,
    tags,
    geometry: coordinates.map(([lon, lat]) => ({ lon, lat })),
  };
}

describe("normalizeSkiData — status wyciągu", () => {
  it("pomija wyciągi w projekcie, budowie i nieczynne", () => {
    const data = normalizeSkiData([
      element(1, { aerialway: "proposed", name: "(Projekt) Fernerkogelbahn" }, [[10.95, 46.95], [10.96, 46.96]]),
      element(2, { aerialway: "construction", name: "W budowie" }, [[10.95, 46.95], [10.96, 46.96]]),
      element(3, { aerialway: "disused", name: "Nieczynny" }, [[10.95, 46.95], [10.96, 46.96]]),
      element(4, { aerialway: "t-bar", name: "Mutkogl" }, [[10.93, 46.92], [10.94, 46.92]]),
    ]);
    expect(data.lifts.features.map((feature) => feature.properties.name)).toEqual(["Mutkogl"]);
  });
});

describe("clipSkiDataToBounds", () => {
  const data: SkiData = normalizeSkiData([
    element(10, { "piste:type": "downhill", ref: "1" }, [[10.88, 46.95], [10.92, 46.95], [10.94, 46.95]]),
    element(11, { "piste:type": "downhill", ref: "2" }, [[10.80, 46.90], [10.85, 46.90]]),
  ]);

  it("przycina trasę do bboxa", () => {
    const clipped = clipSkiDataToBounds(data, BOUNDS);
    const piste = clipped.pistes.features.find((feature) => feature.properties.ref === "1");
    expect(piste).toBeDefined();
    const coordinates = piste!.geometry.type === "LineString" ? piste!.geometry.coordinates : [];
    expect(coordinates.length).toBeGreaterThanOrEqual(2);
    for (const [lon, lat] of coordinates) {
      expect(lon).toBeGreaterThanOrEqual(BOUNDS[0] - 1e-9);
      expect(lon).toBeLessThanOrEqual(BOUNDS[2] + 1e-9);
      expect(lat).toBeGreaterThanOrEqual(BOUNDS[1] - 1e-9);
      expect(lat).toBeLessThanOrEqual(BOUNDS[3] + 1e-9);
    }
  });

  it("usuwa trasę całkowicie poza bboxem", () => {
    const clipped = clipSkiDataToBounds(data, BOUNDS);
    expect(clipped.pistes.features.some((feature) => feature.properties.ref === "2")).toBe(false);
    expect(clipped.lines.every((feature) => feature.properties.ref !== "2")).toBe(true);
  });
});
