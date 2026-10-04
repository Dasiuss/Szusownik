# web/ — PWA

Aplikacja web (PWA) do prezentacji i analizy przejazdów.

- Stack: React 19 + TypeScript + Vite 6 (+ vite-plugin-pwa, Recharts, MapLibre GL,
  Dexie, papaparse, react-router-dom, Tailwind v4).
- Dane demo: **generowany** ślad narciarski (`public/fixtures/ride.csv` z
  `scripts/gen-demo-ride.mjs`) na prawdziwych trasach Sölden; docelowo transfer
  BLE z urządzenia (faza C) + Supabase (faza D). Realne nagranie do testów:
  `test data/20260926_181420.csv`.

Struktura `src/`:

- `lib/csv.ts` — parsowanie + walidacja schematu CSV z urządzenia.
- `lib/geo.ts` — haversine, średnie ruchome, nachylenie (defaulty z wymagań-PWA §6).
- `lib/runs.ts` — wzbogacanie próbek, cięcie zjazdów (wzrost wysokości >=5 m), statystyki dnia.
- `lib/db.ts` — Dexie/IndexedDB, schemat v6 (surowe CSV, zjazdy, etykiety,
  tombstone'y, pominięte/oczekujące pliki, metadane).
- `lib/data.ts` — seed demo, grupowanie dni, materializacja zjazdów i lokalne operacje danych.
- `lib/mapData.ts` — normalizacja tras/wyciągów OSM (Overpass) + cache.
- `lib/routeMatching.ts` — automatyczne dopasowanie zjazdu do tras (sekwencja + spany).
- `lib/traceMap.ts` — przygotowanie śladu do mini-mapy (kolor wg prędkości, decymacja).
- `lib/ble.ts` — transfer BLE i sprawdzanie nowych plików bez rozłączania sesji.
- `lib/device.tsx` — wspólna sesja BLE, reconnect i limit bezczynności 10 minut.
- `routes/DayView.tsx` — karta nowych plików, statystyki dnia i lista zjazdów.
- `routes/HistoryView.tsx` — historia aktywności pogrupowana po lokalnych dniach.
- `routes/RunView.tsx` — nazwa, usuwanie, mini-mapa, trasy zjazdu i wykresy.
- `routes/DaySummaryView.tsx` — połączone statystyki, mini-mapa i wykresy dnia.
- `components/TraceMap.tsx` — mini-mapa 2D (MapLibre): trasy, wyciągi i ślad GPS.
- `routes/SettingsView.tsx` — status urządzenia, ustawienia dźwięku i widoczna
  wersja PWA (czas builda) w sekcji „Dane aplikacji".
- `lib/version.ts` — odczyt `__BUILD_TIME__` (wstrzykiwany w `vite.config.ts`)
  i formatowanie czasu builda w `pl-PL`.

Komendy (katalog `web/`):

```powershell
npm install
npm run dev      # development, otwórz http://localhost:5173
npm run build    # tsc + build produkcyjny (PWA, service worker)
npm run preview
```

Deploy: GitHub Pages (https://dasiuss.github.io/Szusownik/) przez
`.github/workflows/deploy.yml` — buduje `web/` na każdy push do `main`
zawierający zmiany w `web/`. W ustawieniach repo: Pages → Source: GitHub Actions.
