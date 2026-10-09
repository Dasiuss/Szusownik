// Test zgodności wspólnego protokołu ESP-NOW HUD (Szusownik <-> HudRekaw).
// SSOT: protocol/hud-espnow-v1.json. Jeśli ten test padnie, uruchom:
//   node scripts/gen-hud-protocol.mjs (albo `npm run gen:hud-protocol` w web/)
// i zacommituj wygenerowane nagłówki.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HUD_HEADER_OUTPUTS,
  renderHudProtocolHeader,
} from "../../../scripts/gen-hud-protocol.mjs";

// Git na Windows (core.autocrlf) potrafi zamienić LF na CRLF przy checkout,
// więc porównujemy treść niezależnie od końców linii — liczy się zawartość.
function readNormalized(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

describe("wspólny spec protokołu HUD", () => {
  it("oba nagłówki firmware są identyczne i aktualne", () => {
    const rendered = renderHudProtocolHeader();
    expect(HUD_HEADER_OUTPUTS).toHaveLength(2);
    for (const path of HUD_HEADER_OUTPUTS) {
      expect(readNormalized(path)).toBe(rendered);
    }
  });

  it("oba firmware mają tę samą definicję (nagłówki bajt w bajt)", () => {
    const headers = HUD_HEADER_OUTPUTS.map(readNormalized);
    expect(headers[0]).toBe(headers[1]);
  });
});
