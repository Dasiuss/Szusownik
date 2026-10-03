import { describe, expect, it } from "vitest";
import { syntheticSample } from "../../test/fixtures.ts";
import { DEVICE_CSV_V2_HEADER, parseDeviceCsv, serializeDeviceCsvV2 } from "./csv.ts";

describe("csv v2", () => {
  it("round-trip zachowuje wartości i nulle pól opcjonalnych", () => {
    const samples = [
      syntheticSample(0, {
        gnssFixValid: null,
        gnssFixAgeMs: null,
        gnssSatellites: null,
        gnssSatellitesAgeMs: null,
        gnssHdop: null,
        gnssHdopAgeMs: null,
      }),
      syntheticSample(1, { speed: 0, gnssHdop: 0 }),
    ];
    expect(parseDeviceCsv(serializeDeviceCsvV2(samples))).toEqual(samples);
  });

  it("odrzuca brak wymaganego pola (speed)", () => {
    const bad = [
      DEVICE_CSV_V2_HEADER,
      "2026-01-01T00:00:00Z,51,17,,100,180,100,1,0,8,0,0.9,0",
    ].join("\n");
    expect(() => parseDeviceCsv(bad)).toThrow(/speed/i);
  });

  it("odrzuca ujemne i niecałkowite pole opcjonalne", () => {
    const negative = [
      DEVICE_CSV_V2_HEADER,
      "2026-01-01T00:00:00Z,51,17,10,100,180,100,1,-1,8,0,0.9,0",
    ].join("\n");
    expect(() => parseDeviceCsv(negative)).toThrow(/gnss_fix_age_ms/);

    const fractional = [
      DEVICE_CSV_V2_HEADER,
      "2026-01-01T00:00:00Z,51,17,10,100,180,100,1,0,8.5,0,0.9,0",
    ].join("\n");
    expect(() => parseDeviceCsv(fractional)).toThrow(/gnss_satellites/);
  });

  it("odrzuca niezgodny nagłówek i pomija puste linie", () => {
    expect(() => parseDeviceCsv("timestamp,lat\n2026-01-01T00:00:00Z,51")).toThrow();
    const text = [
      DEVICE_CSV_V2_HEADER,
      "2026-01-01T00:00:00Z,51,17,10,100,180,100,1,0,8,0,0.9,0",
      "",
    ].join("\n");
    expect(parseDeviceCsv(text)).toHaveLength(1);
  });
});
