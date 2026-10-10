// Test zgodności wspólnego protokołu trasy. SSOT: protocol/route-v1.json.
// Jeśli ten test padnie, uruchom: node scripts/gen-route-protocol.mjs (albo
// `npm run gen:route-protocol` w web/) i zacommituj wygenerowane pliki.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HEADER_OUTPUTS,
  renderRouteHeader,
  renderRouteTs,
  TS_OUTPUT,
} from "../../../scripts/gen-route-protocol.mjs";
import {
  ROUTE_HEADER_SIZE,
  ROUTE_MAX_BLOB,
  ROUTE_MAX_LABEL,
  ROUTE_MAX_POINTS,
  ROUTE_MAX_SEGMENTS,
  ROUTE_POINT_SIZE,
  ROUTE_SEGMENT_HEADER_SIZE,
  ROUTE_WIRE_PROTO,
  SZ_UUID_ROUTE,
} from "./routeProtocol.ts";

// Git na Windows (core.autocrlf) potrafi zamienić LF na CRLF przy checkout,
// więc porównujemy treść niezależnie od końców linii — liczy się zawartość.
function readNormalized(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

describe("wspólny spec protokołu trasy", () => {
  it("wygenerowany routeProtocol.ts jest aktualny", () => {
    expect(readNormalized(TS_OUTPUT)).toBe(renderRouteTs());
  });

  it("oba nagłówki firmware są identyczne i aktualne", () => {
    const rendered = renderRouteHeader();
    expect(HEADER_OUTPUTS).toHaveLength(2);
    for (const path of HEADER_OUTPUTS) {
      expect(readNormalized(path)).toBe(rendered);
    }
  });

  it("oba firmware mają tę samą definicję (nagłówki bajt w bajt)", () => {
    const headers = HEADER_OUTPUTS.map(readNormalized);
    expect(headers[0]).toBe(headers[1]);
  });

  it("stałe geometrii bloba są spójne", () => {
    expect(ROUTE_WIRE_PROTO).toBe("szusownik/route-v1");
    expect(SZ_UUID_ROUTE).toMatch(/^3f9a0006-/);
    // Maksymalny blob musi się zmieścić w zadeklarowanym limicie.
    const worstCase =
      ROUTE_HEADER_SIZE +
      ROUTE_MAX_POINTS * ROUTE_POINT_SIZE +
      ROUTE_MAX_SEGMENTS * (ROUTE_SEGMENT_HEADER_SIZE + ROUTE_MAX_LABEL) +
      4;
    expect(ROUTE_MAX_BLOB).toBeGreaterThanOrEqual(worstCase);
  });
});
