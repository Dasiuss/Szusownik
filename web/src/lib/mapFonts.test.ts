// Pilnuje, żeby każdy krój pisma użyty w kodzie miał komplet glifów w
// `web/public/fonts/`. Brak pliku nie kończy się błędem sieci: serwer dev/PWA
// zwraca wtedy `index.html` z kodem 200, MapLibre parsuje HTML jako PBF
// i sypie „Unimplemented type: 4" oraz rysuje tekst czcionką systemową.
//
// Lista zakresów pochodzi z `scripts/build-map-assets.mjs` (jedno źródło prawdy).

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(WEB_ROOT, "src");
const FONTS = path.join(WEB_ROOT, "public", "fonts");
const BUILD_SCRIPT = path.resolve(WEB_ROOT, "../scripts/build-map-assets.mjs");

function walkSource(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSource(full, files);
    else if (/\.tsx?$/.test(entry.name)) files.push(full);
  }
  return files;
}

/** Krój użyty w `text-font` — zeskanowany z kodu, nie z konfiguracji. */
function usedFontStacks(): string[] {
  const stacks = new Set<string>();
  for (const file of walkSource(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/Noto Sans [A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*)*/g)) {
      stacks.add(match[0]);
    }
  }
  return [...stacks].sort();
}

/** Zakresy z build-skryptu, np. `0-255`. */
function builtRanges(): string[] {
  const script = readFileSync(BUILD_SCRIPT, "utf8");
  const block = script.match(/FONT_RANGES\s*=\s*\[([\s\S]*?)\]/)?.[1];
  if (!block) throw new Error("Nie znaleziono FONT_RANGES w scripts/build-map-assets.mjs");
  return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

describe("glify mapy", () => {
  it("każdy krój z kodu ma komplet glifów w web/public/fonts", () => {
    const stacks = usedFontStacks();
    const ranges = builtRanges();
    expect(stacks.length).toBeGreaterThan(0);
    expect(ranges.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const stack of stacks) {
      for (const range of ranges) {
        const file = path.join(FONTS, stack, `${range}.pbf`);
        let size = 0;
        try {
          size = statSync(file).size;
        } catch {
          missing.push(`${stack}/${range}.pbf`);
          continue;
        }
        // Prawdziwy glif PBF zaczyna się od pola 1 (stacks) — bajt 0x0a.
        // HTML z fallbacku SPA serwera zaczyna się od "<" (0x3c).
        if (size === 0 || readFileSync(file)[0] !== 0x0a) {
          missing.push(`${stack}/${range}.pbf (niepoprawny PBF, ${size} B)`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
