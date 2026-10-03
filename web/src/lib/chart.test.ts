import { describe, expect, it } from "vitest";
import {
  getDistanceAxis,
  getDistanceAxisForDomain,
  getDistanceStep,
  panDomain,
  zoomDomain,
} from "./chart.ts";

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

describe("getDistanceStep", () => {
  it("drobne kroki dla mocno przybliżonego okna", () => {
    expect(getDistanceStep(0.1)).toBe(0.05);
    expect(getDistanceStep(0.25)).toBe(0.05);
    expect(getDistanceStep(0.4)).toBe(0.1);
    expect(getDistanceStep(0.6)).toBe(0.1);
  });

  it("dotychczasowe kroki dla szerszych okien", () => {
    expect(getDistanceStep(1.4)).toBe(0.25);
    expect(getDistanceStep(4.5)).toBe(0.5);
    expect(getDistanceStep(12)).toBe(1);
  });
});

describe("getDistanceAxisForDomain", () => {
  it("ticki są wielokrotnościami kroku wewnątrz widocznego okna", () => {
    const axis = getDistanceAxisForDomain(3.12, 3.42);
    expect(axis.domain).toEqual([3.12, 3.42]);
    expect(axis.ticks).toEqual([3.2, 3.3, 3.4]);
  });

  it("krok 0.05 dla bardzo wąskiego okna", () => {
    const axis = getDistanceAxisForDomain(1.0, 1.2);
    expect(axis.ticks).toEqual([1, 1.05, 1.1, 1.15, 1.2]);
  });

  it("nie rozciąga domeny poza widoczne okno", () => {
    expect(getDistanceAxisForDomain(0.13, 0.38).domain).toEqual([0.13, 0.38]);
  });

  it("przy skrajnym przybliżeniu zagęszcza krok, żeby ticki nie zniknęły", () => {
    const axis = getDistanceAxisForDomain(1.0, 1.02);
    expect(axis.ticks.length).toBeGreaterThanOrEqual(2);
    expect(axis.ticks[0]).toBeGreaterThanOrEqual(1.0);
    expect(axis.ticks.at(-1)).toBeLessThanOrEqual(1.02);
  });
});

describe("zoomDomain", () => {
  it("przybliża wokół punktu zaczepienia", () => {
    expect(zoomDomain([0, 10], 10, 0.5, 0)).toEqual([0, 5]);
    expect(zoomDomain([0, 10], 10, 0.5, 1)).toEqual([5, 10]);
    expect(zoomDomain([0, 10], 10, 0.5, 0.5)).toEqual([2.5, 7.5]);
  });

  it("nie pozwala wyjechać poza zakres danych", () => {
    expect(zoomDomain([2, 8], 10, 2, 0.5)).toEqual([0, 10]);
  });

  it("nie zwęża okna poniżej minimum numerycznego", () => {
    const [min, max] = zoomDomain([0, 10], 10, 0, 0.5);
    expect(max - min).toBeCloseTo(0.0001, 6);
  });
});

describe("panDomain", () => {
  it("przesuwa okno zachowując szerokość", () => {
    expect(panDomain([2, 8], 10, -5)).toEqual([0, 6]);
    expect(panDomain([2, 8], 10, 5)).toEqual([4, 10]);
  });

  it("nie przesuwa poza zakres danych", () => {
    expect(panDomain([0, 10], 10, 3)).toEqual([0, 10]);
  });
});
