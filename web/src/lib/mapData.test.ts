import { describe, expect, it } from "vitest";
import { overpassElements } from "../../test/skiArea.ts";
import { normalizeSkiData } from "./mapData.ts";

const data = normalizeSkiData(overpassElements(), false, "2026-01-01T00:00:00.000Z");

describe("normalizeSkiData", () => {
  it("bierze tylko trasy downhill, pomijając grooming=no i freeride", () => {
    const ids = data.pistes.features.map((feature) => feature.id);
    expect(ids).toContain("way/1");
    expect(ids).toContain("way/2");
    expect(ids).not.toContain("way/3"); // grooming=no
    expect(ids).not.toContain("way/4"); // freeride
    expect(ids).not.toContain("way/7"); // highway
  });

  it("klasyfikuje wyciąg po aerialway i rozwiązuje nazwę ośrodka z relacji", () => {
    expect(data.lifts.features.map((feature) => feature.id)).toEqual(["way/5"]);
    const easy = data.pistes.features.find((feature) => feature.id === "way/1")!;
    expect(easy.properties.site).toBe("Ośrodek Testowy");
    expect(easy.properties.difficulty).toBe("easy");
    expect(easy.properties.difficultyColor).toBeTruthy();
  });

  it("zamknięty way trasy staje się polygonem; `lines` zawiera tylko linie", () => {
    const loop = data.pistes.features.find((feature) => feature.id === "way/6")!;
    expect(loop.geometry.type).toBe("Polygon");
    expect(data.lines.every((feature) => feature.geometry.type === "LineString")).toBe(true);
    expect(data.lines.length).toBe(3); // way/1, way/2, way/5
  });

  it("deduplikuje cechy po uid", () => {
    const duplicated = normalizeSkiData(
      [...overpassElements(), ...overpassElements()],
      false,
      "2026-01-01T00:00:00.000Z",
    );
    const ids = duplicated.pistes.features.map((feature) => feature.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
