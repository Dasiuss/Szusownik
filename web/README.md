# web/ — PWA

Aplikacja web (PWA) do prezentacji i analizy przejazdów.

- Stack: React 19 + TypeScript + Vite 6 (+ vite-plugin-pwa, Recharts, Dexie,
  papaparse, react-router-dom, Tailwind v4).
- Dane: **rzeczywiste nagranie z urządzenia** jako demo fixture
  (`public/fixtures/ride.csv`, skopiowane z `test data/LOG_1605.csv`),
  docelowo transfer BLE z urządzenia (faza C) + Supabase (faza D). Bez syntetycznych mocków.

Struktura `src/`:

- `lib/csv.ts` — parsowanie + walidacja schematu CSV z urządzenia.
- `lib/geo.ts` — haversine, średnie ruchome, nachylenie (defaulty z wymagań-PWA §6).
- `lib/runs.ts` — wzbogacanie próbek, cięcie zjazdów (wzrost wysokości >=5 m), statystyki dnia.
- `lib/db.ts` — Dexie/IndexedDB, schemat v2 (surowe CSV, zjazdy i metadane).
- `lib/data.ts` — seed demo, grupowanie dni, materializacja zjazdów i lokalne operacje danych.
- `lib/ble.ts` — transfer BLE i sprawdzanie nowych plików bez rozłączania sesji.
- `lib/device.tsx` — wspólna sesja BLE, reconnect i limit bezczynności 10 minut.
- `routes/DayView.tsx` — karta nowych plików, statystyki dnia i lista zjazdów.
- `routes/HistoryView.tsx` — historia aktywności pogrupowana po lokalnych dniach.
- `routes/RunView.tsx` — nazwa, usuwanie i wykresy prędkość/wysokość vs dystans.
- `routes/DaySummaryView.tsx` — połączone statystyki i wykresy całego dnia.
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
