import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, StyleSpecification } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Icon } from "../components/Icon.tsx";
import { getAllStoredSamples } from "../lib/data.ts";
import { useDevice } from "../lib/device.tsx";
import { findRoute, snapToPiste, type RouteResult } from "../lib/mapRouting.ts";
import {
  AERIALWAY_LABELS,
  DIFFICULTY_COLORS,
  SOLDEN_BOUNDS,
  SOLDEN_CENTER,
  loadSkiData,
  type Position,
  type SkiData,
  type SkiFeature,
} from "../lib/mapData.ts";
import type { Sample } from "../lib/csv.ts";

interface GeoJsonPointCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: { role: "current" };
    geometry: { type: "Point"; coordinates: Position };
  }>;
}

interface GeoJsonLineCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: Record<string, string>;
    geometry: { type: "LineString"; coordinates: Position[] };
  }>;
}

interface DevicePosition {
  coordinate: Position;
  accuracy: number;
}

interface SelectedFeature {
  source: "pistes" | "lifts" | "home";
  ids: string[];
  uid: string;
  label: string;
  kind: "piste" | "lift" | "home";
  difficulty: string;
  color: string;
  warning: boolean;
  grooming: string;
  aerialway: string;
  openingHours: string;
  lengthM: number | null;
  elevationDifferenceM: number | null;
  navigationCoordinate: Position | null;
}

interface MapItem {
  source: "pistes" | "lifts";
  ids: string[];
  label: string;
  displayLabel: string;
  site: string | null;
  color: string;
  kind: "trasa" | "wyciąg";
  distanceM: number;
}

type RouteMode = "idle" | "start" | "end";

const HOME_COORDINATES: Position = [11.0095, 46.9726];
const EMPTY_COLLECTION: GeoJsonLineCollection = { type: "FeatureCollection", features: [] };
const EMPTY_POINTS: GeoJsonPointCollection = { type: "FeatureCollection", features: [] };
const LINE_GEOMETRY_FILTER = ["==", ["geometry-type"], "LineString"] as never;
const POLYGON_GEOMETRY_FILTER = ["==", ["geometry-type"], "Polygon"] as never;
const WARNING_COLOR_EXPRESSION = [
  "match",
  ["get", "difficulty"],
  "advanced",
  "#e5e7eb",
  "expert",
  "#e5e7eb",
  "#374151",
] as never;

maplibregl.setWorkerUrl(maplibreWorkerUrl);

const MAP_STYLE: StyleSpecification = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    topo: {
      type: "raster",
      tiles: ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      bounds: SOLDEN_BOUNDS,
      attribution: "© OpenTopoMap contributors",
    },
    dem: {
      type: "raster-dem",
      tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
      tileSize: 256,
      encoding: "terrarium",
      bounds: SOLDEN_BOUNDS,
    },
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#dbe9e5" } },
    { id: "topo", type: "raster", source: "topo", paint: { "raster-saturation": -0.15, "raster-contrast": 0.05 } },
  ],
  terrain: { source: "dem", exaggeration: 0.6 },
  sky: { "sky-color": "#a5d6f5", "horizon-color": "#f0f6fa", "horizon-fog-blend": 0.4, "fog-color": "#e8eef2", "fog-ground-blend": 0.4, "atmosphere-blend": 1 },
};

const COLOR_EXPRESSION = [
  "match",
  ["get", "difficulty"],
  "novice",
  DIFFICULTY_COLORS.novice,
  "easy",
  DIFFICULTY_COLORS.easy,
  "intermediate",
  DIFFICULTY_COLORS.intermediate,
  "advanced",
  DIFFICULTY_COLORS.advanced,
  "expert",
  DIFFICULTY_COLORS.expert,
  DIFFICULTY_COLORS.unknown,
] as never;

function emptyMapData(): SkiData {
  return {
    pistes: { type: "FeatureCollection", features: [] },
    lifts: { type: "FeatureCollection", features: [] },
    lines: [],
    stale: false,
    savedAt: "",
  };
}

function sourceData(map: maplibregl.Map, id: string, data: unknown): void {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  if (source) source.setData(data as Parameters<GeoJSONSource["setData"]>[0]);
}

function pointCollection(position: DevicePosition | null): GeoJsonPointCollection {
  const features: GeoJsonPointCollection["features"] = [];
  if (position) features.push({ type: "Feature", properties: { role: "current" }, geometry: { type: "Point", coordinates: position.coordinate } });
  return { type: "FeatureCollection", features };
}

function recentTrace(samples: Sample[], now: number): GeoJsonLineCollection {
  const cutoff = now - 5 * 60 * 1000;
  const recent = samples
    .map((sample) => ({ sample, timestamp: Date.parse(sample.t) }))
    .filter(({ sample, timestamp }) => Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= now && Number.isFinite(sample.lat) && Number.isFinite(sample.lon))
    .sort((a, b) => a.timestamp - b.timestamp);
  if (recent.length < 2) return EMPTY_COLLECTION;
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { label: "Ostatnie 5 minut" },
      geometry: { type: "LineString", coordinates: recent.map(({ sample }) => [sample.lon, sample.lat]) },
    }],
  };
}

function coordinateDistance(a: Position, b: Position): number {
  const latitude = ((a[1] + b[1]) / 2) * Math.PI / 180;
  const longitudeScale = 111320 * Math.max(Math.cos(latitude), 0.1);
  return Math.hypot((b[0] - a[0]) * longitudeScale, (b[1] - a[1]) * 111320);
}

function featureCoordinates(feature: SkiFeature): Position[] {
  return feature.geometry.type === "Polygon" ? feature.geometry.coordinates[0] ?? [] : feature.geometry.coordinates;
}

function featureLengthM(feature: SkiFeature): number {
  const coordinates = featureCoordinates(feature);
  let lengthM = 0;
  for (let index = 1; index < coordinates.length; index += 1) lengthM += coordinateDistance(coordinates[index - 1], coordinates[index]);
  return lengthM;
}

function terrainElevationAt(map: maplibregl.Map | null, coordinate: Position): number | null {
  try {
    const elevation = map?.queryTerrainElevation({ lng: coordinate[0], lat: coordinate[1] }, { exaggerated: false });
    return typeof elevation === "number" && Number.isFinite(elevation) ? elevation : null;
  } catch {
    return null;
  }
}

function featureStats(feature: SkiFeature, map: maplibregl.Map | null): { lengthM: number; elevationDifferenceM: number | null } {
  const coordinates = featureCoordinates(feature);
  let lengthM = 0;
  let lowestElevation = Infinity;
  let highestElevation = -Infinity;
  let elevationCount = 0;

  for (let index = 0; index < coordinates.length; index += 1) {
    const coordinate = coordinates[index];
    if (index > 0) lengthM += coordinateDistance(coordinates[index - 1], coordinate);
    const elevation = terrainElevationAt(map, coordinate);
    if (elevation !== null) {
      lowestElevation = Math.min(lowestElevation, elevation);
      highestElevation = Math.max(highestElevation, elevation);
      elevationCount += 1;
    }
  }

  return {
    lengthM,
    elevationDifferenceM: elevationCount >= 2 ? highestElevation - lowestElevation : null,
  };
}

function featureReferenceCoordinate(feature: SkiFeature): Position | null {
  const coordinates = featureCoordinates(feature);
  return coordinates[Math.floor(coordinates.length / 2)] ?? coordinates[0] ?? null;
}

function formatDistance(distanceM: number | null): string {
  if (distanceM === null) return "brak danych";
  if (distanceM >= 10000) return `${(distanceM / 1000).toFixed(0)} km`;
  return `${(distanceM / 1000).toFixed(1)} km`;
}

function formatElevationDifference(elevationM: number | null): string {
  return elevationM === null ? "brak DEM" : `${Math.round(elevationM)} m`;
}

function formatAverageSlope(lengthM: number | null, elevationDifferenceM: number | null): string {
  if (lengthM === null || elevationDifferenceM === null || lengthM <= 0) return "brak";
  return `${((elevationDifferenceM / lengthM) * 100).toFixed(1)}%`;
}

function groomingLabel(grooming: string): string {
  if (grooming === "backcountry") return "nieratrakowana (backcountry)";
  if (grooming === "mogul") return "muldy";
  if (grooming === "no") return "nieprzygotowana";
  if (!grooming || grooming === "classic") return "";
  return grooming;
}

function selectedFeatureFor(feature: SkiFeature, source: "pistes" | "lifts", ids: string[], map: maplibregl.Map | null, navigationCoordinate: Position | null = null): SelectedFeature {
  const properties = feature.properties;
  const kind = source === "lifts" ? "lift" : "piste";
  const stats = featureStats(feature, map);
  return {
    source,
    ids,
    uid: properties.uid,
    label: properties.label || properties.name || (kind === "lift" ? "Wyciąg" : "Bez nazwy"),
    kind,
    difficulty: properties.difficulty,
    color: source === "lifts" ? "#dc2626" : properties.difficultyColor,
    warning: properties.warning,
    grooming: properties.grooming,
    aerialway: properties.aerialway,
    openingHours: properties.openingHours,
    lengthM: stats.lengthM,
    elevationDifferenceM: stats.elevationDifferenceM,
    navigationCoordinate,
  };
}

function itemLabel(feature: SkiFeature): string {
  if (feature.properties.routeKind === "lift") return feature.properties.name || feature.properties.ref;
  return feature.properties.label || feature.properties.name;
}

function mapItemsFor(data: SkiData): MapItem[] {
  const groups = new Map<string, MapItem>();
  const add = (feature: SkiFeature, source: "pistes" | "lifts"): void => {
    const rawLabel = itemLabel(feature);
    const key = `${feature.properties.site ?? ""}\u0000${rawLabel || feature.properties.uid}`;
    const existing = groups.get(key);
    if (existing) {
      existing.ids.push(feature.properties.uid);
      existing.distanceM += featureLengthM(feature);
      return;
    }
    const isLift = source === "lifts";
    const label = rawLabel || (isLift ? "Wyciąg" : "Trasa (bez nazwy)");
    const typeLabel = feature.properties.aerialway ? AERIALWAY_LABELS[feature.properties.aerialway] ?? feature.properties.aerialway : "nieznany";
    groups.set(key, {
      source,
      ids: [feature.properties.uid],
      label,
      displayLabel: isLift ? `${label} (${typeLabel})` : label,
      site: feature.properties.site,
      color: isLift ? "#7c3aed" : feature.properties.difficultyColor,
      kind: isLift ? "wyciąg" : "trasa",
      distanceM: featureLengthM(feature),
    });
  };
  for (const feature of data.pistes.features) add(feature, "pistes");
  for (const feature of data.lifts.features) add(feature, "lifts");
  const siteRank = (site: string | null): number => site === "Sölden" ? 0 : site ? 1 : 2;
  return [...groups.values()].sort((first, second) =>
    siteRank(first.site) - siteRank(second.site)
    || (first.site ?? "").localeCompare(second.site ?? "", "pl", { sensitivity: "base" })
    || (first.kind === second.kind ? 0 : first.kind === "trasa" ? -1 : 1)
    || first.label.localeCompare(second.label, "pl", { numeric: true, sensitivity: "base" }),
  );
}

function routeDistanceLabel(distanceM: number): string {
  if (distanceM >= 10000) return `${(distanceM / 1000).toFixed(0)} km`;
  return `${(distanceM / 1000).toFixed(1)} km`;
}

function withinBounds(position: Position): boolean {
  return position[0] >= SOLDEN_BOUNDS[0] && position[0] <= SOLDEN_BOUNDS[2] && position[1] >= SOLDEN_BOUNDS[1] && position[1] <= SOLDEN_BOUNDS[3];
}

export default function MapView() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const highlightedRef = useRef<SelectedFeature | null>(null);
  const mapDataRef = useRef<SkiData>(emptyMapData());
  const itemIndexRef = useRef(new Map<string, MapItem>());
  const routePointsRef = useRef<{ start: Position | null; end: Position | null }>({ start: null, end: null });
  const routeMarkersRef = useRef<{ start: maplibregl.Marker | null; end: maplibregl.Marker | null }>({ start: null, end: null });
  const hasCenteredOnPosition = useRef(false);
  const routeModeRef = useRef<RouteMode>("idle");
  const autoRouteRef = useRef(false);
  const blinkRef = useRef(0);
  const [mapData, setMapData] = useState<SkiData>(emptyMapData);
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [position, setPosition] = useState<DevicePosition | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [routeMode, setRouteMode] = useState<RouteMode>("idle");
  const [manualStart, setManualStart] = useState<Position | null>(null);
  const [destination, setDestination] = useState<Position | null>(null);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routing, setRouting] = useState(false);
  const [selected, setSelected] = useState<SelectedFeature | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [samples, setSamples] = useState<Sample[]>([]);
  const device = useDevice();

  const deviceStart = position?.coordinate ?? null;
  const start = manualStart ?? deviceStart;
  const trace = useMemo(() => recentTrace(samples, now), [samples, now]);
  const mapItems = useMemo(() => mapItemsFor(mapData), [mapData]);
  const filteredMapItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pl");
    if (!query) return mapItems;
    return mapItems.filter((item) => item.displayLabel.toLocaleLowerCase("pl").includes(query));
  }, [mapItems, search]);
  const featureIndex = useMemo(() => {
    const index = new Map<string, SkiFeature>();
    for (const feature of [...mapData.pistes.features, ...mapData.lifts.features]) index.set(feature.properties.uid, feature);
    return index;
  }, [mapData]);
  const routeSequence = useMemo(() => {
    if (!route) return [];
    const seen = new Set<string>();
    return route.sequence.filter((item) => {
      const key = `${item.kind}:${item.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [route]);

  useEffect(() => {
    mapDataRef.current = mapData;
    itemIndexRef.current = new Map(mapItems.flatMap((item) => item.ids.map((uid) => [uid, item] as const)));
  }, [mapData, mapItems]);

  useEffect(() => {
    routeModeRef.current = routeMode;
  }, [routeMode]);

  useEffect(() => {
    let active = true;
    loadSkiData()
      .then((loaded) => {
        if (active) setMapData(loaded);
      })
      .catch((error: unknown) => {
        if (active) setMapError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    getAllStoredSamples()
      .then((loaded) => {
        if (active) setSamples(loaded);
      })
      .catch(() => {
        if (active) setSamples([]);
      });
    return () => {
      active = false;
    };
  }, [device.dataRevision]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsError("Ta przeglądarka nie udostępnia GPS.");
      return undefined;
    }
    const watchId = navigator.geolocation.watchPosition(
      (next) => {
        setGpsError(null);
        setPosition({ coordinate: [next.coords.longitude, next.coords.latitude], accuracy: next.coords.accuracy });
      },
      (error) => setGpsError(error.code === error.PERMISSION_DENIED ? "Brak zgody na lokalizację telefonu." : "Nie udało się odczytać pozycji GPS."),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return undefined;
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLE,
      center: SOLDEN_CENTER,
      zoom: window.matchMedia("(max-width: 768px)").matches ? 12 : 13,
      pitch: 40,
      bearing: -90,
      maxPitch: 85,
      maxZoom: 19,
      attributionControl: true,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.ScaleControl(), "bottom-left");
    const homeMarkerElement = document.createElement("div");
    homeMarkerElement.className = "home-marker";
    homeMarkerElement.setAttribute("role", "img");
    homeMarkerElement.setAttribute("aria-label", "Dom");
    homeMarkerElement.title = "Dom";
    homeMarkerElement.innerHTML = `
      <svg viewBox="0 0 32 42" aria-hidden="true">
        <path class="home-marker-pin" d="M16 41S2 25.5 2 15C2 7.3 8.3 1 16 1s14 6.3 14 14c0 10.5-14 26-14 26Z" />
        <path class="home-marker-house" d="m8.5 19 7.5-6 7.5 6v8h-15v-8Zm4.5 8v-5h6v5" />
      </svg>`;
    homeMarkerElement.addEventListener("click", (event) => {
      event.stopPropagation();
      selectHome();
    });
    const homeMarker = new maplibregl.Marker({ element: homeMarkerElement, anchor: "bottom" }).setLngLat(HOME_COORDINATES).addTo(map);
    map.on("load", () => {
      map.addSource("pistes", { type: "geojson", data: mapData.pistes as never, promoteId: "uid" });
      map.addSource("lifts", { type: "geojson", data: mapData.lifts as never, promoteId: "uid" });
      map.addSource("recent-trace", { type: "geojson", data: EMPTY_COLLECTION as never });
      map.addSource("map-points", { type: "geojson", data: EMPTY_POINTS as never });
      map.addSource("route-result", { type: "geojson", data: EMPTY_COLLECTION as never });
      map.addLayer({ id: "pistes-area-fill", type: "fill", source: "pistes", filter: POLYGON_GEOMETRY_FILTER, paint: { "fill-color": COLOR_EXPRESSION, "fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.5, 0.26] as never } });
      map.addLayer({ id: "pistes-area-outline", type: "line", source: "pistes", filter: POLYGON_GEOMETRY_FILTER, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["case", ["boolean", ["feature-state", "selected"], false], "#facc15", COLOR_EXPRESSION] as never, "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 3, 1.5] as never } });
      map.addLayer({ id: "pistes-casing", type: "line", source: "pistes", filter: LINE_GEOMETRY_FILTER, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["case", ["boolean", ["feature-state", "selected"], false], "#facc15", "#ffffff"] as never, "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 10, 6] as never } });
      map.addLayer({ id: "pistes-line", type: "line", source: "pistes", filter: LINE_GEOMETRY_FILTER, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": COLOR_EXPRESSION, "line-width": 3, "line-opacity": 0.95 } });
      map.addLayer({ id: "pistes-warning-stripe", type: "line", source: "pistes", filter: ["all", LINE_GEOMETRY_FILTER, ["get", "warning"]] as never, layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": WARNING_COLOR_EXPRESSION, "line-width": 3, "line-dasharray": [2, 10] } });
      map.addLayer({ id: "pistes-labels", type: "symbol", source: "pistes", filter: ["all", LINE_GEOMETRY_FILTER, ["has", "label"]] as never, layout: { "symbol-placement": "line", "symbol-spacing": 150, "text-field": ["get", "label"], "text-size": 11, "text-font": ["Noto Sans Bold"], "text-allow-overlap": false, "text-optional": true }, paint: { "text-color": "#ffffff", "text-halo-color": "#17363b", "text-halo-width": 1.5 } });
      map.addLayer({ id: "pistes-hit", type: "line", source: "pistes", filter: LINE_GEOMETRY_FILTER, paint: { "line-color": "rgba(0, 0, 0, 0)", "line-width": 18 } });
      map.addLayer({ id: "lifts-line", type: "line", source: "lifts", layout: { "line-cap": "round" }, paint: { "line-color": ["case", ["boolean", ["feature-state", "selected"], false], "#facc15", "#dc2626"] as never, "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 5, 2.5] as never, "line-dasharray": [2, 1.5] } });
      map.addLayer({ id: "lifts-labels", type: "symbol", source: "lifts", filter: ["has", "name"], layout: { "symbol-placement": "line-center", "text-field": ["get", "name"], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-offset": [0, 0.6], "text-allow-overlap": false }, paint: { "text-color": "#7f1d1d", "text-halo-color": "#ffffff", "text-halo-width": 1.5 } });
      map.addLayer({ id: "lifts-hit", type: "line", source: "lifts", paint: { "line-color": "rgba(0, 0, 0, 0)", "line-width": 18 } });
      map.addLayer({ id: "recent-trace-casing", type: "line", source: "recent-trace", paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.8 } });
      map.addLayer({ id: "recent-trace-line", type: "line", source: "recent-trace", paint: { "line-color": "#ed7657", "line-width": 4, "line-dasharray": [1, 1.5] } });
      map.addLayer({ id: "route-casing", type: "line", source: "route-result", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 9 } });
      map.addLayer({ id: "route-piste", type: "line", source: "route-result", filter: ["!=", ["get", "kind"], "lift"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#1557b0", "line-width": 6 } });
      map.addLayer({ id: "route-lift", type: "line", source: "route-result", filter: ["==", ["get", "kind"], "lift"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#7c3aed", "line-width": 6, "line-dasharray": [2, 1.5] } });
      map.addLayer({ id: "route-piste-labels", type: "symbol", source: "route-result", filter: ["all", ["==", ["get", "kind"], "piste"], ["has", "label"]], layout: { "symbol-placement": "line", "symbol-spacing": 260, "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": 16, "text-letter-spacing": 0.05, "text-allow-overlap": true, "text-ignore-placement": true }, paint: { "text-color": "#1557b0", "text-halo-color": "#ffffff", "text-halo-width": 3, "text-halo-blur": 0.2 } });
      map.addLayer({ id: "route-lift-labels", type: "symbol", source: "route-result", filter: ["all", ["==", ["get", "kind"], "lift"], ["has", "label"]], layout: { "symbol-placement": "line-center", "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": 16, "text-letter-spacing": 0.05, "text-allow-overlap": true, "text-ignore-placement": true }, paint: { "text-color": "#5b21b6", "text-halo-color": "#ffffff", "text-halo-width": 3, "text-halo-blur": 0.2 } });
       map.addLayer({ id: "map-points", type: "circle", source: "map-points", paint: { "circle-color": "#1976d2", "circle-radius": 8, "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 } });
      map.on("click", (event) => {
        const activeRouteMode = routeModeRef.current;
        const hit = map.queryRenderedFeatures(event.point, { layers: ["pistes-hit", "pistes-area-fill", "lifts-hit"] });
        if (activeRouteMode !== "idle") {
          const clicked: Position = [event.lngLat.lng, event.lngLat.lat];
          const liftHit = hit.find((feature) => feature.layer?.id === "lifts-hit");
          const liftUid = liftHit ? String(liftHit.properties?.uid ?? liftHit.id ?? "") : undefined;
          const snap = snapToPiste(mapDataRef.current.lines, clicked, liftUid);
           if (!snap) {
             setRouteError("Kliknij w liniową trasę, maksymalnie 100 m od niej.");
             return;
           }
           if (activeRouteMode === "start") {
             routePointsRef.current = { start: snap.coordinate, end: null };
             updateRouteMarkers(routePointsRef.current);
             setManualStart(snap.coordinate);
             setDestination(null);
             setRouteMode("end");
           } else {
             routePointsRef.current = { start: routePointsRef.current.start, end: snap.coordinate };
             updateRouteMarkers(routePointsRef.current);
             autoRouteRef.current = true;
             setDestination(snap.coordinate);
             setRouteMode("idle");
           }
           setRoute(null);
           setRouteError(null);
           return;
        }
        if (hit.length === 0) closeSelected();
      });
      const select = (event: maplibregl.MapLayerMouseEvent, source: "pistes" | "lifts") => {
        if (routeModeRef.current !== "idle") return;
        const feature = event.features?.[0];
        if (!feature) return;
        const uid = String(feature.properties?.uid ?? feature.id ?? "");
         const group = itemIndexRef.current.get(uid);
         const dataFeature = mapDataRef.current[source].features.find((candidate) => candidate.properties.uid === uid);
         if (!dataFeature) return;
         const next = selectedFeatureFor(dataFeature, source, group?.ids ?? [uid], map, [event.lngLat.lng, event.lngLat.lat]);
         clearHighlightedFeature();
         for (const id of next.ids) map.setFeatureState({ source, id }, { selected: true });
        highlightedRef.current = next;
        setSelected(next);
      };
      map.on("click", "pistes-hit", (event) => select(event, "pistes"));
      map.on("click", "pistes-area-fill", (event) => select(event, "pistes"));
      map.on("click", "lifts-hit", (event) => select(event, "lifts"));
      map.on("mouseenter", "pistes-hit", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "pistes-hit", () => { map.getCanvas().style.cursor = ""; });
      map.on("mouseenter", "pistes-area-fill", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "pistes-area-fill", () => { map.getCanvas().style.cursor = ""; });
      map.on("mouseenter", "lifts-hit", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "lifts-hit", () => { map.getCanvas().style.cursor = ""; });
      setMapReady(true);
    });
    map.on("error", (event) => {
      const mapErrorEvent = event as typeof event & { sourceId?: string; tile?: unknown };
      const errorMessage = event.error?.message ?? "";
      if (mapErrorEvent.sourceId || mapErrorEvent.tile || errorMessage.includes(".png")) return;
      if (errorMessage) setMapError(errorMessage);
    });
    return () => {
      for (const marker of Object.values(routeMarkersRef.current)) marker?.remove();
      map.remove();
      homeMarker.remove();
      mapRef.current = null;
    };
    // The map is created once; source data is synchronized by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    sourceData(map, "pistes", mapData.pistes);
    sourceData(map, "lifts", mapData.lifts);
  }, [mapData, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    sourceData(map, "recent-trace", trace);
  }, [trace, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    sourceData(map, "map-points", pointCollection(position));
  }, [mapReady, position]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    sourceData(map, "route-result", route?.segments ?? EMPTY_COLLECTION);
  }, [mapReady, route]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !position || hasCenteredOnPosition.current || !withinBounds(position.coordinate)) return;
    map.easeTo({ center: position.coordinate, zoom: map.getZoom(), duration: 700 });
    hasCenteredOnPosition.current = true;
  }, [mapReady, position]);

  async function calculateRouteFor(routeStart: Position, routeEnd: Position) {
    setRouting(true);
    setRouteError(null);
    // Pozwól przeglądarce namalować markery i komunikat przed synchroniczną
    // budową grafu, która blokuje główny wątek.
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    try {
      const map = mapRef.current;
      const result = await findRoute(mapData.lines, routeStart, routeEnd, (coordinate) => {
        if (!map) return null;
        return map.queryTerrainElevation({ lng: coordinate[0], lat: coordinate[1] }, { exaggerated: false });
      });
      setRoute(result);
    } catch (error: unknown) {
      setRoute(null);
      setRouteError(error instanceof Error ? error.message : String(error));
    } finally {
      setRouting(false);
    }
  }

  useEffect(() => {
    if (!autoRouteRef.current || !destination || !start || routing) return;
    autoRouteRef.current = false;
    void calculateRouteFor(start, destination);
  }, [destination, start, routing]);

  function centerOnPosition() {
    if (!position || !mapRef.current) return;
    mapRef.current.flyTo({ center: position.coordinate, zoom: Math.max(mapRef.current.getZoom(), 14), essential: true });
  }

  function updateRouteMarkers(points: { start: Position | null; end: Position | null }): void {
    const map = mapRef.current;
    for (const marker of Object.values(routeMarkersRef.current)) marker?.remove();
    routeMarkersRef.current = { start: null, end: null };
    if (!map) return;
    if (points.start) routeMarkersRef.current.start = new maplibregl.Marker({ color: "#16a34a" }).setLngLat(points.start).addTo(map);
    if (points.end) routeMarkersRef.current.end = new maplibregl.Marker({ color: "#dc2626" }).setLngLat(points.end).addTo(map);
  }

  function clearHighlightedFeature(): void {
    const map = mapRef.current;
    blinkRef.current += 1;
    if (map && highlightedRef.current) {
      if (highlightedRef.current.source !== "home") {
        for (const id of highlightedRef.current.ids) map.setFeatureState({ source: highlightedRef.current.source, id }, { selected: false });
      }
    }
    highlightedRef.current = null;
  }

  function closeSelected(): void {
    clearHighlightedFeature();
    setSelected(null);
  }

  function selectMapItem(item: MapItem): void {
    const map = mapRef.current;
    const feature = featureIndex.get(item.ids[0]);
    if (!map || !feature) return;
    clearHighlightedFeature();
    for (const id of item.ids) map.setFeatureState({ source: item.source, id }, { selected: true });
    const next = selectedFeatureFor(feature, item.source, item.ids, map, featureReferenceCoordinate(feature));
    highlightedRef.current = next;
    setSelected(next);
    blinkSelection(item.source, item.ids);
  }

  function selectHome(): void {
    clearHighlightedFeature();
    const next: SelectedFeature = {
      source: "home",
      ids: [],
      uid: "home",
      label: "Dom",
      kind: "home",
      difficulty: "unknown",
      color: "#0b3d66",
      warning: false,
      grooming: "",
      aerialway: "",
      openingHours: "",
      lengthM: null,
      elevationDifferenceM: null,
      navigationCoordinate: HOME_COORDINATES,
    };
    highlightedRef.current = next;
    setSelected(next);
  }

  function blinkSelection(source: "pistes" | "lifts", ids: string[]): void {
    const map = mapRef.current;
    if (!map) return;
    const token = ++blinkRef.current;
    const pulses = [false, true, false, true, false, true, false, true, false, true];
    pulses.forEach((on, index) => {
      window.setTimeout(() => {
        if (token !== blinkRef.current) return;
        for (const id of ids) map.setFeatureState({ source, id }, { selected: on });
      }, 180 * (index + 1));
    });
  }

  function fitMapItem(item: MapItem): void {
    const map = mapRef.current;
    if (!map) return;
    const coordinates: Position[] = [];
    for (const id of item.ids) {
      const feature = featureIndex.get(id);
      if (!feature) continue;
      const points = feature.geometry.type === "Polygon" ? feature.geometry.coordinates[0] : feature.geometry.coordinates;
      coordinates.push(...points);
    }
    if (coordinates.length === 0) return;
    const bounds = coordinates.reduce((result, coordinate) => result.extend(coordinate), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
    map.fitBounds(bounds, { padding: 80, maxZoom: 13, bearing: map.getBearing(), pitch: map.getPitch(), duration: 600 });
  }

  function toggleRouteMode(): void {
    if (routeMode !== "idle" || route || routePointsRef.current.start) {
      clearRoute();
      return;
    }
    setRouteError(null);
    routePointsRef.current = { start: null, end: null };
    setRouteMode("start");
  }

  function navigateToSelected(): void {
    if (!selected) return;
    const navigationStart = position?.coordinate ?? HOME_COORDINATES;
    let target = HOME_COORDINATES;
    let liftUid: string | undefined;
    if (selected.kind !== "home") {
      const feature = featureIndex.get(selected.uid);
      if (!feature) return;
      target = selected.navigationCoordinate ?? featureReferenceCoordinate(feature) ?? HOME_COORDINATES;
      liftUid = selected.kind === "lift" ? selected.uid : undefined;
    }
    const snapped = snapToPiste(mapData.lines, target, liftUid);
    if (!snapped) {
      setRouteError("Nie znalazłem trasy w pobliżu wybranego celu.");
      return;
    }
    routePointsRef.current = { start: navigationStart, end: snapped.coordinate };
    updateRouteMarkers(routePointsRef.current);
    autoRouteRef.current = true;
    setRoute(null);
    setManualStart(navigationStart);
    setDestination(snapped.coordinate);
    setRouteMode("idle");
    setRouteError(null);
  }

  function clearRoute(): void {
    autoRouteRef.current = false;
    routePointsRef.current = { start: null, end: null };
    updateRouteMarkers(routePointsRef.current);
    setRoute(null);
    setDestination(null);
    setManualStart(null);
    setRouteError(null);
    setRouteMode("idle");
  }

  return (
    <div className="map-page">
      <div className="map-canvas" ref={mapContainer} aria-label="Mapa tras narciarskich Sölden" />
      <div className="map-actions">
        <button className="map-icon-button" type="button" onClick={centerOnPosition} disabled={!position} aria-label="Pokaż moją pozycję" title="Pokaż moją pozycję"><Icon name="activity" size={19} /></button>
        <button className={`map-icon-button${menuOpen ? " map-icon-button-active" : ""}`} type="button" onClick={() => setMenuOpen((open) => !open)} aria-label="Szukaj tras i wyciągów" title="Szukaj tras i wyciągów"><Icon name="search" size={19} /></button>
        <button className={`map-icon-button${routeMode !== "idle" || route ? " map-icon-button-active" : ""}`} type="button" onClick={toggleRouteMode} aria-label={route ? "Wyczyść trasę" : "Wyznacz trasę"} title={route ? "Wyczyść trasę" : "Wyznacz trasę"}><Icon name="route" size={19} /></button>
      </div>

      {mapError && <div className="map-alert"><Icon name="x" size={16} /><span>{mapError}. Mapa może nie zawierać tras.</span><button className="map-alert-close" type="button" onClick={() => setMapError(null)} aria-label="Zamknij komunikat"><Icon name="x" size={15} /></button></div>}
      {!mapError && !mapData.stale && !mapReady && <div className="map-loading"><span className="spinner" /> Wczytuję mapę i trasy…</div>}

      {(routeMode !== "idle" || routeError || routing) && (
        <div className="map-route-message" role="status">
          {routing ? "Wyznaczam trasę…" : routeError ?? (routeMode === "start" ? "Kliknij punkt startowy na trasie." : "Kliknij punkt docelowy na trasie.")}
        </div>
      )}

      {selected && (
        <section className="map-feature-card">
          <button className="map-card-close" type="button" onClick={closeSelected} aria-label="Zamknij szczegóły"><Icon name="x" size={16} /></button>
          <span className="map-feature-kicker">{selected.kind === "lift" ? "Wyciąg" : selected.kind === "home" ? "Dom" : "Trasa"}</span>
          <strong style={{ color: selected.color }}>{selected.label}</strong>
          {selected.kind === "piste" && <span className="map-feature-difficulty">
            <b>{selected.difficulty === "unknown" ? "Trudność nieznana" : selected.difficulty}{selected.warning ? " · ostrzeżenie" : ""}</b>
            {groomingLabel(selected.grooming) && <small>{groomingLabel(selected.grooming)}</small>}
          </span>}
          {selected.kind === "lift" && <span>{AERIALWAY_LABELS[selected.aerialway] ?? (selected.aerialway || "Typ wyciągu nieznany")}</span>}
          {selected.kind !== "home" && <span className="map-feature-opening-hours"><small>Godziny</small><b>{selected.openingHours || "brak danych"}</b></span>}
          {selected.kind !== "home" && <div className="map-feature-metrics">
            <span title="Długość"><Icon name="ruler" size={14} /><b>{formatDistance(selected.lengthM)}</b></span>
            <span title="Różnica wysokości"><Icon name="mountain" size={14} /><b>{formatElevationDifference(selected.elevationDifferenceM)}</b></span>
            <span title="Średnie nachylenie"><Icon name="percent" size={14} /><b>{formatAverageSlope(selected.lengthM, selected.elevationDifferenceM)}</b></span>
          </div>}
          <button className="map-feature-navigate" type="button" onClick={navigateToSelected}>{selected.kind === "home" ? "Nawiguj do domu" : "Nawiguj"}</button>
        </section>
      )}

      {route && (
        <section className="map-route-result">
          <strong>[{routeDistanceLabel(route.distanceM)}]</strong>
          <div className="map-route-sequence">
            {routeSequence.map((item, index) => (
              <span key={`${item.kind}:${item.label}`} className="map-route-sequence-item">
                {index > 0 && <b>→</b>}
                <span className="map-route-badge" style={{ background: item.kind === "lift" ? "#7c3aed" : item.color }}>{item.label}</span>
              </span>
            ))}
          </div>
          <button className="map-clear-route" type="button" onClick={clearRoute}>Wyczyść</button>
        </section>
      )}

      {menuOpen && <aside className="map-search-panel">
        <div className="map-search-heading">
          <label className="map-search-label" htmlFor="map-feature-search">Trasy i wyciągi</label>
          <button className="map-search-close" type="button" onClick={() => setMenuOpen(false)} aria-label="Zamknij menu"><Icon name="x" size={16} /></button>
        </div>
        <div className="map-search-input-wrap">
          <Icon name="search" size={16} />
          <input id="map-feature-search" type="search" placeholder="Szukaj trasy lub wyciągu…" value={search} onChange={(event) => setSearch(event.target.value)} autoFocus />
        </div>
        <div className="map-search-list">
          {filteredMapItems.map((item, index) => {
            const previous = filteredMapItems[index - 1];
            const sectionName = item.site || "Inne";
            const previousSection = previous?.site || "Inne";
            const showSection = index === 0 || sectionName !== previousSection;
            const showKind = showSection || previous?.kind !== item.kind;
            return (
              <div key={`${item.source}/${item.ids[0]}`}>
                {showSection && <div className="map-search-section">{sectionName}</div>}
                {showKind && <div className="map-search-kind">{item.kind === "trasa" ? "Trasy" : "Wyciągi"}</div>}
                <button className="map-search-item" type="button" onClick={() => selectMapItem(item)} onDoubleClick={() => fitMapItem(item)}>
                  <span className="map-search-item-main"><span>{item.displayLabel}</span><small>{formatDistance(item.distanceM)}</small></span>
                  <b style={{ background: item.color }}>{item.kind}</b>
                </button>
              </div>
            );
          })}
          {filteredMapItems.length === 0 && <span className="map-search-empty">Brak wyników</span>}
        </div>
      </aside>}
    </div>
  );
}
