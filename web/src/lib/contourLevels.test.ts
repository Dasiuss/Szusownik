import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CONTOUR_MINOR_M, contourThresholds } from "./contourLevels.ts";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("progi poziomic", () => {
  it("duża mapa ma stały interwał od z10 (pod pochylenie)", () => {
    const thresholds = contourThresholds("pitch");
    expect(thresholds[8]).toEqual([200, 800]);
    expect(thresholds[9]).toEqual([200, 800]);
    for (let z = 10; z <= 14; z += 1) expect(thresholds[z]).toEqual([50, 200]);
  });

  it("mini-mapa podwaja interwał co poziom oddalenia", () => {
    const thresholds = contourThresholds("zoom");
    expect(thresholds[8]).toEqual([400, 1600]);
    expect(thresholds[11]).toEqual([400, 1600]);
    expect(thresholds[12]).toEqual([200, 800]);
    expect(thresholds[13]).toEqual([100, 400]);
    expect(thresholds[14]).toEqual([50, 200]);
    expect(CONTOUR_MINOR_M).toBe(50);
  });

  it("mini-mapa prosi o profil zależny od zoomu", () => {
    const source = readFileSync(path.join(WEB_ROOT, "src/components/TraceMap.tsx"), "utf8");
    expect(source).toMatch(/contourProfile:\s*"zoom"/);
  });
});
