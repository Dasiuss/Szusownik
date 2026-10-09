// Generator wspólnego protokołu ESP-NOW HUD (Szusownik nadajnik <-> HudRekaw).
//
// SSOT: protocol/hud-espnow-v1.json. Ten skrypt renderuje ten sam nagłówek C++
// do obu firmware, które muszą mieć identyczne definicje pakietów:
//   - firmware/Szusownik/src/config/hud_protocol.h (nadajnik)
//   - firmware/HudRekaw/src/config/hud_protocol.h   (odbiornik)
// Oba pliki są commitowane; test web/src/lib/hudProtocol.test.ts sprawdza, że są
// aktualne (regeneruje w pamięci i porównuje z zawartością na dysku).
//
// Uruchomienie (z katalogu repo):
//   node scripts/gen-hud-protocol.mjs
//
// Zasada: NIE edytuj wygenerowanych plików ręcznie — zmień spec i uruchom skrypt.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "..");
export const SPEC_PATH = join(REPO_ROOT, "protocol", "hud-espnow-v1.json");
export const HUD_HEADER_OUTPUTS = [
  join(REPO_ROOT, "firmware", "Szusownik", "src", "config", "hud_protocol.h"),
  join(REPO_ROOT, "firmware", "HudRekaw", "src", "config", "hud_protocol.h"),
];

const BANNER = [
  "// GENERATED FILE - DO NOT EDIT.",
  "// Source: protocol/hud-espnow-v1.json",
  "// Regenerate: node scripts/gen-hud-protocol.mjs",
];

export function loadHudSpec(specPath = SPEC_PATH) {
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

export function renderHudProtocolHeader(spec = loadHudSpec()) {
  const lines = [...BANNER, "#pragma once", ""];
  for (const [key, value, isFloat] of numberEntries(spec)) {
    lines.push(`#define ${key} ${isFloat ? `${value}.0f` : value}`);
  }
  if (lines[lines.length - 1] !== "") lines.push("");
  for (const [key, value] of Object.entries(spec.strings ?? {})) {
    lines.push(`#define ${key} ${cppString(value)}`);
  }
  for (const [key, value] of Object.entries(spec.chars ?? {})) {
    lines.push(`#define ${key} '${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`);
  }
  lines.push("");
  return lines.join("\n");
}

export function generate({ specPath = SPEC_PATH } = {}) {
  const spec = loadHudSpec(specPath);
  const header = renderHudProtocolHeader(spec);
  for (const output of HUD_HEADER_OUTPUTS) {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, header, "utf8");
  }
  return { header, headerPaths: HUD_HEADER_OUTPUTS };
}

function main() {
  const { headerPaths } = generate();
  for (const path of headerPaths) console.log(`hud-protocol: ${path}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
