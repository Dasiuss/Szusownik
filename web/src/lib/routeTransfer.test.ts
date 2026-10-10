import { describe, expect, it } from "vitest";
import type { Position } from "./mapData.ts";
import type { RouteResult } from "./mapRouting.ts";
import {
  crc32,
  decodeRoute,
  emptyRouteBlob,
  encodeRoute,
  ROUTE_BLOB_VERSION,
} from "./routeTransfer.ts";
import {
  ROUTE_HEADER_SIZE,
  ROUTE_METERS_PER_DEG_LAT,
  ROUTE_POINT_SIZE,
} from "./routeProtocol.ts";

function piste(uid: string, label: string, coordinates: Position[], kind: "piste" | "lift" = "piste") {
  return {
    type: "Feature" as const,
    properties: { kind, color: "#1557b0", uid, label },
    geometry: { type: "LineString" as const, coordinates },
  };
}

function sampleRoute(): RouteResult {
  const down: Position[] = [
    [11.0, 46.95],
    [11.002, 46.948],
    [11.004, 46.945],
    [11.006, 46.942],
  ];
  const lift: Position[] = [
    [11.006, 46.942],
    [11.004, 46.947],
    [11.0, 46.95],
  ];
  const features = [piste("way/1", "1", down), piste("way/2", "Gaislachkogl", lift, "lift")];
  return {
    distanceM: 0,
    cost: [0, 0, 0, 0, 0, 0],
    sequence: [
      { uid: "way/1", label: "1", kind: "piste", color: "#1557b0", aerialway: "" },
      { uid: "way/2", label: "Gaislachkogl", kind: "lift", color: "#7c3aed", aerialway: "chair_lift" },
    ],
    segments: { type: "FeatureCollection", features },
    start: down[0],
    end: lift[lift.length - 1],
  };
}

describe("kod trasy (encode/decode)", () => {
  it("koduje nagłówek, punkty i odcinki oraz waliduje CRC", () => {
    const { bytes, crc, hasRoute } = encodeRoute(sampleRoute());
    expect(hasRoute).toBe(true);

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint16(0, true)).toBe(ROUTE_BLOB_VERSION);
    expect(view.getUint16(10, true)).toBeGreaterThan(1); // pointCount
    expect(view.getUint16(12, true)).toBe(2); // segmentCount
    expect(view.getUint16(14, true)).toBeGreaterThan(0); // totalDistanceM

    // Origin to pierwszy punkt trasy (lat/lon e7).
    expect(view.getInt32(2, true)).toBe(Math.round(46.95 * 1e7));
    expect(view.getInt32(6, true)).toBe(Math.round(11.0 * 1e7));

    const decoded = decodeRoute(bytes);
    expect(decoded).not.toBeNull();
    expect(decoded!.crc).toBe(crc);
    expect(decoded!.steps.map((step) => step.label)).toEqual(["1", "Gaislachkogl"]);
    expect(decoded!.steps.map((step) => step.kind)).toEqual(["piste", "lift"]);
    expect(decoded!.points).toHaveLength(view.getUint16(10, true));
    // Pierwszy punkt jest w origin.
    expect(decoded!.points[0]).toEqual([0, 0]);
    // Odcinki pokrywają całą trasę i są ciągłe.
    expect(decoded!.steps[0].startDistM).toBe(0);
    expect(decoded!.steps[0].endDistM).toBe(decoded!.steps[1].startDistM);
    expect(decoded!.steps[decoded!.steps.length - 1].endDistM).toBe(decoded!.totalDistanceM);
  });

  it("decymuje punkty do zadanego kroku (mniej niż surowe)", () => {
    const dense: RouteResult = sampleRoute();
    // Powtórz geometrię tak, by było dużo punktów w małych odstępach.
    const coordinates: Position[] = [];
    for (let index = 0; index <= 400; index += 1) coordinates.push([11.0 + index * 0.000002, 46.95 - index * 0.000001]);
    dense.segments.features = [piste("way/1", "1", coordinates)];
    const { bytes } = encodeRoute(dense);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const pointCount = view.getUint16(10, true);
    expect(pointCount).toBeLessThan(coordinates.length);
    // Każdy punkt to 4 B + nagłówek 16 B + CRC 4 B, a odcinek do 18 B.
    expect(bytes.length).toBeGreaterThanOrEqual(ROUTE_HEADER_SIZE + pointCount * ROUTE_POINT_SIZE + 4);
  });

  it("pusty blob reprezentuje brak trasy", () => {
    const { bytes, hasRoute } = emptyRouteBlob();
    const decoded = decodeRoute(bytes);
    expect(hasRoute).toBe(false);
    expect(decoded).not.toBeNull();
    expect(decoded!.hasRoute).toBe(false);
    expect(decoded!.points).toHaveLength(0);
    expect(decoded!.steps).toHaveLength(0);
  });

  it("odrzuca blob z uszkodzonym CRC", () => {
    const { bytes } = encodeRoute(sampleRoute());
    const corrupted = bytes.slice();
    corrupted[ROUTE_HEADER_SIZE] = (corrupted[ROUTE_HEADER_SIZE] + 1) & 0xff;
    expect(decodeRoute(corrupted)).toBeNull();
  });

  it("te same współrzędne dają ten sam CRC (tożsamość trasy)", () => {
    const first = encodeRoute(sampleRoute());
    const second = encodeRoute(sampleRoute());
    expect(first.crc).toBe(second.crc);
  });

  it("origin jest bazą dla lokalnych metrów", () => {
    const { bytes } = encodeRoute(sampleRoute());
    const decoded = decodeRoute(bytes)!;
    // Ostatni punkt (koniec wyciągu) jest ~ na północ od startu.
    const lastPoint = decoded.points[decoded.points.length - 1];
    const expectedNorth = (46.95 - 46.95) * ROUTE_METERS_PER_DEG_LAT;
    expect(lastPoint[1]).toBeCloseTo(expectedNorth, 0);
  });

  it("crc32 jest zgodny ze standardem IEEE", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});
