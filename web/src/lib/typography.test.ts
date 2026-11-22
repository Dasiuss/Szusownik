import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Pilnuje reguły typografii: rozmiary czcionek są względne wobec bazowego
// rozmiaru dokumentu, żeby PWA reagowała na systemowy rozmiar tekstu Androida,
// a napisy, które są już duże, nie puchły (sufit `min(rem, cap)`).
// Ustalenia: docs/wymagania-PWA.md → „Zasady UI”.

const WEB_ROOT = new URL("../../", import.meta.url);
const CSS = readFileSync(new URL("src/index.css", WEB_ROOT), "utf8");
const HTML = readFileSync(new URL("index.html", WEB_ROOT), "utf8");

/** Wartości `font-size` dopuszczalne wprost w px — tylko napisy już duże. */
const LARGE_TEXT_SELECTORS = new Set(["h1", ".speed-value", ".detail-header h1"]);

/** Sufity wspólne z `min(<rem>, <px>)`: 22 drobny, 24 średni, 26 nagłówki,
 *  18 wyjątkowo dolna nawigacja (cztery długie polskie etykiety w jednym rzędzie). */
const CAPS = new Set([18, 22, 24, 26]);

interface Declaration {
  selectors: string[];
  value: string;
  line: number;
}

function fontSizes(): Declaration[] {
  const declarations: Declaration[] = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of CSS.matchAll(rule)) {
    const [whole, selectorText, body] = match;
    const selectors = selectorText.split(",").map((selector) => selector.trim()).filter(Boolean);
    const line = CSS.slice(0, match.index).split("\n").length;
    for (const bodyMatch of body.matchAll(/font-size\s*:\s*([^;]+)/g)) {
      declarations.push({ selectors, value: bodyMatch[1].trim(), line: line + whole.slice(0, whole.indexOf(bodyMatch[0])).split("\n").length - 1 });
    }
  }
  return declarations;
}

const REM = /^(\d+(?:\.\d+)?)rem$/;
const EM = /^(\d+(?:\.\d+)?|\.\d+)em$/;
const PERCENT = /^\d+(?:\.\d+)?%$/;
const CAPPED = /^min\(\s*(\d+(?:\.\d+)?)rem\s*,\s*(\d+(?:\.\d+)?)px\s*\)$/;
const PX = /^\d+(?:\.\d+)?px$/;
const CLAMP_PX = /^clamp\([^)]*px[^)]*\)$/;

describe("meta text-scale", () => {
  it("włącza skalowanie tekstu razem z systemem", () => {
    expect(HTML).toMatch(/<meta[^>]+name=["']text-scale["'][^>]+content=["']scale["']/i);
  });
});

describe("bazowy rozmiar dokumentu", () => {
  it("nie jest nadpisywany (zablokowałoby to skalowanie systemowe)", () => {
    const overrides = fontSizes().filter((declaration) =>
      declaration.selectors.some((selector) => ["html", ":root", "body", "*"].includes(selector)),
    );
    expect(overrides.map((declaration) => `${declaration.selectors.join(", ")} (linia ${declaration.line})`)).toEqual([]);
  });
});

describe("rozmiary czcionek", () => {
  it("każdy rozmiar jest względny, z sufitem albo dużym napisem", () => {
    const offenders: string[] = [];
    for (const { selectors, value, line } of fontSizes()) {
      const where = `${selectors.join(", ")} (linia ${line}): ${value}`;
      if (REM.test(value) || EM.test(value) || PERCENT.test(value)) continue;
      if (CAPPED.test(value)) continue;
      const large = selectors.every((selector) => LARGE_TEXT_SELECTORS.has(selector));
      if (large && (PX.test(value) || CLAMP_PX.test(value))) continue;
      offenders.push(where);
    }
    expect(offenders).toEqual([]);
  });

  it("rem jest dokładnym przeliczeniem z px (wielokrotność 1/2 px)", () => {
    const offenders: string[] = [];
    for (const { selectors, value, line } of fontSizes()) {
      const source = REM.exec(value) ?? CAPPED.exec(value);
      if (!source) continue;
      const px = Number(source[1]) * 16;
      if (Math.abs(px * 2 - Math.round(px * 2)) > 1e-9) offenders.push(`${selectors.join(", ")} (linia ${line}): ${value}`);
    }
    expect(offenders).toEqual([]);
  });

  it("sufit nie działa przy skali 100% i pochodzi z ustalonej drabinki", () => {
    const offenders: string[] = [];
    for (const { selectors, value, line } of fontSizes()) {
      const capped = CAPPED.exec(value);
      if (!capped) continue;
      const atFullSize = Number(capped[1]) * 16;
      const cap = Number(capped[2]);
      if (atFullSize > cap || cap !== Math.round(cap) || !CAPS.has(cap)) {
        offenders.push(`${selectors.join(", ")} (linia ${line}): ${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
