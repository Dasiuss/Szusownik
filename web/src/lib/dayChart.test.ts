import { describe, expect, it } from "vitest";
import { syntheticRollingSamples } from "../../test/fixtures.ts";
import { buildDayChartData, buildDayRunSegments, runSampleSpanM } from "./dayChart.ts";
import type { StoredRun } from "./db.ts";
import { analyzeDay, QUALITY_ANALYSIS_VERSION } from "./runs.ts";

function storedRuns(lifts: number): StoredRun[] {
  return analyzeDay(syntheticRollingSamples({ lifts })).runs.map((run) => ({
    ...run,
    id: `2026-01-15::${run.startT}`,
    dayKey: "2026-01-15",
    analysisVersion: QUALITY_ANALYSIS_VERSION,
    receivedAt: run.startT,
  }));
}

describe("buildDayChartData", () => {
  it("wspólna oś dystansu rośnie monotonicznie mimo wyciągów w segmentach", () => {
    const points = buildDayChartData(storedRuns(3));
    expect(points.length).toBeGreaterThan(0);
    for (let index = 1; index < points.length; index++) {
      // Regresja: na granicy zjazdów linia cofała się, gdy offset szedł po
      // distanceM (bez wyciągu), a pozycja próbek po pełnej rozpiętości.
      expect(points[index].d).toBeGreaterThanOrEqual(points[index - 1].d);
    }
  });

  it("koniec ostatniego segmentu pokrywa się z końcem danych na osi", () => {
    const runs = storedRuns(4);
    const points = buildDayChartData(runs);
    const segments = buildDayRunSegments(runs);
    expect(segments[segments.length - 1].endD).toBeCloseTo(points[points.length - 1].d, 6);
  });

  it("rozpiętość próbek zjazdu jest większa niż jego dystans w dół (wyciąg zostaje na wykresie)", () => {
    const runs = storedRuns(3);
    const withLift = runs.filter((run) => {
      const start = run.samples[0].altSm;
      const highest = Math.max(...run.samples.map((sample) => sample.altSm));
      return highest > start + 5;
    });
    expect(withLift.length).toBeGreaterThan(0);
    for (const run of withLift) {
      expect(runSampleSpanM(run)).toBeGreaterThan(run.distanceM);
    }
  });
});
