import Papa from "papaparse";

export interface Sample {
  t: string; // timestamp z urządzenia (ISO) — przy >1 Hz może powtarzać się
  lat: number;
  lon: number;
  speed: number; // km/h (Doppler z urządzenia)
  altGps: number; // m (wysokość z GPS)
  hdg: number; // stopnie
  altBaro: number; // m (wysokość barometryczna, standardowa atmosfera)
  gnssFixValid: boolean | null;
  gnssFixAgeMs: number | null;
  gnssSatellites: number | null;
  gnssSatellitesAgeMs: number | null;
  gnssHdop: number | null;
  gnssHdopAgeMs: number | null;
}

export const DEVICE_CSV_V2_HEADER =
  "timestamp,lat,lon,speed,altitude_gps,heading,altitude_baro,gnss_fix_valid,gnss_fix_age_ms,gnss_satellites,gnss_satellites_age_ms,gnss_hdop,gnss_hdop_age_ms";

function requiredNumber(value: unknown, name: string): number {
  const raw = typeof value === "string" ? value.trim() : "";
  const number = raw ? Number(raw) : NaN;
  if (!Number.isFinite(number)) throw new Error(`Złe pole ${name}: ${String(value)}`);
  return number;
}

function optionalNumber(value: unknown, name: string, integer = false): number | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  const number = Number(raw);
  if (!Number.isFinite(number) || number < 0 || (integer && !Number.isInteger(number))) {
    throw new Error(`Złe pole ${name}: ${String(value)}`);
  }
  return number;
}

function optionalBoolean(value: unknown, name: string): boolean | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  if (raw === "1") return true;
  if (raw === "0") return false;
  throw new Error(`Złe pole ${name}: ${String(value)}`);
}

/** Parsuje i waliduje surowy CSV v2; puste metryki GNSS pozostają null. */
export function parseDeviceCsv(text: string): Sample[] {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  if (result.errors.length > 0) {
    throw new Error(`Błąd CSV: ${result.errors[0].message}`);
  }

  const header = (result.meta.fields ?? []).map((field) => field.trim()).join(",");
  if (header !== DEVICE_CSV_V2_HEADER) {
    throw new Error(`Nieobsługiwany nagłówek CSV: ${header}`);
  }

  return result.data.map((row, index): Sample => {
    const t = (row.timestamp ?? "").trim();
    if (!t) throw new Error(`Wiersz ${index + 2}: pusty timestamp`);
    return {
      t,
      lat: requiredNumber(row.lat, "lat"),
      lon: requiredNumber(row.lon, "lon"),
      speed: requiredNumber(row.speed, "speed"),
      altGps: requiredNumber(row.altitude_gps, "altitude_gps"),
      hdg: requiredNumber(row.heading, "heading"),
      altBaro: requiredNumber(row.altitude_baro, "altitude_baro"),
      gnssFixValid: optionalBoolean(row.gnss_fix_valid, "gnss_fix_valid"),
      gnssFixAgeMs: optionalNumber(row.gnss_fix_age_ms, "gnss_fix_age_ms", true),
      gnssSatellites: optionalNumber(row.gnss_satellites, "gnss_satellites", true),
      gnssSatellitesAgeMs: optionalNumber(row.gnss_satellites_age_ms, "gnss_satellites_age_ms", true),
      gnssHdop: optionalNumber(row.gnss_hdop, "gnss_hdop"),
      gnssHdopAgeMs: optionalNumber(row.gnss_hdop_age_ms, "gnss_hdop_age_ms", true),
    };
  });
}

export function serializeDeviceCsvV2(samples: Sample[]): string {
  const rows = samples.map((sample) => [
    sample.t,
    sample.lat,
    sample.lon,
    sample.speed,
    sample.altGps,
    sample.hdg,
    sample.altBaro,
    sample.gnssFixValid === null ? "" : sample.gnssFixValid ? 1 : 0,
    sample.gnssFixAgeMs ?? "",
    sample.gnssSatellites ?? "",
    sample.gnssSatellitesAgeMs ?? "",
    sample.gnssHdop ?? "",
    sample.gnssHdopAgeMs ?? "",
  ].join(","));
  return [DEVICE_CSV_V2_HEADER, ...rows].join("\n") + "\n";
}
