// Generator wspólnego protokołu BLE Szusownika.
//
// SSOT: protocol/ble-file-v1.json. Ten skrypt renderuje:
//   - web/src/lib/protocol.ts                  (PWA, TypeScript)
//   - firmware/Szusownik/src/config/protocol.h (firmware, C++)
// Oba pliki są commitowane; test web/src/lib/protocol.test.ts sprawdza, że są
// aktualne (regeneruje w pamięci i porównuje z zawartością na dysku).
//
// Uruchomienie (z katalogu repo):
//   node scripts/gen-protocol.mjs
//
// Zasada: NIE edytuj wygenerowanych plików ręcznie — zmień spec i uruchom skrypt.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "..");
export const SPEC_PATH = join(REPO_ROOT, "protocol", "ble-file-v1.json");
export const TS_OUTPUT = join(REPO_ROOT, "web", "src", "lib", "protocol.ts");
export const HEADER_OUTPUT = join(REPO_ROOT, "firmware", "Szusownik", "src", "config", "protocol.h");

const BANNER = [
  "// GENERATED FILE - DO NOT EDIT.",
  "// Source: protocol/ble-file-v1.json",
  "// Regenerate: node scripts/gen-protocol.mjs",
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

export function renderProtocolTs(spec = loadSpec()) {
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

export function renderProtocolHeader(spec = loadSpec()) {
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
  const ts = renderProtocolTs(spec);
  const header = renderProtocolHeader(spec);
  mkdirSync(dirname(TS_OUTPUT), { recursive: true });
  mkdirSync(dirname(HEADER_OUTPUT), { recursive: true });
  writeFileSync(TS_OUTPUT, ts, "utf8");
  writeFileSync(HEADER_OUTPUT, header, "utf8");
  return { ts, header, tsPath: TS_OUTPUT, headerPath: HEADER_OUTPUT };
}

function main() {
  const { tsPath, headerPath } = generate();
  console.log(`protocol: ${tsPath}`);
  console.log(`protocol: ${headerPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
