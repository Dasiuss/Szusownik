import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, MapGeoJSONFeature, StyleSpecification } from "maplibre-gl";
import { Icon } from "../components/Icon.tsx";
import { getAllStoredSamples } from "../lib/data.ts";
import { useDevice } from "../lib/device.tsx";
import { findRoute, type RouteResult } from "../lib/mapRouting.ts";
import {
  DIFFICULTY_COLORS,
  SOLDEN_BOUNDS,
  SOLDEN_CENTER,
  loadSkiData,
  type Position,
  type SkiData,
} from "../lib/mapData.ts";
import type { Sample } from "../lib/csv.ts";

interface GeoJsonPointCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: { role: "current" | "start" | "end" };
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
  source: "pistes" | "lifts";
  uid: string;
  label: string;
  kind: "piste" | "lift";
  difficulty: string;
  color: string;
  warning: boolean;
}

type RouteMode = "idle" | "start" | "end";

const EMPTY_COLLECTION: GeoJsonLineCollection = { type: "FeatureCollection", features: [] };
const EMPTY_POINTS: GeoJsonPointCollection = { type: "FeatureCollection", features: [] };

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
  sky: { "sky-color": "#a5d6f5", "sky-horizon-color": "#f0f6fa", "horizon-fog-blend": 0.2, "fog-color": "#e8eef2" },
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

function pointCollection(position: DevicePosition | null, start: Position | null, end: Position | null, showStartMarker: boolean): GeoJsonPointCollection {
  const features: GeoJsonPointCollection["features"] = [];
  if (position) features.push({ type: "Feature", properties: { role: "current" }, geometry: { type: "Point", coordinates: position.coordinate } });
  if (start && showStartMarker) features.push({ type: "Feature", properties: { role: "start" }, geometry: { type: "Point", coordinates: start } });
  if (end) features.push({ type: "Feature", properties: { role: "end" }, geometry: { type: "Point", coordinates: end } });
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

function parseSelectedFeature(feature: MapGeoJSONFeature, source: "pistes" | "lifts"): SelectedFeature | null {
  const properties = feature.properties;
  const uid = String(properties?.uid ?? feature.id ?? "");
  if (!uid) return null;
  const kind = source === "lifts" ? "lift" : "piste";
  const difficulty = String(properties?.difficulty ?? "unknown");
  return {
    source,
    uid,
    label: String(properties?.label ?? "Bez nazwy"),
    kind,
    difficulty,
    color: source === "lifts" ? "#a12b40" : DIFFICULTY_COLORS[difficulty] ?? DIFFICULTY_COLORS.unknown,
    warning: properties?.warning === true || properties?.warning === "true",
  };
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
  const hasCenteredOnPosition = useRef(false);
  const routeModeRef = useRef<RouteMode>("idle");
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
  const [now, setNow] = useState(() => Date.now());
  const [samples, setSamples] = useState<Sample[]>([]);
  const device = useDevice();

  const deviceStart = position?.coordinate ?? null;
  const start = manualStart ?? deviceStart;
  const trace = useMemo(() => recentTrace(samples, now), [samples, now]);

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
      zoom: 12,
      pitch: 40,
      bearing: -90,
      maxPitch: 85,
      maxZoom: 19,
      attributionControl: true,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
    map.on("load", () => {
      map.addSource("pistes", { type: "geojson", data: mapData.pistes as never, promoteId: "uid" });
      map.addSource("lifts", { type: "geojson", data: mapData.lifts as never, promoteId: "uid" });
      map.addSource("recent-trace", { type: "geojson", data: EMPTY_COLLECTION as never });
      map.addSource("map-points", { type: "geojson", data: EMPTY_POINTS as never });
      map.addSource("route-result", { type: "geojson", data: EMPTY_COLLECTION as never });
      map.addLayer({ id: "pistes-area-fill", type: "fill", source: "pistes", paint: { "fill-color": COLOR_EXPRESSION, "fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.5, 0.26] as never } });
      map.addLayer({ id: "pistes-area-outline", type: "line", source: "pistes", paint: { "line-color": "#ffffff", "line-width": 1, "line-opacity": 0.75 } });
      map.addLayer({ id: "pistes-casing", type: "line", source: "pistes", paint: { "line-color": "#ffffff", "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 8, 4] as never, "line-opacity": 0.9 } });
      map.addLayer({ id: "pistes-line", type: "line", source: "pistes", paint: { "line-color": COLOR_EXPRESSION, "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 5, 2.5] as never, "line-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 1, 0.9] as never } });
      map.addLayer({ id: "pistes-warning-stripe", type: "line", source: "pistes", filter: ["==", ["get", "warning"], true], paint: { "line-color": "#374151", "line-width": 2, "line-dasharray": [2, 10] } });
      map.addLayer({ id: "pistes-labels", type: "symbol", source: "pistes", layout: { "symbol-placement": "line", "symbol-spacing": 150, "text-field": ["get", "label"], "text-size": 11, "text-font": ["Noto Sans Bold"] }, paint: { "text-color": "#ffffff", "text-halo-color": "#17363b", "text-halo-width": 1.5 } });
      map.addLayer({ id: "pistes-hit", type: "line", source: "pistes", paint: { "line-color": "#000000", "line-width": 18, "line-opacity": 0 } });
      map.addLayer({ id: "lifts-line", type: "line", source: "lifts", paint: { "line-color": "#a12b40", "line-width": 2, "line-dasharray": [2, 2] } });
      map.addLayer({ id: "lifts-labels", type: "symbol", source: "lifts", layout: { "symbol-placement": "line-center", "text-field": ["get", "label"], "text-size": 10 }, paint: { "text-color": "#7d2437", "text-halo-color": "#ffffff", "text-halo-width": 1.5 } });
      map.addLayer({ id: "lifts-hit", type: "line", source: "lifts", paint: { "line-color": "#000000", "line-width": 18, "line-opacity": 0 } });
      map.addLayer({ id: "recent-trace-casing", type: "line", source: "recent-trace", paint: { "line-color": "#ffffff", "line-width": 7, "line-opacity": 0.8 } });
      map.addLayer({ id: "recent-trace-line", type: "line", source: "recent-trace", paint: { "line-color": "#ed7657", "line-width": 4, "line-dasharray": [1, 1.5] } });
      map.addLayer({ id: "route-casing", type: "line", source: "route-result", paint: { "line-color": "#ffffff", "line-width": 10, "line-opacity": 0.9 } });
      map.addLayer({ id: "route-piste", type: "line", source: "route-result", filter: ["==", ["get", "kind"], "piste"], paint: { "line-color": ["get", "color"], "line-width": 6 } });
      map.addLayer({ id: "route-lift", type: "line", source: "route-result", filter: ["==", ["get", "kind"], "lift"], paint: { "line-color": "#7c3aed", "line-width": 6, "line-dasharray": [1, 1.5] } });
      map.addLayer({ id: "route-connection", type: "line", source: "route-result", filter: ["==", ["get", "kind"], "connection"], paint: { "line-color": "#1557b0", "line-width": 5, "line-dasharray": [2, 2] } });
      map.addLayer({ id: "map-points", type: "circle", source: "map-points", paint: { "circle-color": ["match", ["get", "role"], "current", "#1976d2", "start", "#16835d", "end", "#ed7657", "#17363b"] as never, "circle-radius": ["match", ["get", "role"], "current", 8, 6] as never, "circle-stroke-color": "#ffffff", "circle-stroke-width": 3 } });
      map.on("click", (event) => {
        const activeRouteMode = routeModeRef.current;
        if (activeRouteMode === "idle") return;
        const clicked: Position = [event.lngLat.lng, event.lngLat.lat];
        if (activeRouteMode === "start") {
          setManualStart(clicked);
          setRoute(null);
          setRouteError(null);
          setRouteMode("idle");
        } else {
          setDestination(clicked);
          setRoute(null);
          setRouteError(null);
          setRouteMode("idle");
        }
      });
      const select = (event: maplibregl.MapLayerMouseEvent, source: "pistes" | "lifts") => {
        if (routeModeRef.current !== "idle") return;
        const feature = event.features?.[0];
        if (!feature) return;
        const next = parseSelectedFeature(feature, source);
        if (!next) return;
        if (highlightedRef.current) map.setFeatureState({ source: highlightedRef.current.source, id: highlightedRef.current.uid }, { selected: false });
        map.setFeatureState({ source, id: next.uid }, { selected: true });
        highlightedRef.current = next;
        setSelected(next);
      };
      map.on("click", "pistes-hit", (event) => select(event, "pistes"));
      map.on("click", "lifts-hit", (event) => select(event, "lifts"));
      map.on("mouseenter", "pistes-hit", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "pistes-hit", () => { map.getCanvas().style.cursor = ""; });
      map.on("mouseenter", "lifts-hit", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "lifts-hit", () => { map.getCanvas().style.cursor = ""; });
      setMapReady(true);
    });
    map.on("error", (event) => {
      if (event.error?.message?.includes("Overpass")) setMapError(event.error.message);
    });
    return () => {
      map.remove();
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
    sourceData(map, "map-points", pointCollection(position, start, destination, manualStart !== null));
  }, [destination, manualStart, mapReady, position, start]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    sourceData(map, "route-result", route?.segments ?? EMPTY_COLLECTION);
  }, [mapReady, route]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !position || hasCenteredOnPosition.current || !withinBounds(position.coordinate)) return;
    map.easeTo({ center: position.coordinate, zoom: Math.max(map.getZoom(), 13), duration: 700 });
    hasCenteredOnPosition.current = true;
  }, [mapReady, position]);

  async function calculateRoute() {
    if (!start || !destination) return;
    setRouting(true);
    setRouteError(null);
    try {
      const map = mapRef.current;
      const result = await findRoute(mapData.lines, start, destination, (coordinate) => {
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

  function centerOnPosition() {
    if (!position || !mapRef.current) return;
    mapRef.current.flyTo({ center: position.coordinate, zoom: Math.max(mapRef.current.getZoom(), 14), essential: true });
  }

  function chooseStart(): void {
    setRouteMode("start");
    setRouteError(null);
  }

  function chooseEnd(): void {
    setRouteMode("end");
    setRouteError(null);
  }

  function closeSelected(): void {
    const map = mapRef.current;
    if (map && highlightedRef.current) map.setFeatureState({ source: highlightedRef.current.source, id: highlightedRef.current.uid }, { selected: false });
    highlightedRef.current = null;
    setSelected(null);
  }

  function clearRoute(): void {
    setRoute(null);
    setDestination(null);
    setManualStart(null);
    setRouteError(null);
    setRouteMode("idle");
  }

  return (
    <div className="map-page">
      <div className="map-canvas" ref={mapContainer} aria-label="Mapa tras narciarskich Sölden" />
      <div className="map-topbar">
        <div>
          <span className="map-kicker">Mapa ośrodka</span>
          <strong>Sölden</strong>
        </div>
        <div className="map-top-actions">
          <span className={`map-data-status${mapData.stale ? " map-data-status-stale" : ""}`}>
            <span className="map-status-dot" /> {mapError ? "Brak danych" : mapData.stale ? "Dane starsze" : "Trasy gotowe"}
          </span>
          <button className="map-icon-button" type="button" onClick={centerOnPosition} disabled={!position} aria-label="Pokaż moją pozycję" title="Pokaż moją pozycję"><Icon name="activity" size={19} /></button>
        </div>
      </div>

      {mapError && <div className="map-alert"><Icon name="x" size={16} /> {mapError}. Mapa może nie zawierać tras.</div>}
      {!mapError && !mapData.stale && !mapReady && <div className="map-loading"><span className="spinner" /> Wczytuję mapę i trasy…</div>}

      <div className="map-legend">
        <span><i className="legend-line legend-line-blue" /> plan</span>
        <span><i className="legend-line legend-line-coral" /> ostatnie 5 min</span>
        <span><i className="legend-dot legend-dot-gps" /> GPS telefonu</span>
      </div>

      {selected && (
        <section className="map-feature-card">
          <button className="map-card-close" type="button" onClick={closeSelected} aria-label="Zamknij szczegóły"><Icon name="x" size={16} /></button>
          <span className="map-feature-kicker">{selected.kind === "lift" ? "Wyciąg" : "Trasa"}</span>
          <strong style={{ color: selected.color }}>{selected.label}</strong>
          {selected.kind === "piste" && <span>{selected.difficulty === "unknown" ? "Trudność nieznana" : selected.difficulty}{selected.warning ? " · ostrzeżenie" : ""}</span>}
        </section>
      )}

      {route && (
        <section className="map-route-result">
          <span className="map-feature-kicker">Wyznaczona trasa</span>
          <strong>[{routeDistanceLabel(route.distanceM)}]</strong>
          <div className="map-route-sequence">
            {route.sequence.map((item, index) => (
              <span key={`${item.uid}-${index}`} className={item.kind === "lift" ? "map-sequence-lift" : ""} style={item.kind === "piste" ? { color: item.color } : undefined}>
                {index > 0 && <b>→</b>}{item.label}
              </span>
            ))}
          </div>
          <button className="map-clear-route" type="button" onClick={clearRoute}>Wyczyść</button>
        </section>
      )}

      <section className="map-route-controls">
        <div className="map-controls-heading">
          <div><span className="map-feature-kicker">Routing po stoku</span><strong>{routeMode === "idle" ? "Wybierz początek i cel" : routeMode === "start" ? "Wskaż początek na mapie" : "Wskaż cel na mapie"}</strong></div>
          {(start || destination) && <button className="map-card-close" type="button" onClick={clearRoute} aria-label="Wyczyść punkty"><Icon name="refresh" size={16} /></button>}
        </div>
        <div className="map-point-buttons">
          <button className={`map-point-button${routeMode === "start" ? " map-point-button-active" : ""}`} type="button" onClick={chooseStart}>
            <span className="map-point-marker map-point-marker-start" />
            <span><small>Start</small><b>{manualStart ? "Punkt z mapy" : position ? "Pozycja telefonu" : "Brak pozycji GPS"}</b></span>
          </button>
          <button className={`map-point-button${routeMode === "end" ? " map-point-button-active" : ""}`} type="button" onClick={chooseEnd}>
            <span className="map-point-marker map-point-marker-end" />
            <span><small>Cel</small><b>{destination ? "Punkt z mapy" : "Wybierz na mapie"}</b></span>
          </button>
        </div>
        <div className="map-controls-footer">
          {routeError ? <span className="map-route-error">{routeError}</span> : gpsError ? <span className="map-route-hint">{gpsError}</span> : <span className="map-route-hint">Kliknij trasę, aby zobaczyć szczegóły.</span>}
          <button className="button button-primary map-route-button" type="button" onClick={() => void calculateRoute()} disabled={routing || !start || !destination || mapData.lines.length === 0}>
            {routing ? <><span className="spinner spinner-light" /> Liczę…</> : "Wyznacz trasę"}
          </button>
        </div>
      </section>
    </div>
  );
}
