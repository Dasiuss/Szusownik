export type Position = [number, number];

export const SOLDEN_BOUNDS: [number, number, number, number] = [10.75, 46.85, 11.05, 47.1];
export const SOLDEN_CENTER: Position = [10.977123714520985, 46.95802633395613];
export const ROUTE_SNAP_RADIUS_M = 100;
export const MAP_DATA_TTL_MS = 8 * 24 * 60 * 60 * 1000;

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
  stale: boolean;
  savedAt: string;
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

interface CachedSkiData {
  savedAt: string;
  elements: OverpassElement[];
}

const CACHE_KEY = "szusownik:ski-data:v3";
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

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

export function normalizeSkiData(elements: OverpassElement[], stale: boolean, savedAt: string): SkiData {
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
    const isLift = Boolean(tags.aerialway);
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
    stale,
    savedAt,
  };
}

function readCache(): CachedSkiData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSkiData;
    if (!parsed.savedAt || !Array.isArray(parsed.elements)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(cache: CachedSkiData): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    // A full localStorage should not prevent showing freshly downloaded data.
  }
}

function overpassQuery(): string {
  const [west, south, east, north] = SOLDEN_BOUNDS;
  return `[out:json][timeout:30];(
  way["piste:type"](${south},${west},${north},${east});
  relation["piste:type"](${south},${west},${north},${east});
  way["aerialway"](${south},${west},${north},${east});
  relation["site"="piste"](${south},${west},${north},${east});
);out body geom;`;
}

async function fetchElements(): Promise<OverpassElement[]> {
  const response = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: `data=${encodeURIComponent(overpassQuery())}`,
  });
  if (!response.ok) throw new Error(`Overpass: HTTP ${response.status}`);
  const payload = (await response.json()) as OverpassResponse;
  if (!Array.isArray(payload.elements)) throw new Error("Overpass: brak danych tras");
  return payload.elements;
}

export async function loadSkiData(): Promise<SkiData> {
  const cached = readCache();
  if (cached && Date.now() - Date.parse(cached.savedAt) < MAP_DATA_TTL_MS) {
    return normalizeSkiData(cached.elements, false, cached.savedAt);
  }

  try {
    const elements = await fetchElements();
    const fresh: CachedSkiData = { elements, savedAt: new Date().toISOString() };
    writeCache(fresh);
    return normalizeSkiData(elements, false, fresh.savedAt);
  } catch (error) {
    if (cached) return normalizeSkiData(cached.elements, true, cached.savedAt);
    throw error;
  }
}
