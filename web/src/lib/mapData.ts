import { clipLineToRect, clipRingToRect, type TileRect } from "./tileClip.ts";

export type Position = [number, number];

// Bbox danych mapy: west, south, east, north. Musi zgadzać się z
// `scripts/build-map-assets.mjs` i ekstrakcją `solden.pmtiles`.
export const SOLDEN_BOUNDS: [number, number, number, number] = [
  10.905, 46.886957, 11.028039, 46.999242,
];
export const SOLDEN_CENTER: Position = [10.977123714520985, 46.95802633395613];
export const ROUTE_SNAP_RADIUS_M = 100;

export const HOME_COORDINATES: Position = [11.0095, 46.9726];

// Snapshot OSM (trasy + wyciągi) budowany przez `scripts/build-map-assets.mjs`
// i precache'owany razem z resztą zasobów mapy. Brak zapytań do Overpassa.
const SKI_SNAPSHOT_URL = `${import.meta.env.BASE_URL}overpass-solden.json`;

export const DIFFICULTY_COLORS: Record<string, string> = {
  novice: "#22c55e",
  easy: "#60a5fa",
  intermediate: "#ef4444",
  advanced: "#111827",
  expert: "#f97316",
  unknown: "#888888",
};

export const AERIALWAY_LABELS: Record<string, string> = {
  chair_lift: "krzesełkowy",
  gondola: "gondolowy",
  cable_car: "kolejka linowa",
  drag_lift: "orczyk",
  "t-bar": "orczyk (T)",
  "j-bar": "orczyk (J)",
  platter: "talerczyk",
  rope_tow: "wyrwirączka",
  magic_carpet: "taśma",
  mixed_lift: "gondola+krzesełka",
  zip_line: "tyrolka",
};

export interface SkiProperties {
  uid: string;
  label: string;
  name: string;
  ref: string;
  difficulty: string;
  difficultyColor: string;
  pisteType: string;
  grooming: string;
  warning: boolean;
  site: string | null;
  aerialway: string;
  openingHours: string;
  routeKind: "piste" | "lift";
}

export interface SkiLineFeature {
  type: "Feature";
  id: string;
  properties: SkiProperties;
  geometry: {
    type: "LineString";
    coordinates: Position[];
  };
}

export interface SkiPolygonFeature {
  type: "Feature";
  id: string;
  properties: SkiProperties;
  geometry: {
    type: "Polygon";
    coordinates: Position[][];
  };
}

export type SkiFeature = SkiLineFeature | SkiPolygonFeature;

export interface SkiFeatureCollection {
  type: "FeatureCollection";
  features: SkiFeature[];
}

export interface SkiData {
  pistes: SkiFeatureCollection;
  lifts: SkiFeatureCollection;
  lines: SkiLineFeature[];
}

interface OverpassGeometryPoint {
  lat: number;
  lon: number;
}

interface OverpassMember {
  type: string;
  ref: number;
  role?: string;
  geometry?: OverpassGeometryPoint[];
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  tags?: Record<string, string>;
  geometry?: OverpassGeometryPoint[];
  members?: OverpassMember[];
}

interface OverpassResponse {
  elements?: OverpassElement[];
}

// Ostatnio wczytane dane tras — używane przez dopasowanie zjazdów do tras przy
// materializacji. Nie pobiera nic z sieci.
let matchingSkiData: SkiData | null = null;

function difficultyFor(tags: Record<string, string>): string {
  const difficulty = tags["piste:difficulty"] ?? tags.difficulty ?? "unknown";
  return DIFFICULTY_COLORS[difficulty] ? difficulty : "unknown";
}

function labelFor(tags: Record<string, string>): string {
  return tags.ref ?? tags.name ?? tags["piste:name"] ?? "";
}

function lineGeometry(element: OverpassElement): Position[] {
  if (element.geometry && element.geometry.length >= 2) {
    return element.geometry.map((point) => [point.lon, point.lat]);
  }
  return [];
}

function propertiesFor(element: OverpassElement, routeKind: "piste" | "lift", site: string | null): SkiProperties {
  const tags = element.tags ?? {};
  const difficulty = routeKind === "piste" ? difficultyFor(tags) : "unknown";
  const grooming = tags["piste:grooming"] ?? tags.grooming ?? "";
  return {
    uid: `${element.type}/${element.id}`,
    label: routeKind === "piste" ? labelFor(tags) : tags.name ?? tags.ref ?? "Wyciąg",
    name: routeKind === "lift" ? tags.name ?? tags.ref ?? "" : tags.name ?? "",
    ref: tags.ref ?? "",
    difficulty,
    difficultyColor: DIFFICULTY_COLORS[difficulty],
    pisteType: tags["piste:type"] ?? "",
    grooming,
    warning: grooming === "backcountry" || grooming === "mogul",
    site,
    aerialway: tags.aerialway ?? "",
    openingHours: tags.opening_hours ?? "",
    routeKind,
  };
}

function samePosition(a: Position, b: Position): boolean {
  return Math.abs(a[0] - b[0]) < 0.0000001 && Math.abs(a[1] - b[1]) < 0.0000001;
}

function normalizeElement(element: OverpassElement, routeKind: "piste" | "lift", site: string | null): SkiFeature | null {
  const tags = element.tags ?? {};
  if (routeKind === "piste") {
    const pisteType = tags["piste:type"] ?? "";
    if (!pisteType.split(/[;,]/).some((value) => value.trim() === "downhill")) return null;
    if ((tags["piste:grooming"] ?? tags.grooming) === "no" || tags["piste:difficulty"] === "freeride") return null;
  }

  const coordinates = lineGeometry(element);
  if (coordinates.length < 2) return null;
  const properties = propertiesFor(element, routeKind, site);
  const id = properties.uid;
  const closed = coordinates.length >= 4 && samePosition(coordinates[0], coordinates[coordinates.length - 1]);

  if (routeKind === "piste" && closed) {
    return {
      type: "Feature",
      id,
      properties,
      geometry: { type: "Polygon", coordinates: [coordinates] },
    };
  }
  return {
    type: "Feature",
    id,
    properties,
    geometry: { type: "LineString", coordinates },
  };
}

// Statusy, w których wyciąg nie jest czynny (projekty, budowa, zamknięte).
const NON_PASSENGER_AERIALWAY = new Set(["proposed", "construction", "abandoned", "disused", "razed", "no"]);

export function normalizeSkiData(elements: OverpassElement[]): SkiData {
  const pistes: SkiFeature[] = [];
  const lifts: SkiFeature[] = [];
  const seen = new Set<string>();

  const siteRelations = elements.filter((element) => element.type === "relation" && element.tags?.site === "piste");
  const routeRelations = elements.filter((element) => element.type === "relation" && Boolean(element.tags?.["piste:type"]));
  const memberToSite = new Map<string, string | null>();
  for (const siteRelation of siteRelations) {
    const site = siteRelation.tags?.name ?? null;
    for (const member of siteRelation.members ?? []) {
      if (member.type !== "node") memberToSite.set(`${member.type}/${member.ref}`, site);
    }
  }
  const wayToRoute = new Map<string, number>();
  for (const routeRelation of routeRelations) {
    for (const member of routeRelation.members ?? []) {
      if (member.type === "way") wayToRoute.set(`way/${member.ref}`, routeRelation.id);
    }
  }
  const routeToSite = new Map<number, string | null>();
  for (const routeRelation of routeRelations) {
    const site = memberToSite.get(`relation/${routeRelation.id}`);
    if (site) routeToSite.set(routeRelation.id, site);
  }
  const siteFor = (element: OverpassElement): string | null => {
    const direct = memberToSite.get(`${element.type}/${element.id}`);
    if (direct !== undefined) return direct;
    if (element.type === "way") {
      const routeId = wayToRoute.get(`way/${element.id}`);
      if (routeId !== undefined) return routeToSite.get(routeId) ?? null;
    }
    return null;
  };

  for (const element of elements) {
    const tags = element.tags ?? {};
    // Wyciągi w projekcie/budowie/nieczynne nie są częścią czynnego ośrodka.
    const isLift = Boolean(tags.aerialway) && !NON_PASSENGER_AERIALWAY.has(tags.aerialway);
    const isPiste = Boolean(tags["piste:type"]);
    if (!isLift && !isPiste) continue;
    const feature = normalizeElement(element, isLift ? "lift" : "piste", siteFor(element));
    if (!feature || seen.has(feature.id)) continue;
    seen.add(feature.id);
    if (isLift) lifts.push(feature);
    else pistes.push(feature);
  }

  return {
    pistes: { type: "FeatureCollection", features: pistes },
    lifts: { type: "FeatureCollection", features: lifts },
    lines: [...pistes, ...lifts].filter((feature): feature is SkiLineFeature => feature.geometry.type === "LineString"),
  };
}

/**
 * Przycina trasy i wyciągi do bboxa mapy. Elementy całkowicie poza obszarem
 * znikają, a te przecinające granicę kończą się na niej (tak samo jak podkład
 * i poziomice). Z rozciętej linii zostaje najdłuższy fragment — geometria tras
 * nie bywa rozcinana na wiele części, a typ `LineString` musi zostać.
 */
export function clipSkiDataToBounds(data: SkiData, bounds: [number, number, number, number]): SkiData {
  const rect: TileRect = { minX: bounds[0], minY: bounds[1], maxX: bounds[2], maxY: bounds[3] };
  const clipFeature = (feature: SkiFeature): SkiFeature | null => {
    if (feature.geometry.type === "LineString") {
      const parts = clipLineToRect(feature.geometry.coordinates, rect).filter((part) => part.length >= 2);
      if (parts.length === 0) return null;
      const longest = parts.reduce((best, part) => (part.length > best.length ? part : best));
      return { ...feature, geometry: { type: "LineString", coordinates: longest } };
    }
    const ring = clipRingToRect(feature.geometry.coordinates[0], rect);
    if (ring.length < 3) return null;
    return { ...feature, geometry: { type: "Polygon", coordinates: [ring] } };
  };
  const pistes = data.pistes.features.map(clipFeature).filter((feature): feature is SkiFeature => feature !== null);
  const lifts = data.lifts.features.map(clipFeature).filter((feature): feature is SkiFeature => feature !== null);
  return {
    pistes: { ...data.pistes, features: pistes },
    lifts: { ...data.lifts, features: lifts },
    lines: [...pistes, ...lifts].filter((feature): feature is SkiLineFeature => feature.geometry.type === "LineString"),
  };
}

// Współbieżne wywołania (boot PWA i mini-mapa) dzielą jedno wczytanie snapshotu.
let inflightLoad: Promise<SkiData> | null = null;

export async function loadSkiData(): Promise<SkiData> {
  if (matchingSkiData) return matchingSkiData;
  if (inflightLoad) return inflightLoad;

  inflightLoad = (async () => {
    try {
      const response = await fetch(SKI_SNAPSHOT_URL);
      if (!response.ok) throw new Error(`Snapshot tras: HTTP ${response.status}`);
      const payload = (await response.json()) as OverpassResponse;
      if (!Array.isArray(payload.elements)) throw new Error("Snapshot tras: brak danych");
      matchingSkiData = clipSkiDataToBounds(normalizeSkiData(payload.elements), SOLDEN_BOUNDS);
      return matchingSkiData;
    } finally {
      inflightLoad = null;
    }
  })();
  return inflightLoad;
}

/** Trasy dostępne dla dopasowania (ostatnie wczytanie) albo null. */
export function getSkiDataForMatching(): SkiData | null {
  return matchingSkiData;
}

/** Wstrzyknięcie tras do dopasowania (testy) — bez sieci i storage. */
export function primeSkiDataForMatching(data: SkiData | null): void {
  matchingSkiData = data;
  inflightLoad = null;
}
