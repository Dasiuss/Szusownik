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
| Unit | `web/src/lib/*.test.ts` | Vitest (node) | csv, geo, runs, mapData, mapRouting, routeMatching, traceMap, routeTransfer (kod trasy), czyste helpery BLE |
| Integracja | `web/src/lib/*.integration.test.ts` | Vitest + `fake-indexeddb` | `SzusownikBle` z symulatorem urządzenia, zapis do IndexedDB, materializacja zjazdów, etykiety/tombstone'y, wysyłka trasy |
| Kontrakt | `web/src/lib/protocol.test.ts`, `hudProtocol.test.ts`, `routeProtocol.test.ts` | Vitest | zgodność wygenerowanych plików z `protocol/ble-file-v1.json`, `hud-espnow-v1.json`, `route-v1.json` |
| E2E UI | `web/e2e/*.spec.ts` | Playwright (Chromium) | boot z demo, sync z symulatorem, widoki, rename/delete, mapa i mini-mapa śladu (mock Overpass) |
| Host firmware | `firmware/test/host/test_*.cpp`, `firmware/test/host/hudrekaw/test_*.cpp` | Catch2 + g++ | czysta logika `Szusownik/src/core/` + `HudRekaw/src/core/` + CRC32 z goldenem z urządzenia + golden bloba trasy |

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
# Wszystkie testy (build przyrostowy; Catch2 prekompilowany raz):
powershell -ExecutionPolicy Bypass -File firmware/test/host/run.ps1
# Tylko pasujące testy albo jedna binarka (szybka pętla):
powershell -ExecutionPolicy Bypass -File firmware/test/host/run.ps1 -Filter "run_tracker*"
powershell -ExecutionPolicy Bypass -File firmware/test/host/run.ps1 -Binaries szusownik
```

Build jest **przyrostowy**: każdy `.cpp` trafia do `.o` w
`firmware/test/host/.build/` tylko gdy jest nowszy niż źródło lub którykolwiek
nagłówek, a Catch2 jest prekompilowany raz. Powtórne uruchomienie bez zmian to
~2 s (samo linkowanie). W testach Catch2 `Approx` wymaga kwalifikacji `Catch::`
(dodaj `using Catch::Approx;`) — pliki testów nie mają `using namespace Catch`.

Czysta, testowalna logika firmware mieszka w `firmware/Szusownik/src/core/` i
`firmware/HudRekaw/src/core/` (bez `Arduino.h`): pasma GNSS, bufor listy, rotacja
pliku, format linii CSV, wzorce buzzera, progi termiczne, kodowanie pakietów
ESP-NOW HUD, detekcja zjazdu `RunTracker` (fuzja baro+GPS + ZigZag) i
formatowanie HUD (`hud_format`) oraz logika trasy (dekod bloba, indeks odcinka,
dotarcie); a po stronie odbiorcy dekodowanie pakietów, dekod trasy,
matematyka mapy (projekcja/fisheye, kolory, labele) i format TOT. `src/` deleguje do `core/`, a
testy hostowe linkują tylko `core/` + `src/ble/crc32.h`. `run.ps1` buduje dwa
binaria (`host_tests_szusownik`, `host_tests_hudrekaw`). Test CRC32 porównuje
realne nagranie `test data/20260926_181420.csv` z goldenem z urządzenia
(`crc=CF1B7DB8`, `raw=216651`).

Kompilacja firmware nadal przez `arduino-cli` (sketch `firmware/Szusownik`);
`firmware/test/host/` nie jest częścią sketcha, więc nie trafia do builda.

## Wspólny protokół

`protocol/ble-file-v1.json` to SSOT (UUID, ramki, komendy, statusy, zakresy
ustawień, nagłówek CSV). Generator tworzy `web/src/lib/protocol.ts` i
`firmware/Szusownik/src/config/protocol.h`:

```powershell
node scripts/gen-protocol.mjs      # albo: npm run gen:protocol (w web/)
```

Protokół ESP-NOW HUD ma osobny SSOT `protocol/hud-espnow-v1.json` i generator
`scripts/gen-hud-protocol.mjs`, który tworzy identyczny nagłówek do obu firmware
(`Szusownik/src/config/hud_protocol.h` i `HudRekaw/src/config/hud_protocol.h`):

```powershell
node scripts/gen-hud-protocol.mjs  # albo: npm run gen:hud-protocol (w web/)
```

Protokół trasy ma SSOT `protocol/route-v1.json` i generator
`scripts/gen-route-protocol.mjs`, który tworzy `web/src/lib/routeProtocol.ts` oraz
identyczne nagłówki `route_protocol.h` do obu firmware:

```powershell
node scripts/gen-route-protocol.mjs  # albo: npm run gen:route-protocol (w web/)
```

Układ bloba trasy jest zweryfikowany przez **golden** (ten sam 69-bajtowy blob,
CRC `26EA8EF9`) w `routeTransfer.test.ts` (PWA), `test_route.cpp` (Szusownik) i
`hudrekaw/test_route.cpp` (HudRekaw) — rozjazd PWA <-> firmware wywala testy hostowe.

Nie edytuj wygenerowanych plików ręcznie. `web/src/lib/protocol.test.ts`,
`hudProtocol.test.ts` i `routeProtocol.test.ts` regenerują je w pamięci i
porównują z zawartością na dysku — rozjazd wywala test.

## Dane testowe

- Realne nagranie: `test data/20260926_181420.csv` (+ `.meta`). Golden transferu:
  `web/test/golden/device-done.json` (linia `BLE done ...` z monitora).
- Demo PWA: `web/public/fixtures/ride.csv` — generowany przez
  `scripts/gen-demo-ride.mjs` (albo `npm run gen:demo` w `web/`) na prawdziwej
  geometrii Sölden (`scripts/data/demo-solden.json`). Test `demoFixture.test.ts`
  pilnuje, że plik daje 3 zjazdy i dopasowanie tras `1 → 1a`.
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
