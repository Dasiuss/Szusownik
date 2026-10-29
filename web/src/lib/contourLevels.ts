// Progi poziomic dla `maplibre-contour` — czysta logika bez zależności od
// MapLibre, żeby dała się testować w Node.

export type ContourProfile = "pitch" | "zoom";

/** Bazowy (najgęstszy) interwał poziomic w metrach. */
export const CONTOUR_MINOR_M = 50;

/**
 * Progi poziomic per zoom: `[linia zwykła, linia główna]` (główna = 4×).
 *
 * - `pitch` — duża mapa z terenem 3D. Interwał jest stały od z10, bo przy
 *   pochyleniu MapLibre renderuje dalszy plan na niższym zoomie i gęstość
 *   linii na ekranie zależałaby od odległości (bliżej gęsto, dalej rzadko).
 * - `zoom` — płaskie mini-mapy (widok z góry). Interwał podwaja się co poziom
 *   oddalenia, więc odstęp linii na ekranie jest w przybliżeniu stały i przy
 *   dopasowaniu całego dnia poziomice nie zalewają obrazu.
 */
export function contourThresholds(
  profile: ContourProfile,
  minorMeters: number = CONTOUR_MINOR_M,
): Record<number, [number, number]> {
  const major = minorMeters * 4;
  if (profile === "zoom") {
    return {
      8: [minorMeters * 8, major * 8],
      9: [minorMeters * 8, major * 8],
      10: [minorMeters * 8, major * 8],
      11: [minorMeters * 8, major * 8],
      12: [minorMeters * 4, major * 4],
      13: [minorMeters * 2, major * 2],
      14: [minorMeters, major],
    };
  }
  return {
    8: [minorMeters * 4, major * 4],
    9: [minorMeters * 4, major * 4],
    10: [minorMeters, major],
    11: [minorMeters, major],
    12: [minorMeters, major],
    13: [minorMeters, major],
    14: [minorMeters, major],
  };
}
