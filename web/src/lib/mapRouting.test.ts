import { describe, expect, it } from "vitest";
import type { Position } from "./mapData.ts";
import { findRoute, snapToRoute, trimRoute } from "./mapRouting.ts";
import { lineFeature, planeElevation, straightPiste } from "../../test/skiArea.ts";

const A0: Position = [10.98, 46.97];
const A1: Position = [10.984, 46.966];
const B1: Position = [10.988, 46.96];

describe("findRoute", () => {
  it("start i cel na tej samej trasie", async () => {
    const route = await findRoute([straightPiste("piste/A", A0, A1)], A0, A1);
    expect(route.sequence.map((item) => item.uid)).toEqual(["piste/A"]);
    expect(route.distanceM).toBeGreaterThan(400);
    expect(route.distanceM).toBeLessThan(700);
    expect(route.segments.features.length).toBeGreaterThan(0);
  });

  it("łączy dwie trasy stykające się końcami", async () => {
    const features = [straightPiste("piste/A", A0, A1), straightPiste("piste/B", A1, B1)];
    const route = await findRoute(features, A0, B1);
    expect(route.sequence.map((item) => item.uid)).toEqual(["piste/A", "piste/B"]);
  });

  it("prowadzi przez wyciąg, gdy trasy nie stykają się bezpośrednio", async () => {
    // Dwie osobne trasy ~1,4 km od siebie, połączone tylko wyciągiem.
    const topA: Position = [10.975, 46.975];
    const bottomA: Position = [10.98, 46.965];
    const topB: Position = [10.995, 46.975];
    const bottomB: Position = [10.99, 46.965];
    const features = [
      straightPiste("piste/A", topA, bottomA),
      lineFeature("lift/L", [bottomA, topB], { routeKind: "lift", aerialway: "chair_lift", name: "Krzesełko" }),
      straightPiste("piste/B", topB, bottomB),
    ];
    const route = await findRoute(features, topA, bottomB);
    const uids = route.sequence.map((item) => item.uid);
    expect(uids).toContain("lift/L");
    expect(route.sequence.find((item) => item.uid === "lift/L")?.kind).toBe("lift");
  });

  it("rzuca, gdy punkt jest dalej niż 100 m od trasy", async () => {
    await expect(findRoute([straightPiste("piste/A", A0, A1)], [11.2, 46.9], A1)).rejects.toThrow(/100 m/);
  });

  it("rzuca, gdy nie ma ścieżki", async () => {
    await expect(findRoute([straightPiste("piste/A", A0, A1)], A0, [10.99, 46.96])).rejects.toThrow();
  });

  it("wybiera dłuższą łatwą trasę zamiast krótszej czarnej (koszt leksykograficzny)", async () => {
    const start: Position = [10.98, 46.97];
    const end: Position = [10.99, 46.96];
    const black = straightPiste("piste/black", start, end, { difficulty: "expert" });
    const easy = lineFeature("piste/easy", [start, [10.986, 46.968], end], { difficulty: "easy" });

    const route = await findRoute([black, easy], start, end);
    expect(route.sequence.map((item) => item.uid)).toContain("piste/easy");
    expect(route.cost[3]).toBe(0); // blackDistance
  });
});

describe("snapToRoute / trimRoute", () => {
  it("snapuje pozycję do trasy i skraca ją od początku", async () => {
    const route = await findRoute([straightPiste("piste/A", A0, A1)], A0, A1);

    const snapped = snapToRoute(route, A0);
    expect(snapped).not.toBeNull();
    expect(snapped!.offsetM).toBeLessThan(1);
    expect(snapped!.alongM).toBeLessThan(5);

    const trimmed = trimRoute(route, 100);
    expect(trimmed).not.toBeNull();
    expect(trimmed!.distanceM).toBeLessThan(route.distanceM);
    expect(trimmed!.distanceM).toBeGreaterThan(0);
  });
});

describe("elevation", () => {
  it("wysokość maleje w dół trasy (sanity providera)", () => {
    expect(planeElevation(A0)).toBeGreaterThan(planeElevation(A1));
  });
});
