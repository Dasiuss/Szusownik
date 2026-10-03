# Testy

Strategia: **przepływy i funkcje integracyjnie/e2e, unitowe tylko dla cięższej,
izolowanej logiki**. Testy są
uruchamiane **lokalnie** — nie ma joba testowego w GitHub Actions (deploy Pages
buduje tylko PWA). Pokrycie mierzymy dla orientacji, bez progu minimalnego.

Zasada: testy sprzętowe z `docs/ble-transfer.md` §12, `docs/hud-display.md` §10 i
`docs/mapy-routing.md` §11 pozostają **manualne** (wymagają ESP32/telefonu/GPU).
Automatyzacja pokrywa wszystko poniżej tego progu.

## Warstwy

| Warstwa | Gdzie | Runner | Co pokrywa |
|---|---|---|---|
| Unit | `web/src/lib/*.test.ts` | Vitest (node) | csv, geo, runs, mapData, mapRouting, czyste helpery BLE |
| Integracja | `web/src/lib/*.integration.test.ts` | Vitest + `fake-indexeddb` | `SzusownikBle` z symulatorem urządzenia, zapis do IndexedDB, materializacja zjazdów, etykiety/tombstone'y |
| Kontrakt | `web/src/lib/protocol.test.ts` | Vitest | zgodność wygenerowanego protokołu z `protocol/ble-file-v1.json` |
| E2E UI | `web/e2e/*.spec.ts` | Playwright (Chromium) | boot z demo, sync z symulatorem, widoki, rename/delete, mapa (mock Overpass) |
| Host firmware | `firmware/test/host/test_*.cpp` | Catch2 + g++ | czysta logika `firmware/Szusownik/src/core/` + CRC32 z goldenem z urządzenia |

## PWA — komendy (katalog `web/`)

```powershell
npm install
npm test               # Vitest: unit + integracja + kontrakt
npm run test:watch     # tryb watch
npm run test:coverage  # raport pokrycia (v8), bez progu
npm run test:e2e       # Playwright (najpierw: npx playwright install chromium)
```

Playwright sam buduje PWA (`npm run build`) i podnosi `vite preview` na
`http://localhost:4173/Szusownik/`. Web Bluetooth nie istnieje w Chromium
headless — testy wstrzykują symulator przez `addInitScript` (`web/e2e/device.ts`).

## Firmware — testy hostowe (katalog repo)

```powershell
# Raz: kompilator C++
winget install BrechtSanders.WinLibs.POSIX.UCRT
# Testy:
powershell -ExecutionPolicy Bypass -File firmware/test/host/run.ps1
```

Czysta, testowalna logika firmware mieszka w `firmware/Szusownik/src/core/`
(bez `Arduino.h`): pasma GNSS, bufor listy, rotacja pliku, format linii CSV,
wzorce buzzera, progi termiczne. `src/` deleguje do `core/`, a testy hostowe
linkują tylko `core/` + `src/ble/crc32.h`. Test CRC32 porównuje realne nagranie
`test data/20260926_181420.csv` z goldenem z urządzenia (`crc=CF1B7DB8`,
`raw=216651`).

Kompilacja firmware nadal przez `arduino-cli` (sketch `firmware/Szusownik`);
`firmware/test/host/` nie jest częścią sketcha, więc nie trafia do builda.

## Wspólny protokół

`protocol/ble-file-v1.json` to SSOT (UUID, ramki, komendy, statusy, zakresy
ustawień, nagłówek CSV). Generator tworzy `web/src/lib/protocol.ts` i
`firmware/Szusownik/src/config/protocol.h`:

```powershell
node scripts/gen-protocol.mjs      # albo: npm run gen:protocol (w web/)
```

Nie edytuj wygenerowanych plików ręcznie. `web/src/lib/protocol.test.ts`
regeneruje je w pamięci i porównuje z zawartością na dysku — rozjazd wywala test.

## Dane testowe

- Realne nagranie: `test data/20260926_181420.csv` (+ `.meta`). Golden transferu:
  `web/test/golden/device-done.json` (linia `BLE done ...` z monitora).
- Generatory syntetyczne: `web/test/fixtures.ts` (zjazd, postój, przejazd z `lifts`
  wyciągami — liczba zjazdów znana z góry, `lifts + 1`).
- Fixture mapy/routingu: `web/test/skiArea.ts` (syntetyczny ośrodek, provider
  wysokości).
- Symulatory urządzenia: `web/test/device-emulator.ts` (integracja; pełny
  protokół z NACK/replay i wstrzykiwaniem awarii) oraz `web/e2e/device.ts`
  (e2e; odtwarza gotowe ramki, bo w przeglądarce nie ma `node:zlib`).

Podmiana realnego nagrania: skopiuj plik z karty do `test data/`, zaktualizuj
`REAL_RIDE_FILE` w `web/test/fixtures.ts` i golden w
`web/test/golden/device-done.json` (nowa linia `BLE done ...` z `monitor_COM7.cmd`).

## Ograniczenia

- Symulator kompresuje zlib-em Node; nie wymagamy bajtowej równości z miniz.
  Porównujemy rozmiar raw, CRC i zdekompresowaną treść — dlatego golden trzyma
  `raw` i `crc`, a nie `comp`/`frames`.
- Mapa w e2e ma zamockowany Overpass; MapLibre renderuje w Chromium przez
  SwiftShader (wolniejsze, ale stabilne).
- `npm run build` używa `tsc` z projektem referencyjnym bez `-b`, więc nie
  type-checkuje źródeł; testy Vitest transpilują bez typowania. To znane
  (nie zmieniamy w tym zakresie).
