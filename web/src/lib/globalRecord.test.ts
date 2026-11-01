import { describe, expect, it } from "vitest";
import {
  confirmedGlobalRecord,
  isDemoFile,
  isUtcSampleTimestamp,
  latestAnalyzedTimestamp,
  parseGlobalRecordPayload,
} from "./globalRecord.ts";

describe("global confirmed record", () => {
  it("defaults to 50 km/h when there are no confirmed real rides", () => {
    expect(confirmedGlobalRecord([])).toBe(50);
    expect(confirmedGlobalRecord([
      { confirmedMaxSpeed: null },
      { confirmedMaxSpeed: 180, demo: true },
    ])).toBe(50);
  });

  it("takes the highest confirmed real result and ignores demo or unconfirmed maxima", () => {
    expect(confirmedGlobalRecord([
      { confirmedMaxSpeed: 119.7 },
      { confirmedMaxSpeed: 182, demo: true },
      { confirmedMaxSpeed: null },
      { confirmedMaxSpeed: 121.4 },
    ])).toBe(121.4);
  });

  it("uses the newest timestamp from analyzed samples as the reconciliation watermark", () => {
    expect(latestAnalyzedTimestamp([
      { t: "2026-10-29T10:00:01.000Z" },
      { t: "2026-10-29T10:00:03.200Z" },
      { t: "2026-10-29T10:00:02.500Z" },
    ])).toBe("2026-10-29T10:00:03.200Z");
    expect(latestAnalyzedTimestamp([])).toBe("");
  });

  it("normalizes the demo filename and shares strict ISO watermark validation", () => {
    expect(isDemoFile("demo-ride.csv")).toBe(true);
    expect(isDemoFile("/demo-ride.csv")).toBe(true);
    expect(isDemoFile("/20261029_100000.csv")).toBe(false);
    expect(isUtcSampleTimestamp("2026-10-29T10:00:03.200Z")).toBe(true);
    expect(isUtcSampleTimestamp("2026-XX-29T10:00:03.200Z")).toBe(false);
  });

  it("parses the shared record command payload and rejects invalid arguments", () => {
    expect(parseGlobalRecordPayload("1234:2026-10-29T10:00:03.200Z")).toEqual({
      confirmedTenthsKmh: 1234,
      analyzedThrough: "2026-10-29T10:00:03.200Z",
    });
    expect(parseGlobalRecordPayload("500:-")).toEqual({ confirmedTenthsKmh: 500, analyzedThrough: "" });
    expect(parseGlobalRecordPayload("499:-")).toBeNull();
    expect(parseGlobalRecordPayload("1234.5:-")).toBeNull();
    expect(parseGlobalRecordPayload("1234:bad-time")).toBeNull();
  });
});
