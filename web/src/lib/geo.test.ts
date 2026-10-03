import { describe, expect, it } from "vitest";
import { gradeDeg, haversineM, movingAvg } from "./geo.ts";

describe("geo", () => {
  it("haversine: zero dla tego samego punktu, ~111 km na stopień szerokości", () => {
    expect(haversineM(51, 17, 51, 17)).toBe(0);
    const oneDegree = haversineM(51, 17, 52, 17);
    expect(oneDegree).toBeGreaterThan(111_000);
    expect(oneDegree).toBeLessThan(111_250);
  });

  it("movingAvg: okno 1 zwraca kopię bez wygładzania", () => {
    const xs = [1, 2, 3];
    const out = movingAvg(xs, 1);
    expect(out).toEqual(xs);
    expect(out).not.toBe(xs);
  });

  it("movingAvg: częściowe okno na starcie, pełne dalej", () => {
    expect(movingAvg([3, 6, 9, 12], 3)).toEqual([3, 4.5, 6, 9]);
  });

  it("gradeDeg: zero na płaskim, ujemne przy zjeździe", () => {
    expect(gradeDeg([100, 100, 100], [0, 10, 20], 15)).toEqual([0, 0, 0]);
    const descending = gradeDeg([100, 90, 80], [0, 10, 20], 15);
    expect(descending[2]).toBeLessThan(0);
  });
});
