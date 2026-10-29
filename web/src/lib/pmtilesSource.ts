import * as maplibregl from "maplibre-gl";
import { PMTiles, Protocol, type RangeResponse, type Source } from "pmtiles";
import { SOLDEN_BOUNDS } from "./mapData.ts";
import { clipVectorTile } from "./tileClip.ts";

const BASE = import.meta.env.BASE_URL;

// Klucz archiwum w protokole `pmtiles://`. Używany też w stylu mapy.
export const PMTILES_KEY = "solden.pmtiles";
const PMTILES_URL = `${window.location.origin}${BASE}${PMTILES_KEY}`;

/**
 * Źródło PMTiles czytające całe archiwum z pamięci.
 *
 * Dlaczego nie `FetchSource`: PMTiles normalnie czyta plik przez HTTP Range
 * (206). Service worker precache'ujący plik zwraca go w całości (200), co
 * potrafi zepsuć odczyt offline. Wczytanie ~3 MB do pamięci usuwa tę zależność.
 */
class MemorySource implements Source {
  private readonly buffer: ArrayBuffer;

  constructor(buffer: ArrayBuffer) {
    this.buffer = buffer;
  }

  getKey(): string {
    return PMTILES_KEY;
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    return { data: this.buffer.slice(offset, offset + length) };
  }
}

let prepared: Promise<boolean> | null = null;

/**
 * Wczytuje archiwum podkładu i rejestruje protokół `pmtiles://`.
 * Zwraca `false`, gdy archiwum jest niedostępne (np. pierwsze wejście offline
 * bez precache) — mapa działa wtedy bez podkładu, ale z resztą warstw.
 * Po niepowodzeniu stan jest czyszczony, więc kolejne wywołanie próbuje
 * ponownie (np. gdy sieć wróci) zamiast zwracać zapamiętaną porażkę.
 */
export function prepareBasemap(): Promise<boolean> {
  if (!prepared) {
    prepared = (async () => {
      try {
        const response = await fetch(PMTILES_URL);
        if (!response.ok) throw new Error(`PMTiles: HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        const protocol = new Protocol();
        protocol.add(new PMTiles(new MemorySource(buffer)));
        // `pmtiles extract --bbox` przycina archiwum do całych kafelków, więc
        // geometria wystaje poza obszar. Przycinamy każdy kafelek do bboxa —
        // tak samo jak poziomice — żeby podkład kończył się na granicy danych.
        maplibregl.addProtocol("pmtiles", async (request, abortController) => {
          const tile = await protocol.tile(request, abortController);
          const match = /\/\/(\d+)\/(\d+)\/(\d+)/.exec(request.url);
          if (!match) return tile;
          const [, z, x, y] = match.map(Number);
          const data = tile.data as ArrayBuffer;
          return { ...tile, data: clipVectorTile(data, z, x, y, SOLDEN_BOUNDS) };
        });
        return true;
      } catch (error) {
        console.warn("Podkład wektorowy niedostępny:", error);
        prepared = null;
        return false;
      }
    })();
  }
  return prepared;
}
