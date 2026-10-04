// Mini-mapa 2D: trasy OSM + wyciągi + ślad GPS kolorowany prędkością.
// Używana nad wykresami w szczegółach zjazdu i w widoku „Cały dzień".
//
// Ładowana przez `React.lazy` w widokach, żeby MapLibre nie trafiał do głównego
// bundla (współdzieli chunk z pełnym widokiem mapy). Kamera jest płaska (2D,
// bez terenu) z włączonym obrotem, jak w dużej mapie.

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, StyleSpecification } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { Icon } from "./Icon.tsx";
import {
  DIFFICULTY_COLORS,
  SOLDEN_BOUNDS,
  SOLDEN_CENTER,
  getSkiDataForMatching,
  loadCachedSkiData,
  loadSkiData,
  type SkiData,
} from "../lib/mapData.ts";
import { buildTraceCollection, traceBounds, type TracePoint } from "../lib/traceMap.ts";

maplibregl.setWorkerUrl(maplibreWorkerUrl);

const EMPTY_PISTES = { type: "FeatureCollection", features: [] } as const;
const EMPTY_TRACE = { type: "FeatureCollection", features: [] } as const;

const PISTE_LABEL_FILTER = ["all", ["==", ["geometry-type"], "LineString"], ["has", "label"]] as never;

const PISTE_COLOR_EXPRESSION = [
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

const MINI_STYLE: StyleSpecification = {
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
  },
  layers: [
    { id: "background", type: "background", paint: { "background-color": "#dbe9e5" } },
    { id: "topo", type: "raster", source: "topo", paint: { "raster-saturation": -0.15, "raster-contrast": 0.05 } },
  ],
};

function addMiniLayers(map: maplibregl.Map): void {
  map.addSource("pistes", { type: "geojson", data: EMPTY_PISTES });
  map.addSource("lifts", { type: "geojson", data: EMPTY_PISTES });
  map.addSource("trace", { type: "geojson", data: EMPTY_TRACE });

  map.addLayer({
    id: "pistes-casing",
    type: "line",
    source: "pistes",
    filter: ["==", ["geometry-type"], "LineString"] as never,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ffffff", "line-width": 4, "line-opacity": 0.55 },
  });
  map.addLayer({
    id: "pistes-line",
    type: "line",
    source: "pistes",
    filter: ["==", ["geometry-type"], "LineString"] as never,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": PISTE_COLOR_EXPRESSION, "line-width": 2, "line-opacity": 0.55 },
  });
  map.addLayer({
    id: "lifts-line",
    type: "line",
    source: "lifts",
    layout: { "line-cap": "round" },
    paint: { "line-color": "#dc2626", "line-width": 1.8, "line-dasharray": [2, 1.5] },
  });
  map.addLayer({
    id: "trace-casing",
    type: "line",
    source: "trace",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.65 },
  });
  map.addLayer({
    id: "trace-line",
    type: "line",
    source: "trace",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["get", "color"] as never, "line-width": 4.5 },
  });
  map.addLayer({
    id: "pistes-labels",
    type: "symbol",
    source: "pistes",
    filter: PISTE_LABEL_FILTER,
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 160,
      "text-field": ["get", "label"] as never,
      "text-size": 11,
      "text-font": ["Noto Sans Bold"],
      "text-allow-overlap": false,
      "text-optional": true,
    },
    paint: { "text-color": "#17363b", "text-halo-color": "#ffffff", "text-halo-width": 1.6 },
  });
}

function applySkiData(map: maplibregl.Map, data: SkiData | null): void {
  if (!data) return;
  const pistes = map.getSource("pistes") as GeoJSONSource | undefined;
  const lifts = map.getSource("lifts") as GeoJSONSource | undefined;
  if (pistes) pistes.setData(data.pistes as never);
  if (lifts) lifts.setData(data.lifts as never);
}

function applyTrace(map: maplibregl.Map, traces: TracePoint[][]): void {
  const source = map.getSource("trace") as GeoJSONSource | undefined;
  if (!source) return;
  source.setData(buildTraceCollection(traces) as never);
  const bounds = traceBounds(traces);
  if (!bounds) return;
  const pad = 0.0009;
  map.fitBounds(
    [
      [bounds[0][0] - pad, bounds[0][1] - pad],
      [bounds[1][0] + pad, bounds[1][1] + pad],
    ],
    { padding: 26, duration: 0 },
  );
}

interface TraceMapProps {
  traces: TracePoint[][];
  ariaLabel?: string;
}

export default function TraceMap({ traces, ariaLabel = "Mapa śladu" }: TraceMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loadedRef = useRef(false);
  const tracesRef = useRef(traces);
  tracesRef.current = traces;
  const [expanded, setExpanded] = useState(false);

  const [skiData, setSkiData] = useState<SkiData | null>(
    () => getSkiDataForMatching() ?? loadCachedSkiData(),
  );
  const skiRef = useRef(skiData);
  skiRef.current = skiData;

  // Trasy OSM: cache-first, a gdy ich brak — dociągamy w tle (best-effort).
  useEffect(() => {
    if (skiData) return;
    let active = true;
    loadSkiData()
      .then((data) => {
        if (active) setSkiData(data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [skiData]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const map = new maplibregl.Map({
      container,
      style: MINI_STYLE,
      center: SOLDEN_CENTER,
      zoom: 12,
      pitch: 0,
      bearing: -90,
      maxPitch: 0,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      attributionControl: { compact: true },
    });
    // Stała orientacja jak w dużej mapie (bearing -90) — bez obrotu gestami.
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    mapRef.current = map;
    map.on("load", () => {
      addMiniLayers(map);
      loadedRef.current = true;
      applySkiData(map, skiRef.current);
      applyTrace(map, tracesRef.current);
    });
    return () => {
      loadedRef.current = false;
      mapRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    applySkiData(map, skiData);
  }, [skiData]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    applyTrace(map, traces);
  }, [traces]);

  // Zmiana rozmiaru kafelka: przelicz canvas i dopasuj widok do śladu.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    map.resize();
    applyTrace(map, tracesRef.current);
  }, [expanded]);

  return (
    <section className={`trace-map-card${expanded ? " trace-map-card-expanded" : ""}`} aria-label={ariaLabel}>
      <div className="trace-map" ref={containerRef} />
      <button
        type="button"
        className="trace-map-toggle"
        aria-label={expanded ? "Zwiń mapę" : "Powiększ mapę"}
        aria-pressed={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <Icon name={expanded ? "collapse" : "expand"} size={18} />
      </button>
    </section>
  );
}
