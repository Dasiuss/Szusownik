import type { Sample } from "./csv.ts";

export function addSyntheticDemoQuality(samples: Sample[]): Sample[] {
  return samples.map((sample) => ({
    ...sample,
    gnssFixValid: true,
    gnssFixAgeMs: 100,
    gnssSatellites: 8,
    gnssSatellitesAgeMs: 100,
    gnssHdop: 0.9,
    gnssHdopAgeMs: 100,
  }));
}
