// Wspólna transliteracja nazw do czystego ASCII. Używana przez PWA
// (`web/src/lib/routeTransfer.ts`, etykiety trasy wysyłane do Szusownika i
// dalej do HudRekaw) ORAZ przez generator mapy flash HudRekaw
// (`scripts/build-map.mjs`). Oba firmware mają czcionki wyłącznie ASCII
// (Adafruit GFX na SSD1306 i ST7789), a blob trasy (`protocol/route-v1.json`)
// niesie etykiety jako `char[]`, więc urządzenia muszą dostać sam ASCII.
//
// Nie jest to plik TypeScript, bo importuje go też skrypt Node-a (build-map.mjs).
// Deklaracje typów są w `asciiFold.d.mts`.
//
// Kolejność: NFD + usunięcie znaków łączących załatwia akcenty (á, é, ö, ą,
// ń, ř, š...). Znaki bez rozkładu NFD (ß, ł, ø, æ, œ, đ, ...) mają jawną
// tabelę. Na końcu wypadają wszystkie znaki spoza 0x20-0x7E.

const SPECIAL_FOLD = {
  // Niemiecki: ß -> ss (umlauty składają się przez NFD do pojedynczej litery).
  "ß": "ss",
  "ẞ": "SS",
  // Polskie i skandynawskie (bez rozkładu NFD).
  "ł": "l",
  "Ł": "L",
  "ø": "o",
  "Ø": "O",
  // Ligatury.
  "æ": "ae",
  "Æ": "AE",
  "œ": "oe",
  "Œ": "OE",
  "ĳ": "ij",
  "Ĳ": "IJ",
  // Pozostałe łacińskie znaki bez rozkładu NFD.
  "đ": "d",
  "Đ": "D",
  "ð": "d",
  "Ð": "D",
  "þ": "th",
  "Þ": "TH",
  "ı": "i",
  "İ": "I",
  "ŋ": "ng",
  "Ŋ": "NG",
  "ħ": "h",
  "Ħ": "H",
  "ŧ": "t",
  "Ŧ": "T",
  "ſ": "s",
  "ĸ": "k",
  "µ": "u",
};

/**
 * Transliteruje wartość do czystego ASCII (0x20-0x7E) i przycina brzegi.
 * Znaki, których nie da się złożyć (inne alfabety, emoji), są usuwane.
 *
 * @param {string} value
 * @returns {string}
 */
export function asciiFold(value) {
  if (typeof value !== "string") return "";
  const decomposed = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let out = "";
  for (const char of decomposed) {
    if (Object.hasOwn(SPECIAL_FOLD, char)) {
      out += SPECIAL_FOLD[char];
    } else if (char >= " " && char <= "~") {
      out += char;
    }
  }
  return out.trim();
}
