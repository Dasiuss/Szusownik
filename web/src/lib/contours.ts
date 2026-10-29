import * as maplibregl from "maplibre-gl";
import mlcontour from "maplibre-contour";
import { clipVectorTile, tileIntersectsBounds } from "./tileClip.ts";
import { SOLDEN_BOUNDS } from "./mapData.ts";
import { CONTOUR_MINOR_M, contourThresholds, type ContourProfile } from "./contourLevels.ts";

const BASE = import.meta.env.BASE_URL;
const ORIGIN = window.location.origin;

// Ten sam lokalny DEM, z którego korzysta teren 3D i cieniowanie.
export const DEM_TILES_URL = `${ORIGIN}${BASE}dem/{z}/{x}/{y}.png`;
export const DEM_MAX_ZOOM = 13;
export const CONTOUR_SOURCE_LAYER = "contours";

// Poziomice liczone w przeglądarce z kafelków DEM (`maplibre-contour`, BSD-3).
// Brak generowanych plików — krzywe powstają z tego samego DEM co relief.
let demSource: InstanceType<typeof mlcontour.DemSource> | null = null;
try {
  const source = new mlcontour.DemSource({
    url: DEM_TILES_URL,
    encoding: "terrarium",
    maxzoom: DEM_MAX_ZOOM,
    worker: true,
    cacheSize: 100,
    timeoutMs: 10000,
  });
  // Kafelek DEM (zwłaszcza na niskich zoomach) obejmuje teren większy niż bbox,
  // więc gotową geometrię przycinamy do obszaru mapy — inaczej poziomice leją
  // się daleko poza dane (przy z8 kafelek to ~1,4° szerokości).
  maplibregl.addProtocol(source.contourProtocolId, async (request, abortController) => {
    const match = /\/\/(\d+)\/(\d+)\/(\d+)/.exec(request.url);
    if (!match) return source.contourProtocolV4(request, abortController);
    const [, z, x, y] = match.map(Number);
    // Kafelek poza obszarem danych: nie ma czego generować, a brakujące kafelki
    // DEM kończyłyby się błędem. Zwracamy pusty kafelek od razu.
    if (!tileIntersectsBounds(z, x, y, SOLDEN_BOUNDS)) return { data: new ArrayBuffer(0) };
    const response = await source.contourProtocolV4(request, abortController);
    return { ...response, data: clipVectorTile(response.data as ArrayBuffer, z, x, y, SOLDEN_BOUNDS) };
  });
  demSource = source;
} catch (error) {
  console.warn("Poziomice niedostępne:", error);
}

/**
 * Adres kafelków poziomic. Profil decyduje o interwale na kolejnych zoomach
 * (`contourThresholds`): `pitch` trzyma stały interwał pod pochyloną mapę,
 * `zoom` podwaja go przy oddalaniu w płaskich mini-mapach.
 */
export function contourTilesUrl(
  minorMeters: number = CONTOUR_MINOR_M,
  profile: ContourProfile = "pitch",
): string | null {
  if (!demSource) return null;
  return demSource.contourProtocolUrl({
    thresholds: contourThresholds(profile, minorMeters),
    contourLayer: CONTOUR_SOURCE_LAYER,
    elevationKey: "ele",
    levelKey: "level",
    extent: 4096,
    buffer: 1,
    subsampleBelow: 1024,
  });
}
