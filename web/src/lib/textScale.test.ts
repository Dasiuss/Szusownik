import { describe, expect, it } from "vitest";
import { BASE_FONT_PX, rootFontSizePx, scaledTextPx } from "./textScale.ts";

// Tekst rysowany poza CSS (etykiety osi wykresów, etykiety mapy) nie widzi
// `min(rem, cap)` z index.css, więc liczy ten sam sufit tutaj. Wartości
// muszą odpowiadać tabeli z docs/wymagania-PWA.md (Zasady UI).

describe("scaledTextPx", () => {
  it("przy skali systemowej 100% zwraca dokładnie dzisiejszy rozmiar", () => {
    expect(scaledTextPx(9, 22, BASE_FONT_PX)).toBe(9);
    expect(scaledTextPx(11, 22, BASE_FONT_PX)).toBe(11);
    expect(scaledTextPx(12, 24, BASE_FONT_PX)).toBe(12);
    expect(scaledTextPx(14, 24, BASE_FONT_PX)).toBe(14);
    expect(scaledTextPx(16, 26, BASE_FONT_PX)).toBe(16);
  });

  it("poniżej sufitu rośnie proporcjonalnie do skali", () => {
    expect(scaledTextPx(10, 22, 24)).toBe(15);
    expect(scaledTextPx(12, 24, 24)).toBe(18);
    expect(scaledTextPx(11, 22, 20)).toBeCloseTo(13.75);
    expect(scaledTextPx(11, 22, 32)).toBe(22);
  });

  it("przycina do sufitu, zamiast rosnąć bez końca", () => {
    expect(scaledTextPx(14, 24, 32)).toBe(24);
    expect(scaledTextPx(16, 26, 32)).toBe(26);
    expect(scaledTextPx(16, 26, 96)).toBe(26);
  });

  it("nigdy nie schodzi poniżej proporcji przy skali mniejszej niż 100%", () => {
    expect(scaledTextPx(11, 22, 14)).toBeCloseTo(9.625);
  });
});

describe("rootFontSizePx", () => {
  it("poza przeglądarką zwraca bazowe 16 px", () => {
    expect(rootFontSizePx()).toBe(BASE_FONT_PX);
  });
});
