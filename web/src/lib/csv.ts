import Papa from "papaparse";

export interface Sample {
  t: string; // timestamp z urządzenia (ISO) — przy >1 Hz powtarza się w obrębie sekundy
  lat: number;
  lon: number;
  speed: number; // km/h (Doppler z urządzenia)
  altGps: number; // m (wysokość z GPS)
  hdg: number; // stopnie
  altBaro: number; // m (wysokość barometryczna, standardowa atmosfera)
}

const HEADER = [
  "timestamp",
  "lat",
  "lon",
  "speed",
  "altitude_gps",
  "heading",
  "altitude_baro",
];

function num(v: unknown, name: string): number {
  const n = typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new Error(`Złe pole ${name}: ${String(v)}`);
  return n;
}

/** Parsuje i waliduje surowy CSV z urządzenia (schemat z firmware/src/config). */
export function parseDeviceCsv(text: string): Sample[] {
  const res = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });
  if (res.errors.length > 0) {
    throw new Error(`Błąd CSV: ${res.errors[0].message}`);
  }
  const fields = res.meta.fields ?? [];
  for (const h of HEADER) {
    if (!fields.includes(h)) throw new Error(`Brak kolumny: ${h}`);
  }
  return res.data.map((row, i) => {
    const t = (row.timestamp ?? "").trim();
    if (!t) throw new Error(`Wiersz ${i + 2}: pusty timestamp`);
    return {
      t,
      lat: num(row.lat, "lat"),
      lon: num(row.lon, "lon"),
      speed: num(row.speed, "speed"),
      altGps: num(row.altitude_gps, "altitude_gps"),
      hdg: num(row.heading, "heading"),
      altBaro: num(row.altitude_baro, "altitude_baro"),
    };
  });
}
