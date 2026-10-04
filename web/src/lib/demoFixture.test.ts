// Weryfikuje, że demo-fixture (`public/fixtures/ride.csv`) przechodzi przez
// logikę PWA i daje sensowne zjazdy z dopasowanymi trasami. Fixture jest
// syntetyczny, ale osadzony na prawdziwej geometrii Sölden
// (scripts/data/demo-solden.json), więc dopasowanie tras ma co złapać.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDeviceCsv } from "./csv.ts";
import { normalizeSkiData } from "./mapData.ts";
import { matchRunRoutes } from "./routeMatching.ts";
import { enrich, splitRuns } from "./runs.ts";

const FIXTURE = fileURLToPath(new URL("../../public/fixtures/ride.csv", import.meta.url));
const LOOP = fileURLToPath(new URL("../../../scripts/data/demo-solden.json", import.meta.url));

interface LoopWay {
  id: number;
  ref: string;
  name: string;
  difficulty: string;
  geometry: Array<[number, number]>;
}
interface LoopData {
  descent: LoopWay[];
}

function loopFeatures() {
  const data = JSON.parse(readFileSync(LOOP, "utf8")) as LoopData;
  const elements = data.descent.map((way) => ({
    type: "way" as const,
    id: way.id,
    tags: {
      "piste:type": "downhill",
      "piste:difficulty": way.difficulty,
      "piste:grooming": "classic",
      ...(way.ref ? { ref: way.ref } : { name: way.name }),
    },
    geometry: way.geometry.map(([lon, lat]) => ({ lon, lat })),
  }));
  return normalizeSkiData(elements, false, "2026-01-15T00:00:00.000Z").lines;
}

describe("demo fixture", () => {
  const samples = parseDeviceCsv(readFileSync(FIXTURE, "utf8"));

  it("parsuje się i jest posortowany po czasie", () => {
    expect(samples.length).toBeGreaterThan(2000);
    for (let i = 1; i < samples.length; i += 1) {
      expect(Date.parse(samples[i].t)).toBeGreaterThanOrEqual(Date.parse(samples[i - 1].t));
    }
  });

  it("daje kilka zjazdów w jednym dniu", () => {
    const runs = splitRuns(enrich(samples));
    expect(runs.length).toBeGreaterThanOrEqual(3);
    // Każdy zjazd obejmuje podejście (wyciąg) + zjazd.
    expect(runs.every((run) => run.distanceM > 1000)).toBe(true);
  });

  it("dopasowuje trasy 1 i 1a do każdego zjazdu", () => {
    const features = loopFeatures();
    const runs = splitRuns(enrich(samples));
    for (const run of runs) {
      const match = matchRunRoutes(features, run.samples);
      expect(match.sequence.map((item) => item.label)).toEqual(["1", "1a"]);
      expect(match.spans.length).toBe(2);
      expect(match.routeName).toBe("1 → 1a");
    }
  });

  it("ma potwierdzone maksimum (zielone kryteria jakości)", () => {
    const runs = splitRuns(enrich(samples));
    expect(runs.some((run) => run.confirmedMaxSpeed !== null)).toBe(true);
    const best = Math.max(...runs.map((run) => run.confirmedMaxSpeed ?? 0));
    expect(best).toBeGreaterThan(70);
  });
});
