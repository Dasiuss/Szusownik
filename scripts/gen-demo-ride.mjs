#!/usr/bin/env node
// Generuje demonstracyjne nagranie PWA: `web/public/fixtures/ride.csv`.
//
// Nie da się nagrać realnego przejazdu, więc budujemy syntetyczny, ale
// osadzony na PRAWDZIWYCH trasach Sölden (snapshot OSM w
// `scripts/data/demo-solden.json`). Pętla: wyciąg Gaislachkoglbahn II (w górę)
// + zjazd trasami `1` i `1a` (w dół), powtórzona kilka razy — dzięki temu
// dopasowanie tras w PWA ma co pokazać (sekwencja + „poprzednie przejazdy").
//
// Uruchomienie:  node scripts/gen-demo-ride.mjs
//
// Wynik nie jest pomiarem: wartości GNSS są modelowane (patrz docs/wymagania-PWA
// §8). Plik ma poprawny format CSV v2 i realną geometrię/deniwelację.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "scripts", "data", "demo-solden.json");
const OUTPUT = path.join(ROOT, "web", "public", "fixtures", "ride.csv");

const HEADER =
  "timestamp,lat,lon,speed,altitude_gps,heading,altitude_baro,gnss_fix_valid,gnss_fix_age_ms,gnss_satellites,gnss_satellites_age_ms,gnss_hdop,gnss_hdop_age_ms";

const BASE_MS = Date.parse("2026-01-15T09:12:00.000Z");
const LIFT_SPEED_KMH = 18;
const LAP_VMAX_KMH = [78, 88, 96]; // różne tempo kolejnych zjazdów
const LAPS = LAP_VMAX_KMH.length;

const R_EARTH = 6371000;
const rad = (deg) => (deg * Math.PI) / 180;

function metersBetween(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(x));
}

function bearingDegrees(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (Math.atan2(y, x) * 180) / Math.PI;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x517a5d);

/** Buduje polilinię z węzłami {lon,lat,elev} i skumulowanym dystansem. */
function buildPolyline(nodes) {
  const cumulative = [0];
  for (let i = 1; i < nodes.length; i += 1) {
    cumulative[i] = cumulative[i - 1] + metersBetween(nodes[i - 1], nodes[i]);
  }
  return { nodes, cumulative, total: cumulative[cumulative.length - 1] };
}

function atDistance(poly, distance) {
  const d = Math.max(0, Math.min(distance, poly.total));
  let index = 1;
  while (index < poly.cumulative.length - 1 && poly.cumulative[index] < d) index += 1;
  const a = poly.nodes[index - 1];
  const b = poly.nodes[index];
  const span = poly.cumulative[index] - poly.cumulative[index - 1] || 1;
  const t = (d - poly.cumulative[index - 1]) / span;
  return {
    lon: a.lon + (b.lon - a.lon) * t,
    lat: a.lat + (b.lat - a.lat) * t,
    elev: a.elev + (b.elev - a.elev) * t,
  };
}

const smoothstep = (value) => {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
};

function samplingHz(speedKmh) {
  if (speedKmh >= 80) return 10;
  if (speedKmh >= 70) return 6;
  if (speedKmh >= 50) return 3;
  if (speedKmh >= 20) return 1;
  return 0.5;
}

function cruiseSpeed(progress, vmax, phase) {
  return vmax * (0.9 + 0.1 * Math.sin(progress * Math.PI * 3 + phase));
}

function descentSpeed(progress, vmax, phase) {
  const accelEnd = 0.12;
  const slowStart = 0.88;
  const cruise = cruiseSpeed(progress, vmax, phase);
  let speed;
  if (progress < accelEnd) {
    // Rozpędzanie: płynnie schodzimy od startu do krzywej przelotowej, więc na
    // granicy faz prędkość jest ciągła (dawniej skok do vmax dawał pik
    // przyspieszenia).
    const t = smoothstep(progress / accelEnd);
    speed = 20 + (cruise - 20) * t;
  } else if (progress > slowStart) {
    // Wyhamowanie: również płynnie od krzywej przelotowej w dół.
    const t = smoothstep((progress - slowStart) / (1 - slowStart));
    speed = cruise * (1 - 0.75 * t);
  } else {
    speed = cruise;
  }
  return Math.max(12, speed);
}

function gnssFix() {
  const satellites = 8 + Math.floor(rand() * 6); // 8..13
  const hdop = Number((0.6 + rand() * 0.6).toFixed(2)); // 0.60..1.20
  const age = 20 + Math.floor(rand() * 80); // 20..99 ms
  return { satellites, hdop, age };
}

const data = JSON.parse(fs.readFileSync(DATA, "utf8"));
const topElev = data.topElev;
const bottomElev = data.bottomElev;

// Zjazd: sklej odcinki tras, wysokość interpolowaną w obrębie każdego odcinka.
const descentNodes = [];
for (const way of data.descent) {
  const points = way.geometry.map(([lon, lat]) => ({ lon, lat }));
  const legs = [0];
  for (let i = 1; i < points.length; i += 1) legs[i] = legs[i - 1] + metersBetween(points[i - 1], points[i]);
  const legTotal = legs[legs.length - 1] || 1;
  points.forEach((point, index) => {
    const elevation = way.startElev + ((way.endElev - way.startElev) * legs[index]) / legTotal;
    const previous = descentNodes[descentNodes.length - 1];
    if (previous && metersBetween(previous, point) < 1) return;
    descentNodes.push({ ...point, elev: elevation });
  });
}
const descent = buildPolyline(descentNodes);

// Wyciąg: orientuj od dołu do góry, wysokość liniowo 2181 -> 3015.
const liftPoints = data.lift.geometry.map(([lon, lat]) => ({ lon, lat }));
if (metersBetween(liftPoints[0], descentNodes[descentNodes.length - 1]) > metersBetween(liftPoints[liftPoints.length - 1], descentNodes[descentNodes.length - 1])) {
  liftPoints.reverse();
}
const liftLegs = [0];
for (let i = 1; i < liftPoints.length; i += 1) liftLegs[i] = liftLegs[i - 1] + metersBetween(liftPoints[i - 1], liftPoints[i]);
const liftTotal = liftLegs[liftLegs.length - 1] || 1;
const liftNodes = liftPoints.map((point, index) => ({
  ...point,
  elev: bottomElev + ((topElev - bottomElev) * liftLegs[index]) / liftTotal,
}));
const lift = buildPolyline(liftNodes);

const samples = [];
let timeMs = BASE_MS;

function emit(node, speed) {
  const fix = gnssFix();
  const noiseLat = (rand() - 0.5) * 0.00002; // ~1-2 m
  const noiseLon = (rand() - 0.5) * 0.00003;
  samples.push({
    t: new Date(Math.round(timeMs)).toISOString(),
    lat: Number((node.lat + noiseLat).toFixed(7)),
    lon: Number((node.lon + noiseLon).toFixed(7)),
    speed: Number(speed.toFixed(1)),
    altGps: Number((node.elev + (rand() - 0.5) * 2.5).toFixed(1)),
    hdg: 0,
    altBaro: Number((node.elev + 9 + (rand() - 0.5) * 0.6).toFixed(1)),
    gnssFixValid: true,
    gnssFixAgeMs: fix.age,
    gnssSatellites: fix.satellites,
    gnssSatellitesAgeMs: fix.age,
    gnssHdop: fix.hdop,
    gnssHdopAgeMs: fix.age,
  });
}

// Krótki postój przed pierwszym wyciągiem (dolina, prędkość ~0).
for (let i = 0; i < 4; i += 1) {
  emit(atDistance(lift, 0), 0.4);
  timeMs += 2000;
}

function ride(poly, speedAt) {
  let distance = 0;
  while (distance < poly.total) {
    const speed = speedAt(distance / poly.total);
    emit(atDistance(poly, distance), speed);
    const dtMs = 1000 / samplingHz(speed);
    distance += (speed / 3.6) * (dtMs / 1000);
    timeMs += dtMs;
  }
  emit(atDistance(poly, poly.total), speedAt(1));
}

for (let lap = 0; lap < LAPS; lap += 1) {
  const phase = lap * 1.7;
  ride(lift, () => LIFT_SPEED_KMH);
  ride(descent, (progress) => descentSpeed(progress, LAP_VMAX_KMH[lap], phase));
}

// Kierunek jazdy z kolejnych pozycji.
for (let i = 0; i < samples.length; i += 1) {
  const next = samples[Math.min(i + 1, samples.length - 1)];
  samples[i].hdg = Number(((bearingDegrees(samples[i], next) + 360) % 360).toFixed(1));
}

const rows = samples.map((sample) =>
  [
    sample.t,
    sample.lat,
    sample.lon,
    sample.speed,
    sample.altGps,
    sample.hdg,
    sample.altBaro,
    sample.gnssFixValid ? 1 : 0,
    sample.gnssFixAgeMs,
    sample.gnssSatellites,
    sample.gnssSatellitesAgeMs,
    sample.gnssHdop,
    sample.gnssHdopAgeMs,
  ].join(","),
);

const csv = [HEADER, ...rows].join("\n") + "\n";
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, csv);

const maxSpeed = Math.max(...samples.map((sample) => sample.speed));
const durationMin = ((timeMs - BASE_MS) / 60000).toFixed(1);
console.log(`zapisano ${path.relative(ROOT, OUTPUT)}`);
console.log(`  pętla: ${Math.round(descent.total)} m zjazdu (${data.descent.map((w) => w.name).join(" -> ")}) + ${Math.round(lift.total)} m wyciągu`);
console.log(`  laps=${LAPS} próbki=${samples.length} czas=${durationMin} min maxSpeed=${maxSpeed} km/h rozmiar=${(csv.length / 1024).toFixed(0)} KB`);
