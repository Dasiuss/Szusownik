import type { DayStats } from "./runs.ts";

// Prosty in-memory store na przeanalizowany dzień (nawigacja lista → szczegóły).
// Trwałość = IndexedDB (surowe CSV), analiza zawsze ze świeżego parsowania.
let day: DayStats | null = null;

export function setDay(d: DayStats | null) {
  day = d;
}
export function getDay(): DayStats | null {
  return day;
}

export function fmtClock(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function fmtDurSec(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtKm(m: number): string {
  return `${(m / 1000).toFixed(2)} km`;
}
