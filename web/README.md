# web/ — PWA

Aplikacja web (PWA) do prezentacji i analizy przejazdów.

- Stack: React 19 + TypeScript + Vite 6 (+ vite-plugin-pwa, Recharts, Dexie,
  papaparse, react-router-dom, Tailwind v4).
- Dane: **rzeczywiste nagranie z urządzenia** jako fixture
  (`public/fixtures/ride.csv` — skopiuj z karty SD, patrz `public/fixtures/README.md`),
  docelowo transfer BLE z urządzenia (faza C) + Supabase (faza D). Bez mocków.

Struktura `src/`:

- `lib/csv.ts` — parsowanie + walidacja schematu CSV z urządzenia.
- `lib/geo.ts` — haversine, średnie ruchome, nachylenie (defaulty z wymagań-PWA §6).
- `lib/runs.ts` — wzbogacanie próbek, cięcie zjazdów (podjazd >30 s), statystyki dnia.
- `lib/db.ts` — Dexie/IndexedDB, schemat v1 (surowe CSV pod kluczem nazwy pliku).
- `lib/ble.ts` — szkielet transferu BLE (UUID v1 jak w firmware, implementacja w fazie C).
- `lib/store.ts` — in-memory store dnia + formatowanie PL.
- `routes/DayView.tsx` — „Pobierz dane", statystyki dnia, lista zjazdów.
- `routes/RunView.tsx` — wykresy prędkość/nachylenie vs dystans.

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
