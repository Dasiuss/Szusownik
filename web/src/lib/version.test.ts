import { describe, expect, it } from "vitest";
import { formatBuildTime, PWA_BUILD_TIME } from "./version.ts";

describe("formatBuildTime", () => {
  it("formatuje ISO na czytelny czas pl-PL", () => {
    expect(PWA_BUILD_TIME).toBe("2026-01-01T00:00:00.000Z");
    const formatted = formatBuildTime("2026-01-02T03:04:00.000Z");
    expect(formatted).toContain("2026");
    expect(formatted).toMatch(/0?2[.\-/]0?1[.\-/]2026/);
  });

  it("zwraca wejście, gdy data jest nieparsowalna", () => {
    expect(formatBuildTime("nie-data")).toBe("nie-data");
  });
});
