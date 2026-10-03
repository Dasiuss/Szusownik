// Test zgodności wspólnego protokołu. SSOT: protocol/ble-file-v1.json.
// Jeśli ten test padnie, uruchom: node scripts/gen-protocol.mjs (albo
// `npm run gen:protocol` w web/) i zacommituj wygenerowane pliki.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HEADER_OUTPUT, renderProtocolHeader, renderProtocolTs, TS_OUTPUT } from "../../../scripts/gen-protocol.mjs";
import { DEVICE_CSV_V2_HEADER } from "./csv.ts";
import {
  SZ_BLE_ACK_BLOCK,
  SZ_BLE_FRAME_SIZE,
  SZ_BLE_HEADER_SIZE,
  SZ_BLE_PAYLOAD_SIZE,
  SZ_CSV_HEADER,
  SZ_WIRE_PROTO,
} from "./protocol.ts";

// Git na Windows (core.autocrlf) potrafi zamienić LF na CRLF przy checkout,
// więc porównujemy treść niezależnie od końców linii — liczy się zawartość.
function readNormalized(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

describe("wspólny spec protokołu", () => {
  it("wygenerowany protocol.ts jest aktualny", () => {
    expect(readNormalized(TS_OUTPUT)).toBe(renderProtocolTs());
  });

  it("wygenerowany protocol.h jest aktualny", () => {
    expect(readNormalized(HEADER_OUTPUT)).toBe(renderProtocolHeader());
  });

  it("nagłówek CSV ma jedną definicję (PWA == spec == firmware)", () => {
    expect(DEVICE_CSV_V2_HEADER).toBe(SZ_CSV_HEADER);
    expect(SZ_WIRE_PROTO).toBe("szusownik/ble-file-v1");
  });

  it("geometria ramki jest spójna", () => {
    expect(SZ_BLE_HEADER_SIZE + SZ_BLE_PAYLOAD_SIZE).toBe(SZ_BLE_FRAME_SIZE);
    expect(SZ_BLE_ACK_BLOCK).toBeGreaterThan(0);
    expect(SZ_BLE_ACK_BLOCK).toBeLessThanOrEqual(SZ_BLE_FRAME_SIZE * 8);
  });
});
