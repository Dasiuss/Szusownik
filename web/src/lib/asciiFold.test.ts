import { describe, expect, it } from "vitest";
import { asciiFold } from "./asciiFold.mjs";

// Transliteracja trafia na urządzenia o czcionce ASCII (OLED Szusownik, ST7789
// HudRekaw) i do bloba trasy (`char[labelLength]`), więc wynik MUSI być czystym
// ASCII. Umlauty składamy do pojedynczej litery, ß do ss; ł, ø, æ, œ, đ i
// pokrewne (bez rozkładu NFD) mają jawne mapowanie zamiast być wyrzucane.

describe("asciiFold: niemiecki", () => {
  it("składa umlauty do pojedynczej litery", () => {
    expect(asciiFold("Sölden")).toBe("Solden");
    expect(asciiFold("Ötztal")).toBe("Otztal");
    expect(asciiFold("Zürs")).toBe("Zurs");
    expect(asciiFold("Güpfi")).toBe("Gupfi");
    expect(asciiFold("über")).toBe("uber");
  });

  it("zamienia ß na ss (w tym ẞ -> SS)", () => {
    expect(asciiFold("Straße")).toBe("Strasse");
    expect(asciiFold("Großglockner")).toBe("Grossglockner");
    expect(asciiFold("Weißsee")).toBe("Weisssee");
    expect(asciiFold("STRAẞE")).toBe("STRASSE");
  });
});

describe("asciiFold: polski", () => {
  it("składa znaki diakrytyczne do ASCII", () => {
    expect(asciiFold("Łódź")).toBe("Lodz");
    expect(asciiFold("Wrocławska")).toBe("Wroclawska");
    expect(asciiFold("Gąsienicowa")).toBe("Gasienicowa");
    expect(asciiFold("Śnieżka")).toBe("Sniezka");
    expect(asciiFold("Żółw")).toBe("Zolw");
    expect(asciiFold("Ćwiczenie")).toBe("Cwiczenie");
    expect(asciiFold("źródło")).toBe("zrodlo");
    expect(asciiFold("pięć")).toBe("piec");
    expect(asciiFold("Narciarski")).toBe("Narciarski");
  });
});

describe("asciiFold: wspólne łacińskie", () => {
  it("obsługuje litery bez rozkładu NFD i ligatury", () => {
    expect(asciiFold("Bjørn")).toBe("Bjorn");
    expect(asciiFold("Åre")).toBe("Are");
    expect(asciiFold("Ærø")).toBe("AEro");
    expect(asciiFold("Œuvre")).toBe("OEuvre");
    expect(asciiFold("Đakovo")).toBe("Dakovo");
    expect(asciiFold("Þingvellir")).toBe("THingvellir");
  });

  it("obsługuje akcenty z rozkładem NFD", () => {
    expect(asciiFold("Café")).toBe("Cafe");
    expect(asciiFold("El Niño")).toBe("El Nino");
    expect(asciiFold("Façade")).toBe("Facade");
    expect(asciiFold("Špindlerův Mlýn")).toBe("Spindleruv Mlyn");
  });
});

describe("asciiFold: zachowanie ogólne", () => {
  it("przepuszcza czysty ASCII bez zmian", () => {
    expect(asciiFold("15")).toBe("15");
    expect(asciiFold("Gaislachkogl")).toBe("Gaislachkogl");
    expect(asciiFold("Piste 3A")).toBe("Piste 3A");
    expect(asciiFold("")).toBe("");
  });

  it("przycina białe znaki z brzegów", () => {
    expect(asciiFold("  Sölden  ")).toBe("Solden");
  });

  it("usuwa znaki spoza ASCII, których nie da się złożyć (inne alfabety)", () => {
    expect(asciiFold("Гора")).toBe("");
    expect(asciiFold("山")).toBe("");
    expect(asciiFold("Plan🚡A")).toBe("PlanA");
  });

  it("wynik nigdy nie zawiera znaków spoza 0x20-0x7E", () => {
    const samples = [
      "Sölden",
      "Grüßgott",
      "Łódź",
      "Wrocławska",
      "Bjørn",
      "Ærø",
      "Þingvellir",
      "Špindlerův Mlýn",
      "Гора",
      "Кавказ",
      "Ça va très bien",
      "naïve café",
      "Nürnberg",
      "Aßling",
    ];
    for (const sample of samples) {
      expect(asciiFold(sample)).toMatch(/^[\x20-\x7e]*$/);
    }
  });
});
