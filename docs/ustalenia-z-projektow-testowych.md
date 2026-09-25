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
                     [PWA Android]
                   BLE -> IndexedDB
                          |
             parser / cięcie zjazdów / statystyki
                          |
                 MapLibre + routing + ślad GPS
                          |
                    Supabase / Strava
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
- w późniejszym etapie wysyła FIT do Stravy przez Supabase Edge Function.

### Supabase

- przechowuje dane użytkowników i zsynchronizowane zjazdy;
- wymusza izolację użytkowników przez RLS `user_id = auth.uid()`;
- przechowuje sekrety Stravy wyłącznie po stronie Edge Function.

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
- Traktować mapę i trasę jako dwie niezależne warstwy bitmapowe.
- Firmware rysuje mapę, potem trasę, a dopiero na końcu nakłada animowane przerwy.
- PWA musi powtarzać dokładnie tę samą kolejność pikseli, liczbę przerw i wzór
  animacji, jeżeli podgląd ma reprezentować OLED.
- Stosować szerokie obszary hit-testu i proste, wysokokontrastowe informacje na
  małym ekranie.

### Mapy i routing

- Pobierać dane tras wektorowo z Overpass, a podkład i teren z kafelków raster/
  raster-dem.
- Trzymać dane tras i wyciągów w osobnych źródłach MapLibre.
- Używać `feature-state` do zaznaczania grup odcinków, zamiast kopiować dane do
  kolejnych źródeł.
- Budować routing lokalnie, aby nie uzależniać podstawowej nawigacji od API
  zewnętrznego.
- Koszt routingu ma być leksykograficzny: najpierw bezpieczeństwo i unikanie
  jazdy wyciągiem w dół, potem liczba wyciągów, ostrzeżenia, trudność, transfery
  i dopiero długość.
- Cache'ować surową odpowiedź Overpass i ponownie przetwarzać ją lokalnie.
- Zakres pobierania danych mapowych ograniczyć do Sölden, ale nie blokować
  użytkownikowi przesuwania widoku poza ten zakres.
- Dane wektorowe tras i wyciągów przechowywać lokalnie przez 8 dni.
- Panel wyniku routingu ma być mały i pokazywać łączny dystans oraz kolorową
  sekwencję tras i wyciągów, bez dodatkowych statystyk.

## 4. Integracja z istniejącą koncepcją Szusownika

### Dane na urządzeniu

Aktualna koncepcja Szusownika zakłada pola CSV:

```text
timestamp, lat, lon, speed, altitude_gps, heading, altitude_baro
```

(`altitude_baro` od firmware 1.5 — barometr BME280; schemat ewolucyjny, walidowany
po nagłówku, zmiany wymagają jednoczesnej aktualizacji PWA.)

CSV v2 rozszerza te pola o metryki jakości GNSS z NMEA (ważność/wiek fixa,
satelity i ich wiek, HDOP i jego wiek). Definicje oraz kryteria potwierdzania
rekordu są w `docs/jakosc-danych.md`.

To jest lepszy kontrakt dla wersji finalnej niż testowy NMEA z `BleTest`. NMEA
może pozostać formatem wejściowym na etapie diagnostyki, ale plik przeznaczony
do codziennej synchronizacji powinien mieć stabilny schemat CSV i nagłówek.

Urządzenie powinno:

1. zamknąć aktualny plik przed udostępnieniem go do pobrania;
2. zwrócić listę plików: nazwa, rozmiar i czas startu;
3. pozwolić PWA porównać nazwy z IndexedDB;
4. nie kasować plików po udanym transferze;
5. rotować pliki po około pięciu zjazdach oraz na żądanie pobrania;
6. usuwać najstarsze pliki dopiero przy braku miejsca na karcie.

### Przetwarzanie zjazdów

Po stronie PWA pozostają ustalenia z `docs/wymagania-PWA.md`:

- skumulowany wzrost wygładzonej wysokości o co najmniej 5 m rozdziela dwa zjazdy
  (próg testowy dla nagrań z auta), a granica jest początkiem tego wzrostu, nie jego
  końcem; w ten sposób poprzedni zjazd kończy się przed wyciągiem;
- dystans liczyć z kolejnych współrzędnych, najlepiej haversine lub Turf;
- nachylenie liczyć z różnicy wysokości i dystansu;
- dystans aktywności to suma dystansów zjazdów, bez wyciągów;
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
- zapis śladu lokalnie;
- dopasowanie śladu do geometrii tras;
- określenie pokrycia trasy i zaliczenia przejazdu.

Nie należy udawać, że obecny routing jest już map-matchingiem. Obecny graf
wyznacza przejście po geometrii OSM, ale nie przypisuje rzeczywistych próbek GPS
do tras.

## 5. Proponowana granica protokołów finalnych

Najmniej ryzykowne jest rozdzielenie dwóch funkcji:

### Duże pliki

Dla CSV użyć sprawdzonego transportu z `BleTest`:

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

### Małe aktualizacje HUD

Stan ekranu może używać osobnych krótkich pakietów, ale nie wolno przejąć
bezpośrednio niepotwierdzonego protokołu `DisplayTest` jako protokołu
produkcyjnego. W finalnej wersji trzeba dodać co najmniej:

- wersję protokołu;
- typ i długość pakietu;
- sekwencję;
- CRC lub inną walidację;
- atomową podmianę kompletnej bitmapy;
- retry albo jawny status zastosowania danych.

UUID-y z projektów testowych są identyfikatorami testowymi. Dla Szusownika
zdefiniowano GATT v1 (2026-09-11, `3f9a…`, jeden service + INFO/CTRL/DATA/STATUS)
opisany w `docs/ble-transfer.md` §10 i zaimplementowany po obu stronach.
Nie mieszać charakterystyki `DisplayTest` z transportem plików bez formalnego
kontraktu (małe pakiety HUD — roadmapa).

## 6. Wersjonowanie i cache

Z `BleTest` należy zachować rozdzielenie:

- wersja protokołu wire;
- wersja firmware;
- wersja PWA.

Zmiana wydania PWA wymaga podbicia wersji cache service workera i widocznej
wersji. Zmiana formatu danych mapowych lub zapytania Overpass wymaga podbicia
wersji klucza cache. Dane użytkownika w IndexedDB muszą mieć wersję schematu,
aby migracja nie zależała od ręcznego czyszczenia przeglądarki.

## 7. Ryzyka do rozwiązania przed wersją finalną

### BLE

- `notify()` nie zwraca statusu przyjęcia pakietu przez NimBLE.
- Brak osobnego kanału raportowania błędu firmware do PWA.
- Wykryto możliwy problem z ponownym ACK end markera po jego duplikacie.
- W PWA błąd transferu nie zawsze wysyła `STOP` do urządzenia.
- Nie ma pełnej walidacji pól metadanych.
- Nie wykonano pełnego testu MTU 23, 247 i 517 ani wielu modeli Androida.
- Profil `v5` wymaga ponownego testu sprzętowego, mimo że bazuje na teście `v4.5`.

### HUD

- Pakiety stanu i bitmap w `DisplayTest` nie mają niezawodności wymaganej dla
  finalnego urządzenia.
- PWA i firmware mogą mieć różną fazę animacji trasy.
- Podgląd canvas nie jest bitowo identyczny z rasteryzacją Adafruit GFX.
- Brak synchronizacji callbacku BLE z renderowaniem bitmap na ESP32.
- Wartości większe niż 999 mogą wejść w obszar mapy.
- Nazwa pola `average` nie zgadza się z etykietą `MAX` na OLED.

### Mapy

- Overpass i DEM są zależnościami sieciowymi; trzeba mieć zachowanie offline.
- Uproszczona obsługa relacji OSM nie obejmuje pełnych multipolygonów.
- Brak DEM może dopuścić zły kierunek połączenia.
- Graf i routing blokują główny wątek dla dużej liczby tras.
- Obecny graf nie jest map-matchingiem śladu GPS.
- Nie ma jeszcze testów automatycznych algorytmu grafu, kosztu i progów snapowania.

## 8. Minimalna bramka jakości przed użyciem produkcyjnym

Przed uznaniem funkcji za gotową trzeba mieć:

1. test kompletnego pliku z SD, większego niż RAM urządzenia;
2. test poprawnego CRC i liczby linii po dekompresji;
3. kontrolowany test utraty, duplikacji i zmiany kolejności ramek;
4. test timeoutu, `STOP`, rozłączenia i ponownego połączenia;
5. test różnych MTU i co najmniej dwóch telefonów Android;
6. test bitmapy niepełnej, uszkodzonej i podmienianej atomowo;
7. test zgodności podglądu HUD z OLED dla skrajnych wartości;
8. test routingu na trasach z wyciągiem, połączeniem, ostrzeżeniem i brakiem DEM;
9. test GPS na rzeczywistym śladzie w kilku ośrodkach;
10. pomiar pamięci, czasu CPU, czasu transferu i opóźnienia UI.

## 9. Źródła i mapa plików

### BleTest

- `BleTest/agents.md` - pełny kontekst, historia benchmarków i parametry BLE.
- `BleTest/firmware/BleTestEsp32/BleTestEsp32.ino` - implementacja firmware.
- `BleTest/firmware/BleTestEsp32/miniz.c`, `miniz.h` - kompresor.
- `BleTest/web/app.js` - Web Bluetooth, odbiór, dekompresja i zapis.
- `BleTest/tools/generate_route.js` - generator testowego NMEA.

### DisplayTest

- `DisplayTest/agents.md` - layout OLED, animacja i protokół pakietów.
- `DisplayTest/firmware/hud_display/hud_display.ino` - rendering i BLE.
- `DisplayTest/pwa/src/main.js` - podgląd, edytor bitmap i BLE.

### MapyTest

- `MapyTest/AGENTS.md` - aktualny opis map, routingu i decyzji.
- `MapyTest/src/App.jsx` - implementacja mapy, grafu i UI.
- `MapyTest/src/App.css`, `MapyTest/src/index.css` - wizualizacja.

### Szusownik

- `docs/koncepcja.md` - zakres produktu.
- `docs/wymagania-ESP.md` - wymagania urządzenia.
- `docs/wymagania-PWA.md` - wymagania PWA.
- `firmware/README.md` - obecny pinout finalnego urządzenia.
