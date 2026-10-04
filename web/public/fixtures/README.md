# Fixture PWA — demo (generowane)

Plik `ride.csv` to **generowane** dane demonstracyjne, a nie nagranie z
urządzenia: syntetyczny dzień narciarski osadzony na prawdziwej geometrii OSM
Sölden. Powstaje z `scripts/gen-demo-ride.mjs` na podstawie
`scripts/data/demo-solden.json` (pętla Gaislachkoglbahn II + zjazd trasami
`1` → `1a`, 3 zjazdy). Format to poprawny CSV v2, ale wartości GNSS są
modelowane. Szczegóły: `docs/wymagania-PWA.md` §8.

Przy seedowaniu PWA przesuwa timestampy do bieżącego czasu i zapisuje plik jako
`demo-ride.csv` (`DEMO_SOURCE_FILE`). Osierocone pliki `demo-*` są usuwane.

Regeneracja fixture (development):

1. (Opcjonalnie) podmień snapshot geometrii `scripts/data/demo-solden.json`.
2. Uruchom generator: `node scripts/gen-demo-ride.mjs` albo `npm run gen:demo`
   (w `web/`).
3. Zwiększ wersję klucza `DEMO_SEEDED_KEY` w `web/src/lib/data.ts`, żeby
   istniejące instalacje pobrały nowy plik (albo wyczyść dane aplikacji), i
   odpal `npm run dev`.

Plik musi mieć nagłówek v2:

```text
timestamp,lat,lon,speed,altitude_gps,heading,altitude_baro,gnss_fix_valid,gnss_fix_age_ms,gnss_satellites,gnss_satellites_age_ms,gnss_hdop,gnss_hdop_age_ms
```

Fixture powinien zawierać co najmniej **2 zjazdy** (tu: 3 zjazdy, każdy = wyciąg
+ zjazd). Zmiany pilnuje `web/src/lib/demoFixture.test.ts`.
