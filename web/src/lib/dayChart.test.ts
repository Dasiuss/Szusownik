import { describe, expect, it } from "vitest";
import { syntheticRollingSamples } from "../../test/fixtures.ts";
import { buildDayProfile } from "./chartSeries.ts";
import { buildDayRunSegments, runSampleSpanM } from "./dayChart.ts";
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

describe("buildDayRunSegments", () => {
  it("koniec ostatniego segmentu pokrywa się z końcem danych na osi", () => {
    const runs = storedRuns(4);
    const points = buildDayProfile(runs);
    const segments = buildDayRunSegments(runs);
    expect(segments[segments.length - 1].endD).toBeCloseTo(points[points.length - 1].d, 6);
  });
});

describe("runSampleSpanM", () => {
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
