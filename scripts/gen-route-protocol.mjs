// Generator wspólnego protokołu trasy nawigacyjnej (PWA <-> Szusownik <-> HudRekaw).
//
// SSOT: protocol/route-v1.json. Ten skrypt renderuje te same stałe do trzech miejsc:
//   - web/src/lib/routeProtocol.ts                    (PWA, TypeScript)
//   - firmware/Szusownik/src/config/route_protocol.h  (firmware, C++)
//   - firmware/HudRekaw/src/config/route_protocol.h   (firmware, C++)
// Wszystkie pliki są commitowane; test web/src/lib/routeProtocol.test.ts sprawdza,
// że są aktualne (regeneruje w pamięci i porównuje z zawartością na dysku).
//
// Uruchomienie (z katalogu repo):
//   node scripts/gen-route-protocol.mjs
//
// Zasada: NIE edytuj wygenerowanych plików ręcznie — zmień spec i uruchom skrypt.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "..");
export const SPEC_PATH = join(REPO_ROOT, "protocol", "route-v1.json");
export const TS_OUTPUT = join(REPO_ROOT, "web", "src", "lib", "routeProtocol.ts");
export const HEADER_OUTPUTS = [
  join(REPO_ROOT, "firmware", "Szusownik", "src", "config", "route_protocol.h"),
  join(REPO_ROOT, "firmware", "HudRekaw", "src", "config", "route_protocol.h"),
];

const BANNER = [
  "// GENERATED FILE - DO NOT EDIT.",
  "// Source: protocol/route-v1.json",
  "// Regenerate: node scripts/gen-route-protocol.mjs",
];

export function loadSpec(specPath = SPEC_PATH) {
  return JSON.parse(readFileSync(specPath, "utf8"));
}

function cppString(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function numberEntries(spec) {
  return [
    ...Object.entries(spec.numbers ?? {}),
    ...Object.entries(spec.floats ?? {}).map(([key, value]) => [key, { value, float: true }]),
  ].map(([key, raw]) => (typeof raw === "object" ? [key, raw.value, true] : [key, raw, false]));
}

export function renderRouteTs(spec = loadSpec()) {
  const lines = [...BANNER, ""];
  for (const [key, value] of numberEntries(spec)) {
    lines.push(`export const ${key} = ${value};`);
  }
  if (lines[lines.length - 1] !== "") lines.push("");
  for (const [key, value] of Object.entries(spec.strings ?? {})) {
    lines.push(`export const ${key} = ${JSON.stringify(value)};`);
  }
  lines.push("");
  return lines.join("\n");
}

export function renderRouteHeader(spec = loadSpec()) {
  const lines = [...BANNER, "#pragma once", ""];
  for (const [key, value, isFloat] of numberEntries(spec)) {
    lines.push(`#define ${key} ${isFloat ? `${value}.0f` : value}`);
  }
  if (lines[lines.length - 1] !== "") lines.push("");
  for (const [key, value] of Object.entries(spec.strings ?? {})) {
    lines.push(`#define ${key} ${cppString(value)}`);
  }
  lines.push("");
  return lines.join("\n");
}

export function generate({ specPath = SPEC_PATH } = {}) {
  const spec = loadSpec(specPath);
  const ts = renderRouteTs(spec);
  const header = renderRouteHeader(spec);
  mkdirSync(dirname(TS_OUTPUT), { recursive: true });
  writeFileSync(TS_OUTPUT, ts, "utf8");
  for (const output of HEADER_OUTPUTS) {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, header, "utf8");
  }
  return { ts, header, tsPath: TS_OUTPUT, headerPaths: HEADER_OUTPUTS };
}

function main() {
  const { tsPath, headerPaths } = generate();
  console.log(`route-protocol: ${tsPath}`);
  for (const path of headerPaths) console.log(`route-protocol: ${path}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
