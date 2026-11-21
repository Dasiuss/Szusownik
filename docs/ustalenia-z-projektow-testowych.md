# Szusownik - ustalenia z BleTest, DisplayTest i MapyTest

> Status: dokumentacja bazowa do budowy wersji finalnej.
> Data zebrania: 2026-09-08.
> Źródła: `BleTest/agents.md`, `DisplayTest/agents.md`, `MapyTest/AGENTS.md`
> oraz implementacje tych projektów.

Ten dokument zbiera decyzje, które nie powinny być wymyślane ponownie przy
budowie Szusownika. Szczegóły poszczególnych obszarów znajdują się w:

- `docs/ble-transfer.md`
- `docs/hud-display.md`
- `docs/mapy-routing.md`

## 1. Jak czytać ustalenia

W dokumentacji stosowane są cztery poziomy pewności:

| Oznaczenie | Znaczenie |
| --- | --- |
| Potwierdzone | Działało w opisanym teście sprzętowym lub jest bezpośrednim wynikiem implementacji. |
| Referencyjne | Jest sprawdzoną decyzją implementacyjną, ale wymaga ponownej walidacji w finalnej konfiguracji. |
| Do przeniesienia | Warto zachować jako zasadę lub algorytm, po dostosowaniu do danych Szusownika. |
| Ryzyko / luka | Znany problem, niepełny test albo zachowanie, którego nie wolno uznać za gotowe produkcyjnie. |

Najważniejsza zasada: wynik testu z danymi w `PROGMEM`, testowym powtórzeniem
trasy lub statycznym obszarem Sölden nie jest jeszcze testem finalnego
urządzenia z kartą SD i rzeczywistym GPS.

## 2. Docelowy podział odpowiedzialności

```text
[GNSS u-blox]
       |
       v
[ESP32-S3]
  |       |        |
  v       v        v
microSD  OLED     BLE
surowe   lokalny   pliki + stan HUD
CSV      HUD             |
                          v
                     [PWA Chrome]
                   BLE -> IndexedDB
                          |
             parser / cięcie zjazdów / statystyki
                          |
                  MapLibre + routing + ślad GPS
                           |
               krok 2: Supabase / Strava
```

### Firmware ESP32

- odczytuje GNSS i zapisuje surowe próbki na microSD;
- generuje lokalny feedback audio i podstawowy HUD;
- utrzymuje urządzenie BLE i przesyła kompletne pliki;
- nie wykonuje ciężkiego wygładzania, map-matchingu ani analizy historii;
- powinien pracować bez blokowania zapisu SD przez transfer BLE.

### PWA

- pobiera tylko brakujące pliki z urządzenia;
- zapisuje surowy plik w IndexedDB przed analizą;
- tnie aktywność na zjazdy;
- liczy statystyki, wykresy, nachylenie i rekordy;
- pobiera dane mapowe, renderuje trasy i wykonuje routing;
- w kroku 2 ma wysyłać FIT do Stravy przez Supabase Edge Function.

### Supabase

- obecnie obsługuje opcjonalny Auth i wyłącznie udostępnianie ostatniej pozycji
  grupy w osobnym schemacie `szusownik`;
- `profiles` i `live_locations` są czytelne dla zalogowanych, a zapis/usuwanie
  ogranicza RLS do własnego `user_id`; przyszłe dane osobiste pozostają
  właścicielskie (`user_id = auth.uid()`);
- PWA nadal przechowuje analizę, pliki, rekordy i trasy lokalnie — ich
  synchronizacja z chmurą jest przyszłym, osobnym zakresem;
- bazę obsługujemy preferencyjnie przez projektowo ograniczony Supabase MCP;
  nie utrzymujemy lokalnego katalogu `supabase/migrations/`;
- klucze serwerowe Stravy wyłącznie po stronie przyszłej Edge Function.

## 3. Decyzje, które należy zachować

### Transfer danych

- Używać strumieniowego zlib/DEFLATE zamiast przesyłać surowy CSV bez kompresji.
- Nie kopiować całego pliku do RAM ESP32.
- Do retransmisji przechowywać ograniczone okno ostatnich ramek, a nie cały plik.
- Stosować skumulowany ACK i NACK wskazujący pierwszą brakującą sekwencję.
- Utrzymywać stały, sprawdzony pacing NOTIFY zamiast prób sterowania wysyłką
  licznikiem wewnętrznych buforów NimBLE.
- Agregować zapis wyniku po stronie PWA. Pojedynczy zapis dla każdego małego
  fragmentu był wyraźnie wolniejszy.
- Walidować wynik end-to-end przez rozmiar, liczbę linii i CRC32.

### Wyświetlacz

- Renderować HUD lokalnie na ESP32, a nie przesyłać gotowego framebufferu przy
  każdej zmianie.
- Szusownik ma **jeden ekran statystyk**: max zjazdu (hero), max od uruchomienia,
  dystans od uruchomienia,
  wysokość (fuzja baro+GPS) i czas lokalny. Aktywna trasa dodaje linię kroków.
  Layout: `docs/hud-display.md`.
- Detekcja zjazdu na urządzeniu to port reguły wysokościowej z PWA (ZigZag);
  SSOT cięcia zjazdów pozostaje w PWA.
- Stosować proste, wysokokontrastowe informacje na małym ekranie; font GFX jest
  ASCII (bez polskich znaków, bez glifu strzałki).

### Mapy i routing

- Budować wektorowy snapshot tras z danych OSM/Overpass; podkład i teren brać
  z kafelków vector/raster-dem.
- Trzymać dane tras i wyciągów w osobnych źródłach MapLibre.
- Używać `feature-state` do zaznaczania grup odcinków, zamiast kopiować dane do
  kolejnych źródeł.
- Budować routing lokalnie, aby nie uzależniać podstawowej nawigacji od API
  zewnętrznego.
- Koszt routingu ma być leksykograficzny: najpierw bezpieczeństwo i unikanie
  jazdy wyciągiem w dół, potem liczba wyciągów, ostrzeżenia, trudność, transfery
  i dopiero długość.
- W czasie budowania cache'ować źródło Overpass i generować lokalny snapshot;
  PWA używa snapshotu i innych precache'owanych zasobów, bez zapytań do
  dostawców map w runtime.
- Zakres pobierania danych mapowych ograniczyć do Sölden, ale nie blokować
  użytkownikowi przesuwania widoku poza ten zakres.
- Dane wektorowe tras i wyciągów trzymać w lokalnym snapshocie precache'owanym
  przez service worker (bez TTL i bez zapytań sieciowych w runtime).
- Panel wyniku routingu ma być mały i pokazywać łączny dystans oraz kolorową
  sekwencję tras i wyciągów, bez dodatkowych statystyk.

## 4. Integracja z istniejącą koncepcją Szusownika

### Dane na urządzeniu

Aktualna koncepcja Szusownika zakłada pola CSV:

```text
timestamp, lat, lon, speed, altitude_gps, heading, altitude_baro
```

(`altitude_baro` od firmware 1.5 — barometr BME280; firmware zapisuje wyłącznie
nagłówek v2, a zmiany schematu wymagają jednoczesnej aktualizacji PWA.)

CSV v2 rozszerza te pola o metryki jakości GNSS z NMEA (ważność/wiek fixa,
satelity i ich wiek, HDOP i jego wiek). Definicje oraz kryteria potwierdzania
rekordu są w `docs/jakosc-danych.md`.

To jest lepszy kontrakt dla wersji finalnej niż testowy NMEA z `BleTest`. NMEA
może pozostać formatem wejściowym na etapie diagnostyki, ale plik przeznaczony
do codziennej synchronizacji powinien mieć stabilny schemat CSV i nagłówek.

Aktualny kontrakt urządzenia:

1. zamykać plik po wykrytym postoju oraz przed synchronizacją BLE, by pliki
   udostępniane do pobrania były kompletne;
2. listować nazwę i rozmiar CSV; PWA porównuje nazwy z IndexedDB;
3. nie kasować plików po udanym transferze — pozostają kopią na karcie;
4. nie tworzyć osobnego pliku na każdy podjazd/zjazd. PWA scala próbki z plików
   i sama tnie wspólną oś czasu na zjazdy;
5. listować tylko pliki CSV z towarzyszącym `.meta` (potwierdzony ruch);
   nieukończone pliki postojowe zostają na karcie, ale są ukryte przed PWA;
6. usuwać najstarsze CSV wraz z `.meta` przez FIFO dopiero wtedy, gdy wolne
   miejsce spadnie poniżej wymaganego minimum.

### Przetwarzanie zjazdów

Po stronie PWA pozostają ustalenia z `docs/wymagania-PWA.md`:

- podejścia (wyciągi) o wysokości co najmniej 5 m wykrywamy histerezą (ZigZag),
  ale cięcie robimy jedno, na dołku (początku podejścia); „Zjazd X" = wyciąg +
  zjazd, odcinki ciągłe (próg testowy dla nagrań z auta); wynik nie zależy od
  częstotliwości próbkowania, a szum nie rozbija zjazdu;
- dystans liczyć z kolejnych współrzędnych, najlepiej haversine lub Turf;
- nachylenie liczyć z różnicy wysokości i dystansu;
- dystans aktywności to suma długości części schodzących zjazdów; `samples`
  segmentu obejmują wyciąg (wykres), ale dystans liczy się od szczytu w dół;
- wykresy prezentować względem dystansu, nie czasu;
- wygładzać wysokość, nachylenie i prędkość dopiero w PWA;
- surowe próbki zachować bez zmian do eksportu i ponownej analizy.

### Pozycja na mapie

`MapyTest` nie ma jeszcze GPS. W Szusowniku:

- `navigator.geolocation.watchPosition` dostarcza bieżącą pozycję telefonu,
  rysowaną jako niebieska kropka;
- bieżąca pozycja telefonu jest domyślnym początkiem routingu, ale użytkownik
  może wskazać inny punkt startowy;
- ostatnie pięć minut próbek z plików jest rysowane jako surowy ślad względem
  czasu telefonu, bez map-matchingu;
- przechowywanie surowych próbek lokalnie w IndexedDB jako pliki CSV;
- dopasowanie śladu do geometrii tras (zaimplementowane jako uproszczone
  przypisanie **zjazd → trasy** przy materializacji; patrz
  `docs/mapy-routing.md` §9). To nie jest pełny map-matching per próbka;
- mini-mapa 2D w szczegółach zjazdu i w „Całym dniu" rysuje trasy OSM, wyciągi
  i ślad zjazdu/dnia kolorowany prędkością (bez wyróżniania dopasowanych tras);
  patrz `docs/mapy-routing.md` §5;
- uproszczone pokrycie tras na podstawie dopasowanych odcinków jest
  **zaimplementowane** (`docs/mapy-routing.md` §9); pełne map-matching per
  próbka i automatyczne zaliczenie całej trasy nadal nie są dostępne.

Nie należy udawać, że obecny routing jest już map-matchingiem. Obecny graf
wyznacza przejście po geometrii OSM, ale nie przypisuje rzeczywistych próbek GPS
do tras.

## 5. Granice protokołów bieżącej implementacji

Aktualna implementacja rozdziela dwa kanały:

### Duże pliki

Pliki CSV są przesyłane sprawdzonym transportem wywodzącym się z `BleTest`:

```text
lista plików -> wybór pliku -> START -> zlib/DEFLATE -> ramki sekwencyjne
-> ACK/NACK -> end marker -> CRC32 -> zapis IndexedDB
```

Transport powinien zachować parametry referencyjne do czasu osobnego benchmarku:

```text
frame size:       244 B
header:             4 B uint32 LE
payload:          240 B
ACK block:         32 ramek
in-flight window: 128 ramek
NOTIFY pacing:      4 ms
ACK timeout:      500 ms
retry limit:        3
input refill:     512 B
```

UUID-y z projektów testowych są identyfikatorami testowymi. Dla Szusownika
zdefiniowano GATT v1 (2026-09-11, `3f9a…`, jeden service + INFO/CTRL/DATA/STATUS)
opisany w `docs/ble-transfer.md` §10 i zaimplementowany po obu stronach.
Transfer plików BLE oraz trasa nawigacyjna mają osobne kanały i kontrakty.
Protokół plików jest opisany w `docs/ble-transfer.md` §10; protokół trasy
wykorzystuje dedykowaną charakterystykę BLE i SSOT `protocol/route-v1.json`.

OLED Szusownika renderuje lokalnie statystyki i — po odebraniu trasy z PWA —
kroki nawigacyjne w dolnej linii (`docs/hud-display.md` §3.2). Opcjonalny
HudRekaw jest osobnym wyświetlaczem: odbiera telemetrię, pozycję i trasę przez
ESP-NOW; szczegóły są w `docs/hud-rekaw.md`.

## 6. Wersjonowanie i cache

Z `BleTest` należy zachować rozdzielenie:

- wersja protokołu wire;
- wersja firmware;
- wersja PWA.

Zmiana wydania PWA nie wymaga podbijania wersji cache: `cacheId` Workbox jest
stały, a o aktualności decydują rewizje pojedynczych plików w precache. Zmiana
formatu danych mapowych wymaga natomiast podmiany pliku (Workbox wykryje zmianę
po rewizji). Dane użytkownika w IndexedDB muszą mieć wersję schematu, aby
migracja nie zależała od ręcznego czyszczenia przeglądarki.

Wersja widoczna PWA to czas builda (data i godzina), a nie numer semantyczny.
`vite.config.ts` liczy jedną chwilę (`new Date().toISOString()`) przy starcie
builda i wstrzykuje ją przez `define` (`__BUILD_TIME__`). Cache Workbox ma
**stały** `cacheId` (`szusownik`), więc wydanie dociąga tylko zmienione zasoby
(dzięki rewizjom precache), a nie całą paczkę mapy. Wartość jest prezentowana na ekranie Urządzenie →
sekcja „Dane aplikacji" (`settings-meta`, etykieta „Wersja PWA") w formacie
`pl-PL` w lokalnej strefie urządzenia. W `npm run dev` znacznik odpowiada
startowi serwera dev.

## 7. Ograniczenia i nadal otwarta walidacja

### BLE

- `notify()` może zgłosić, że NimBLE nie przyjęło ramki; ACK/NACK i replay
  obsługują retransmisję. Przyjęcie przez NimBLE nie jest równoznaczne
  z dostarczeniem do aplikacji — szczegóły i diagnostyka są w
  `docs/ble-transfer.md`.
- Kanał STATUS z kodami błędów istnieje, a PWA wysyła `STOP` po zakończeniu
  lub błędzie transferu.
- Nadal otwarte pozostają pełne testy akceptacyjne utraty ramek/end markera,
  profili MTU 23/247/517 i wielu modeli Androida. Nie należy uznawać ich za
  potwierdzone tylko na podstawie testów symulatora.

### HUD

- Hero „max zjazdu" zależy od wysokości; przy braku barometru fuzja zbiega do
  GPS (wolniejsza reakcja na kształt wysokości) — do obserwacji w terenie.
- Brak testu sprzętowego renderu (font ASCII, skrót i urywanie nazw odcinków
  trasy, kontrast) i odczytu kątem oka na realnym OLED.
- Wysokość z fuzji jest wrażliwa na dryf barometru na długich odcinkach.

### Mapy

- W runtime PWA nie odpytuje Overpassa; lokalny snapshot, podkład i DEM są
  precache'owane. Pierwsze pobranie zasobów wymaga sieci, a osobny e2e trybu
  offline po zainstalowaniu cache nie istnieje (`docs/mapy-routing.md` §8).
- Uproszczona obsługa relacji OSM nie obejmuje pełnych multipolygonów.
- Brak DEM może dopuścić zły kierunek połączenia.
- Graf i routing blokują główny wątek dla dużej liczby tras.
- Graf routingu nie jest map-matchingiem śladu GPS. Dopasowanie zjazdu do tras
  jest osobną, uproszczoną logiką (`routeMatching.ts`, `docs/mapy-routing.md` §9)
  — bez HMM/ciągłości per próbka i bez pokrycia całej trasy.
- Routing, normalizacja map i lokalny snapshot mają testy automatyczne
  (`mapRouting.test.ts`, `mapData.test.ts`, `mapSnapshot.test.ts`). Pokrycie
  konkretnych scenariuszy i brakujące kontrole są opisane w
  `docs/mapy-routing.md` §11.

## 8. Walidacja przed uznaniem funkcji za potwierdzoną

Testy automatyczne i sprzętowe weryfikują różne warstwy. Nadal wymagają
sprawdzenia na właściwych urządzeniach:

1. BLE: duże kompletne pliki z SD, kontrolowana utrata/replay, rozłączenie,
   różne MTU i telefony — `docs/ble-transfer.md` §12;
2. rzeczywisty render OLED i odczyt na urządzeniu, w tym na realnym śladzie —
   `docs/hud-display.md` §7;
3. łącze ESP-NOW, parowanie, trasę i OTA na zestawie ESP32-S3 + ESP8266 —
   ograniczenia sprzętowe opisuje `docs/hud-rekaw.md`;
4. akceptację pozostałych scenariuszy routingu/UI oraz pracy offline wymienionych
   w `docs/mapy-routing.md` §11;
5. nagrania na stoku i pomiary zasobów/latencji przed wnioskami o dokładności
   i wydajności.

## 9. Źródła i mapa plików

### BleTest

- `BleTest/agents.md` - pełny kontekst, historia benchmarków i parametry BLE.
- `BleTest/firmware/BleTestEsp32/BleTestEsp32.ino` - implementacja firmware.
- `BleTest/firmware/BleTestEsp32/miniz.c`, `miniz.h` - kompresor.
- `BleTest/web/app.js` - Web Bluetooth, odbiór, dekompresja i zapis.
- `BleTest/tools/generate_route.js` - generator testowego NMEA.

### DisplayTest

- `DisplayTest/agents.md` - archiwalne ustalenia projektu testowego wyświetlacza.
- `DisplayTest/firmware/hud_display/hud_display.ino` - prototyp firmware wyświetlacza.
- `DisplayTest/pwa/src/main.js` - prototyp PWA projektu testowego.

### MapyTest

- `MapyTest/AGENTS.md` - aktualny opis map, routingu i decyzji.
- `MapyTest/src/App.jsx` - implementacja mapy, grafu i UI.
- `MapyTest/src/App.css`, `MapyTest/src/index.css` - wizualizacja.

### Szusownik

- `docs/koncepcja.md` - zakres produktu.
- `docs/wymagania-ESP.md` - wymagania urządzenia.
- `docs/wymagania-PWA.md` - wymagania PWA.
- `firmware/README.md` - obecny pinout finalnego urządzenia.
