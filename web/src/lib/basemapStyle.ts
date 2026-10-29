import type { RasterDEMSourceSpecification, StyleSpecification } from "maplibre-gl";
import { layers as basemapLayers, namedFlavor } from "@protomaps/basemaps";

import { SOLDEN_BOUNDS } from "./mapData.ts";
import { CONTOUR_MINOR_M, type ContourProfile } from "./contourLevels.ts";
import {
  CONTOUR_SOURCE_LAYER,
  DEM_MAX_ZOOM,
  DEM_TILES_URL,
  contourTilesUrl,
} from "./contours.ts";
import { PMTILES_KEY } from "./pmtilesSource.ts";

const BASE = import.meta.env.BASE_URL;
// MapLibre wymaga ABSOLUTNYCH URL-i dla `glyphs` i `sprite`.
const ORIGIN = window.location.origin;
const local = (path: string) => `${ORIGIN}${BASE}${path}`;

const GLYPHS = local("fonts/{fontstack}/{range}.pbf");
const SPRITE = local("sprites/v4/light");

export const HILLSHADE_LAYER_ID = "dem-hillshade";
export const CONTOUR_LINES_LAYER_ID = "contour-lines";
export const CONTOUR_LABELS_LAYER_ID = "contour-labels";

// Ustalone w prototypie: cieniowanie 45%.
const HILLSHADE_EXAGGERATION = 0.675;

const DEM_ATTRIBUTION =
  "Teren: Mapzen/Joerd, EU-DEM (Copernicus), © offene Daten Österreichs (DGM Österreich), SRTM/USGS";

const HILLSHADE_PAINT = {
  "hillshade-shadow-color": "rgba(66, 82, 82, 0.8)",
  "hillshade-highlight-color": "rgba(255, 255, 255, 0.65)",
  "hillshade-accent-color": "rgba(122, 144, 144, 0.55)",
} as const;

export interface MapStyleOptions {
  /** Wektorowy podkład z `solden.pmtiles`. */
  basemap: boolean;
  /** Cieniowanie terenu z DEM. */
  hillshade: boolean;
  /** Teren 3D z DEM. */
  terrain: boolean;
  /** Poziomice liczone z DEM. */
  contours: boolean;
  /**
   * Profil gęstości poziomic: `pitch` (duża mapa 3D, stały interwał) albo
   * `zoom` (płaskie mini-mapy, interwał podwajany przy oddalaniu).
   */
  contourProfile: ContourProfile;
}

/**
 * Wspólny styl mapy: wektorowy podkład (OSM/Protomaps), cieniowanie, poziomice
 * i opcjonalnie teren 3D. Wszystkie zasoby są lokalne (self-hosted).
 */
export function buildMapStyle(options: Partial<MapStyleOptions> = {}): StyleSpecification {
  const {
    basemap = true,
    hillshade = true,
    terrain = true,
    contours = true,
    contourProfile = "pitch",
  } = options;

  const base = (basemap
    ? basemapLayers("protomaps", namedFlavor("light"), { lang: "pl" })
    : [{ id: "background", type: "background", paint: { "background-color": "#dbe9e5" } }]
  ) as unknown as StyleSpecification["layers"];

  const sources: StyleSpecification["sources"] = {};
  if (basemap) {
    sources.protomaps = {
      type: "vector",
      url: `pmtiles://${PMTILES_KEY}`,
      attribution:
        '<a href="https://protomaps.com">Protomaps</a> © <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
    };
  }

  const demSourceSpec: RasterDEMSourceSpecification = {
    type: "raster-dem",
    tiles: [DEM_TILES_URL],
    tileSize: 256,
    maxzoom: DEM_MAX_ZOOM,
    encoding: "terrarium",
    bounds: SOLDEN_BOUNDS,
  };
  if (terrain || hillshade) sources.dem = { ...demSourceSpec, attribution: DEM_ATTRIBUTION };
  // Osobne źródło dla cieniowania — MapLibre ostrzega, że wspólne z terenem
  // pogarsza jakość renderowania.
  if (hillshade) sources["dem-hillshade"] = { ...demSourceSpec };

  const contourUrl = contours ? contourTilesUrl(CONTOUR_MINOR_M, contourProfile) : null;
  if (contourUrl) {
    // `bounds` ogranicza żądania do kafelków przecinających obszar; reszta
    // i tak wraca pusta z protokołu (bez generowania i bez błędów DEM).
    sources.contours = { type: "vector", tiles: [contourUrl], maxzoom: 15, bounds: SOLDEN_BOUNDS };
  }

  const hillshadeLayer = {
    id: HILLSHADE_LAYER_ID,
    type: "hillshade",
    source: "dem-hillshade",
    paint: {
      "hillshade-exaggeration": HILLSHADE_EXAGGERATION,
      ...HILLSHADE_PAINT,
    },
  } as unknown as StyleSpecification["layers"][number];

  const contourLines = {
    id: CONTOUR_LINES_LAYER_ID,
    type: "line",
    source: "contours",
    "source-layer": CONTOUR_SOURCE_LAYER,
    paint: {
      "line-color": "rgba(138, 108, 78, 0.55)",
      "line-width": ["match", ["get", "level"], 1, 1.1, 0.6] as never,
    },
  } as unknown as StyleSpecification["layers"][number];

  const contourLabels = {
    id: CONTOUR_LABELS_LAYER_ID,
    type: "symbol",
    source: "contours",
    "source-layer": CONTOUR_SOURCE_LAYER,
    filter: [">", ["get", "level"], 0] as never,
    layout: {
      "symbol-placement": "line",
      "text-size": 10,
      "text-field": ["concat", ["number-format", ["get", "ele"], {}], " m"] as never,
      "text-font": ["Noto Sans Medium"],
      "text-padding": 6,
    },
    paint: {
      "text-color": "#7a6448",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.2,
    },
  } as unknown as StyleSpecification["layers"][number];

  // Cieniowanie leży nad wypełnieniami lądu, a pod liniami, wodą i etykietami.
  const insertAt = base.findIndex((layer) => layer.type === "line" || layer.type === "symbol");
  const at = insertAt === -1 ? base.length : insertAt;

  const layers: StyleSpecification["layers"] = [...base.slice(0, at)];
  if (hillshade) layers.push(hillshadeLayer);
  if (contourUrl) layers.push(contourLines);
  layers.push(...base.slice(at));
  if (contourUrl) layers.push(contourLabels);

  return {
    version: 8,
    glyphs: GLYPHS,
    sprite: SPRITE,
    sources,
    layers,
    ...(terrain ? { terrain: { source: "dem", exaggeration: 0.6 } } : {}),
    sky: {
      "sky-color": "#a5d6f5",
      "horizon-color": "#f0f6fa",
      "horizon-fog-blend": 0.4,
      "fog-color": "#e8eef2",
      "fog-ground-blend": 0.4,
      "atmosphere-blend": 1,
    },
  };
}
