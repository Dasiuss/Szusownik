import type { Position } from "./mapData.ts";
import type { RouteResult } from "./mapRouting.ts";
import {
  ROUTE_CRC_SIZE,
  ROUTE_FORMAT_VERSION,
  ROUTE_HEADER_SIZE,
  ROUTE_KIND_LIFT,
  ROUTE_KIND_PISTE,
  ROUTE_MAX_LABEL,
  ROUTE_MAX_POINTS,
  ROUTE_MAX_SEGMENTS,
  ROUTE_METERS_PER_DEG_LAT,
  ROUTE_METERS_PER_DEG_LON,
  ROUTE_POINT_SIZE,
  ROUTE_SAMPLE_SPACING_M,
  ROUTE_SEGMENT_HEADER_SIZE,
} from "./routeProtocol.ts";

// Kanoniczny blob trasy (SSOT: protocol/route-v1.json). Ten sam format czyta
// firmware Szusownika (postęp/dotarcie) i HudRekaw (rysowanie). Tożsamość trasy
// = CRC32 bloba, więc porównanie wersji (PWA <-> urządzenie <-> HudRekaw) to
// jedno pole.

export const ROUTE_BLOB_VERSION = ROUTE_FORMAT_VERSION;

export interface RouteStep {
  label: string;
  kind: "piste" | "lift";
  startDistM: number;
  endDistM: number;
}

export interface DecodedRoute {
  origin: Position;
  /** Punkty trasy jako [east, north] w metrach względem origin. */
  points: Position[];
  steps: RouteStep[];
  totalDistanceM: number;
  crc: number;
  hasRoute: boolean;
}

export interface EncodedRoute {
  bytes: Uint8Array;
  crc: number;
  hasRoute: boolean;
}

let crcTable: Uint32Array | null = null;

/** CRC32 (IEEE 802.3) — identyczny z firmware `szCrc32` i transferem plików. */
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      crcTable[index] = value >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = (crcTable[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function asciiLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "")
    .trim();
}

function clampI16(value: number): number {
  if (value > 32767) return 32767;
  if (value < -32768) return -32768;
  return Math.round(value);
}

function clampU16(value: number): number {
  if (value > 65535) return 65535;
  if (value < 0) return 0;
  return Math.round(value);
}

function metersPerDegLon(latitude: number): number {
  return ROUTE_METERS_PER_DEG_LON * Math.max(Math.cos((latitude * Math.PI) / 180), 0.1);
}

function emptyBytes(): Uint8Array {
  const bytes = new Uint8Array(ROUTE_HEADER_SIZE + ROUTE_CRC_SIZE);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, ROUTE_FORMAT_VERSION, true);
  view.setUint32(ROUTE_HEADER_SIZE, crc32(bytes.subarray(0, ROUTE_HEADER_SIZE)), true);
  return bytes;
}

export function emptyRouteBlob(): EncodedRoute {
  const bytes = emptyBytes();
  const view = new DataView(bytes.buffer);
  return { bytes, crc: view.getUint32(ROUTE_HEADER_SIZE, true), hasRoute: false };
}

interface SourcePoint {
  position: Position;
  label: string;
  kind: "piste" | "lift" | null;
  key: string;
}

function collectSourcePoints(route: RouteResult): SourcePoint[] {
  const points: SourcePoint[] = [];
  for (const feature of route.segments.features) {
    const properties = feature.properties;
    const kind = properties.kind === "lift" ? "lift" : properties.kind === "piste" ? "piste" : null;
    const label = asciiLabel(properties.label ?? "").slice(0, ROUTE_MAX_LABEL);
    const key = kind ? `${kind}:${properties.uid ?? label}` : "";
    for (const coordinate of feature.geometry.coordinates) {
      points.push({ position: coordinate, label, kind, key });
    }
  }
  // Odcinki łączące (connection) nie mają tożsamości — dziedziczą po poprzednim
  // odcinku, a początkowe po następnym (żadne metry nie zostają „bez odcinka").
  let previous: { label: string; kind: "piste" | "lift"; key: string } | null = null;
  for (const point of points) {
    if (point.kind) previous = { label: point.label, kind: point.kind, key: point.key };
    else if (previous) {
      point.label = previous.label;
      point.kind = previous.kind;
      point.key = previous.key;
    }
  }
  let next: { label: string; kind: "piste" | "lift"; key: string } | null = null;
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const point = points[index];
    if (point.kind) next = { label: point.label, kind: point.kind, key: point.key };
    else if (next) {
      point.label = next.label;
      point.kind = next.kind;
      point.key = next.key;
    }
  }
  for (const point of points) {
    if (!point.kind) {
      point.label = "Trasa";
      point.kind = "piste";
      point.key = "piste:";
    }
  }
  return points;
}

/** Decymacja dystansowa: zachowuje pierwszy, ostatni i punkty co >= spacing. */
function decimate(points: SourcePoint[], origin: Position, spacing: number): number[] {
  const lonScale = metersPerDegLon(origin[1]);
  const toMeters = (position: Position): Position => [
    (position[0] - origin[0]) * lonScale,
    (position[1] - origin[1]) * ROUTE_METERS_PER_DEG_LAT,
  ];
  const kept: number[] = [0];
  let lastDistance = 0;
  let cumulative = 0;
  let previous = toMeters(points[0].position);
  for (let index = 1; index < points.length; index += 1) {
    const current = toMeters(points[index].position);
    cumulative += Math.hypot(current[0] - previous[0], current[1] - previous[1]);
    previous = current;
    if (cumulative - lastDistance >= spacing || index === points.length - 1) {
      if (kept[kept.length - 1] !== index) {
        kept.push(index);
        lastDistance = cumulative;
      }
    }
  }
  return kept;
}

export function encodeRoute(route: RouteResult | null): EncodedRoute {
  if (!route || route.segments.features.length === 0) return emptyRouteBlob();
  const source = collectSourcePoints(route);
  if (source.length < 2) return emptyRouteBlob();

  const origin = source[0].position;
  let spacing = ROUTE_SAMPLE_SPACING_M;
  let kept = decimate(source, origin, spacing);
  // Gdyby trasa była bardzo gęsta, rozluźniamy krok, żeby zmieścić się w limicie.
  while (kept.length > ROUTE_MAX_POINTS) {
    spacing *= 1.4;
    kept = decimate(source, origin, spacing);
  }

  const lonScale = metersPerDegLon(origin[1]);
  const localPoints: Position[] = [];
  const cumulative: number[] = [0];
  for (let index = 0; index < kept.length; index += 1) {
    const position = source[kept[index]].position;
    const local: Position = [
      Math.round((position[0] - origin[0]) * lonScale),
      Math.round((position[1] - origin[1]) * ROUTE_METERS_PER_DEG_LAT),
    ];
    localPoints.push(local);
    if (index > 0) {
      const previous = localPoints[index - 1];
      cumulative.push(cumulative[index - 1] + Math.hypot(local[0] - previous[0], local[1] - previous[1]));
    }
  }

  interface Group {
    label: string;
    kind: "piste" | "lift";
    key: string;
    firstIndex: number;
    lastIndex: number;
  }
  const groups: Group[] = [];
  for (let index = 0; index < kept.length; index += 1) {
    const point = source[kept[index]];
    const last = groups[groups.length - 1];
    if (last && last.key === point.key) last.lastIndex = index;
    else groups.push({ label: point.label || (point.kind === "lift" ? "Wyciag" : "Trasa"), kind: point.kind!, key: point.key, firstIndex: index, lastIndex: index });
  }

  let steps = groups.map((group, index) => ({
    label: group.label,
    kind: group.kind,
    startDistM: cumulative[group.firstIndex],
    endDistM: index + 1 < groups.length ? cumulative[groups[index + 1].firstIndex] : cumulative[cumulative.length - 1],
  }));
  if (steps.length > ROUTE_MAX_SEGMENTS) {
    // Zachowujemy pierwsze odcinki, a resztę scalą w ostatni (z wydłużeniem).
    const head = steps.slice(0, ROUTE_MAX_SEGMENTS - 1);
    head.push({ ...steps[ROUTE_MAX_SEGMENTS - 1], endDistM: steps[steps.length - 1].endDistM });
    steps = head;
  }

  const encodedSteps = steps.map((step) => {
    const label = asciiLabel(step.label).slice(0, ROUTE_MAX_LABEL);
    return {
      kind: step.kind === "lift" ? ROUTE_KIND_LIFT : ROUTE_KIND_PISTE,
      label,
      startDistM: clampU16(step.startDistM),
      endDistM: clampU16(step.endDistM),
    };
  });

  const segmentBytes = encodedSteps.reduce((sum, step) => sum + ROUTE_SEGMENT_HEADER_SIZE + step.label.length, 0);
  const size = ROUTE_HEADER_SIZE + localPoints.length * ROUTE_POINT_SIZE + segmentBytes + ROUTE_CRC_SIZE;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, ROUTE_FORMAT_VERSION, true);
  view.setInt32(2, Math.round(origin[1] * 1e7), true);
  view.setInt32(6, Math.round(origin[0] * 1e7), true);
  view.setUint16(10, localPoints.length, true);
  view.setUint16(12, encodedSteps.length, true);
  view.setUint16(14, clampU16(cumulative[cumulative.length - 1]), true);

  let offset = ROUTE_HEADER_SIZE;
  for (const point of localPoints) {
    view.setInt16(offset, clampI16(point[0]), true);
    view.setInt16(offset + 2, clampI16(point[1]), true);
    offset += ROUTE_POINT_SIZE;
  }
  for (const step of encodedSteps) {
    view.setUint8(offset, step.kind);
    view.setUint8(offset + 1, step.label.length);
    view.setUint16(offset + 2, step.startDistM, true);
    view.setUint16(offset + 4, step.endDistM, true);
    offset += ROUTE_SEGMENT_HEADER_SIZE;
    for (let index = 0; index < step.label.length; index += 1) bytes[offset + index] = step.label.charCodeAt(index) & 0x7f;
    offset += step.label.length;
  }
  const crc = crc32(bytes.subarray(0, offset));
  view.setUint32(offset, crc, true);
  return { bytes, crc, hasRoute: localPoints.length > 0 };
}

export function decodeRoute(bytes: Uint8Array): DecodedRoute | null {
  if (bytes.length < ROUTE_HEADER_SIZE + ROUTE_CRC_SIZE) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0, true) !== ROUTE_FORMAT_VERSION) return null;
  const originLat = view.getInt32(2, true) / 1e7;
  const originLon = view.getInt32(6, true) / 1e7;
  const pointCount = view.getUint16(10, true);
  const segmentCount = view.getUint16(12, true);
  const totalDistanceM = view.getUint16(14, true);
  if (pointCount > ROUTE_MAX_POINTS || segmentCount > ROUTE_MAX_SEGMENTS) return null;

  let offset = ROUTE_HEADER_SIZE;
  const points: Position[] = [];
  for (let index = 0; index < pointCount; index += 1) {
    if (offset + ROUTE_POINT_SIZE > bytes.length) return null;
    points.push([view.getInt16(offset, true), view.getInt16(offset + 2, true)]);
    offset += ROUTE_POINT_SIZE;
  }
  const steps: RouteStep[] = [];
  for (let index = 0; index < segmentCount; index += 1) {
    if (offset + ROUTE_SEGMENT_HEADER_SIZE > bytes.length) return null;
    const kind = view.getUint8(offset);
    const labelLength = view.getUint8(offset + 1);
    const startDistM = view.getUint16(offset + 2, true);
    const endDistM = view.getUint16(offset + 4, true);
    offset += ROUTE_SEGMENT_HEADER_SIZE;
    if (offset + labelLength > bytes.length) return null;
    let label = "";
    for (let charIndex = 0; charIndex < labelLength; charIndex += 1) label += String.fromCharCode(bytes[offset + charIndex]);
    offset += labelLength;
    steps.push({ label, kind: kind === ROUTE_KIND_LIFT ? "lift" : "piste", startDistM, endDistM });
  }
  if (offset + ROUTE_CRC_SIZE > bytes.length) return null;
  const storedCrc = view.getUint32(offset, true);
  if (storedCrc !== crc32(bytes.subarray(0, offset))) return null;
  return { origin: [originLon, originLat], points, steps, totalDistanceM, crc: storedCrc, hasRoute: pointCount > 0 };
}
