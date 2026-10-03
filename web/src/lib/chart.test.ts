import { describe, expect, it } from "vitest";
import { getDistanceAxis } from "./chart.ts";

describe("getDistanceAxis", () => {
  it("krok 0.25 km dla krótkich dystansów", () => {
    const axis = getDistanceAxis(1.4);
    expect(axis.domain).toEqual([0, 1.5]);
    expect(axis.ticks).toEqual([0, 0.25, 0.5, 0.75, 1, 1.25, 1.5]);
  });

  it("krok 0.5 km dla średnich dystansów", () => {
    const axis = getDistanceAxis(4.5);
    expect(axis.domain).toEqual([0, 4.5]);
    expect(axis.ticks.length).toBe(10);
  });

  it("krok 1 km dla długich dystansów i dystans 0", () => {
    expect(getDistanceAxis(12).domain).toEqual([0, 12]);
    expect(getDistanceAxis(0).domain).toEqual([0, 0.25]);
  });
});
