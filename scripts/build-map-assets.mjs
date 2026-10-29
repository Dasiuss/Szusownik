// Buduje lokalne zasoby mapy offline dla PWA w `web/public/`:
//  - DEM (AWS Terrain Tiles, terrarium) dla bboxu Sölden,
//  - glify Noto Sans i sprite'y z `protomaps/basemaps-assets`,
//  - snapshot OSM tras i wyciągów przefiltrowany do bboxu.
//
// Kafelki podkładu (`web/public/solden.pmtiles`) buduje osobno CLI Protomaps:
//   pmtiles extract https://build.protomaps.com/RRRRMMDD.pmtiles \
//     web/public/solden.pmtiles --bbox=<BBOX>
//
// Użycie: node scripts/build-map-assets.mjs
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";

// SOLDEN_BOUNDS: west, south, east, north (musi zgadzać się z web/src/lib/mapData.ts).
const BBOX = [10.905, 46.886957, 11.028039, 46.999242];
const DEM_MIN_ZOOM = 0;
const DEM_MAX_ZOOM = 13;
const DEM_BASE = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const PUBLIC = path.resolve("web/public");
const ASSETS_BASE = "https://raw.githubusercontent.com/protomaps/basemaps-assets/main";
const FONTS_BASE = `${ASSETS_BASE}/fonts`;
// `basemaps-assets` nie publikuje Bold — dokładamy go z fontów MapLibre demo
// (ten sam Noto Sans, OFL). Pobierane raz przy budowie, potem self-hosted.
const FONT_SOURCES = {
  "Noto Sans Bold": "https://demotiles.maplibre.org/font",
};

// Musi pokrywać wszystkie `text-font` z `web/src` (pilnuje tego
// `web/src/lib/mapFonts.test.ts`). Bold używają etykiety tras i wyciągów.
const FONT_STACKS = [
  "Noto Sans Regular",
  "Noto Sans Medium",
  "Noto Sans Bold",
  "Noto Sans Italic",
];
// Zakresy łacińskie + polskie znaki + interpunkcja.
const FONT_RANGES = [
  "0-255", "256-511", "512-767", "768-1023", "1024-1279",
  "1280-1535", "1536-1791", "1792-2047", "8192-8447", "8448-8703",
];
// PWA używa tylko stylu `light`.
const SPRITE_FLAVORS = ["light"];

const CONCURRENCY = 12;

const lon2tile = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2tile = (lat, z) => {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
};

async function exists(file) {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function fetchToFile(url, file, label) {
  if (await exists(file)) return "skipped";
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status} (${url})`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buffer);
  return buffer.length;
}

async function runPool(tasks, worker) {
  let index = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (index < tasks.length) {
      const task = tasks[index++];
      await worker(task);
    }
  }));
}

// --- „Pusty" kafelek DEM -----------------------------------------------------
// Biały PNG (RGB 255,255,255) w terrarium dekoduje się do ~32 768 m, czyli
// wysokości spoza dopuszczalnego zakresu — maplibre-contour traktuje ją jak brak
// danych. Sąsiad istnieje (brak 404 → brak wywalonego kafelka poziomic), ale nie
// rysuje żadnych linii.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function emptyTerrainPng(size = 256) {
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size, 0xff);
  for (let y = 0; y < size; y += 1) raw[y * stride] = 0; // filtr 0
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 bitów na kanał
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function writeEmptyTile(file) {
  if (await exists(file)) return;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, emptyTerrainPng());
}

async function fetchDem() {
  // Klucz z/x/y — kafelek prawdziwy ma pierwszeństwo nad „pustym" z pierścienia.
  const tiles = new Map();
  for (let z = DEM_MIN_ZOOM; z <= DEM_MAX_ZOOM; z += 1) {
    const max = 2 ** z - 1;
    const clamp = (v) => Math.min(max, Math.max(0, v));
    const x0 = lon2tile(BBOX[0], z);
    const x1 = lon2tile(BBOX[2], z);
    const y0 = lat2tile(BBOX[3], z);
    const y1 = lat2tile(BBOX[1], z);
    for (let x = x0; x <= x1; x += 1) {
      for (let y = y0; y <= y1; y += 1) tiles.set(`${z}/${x}/${y}`, { z, x, y });
    }
    // Pierścień „pustych" kafelków wokół obszaru (tylko z10+, gdzie poziomice
    // są generowane). Generator poziomic pobiera 3×3 sąsiadów DEM, a brak
    // któregokolwiek wywala cały kafelek (dziura w poziomicach). Biały kafelek
    // dekoduje się do niepoprawnej wysokości (NaN), więc sąsiad istnieje, ale
    // nie rysuje poziomic poza bboxem. Prawdziwy DEM wokół bboxa dawałby
    // poziomice daleko poza obszar mapy.
    if (z >= 10) {
      for (let x = clamp(x0 - 1); x <= clamp(x1 + 1); x += 1) {
        for (let y = clamp(y0 - 1); y <= clamp(y1 + 1); y += 1) {
          const key = `${z}/${x}/${y}`;
          if (!tiles.has(key)) tiles.set(key, { z, x, y, empty: true });
        }
      }
    }
  }
  let bytes = 0;
  let downloaded = 0;
  const queue = [...tiles.values()];
  await runPool(queue, async ({ z, x, y, empty }) => {
    const file = path.join(PUBLIC, "dem", String(z), String(x), `${y}.png`);
    if (empty) {
      await writeEmptyTile(file);
      return;
    }
    const result = await fetchToFile(`${DEM_BASE}/${z}/${x}/${y}.png`, file, `DEM ${z}/${x}/${y}`);
    if (result !== "skipped") {
      bytes += result;
      downloaded += 1;
    }
  });
  console.log(`DEM z${DEM_MIN_ZOOM}–z${DEM_MAX_ZOOM}: ${downloaded} pobranych / ${queue.length} kafelków, ${(bytes / 1048576).toFixed(1)} MB`);
}

async function fetchFontsAndSprites() {
  const tasks = [];
  for (const stack of FONT_STACKS) {
    for (const range of FONT_RANGES) {
      const encoded = encodeURIComponent(stack);
      const base = FONT_SOURCES[stack] ?? FONTS_BASE;
      tasks.push({
        url: `${base}/${encoded}/${range}.pbf`,
        file: path.join(PUBLIC, "fonts", stack, `${range}.pbf`),
      });
    }
  }
  tasks.push({ url: `${ASSETS_BASE}/fonts/OFL.txt`, file: path.join(PUBLIC, "fonts", "OFL.txt") });
  for (const flavor of SPRITE_FLAVORS) {
    for (const suffix of [".json", ".png", "@2x.json", "@2x.png"]) {
      tasks.push({
        url: `${ASSETS_BASE}/sprites/v4/${flavor}${suffix}`,
        file: path.join(PUBLIC, "sprites", "v4", `${flavor}${suffix}`),
      });
    }
  }
  let count = 0;
  await runPool(tasks, async ({ url, file }) => {
    const result = await fetchToFile(url, file, "assets");
    if (result !== "skipped") count += 1;
  });
  console.log(`Glify i sprity: ${count} pobranych / ${tasks.length} plików`);
}

// Elementy bez geometrii (relacje) zostawiamy — służą do rozwiązania nazwy
// ośrodka. Trasy i wyciągi zostawiamy, jeśli choć jeden punkt wpada w bbox.
// Źródło to osobny wycinek OSM dla PWA (`--refresh` pobiera go z Overpassa).
const OSM_SOURCE = path.resolve("scripts/data/overpass-pwa.json");
const OSM_MARGIN_DEG = 0.03;
const OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

function overpassQuery() {
  const [west, south, east, north] = BBOX;
  const box = `${south - OSM_MARGIN_DEG},${west - OSM_MARGIN_DEG},${north + OSM_MARGIN_DEG},${east + OSM_MARGIN_DEG}`;
  return `[out:json][timeout:90];(
  way["piste:type"](${box});
  relation["piste:type"](${box});
  way["aerialway"](${box});
  relation["site"="piste"](${box});
);out body geom;`;
}

async function refreshOsmSource() {
  let lastError = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Szusownik-build/1.0",
        },
        body: `data=${encodeURIComponent(overpassQuery())}`,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!Array.isArray(payload.elements)) throw new Error("brak elements");
      await writeFile(OSM_SOURCE, JSON.stringify(payload));
      console.log(`OSM: pobrano ${payload.elements.length} elementów z ${endpoint}`);
      return payload;
    } catch (error) {
      lastError = error;
      console.warn(`OSM: ${endpoint} nie odpowiedział (${error.message})`);
    }
  }
  throw lastError;
}

async function buildSkiSnapshot() {
  const target = path.join(PUBLIC, "overpass-solden.json");
  const raw = process.argv.includes("--refresh")
    ? await refreshOsmSource()
    : JSON.parse(await readFile(OSM_SOURCE, "utf8"));
  const inside = ([lon, lat]) => lon >= BBOX[0] && lon <= BBOX[2] && lat >= BBOX[1] && lat <= BBOX[3];
  const pointsOf = (element) => {
    const points = [];
    for (const point of element.geometry ?? []) points.push([point.lon, point.lat]);
    for (const member of element.members ?? []) {
      for (const point of member.geometry ?? []) points.push([point.lon, point.lat]);
    }
    return points;
  };
  const elements = (raw.elements ?? []).filter((element) => {
    const points = pointsOf(element);
    return points.length === 0 || points.some(inside);
  });
  await writeFile(target, JSON.stringify({ elements }));
  console.log(`Snapshot tras: ${elements.length} / ${raw.elements.length} elementów w bbox`);
}

await fetchDem();
await fetchFontsAndSprites();
await buildSkiSnapshot();
console.log("\nGotowe. Kafelki podkładu zbuduj osobno CLI Protomaps (patrz nagłówek skryptu).");
