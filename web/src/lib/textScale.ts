// Skalowanie tekstu rysowanego poza CSS: etykiety osi wykresów (Recharts, SVG)
// i etykiety mapy (MapLibre, `text-size` w px). Nie widzą one `min(rem, cap)`
// z index.css, więc liczą ten sam sufit w JS.
//
// Ustalenia i tabela sufitów: docs/wymagania-PWA.md → „Zasady UI”.

/** Bazowy rozmiar czcionki dokumentu przy systemowej skali 100%. */
export const BASE_FONT_PX = 16;

/** Sufity rozmiaru tekstu — te same liczby co w `min(<rem>, <px>)` w CSS. */
export const TEXT_CAP_PX = {
  /** Drobny tekst: eyebrow, podpisy, metadane, etykiety osi. */
  tiny: 22,
  /** Tekst i wartości: opisy, wiersze list, `h3`. */
  small: 24,
  /** Nagłówki i tytuły kart: `h2`. */
  medium: 26,
} as const;

/**
 * Bazowy rozmiar dokumentu w px. Chromium podstawia tu 16 px × systemową skalę
 * tekstu (efekt `<meta name="text-scale" content="scale">`).
 */
export function rootFontSizePx(): number {
  if (typeof document === "undefined") return BASE_FONT_PX;
  const value = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(value) && value > 0 ? value : BASE_FONT_PX;
}

/** Odpowiednik `min(<basePx>rem, <capPx>px)` z CSS, dla liczb w JS. */
export function scaledTextPx(basePx: number, capPx: number, rootPx: number = rootFontSizePx()): number {
  return Math.min(basePx * (rootPx / BASE_FONT_PX), capPx);
}
