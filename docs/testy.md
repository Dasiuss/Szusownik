# Testy

Strategia: **przepływy i funkcje integracyjnie/e2e, unitowe tylko dla cięższej,
izolowanej logiki**. Testy są
uruchamiane **lokalnie** — nie ma joba testowego w GitHub Actions (deploy Pages
buduje tylko PWA). Pokrycie mierzymy dla orientacji, bez progu minimalnego.

Testy wymagające realnego sprzętu pozostają **manualne**: akceptacja BLE na
urządzeniu i telefonie (`docs/ble-transfer.md` §12) oraz render i odczyt OLED
(`docs/hud-display.md` §7). Routing i przetwarzanie danych mapowych mają testy
automatyczne; lista w `docs/mapy-routing.md` §11 rozróżnia pokryte scenariusze
od pozostałych kontroli UI. Nie ma osobnego testu e2e wymuszającego tryb offline
po zainstalowaniu cache mapy.

Procedura terenowego odbioru OLED, rolki plików, rozmiaru CSV i pracy SD + BLE +
buzzera znajduje się w [ręcznym odbiorze sprzętowym Szusownika](#reczny-odbior-sprzetowy-szusownika).

## Warstwy

| Warstwa | Gdzie | Runner | Co pokrywa |
|---|---|---|---|
| Unit | `web/src/lib/*.test.ts` | Vitest (node) | csv, geo, runs, globalny rekord PWA, mapData, mapRouting, routeMatching, traceMap, routeTransfer (kod trasy), czyste helpery BLE |
| Integracja | `web/src/lib/*.integration.test.ts` | Vitest + `fake-indexeddb` | `SzusownikBle` z symulatorem urządzenia, zapis do IndexedDB, materializacja zjazdów, globalny rekord i jego sync, etykiety/tombstone'y, wysyłka trasy |
| Kontrakt | `web/src/lib/protocol.test.ts`, `hudProtocol.test.ts`, `routeProtocol.test.ts` | Vitest | zgodność wygenerowanych plików z `protocol/ble-file-v1.json`, `hud-espnow-v1.json`, `route-v1.json` |
| E2E UI | `web/e2e/*.spec.ts` | Playwright (Chromium) | boot z demo, sync z symulatorem (także połączenie bez nowych plików), widoki, rename/delete, render mapy na lokalnym snapshocie i mini-mapa na danych testowych (bez zapytań do Overpass w runtime) |
| Host firmware | `firmware/test/host/test_*.cpp`, `firmware/test/host/hudrekaw/test_*.cpp` | Catch2 + g++ | czysta logika `Szusownik/src/core/` + `HudRekaw/src/core/`, próg/histereza rekordu i jego stan SD, melodyjka, CRC32 z goldenem z urządzenia + golden bloba trasy |

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
pliku, format linii CSV, wzorce zwykłego buzzera i rekordu, progi termiczne, kodowanie pakietów
ESP-NOW HUD, detekcja zjazdu `RunTracker` (fuzja baro+GPS + ZigZag) i
formatowanie HUD (`hud_format`), globalny rekord z histerezą/cooldownem i format
stanu SD oraz logika trasy (dekod bloba, indeks odcinka,
dotarcie, linia kroków); a po stronie odbiorcy dekodowanie pakietów, dekod trasy,
matematyka mapy (projekcja/fisheye, kolory, labele) i format TOT. `src/` deleguje do `core/`, a
testy hostowe linkują tylko `core/` + `src/ble/crc32.h`. `run.ps1` buduje dwa
binaria (`host_tests_szusownik`, `host_tests_hudrekaw`). Test CRC32 porównuje
realne nagranie `test data/20260926_181420.csv` z goldenem z urządzenia
(`crc=CF1B7DB8`, `raw=216651`).

Kompilacja firmware nadal przez `arduino-cli` (sketch `firmware/Szusownik`);
`firmware/test/host/` nie jest częścią sketcha, więc nie trafia do builda.

## Ręczny odbiór sprzętowy Szusownika

Testy hostowe sprawdzają czyste algorytmy, ale nie render OLED, rzeczywisty
pomiar GNSS, kartę SD ani radio/LEDC. Poniższa procedura służy do odbioru
bieżącego firmware na urządzeniu. Nie zmienia progów rolki ani ustawień buzzera.

### Przygotowanie

1. Użyj urządzenia z aktualnym firmware, sprawnej karty SD i telefonu z PWA.
   Test terenowy wykonuj w bezpiecznym, kontrolowanym miejscu; telefonu nie
   obsługuj podczas zjazdu.
2. Uruchom `monitor_COM7.cmd` i zachowaj `monitor_COM7.log` z całej próby.
   Oczekiwane są poprawny start SD/OLED, GNSS z otwartym widokiem nieba oraz
   ważny UTC (bez czasu nie powstanie plik).
3. Z PWA odczytaj bieżący próg pikania. W teście buzzera wymagaj prędkości
   powyżej tej nastawy (domyślnie 60 km/h); nie zmieniaj jej na potrzeby testu.
   Przygotuj też co najmniej jeden wcześniejszy, zamknięty plik widoczny do
   pobrania w PWA.

### Kryteria zaliczenia

- **OLED:** oba layouty (bez trasy i z trasą) są kompletne, bez obciętych,
  zlewających się lub zasłoniętych pól; liczby i etykiety są czytelne na postoju
  lub wyciągu w typowym świetle. Sprawdź czas `--:--`, `NO FIX`, prędkość,
  maksimum, dystans, wysokość i — z trasą — dolną linię kolejnych odcinków.
  Ekran nie jest kryterium odczytu podczas szybkiego ruchu.
- **Rolka:** ruch `>5 km/h` z poprawnym fixem uzbraja zapis po 3 s (widoczny
  skutek: plik dostaje `.meta`); postój `<0,3 km/h` z fixem przez 3 s domyka
  plik dokładnie raz. Dalszy postój nie tworzy kolejnych rolek; następny ruch
  `>5 km/h` przez 3 s pozwala na kolejną. Strefa 0,3–5 km/h i utrata fixa nie
  powinny kończyć ani uzbrajać warunku.
- **Rozmiar:** zapisz rozmiar CSV w bajtach, liczbę wierszy danych i czas jazdy
  dla każdego pliku z jednego zjazdu. Szacunek **0,06–0,11 MB** jest punktem
  odniesienia, nie limitem zaliczenia — zależy od długości i częstotliwości
  próbkowania. Niezgodność wyjaśnij porównaniem bajtów na próbkę i tempa GNSS.
- **BLE + SD + buzzer:** podczas aktywnego pobierania zamkniętych plików PWA
  urządzenie nadal zapisuje bieżące próbki na SD. W trakcie tego transferu,
  gdy prędkość przekracza próg buzzera, sygnał jest słyszalny, a zapis nie
  zatrzymuje się. PWA kończy pobieranie z prawidłowym rozmiarem i CRC; `err`
  zapisu SD pozostaje 0; log nie zawiera błędów odczytu SD, przerwanego
  transferu ani niewyjaśnionego `SYS loop stall` (przerwa pętli ≥200 ms).

### Przebieg

1. **Ekran.** Na postoju sprawdź najpierw pełny ekran statystyk, a następnie
   wgraj z PWA trasę i sprawdź widok trasy. Powtórz kontrolę z fixa i bez fixa;
   brak czasu GNSS powinien pokazać `--:--`. Zwróć szczególną uwagę na parę
   `MAX` i `SPD`: w kodzie para `60 / 80` zajmuje do 84 px fontem 2 od `x=1`,
   podczas gdy `SPD` zaczyna się przy `x=76`. Zapisz, czy na fizycznym ekranie
   cyfry lub etykiety nachodzą na siebie. W pełnym ekranie sprawdź też dystans
   co najmniej 100,0 km, jeśli taki wynik jest dostępny: pięcioznakowa wartość
   fontem 2 sięga do `x=61`, a `km` zaczyna się przy `x=49, y=56`, więc może
   nachodzić na ostatnią cyfrę. To jawny punkt odbioru — procedura nie zakłada
   naprawy layoutu; wartości, których nie udało się uzyskać, zapisz jako
   niezweryfikowane wizualnie.
2. **Rolka.** Po uzyskaniu fixa i UTC postój przez co najmniej 3 s nie powinien
   sam zamknąć pliku (stan startowy jest rozbrojony). Następnie wykonaj ruch
   powyżej 5 km/h przez co najmniej 3 s i zatrzymaj się stabilnie na ponad 3 s.
   W logu powinny wystąpić `SD meta` po potwierdzonym ruchu i dokładnie jeden
   `SD rolka (postoj) zamyka ...`; po postoju może zostać otwarty nowy plik.
   Pozostań na postoju jeszcze 10 s i sprawdź, że nie pojawia się kolejna rolka.
   Powtórz ruch i postój, aby sprawdzić ponowne uzbrojenie. Zanotuj prędkości
   GNSS z linii `GNSS smpl`; naturalny test terenowy potwierdza zachowanie przy
   realnych danych, ale nie kalibruje granicy co do 0,1 km/h.
3. **Rozmiar.** Po zjeździe zsynchronizuj plik z PWA. Zapisz nazwę, `raw`/rozmiar
   CSV, liczbę próbek/wierszy i czas; plik powinien być kompletnym CSV, a PWA
   powinno go przyjąć bez błędu walidacji.
4. **Współbieżność.** Przygotuj tyle niepobranych, wcześniejszych plików, aby
   transfer trwał co najmniej 5 s. Na bezpiecznym postoju rozpocznij pobieranie
   w PWA, zabezpiecz telefon i wykonaj kontrolowany zjazd bez obsługi telefonu.
   W czasie, gdy monitor pokazuje transfer BLE, próbki GNSS powinny nadal
   zwiększać `wr`/`smp`; po przekroczeniu odczytanego progu buzzera powinny być
   słyszalne sygnały. Po zakończeniu sprawdź w PWA sukces pobrania i w logu
   `BLE done ... raw=... crc=...`, brak `SD write error` oraz brak błędów/zwłok
   pętli z kryteriów powyżej. Jeśli transfer skończy się przed aktywnym
   buzzerem albo nie ma co najmniej 5 s wspólnego okna, test współbieżności jest
   **nierozstrzygnięty** — przygotuj większą kolejkę plików i powtórz; nie
   zaliczaj go na podstawie samego sukcesu BLE.

### Co zapisać z próby

Data i wersja firmware, warunki GNSS, layout/stan fixa, obserwowane nakładanie
pól, nazwy plików i liczba rolek, bajty/wiersze/czas każdego CSV, prędkości
GNSS przy uzbrojeniu i rolce, oraz fragment logu obejmujący jednoczesny zapis,
transfer i buzzer. Wyników niepotwierdzonych na urządzeniu nie oznaczaj jako
zaliczonych.

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
