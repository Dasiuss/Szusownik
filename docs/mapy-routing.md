# Szusownik - mapy, wizualizacja i routing

> Źródło wiedzy: `MapyTest/AGENTS.md` oraz implementacja `MapyTest/src/App.jsx`.
> Status: wizualizacja i routing są referencyjnymi algorytmami; GPS,
> map-matching i zaliczanie tras nie zostały jeszcze zaimplementowane.

## 1. Stack referencyjny

- React 19 i React DOM.
- MapLibre GL 6.5.
- Vite.
- `@turf/distance` i `@turf/helpers`.
- Oxlint.
- Jedna aplikacja w `src/App.jsx`, z funkcjami pomocniczymi na poziomie modułu.

Docelowy Szusownik może użyć React + TypeScript, ale nie powinien zmieniać
algorytmów tylko dlatego, że zmieni się język lub podział komponentów.

## 2. Źródła mapy i terenu

| Źródło | URL | Typ | Zastosowanie |
| --- | --- | --- | --- |
| OpenTopoMap | `https://a.tile.opentopomap.org/{z}/{x}/{y}.png` | raster | podkład |
| AWS Terrain Tiles | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png` | raster-dem | teren 3D i wysokość |
| Overpass | `https://overpass-api.de/api/interpreter` | JSON | trasy, wyciągi, relacje ośrodków |
| MapLibre demo fonts | `https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf` | glyphs | etykiety |

Zakres testowy Sölden:

```js
[10.75, 46.85, 11.05, 47.1] // west, south, east, north
```

Bounds są ustawione na źródłach raster i DEM. MapLibre nie pobiera kafelków poza
obszarem, ale mapa nie ma `maxBounds` ani `minZoom`: użytkownik może przesuwać
widok dalej, tylko zobaczy tło/fog.

Konfiguracja referencyjna:

- środek `[10.977123714520985, 46.95802633395613]`;
- zoom desktop `13`, telefon `12` przy breakpoint `768px`;
- pitch `40`, bearing `-90`, max pitch `85`, max zoom `19`;
- terrain exaggeration `0.6`;
- sky/fog: `#a5d6f5`, `#f0f6fa`, `#e8eef2`;
- worker MapLibre ładowany z bundla Vite przez `setWorkerUrl`.

## 3. Zapytanie Overpass i normalizacja

Zapytanie pobiera w jednym wywołaniu:

```text
[out:json][timeout:30];
(
  way["piste:type"](46.85,10.75,47.10,11.05);
  relation["piste:type"](46.85,10.75,47.10,11.05);
  way["aerialway"](46.85,10.75,47.10,11.05);
  relation["site"="piste"](46.85,10.75,47.10,11.05);
);
out body geom;
```

`overpassToLayers` zwraca dwa `FeatureCollection`: `pistes` i `lifts`.

Każdy element dostaje:

```js
uid: `${el.type}/${el.id}`
```

`uid` jest używany jako `promoteId` i identyfikator `feature-state`.

Przynależność do ośrodka jest rozwiązywana przez:

- bezpośrednie członkostwo elementu w `relation site=piste`;
- jeden poziom pośredni: `way -> route=piste -> site=piste`.

To wystarcza dla obecnych danych, ale nie jest pełną obsługą OSM. Brakuje
pełnego multipolygon, `MultiLineString`, `MultiPolygon` i wielopoziomowych relacji.

Geometria:

- wyciągi zawsze są `LineString`;
- zamknięta geometria trasy z co najmniej czterema punktami jest `Polygon`;
- pozostała geometria trasy jest `LineString`.

## 4. Filtrowanie tras

Pozostają tylko elementy:

- z geometrią i co najmniej dwoma punktami;
- z `piste:type` zawierającym `downhill`;
- z `grooming` różnym od `no`;
- z `piste:difficulty` różnym od `freeride`.

Odrzucane są więc trasy biegowe, skitour, sled, freeride i jawnie
nieprzygotowane odcinki.

Właściwości trasy:

```text
uid, osmId, osmType, name, ref, label, difficulty,
pisteType, grooming, warning, site
```

`label` preferuje `ref`, potem `name`, potem `piste:name`. `warning` jest
prawdziwe dla `grooming=backcountry` i `grooming=mogul`.

Kolory trudności:

| Tag OSM | Kolor | Znaczenie PL |
| --- | --- | --- |
| `novice` | `#22c55e` | zielona |
| `easy` | `#60a5fa` | niebieska |
| `intermediate` | `#ef4444` | czerwona |
| `advanced` | `#111827` | czarna |
| `expert` | `#f97316` | czarna ekspert |
| brak/nieznane | `#888888` | nieznana |

`backcountry` i `mogul` są oznaczane paskami, a nie usuwane. Dla czarnych tras
paski są jasnoszare `#e5e7eb`, dla pozostałych ciemnoszare `#374151`, z dash
`[2, 10]`. Pasek jest nakładany na oryginalny kolor trasy.

## 5. Warstwy MapLibre

Podstawowy zestaw obejmuje:

1. `topo` - podkład.
2. `pistes-area-fill` - wypełnienie polygonów, opacity `0.26`, `0.5` po zaznaczeniu.
3. `pistes-area-outline` - obrys polygonów.
4. `pistes-casing` - biała obwódka linii.
5. `pistes-line` - linia w kolorze trudności.
6. `pistes-warning-stripe` - paski ostrzegawcze.
7. `pistes-labels` - numer/nazwa wzdłuż trasy.
8. `pistes-hit-line` - niewidoczna linia klikana, szerokość 18 px.
9. `lifts-line` - czerwona przerywana linia wyciągu.
10. `lifts-labels` - nazwa wyciągu pośrodku.
11. `lifts-hit` - niewidoczna linia klikana, szerokość 18 px.

Warstwy są dodawane po pobraniu danych. Kolejność dodawania jest kolejnością
rysowania. `feature-state` reaguje na `selected`: wybrany element dostaje
żółty obrys i większą szerokość/opacity. Grupa może obejmować wiele odcinków
tej samej trasy.

Etykiety:

- trasy: `symbol-placement: line`, `symbol-spacing: 150`, Noto Sans Bold 11,
  białe halo, brak overlap;
- wyciągi: `symbol-placement: line-center`, ciemnoczerwony tekst, białe halo.

Niewidoczne hit-area są ważne na telefonie. Nie zmniejszać ich tylko po to, aby
warstwy wyglądały bardziej minimalistycznie.

## 6. Routing lokalny

Routing nie używa zewnętrznego silnika. Działa w przeglądarce na geometrii OSM
i wysokości z DEM.

### Snapowanie

Kliknięcie jest przyciągane do liniowej trasy w promieniu:

```text
ROUTE_SNAP_RADIUS_M = 100
```

Wielokąty są pomijane w routingu. Kliknięcie wyciągu jest używane jako kotwica:
najbliższy punkt wyciągu prowadzi do znalezienia najbliższej trasy, ale wyciąg
nie jest bezpośrednio punktem startowym lub końcowym.

### Normalizacja geometrii

`normalizeRouteFeatures` rozbija trasy na segmenty i zapisuje:

- współrzędne segmentów;
- długość segmentu;
- pozycję wzdłuż geometrii (`location`);
- sumaryczną długość;
- bbox.

Odległość używa Turf, a lokalne odległości do projekcji segmentów używają
przybliżenia:

```text
METERS_PER_DEGREE = 111320
longitude scale = cos(latitude)
```

Jest to wystarczające dla małego obszaru ośrodka i tańsze niż pełna projekcja
przy każdym porównaniu.

### Graf

`buildRouteGraph` tworzy węzły na:

- punktach startu i celu;
- końcach tras;
- najbliższych punktach bliskich tras;
- połączeniach tras z wyciągami.

Połączenie tras jest rozważane przy odległości do `100 m`. Bbox ogranicza
liczbę porównań, a `closestSegmentPoints` szuka najbliższych punktów segmentów.
Połączenia między trasami są dodawane w obu kierunkach, po czym filtruje je
kontrola wysokości.

Połączenia z wyciągami bazują głównie na endpointach wyciągu. Krawędzie wyciągu
mają kierunek normalny w górę oraz awaryjny w dół. Kierunek w dół dostaje karę
`downhillLiftCount = 1`.

### Wysokość i kierunek

Wysokość jest pobierana przez:

```js
map.queryTerrainElevation(coordinates, { exaggerated: false })
```

Trasy domyślnie prowadzą od wyższych punktów do niższych, wyciągi od niższych
do wyższych. Tolerancja połączenia:

```text
ROUTE_ELEVATION_TOLERANCE_M = 15
```

Połączenie jest odrzucane, gdy cel jest ponad 15 m wyżej od źródła. Jeśli DEM
zwróci `null`, ograniczenie wysokości jest pomijane. To jest ważny fallback,
ale może dopuścić błędny kierunek.

### Koszt leksykograficzny

Algorytm Dijkstry porównuje koszt jako wektor:

```text
[
  liczba zjazdów wyciągiem w dół,
  liczba przejazdów wyciągami,
  długość backcountry/mogul,
  długość advanced/expert,
  długość połączeń,
  długość całkowita
]
```

Kolejność jest ważniejsza niż wagi:

1. nie jechać wyciągiem w dół;
2. użyć jak najmniej wyciągów;
3. unikać nieratrakowanych tras i muld;
4. unikać tras czarnych, jeśli wcześniejsze kryteria są równe;
5. ograniczyć odcinki transferowe;
6. dopiero na końcu skrócić trasę.

To oznacza, że routing może wybrać dłuższą czarną trasę zamiast dodatkowego
wyciągu i jest to zachowanie zamierzone.

Kolejka Dijkstry w `MapyTest` jest zwykłą tablicą sortowaną przy każdym kroku.
Dla dużego obszaru trzeba rozważyć kopiec binarny lub A*, ale dopiero po
benchmarku, żeby nie zmienić reguł wyboru trasy.

## 7. Wynik routingu i UI

`routePathFeatures` tworzy osobny GeoJSON z faktycznie użytymi odcinkami:

- trasy i połączenia: niebieski `#1557b0`, szerokość 6 px;
- wyciągi: fioletowy `#7c3aed`, szerokość 6 px i kreskowanie;
- biała obwódka;
- osobne etykiety nadpisujące kolizje zwykłych etykiet.

Panel pokazuje kolejność tras i wyciągów, liczbę wyciągów, liczbę zjazdów
wyciągiem w dół i długość całkowitą. Panel jest domyślnie zwinięty.

Menu:

- grupuje po ośrodku oraz `site + label`;
- deduplikuje odcinki tej samej trasy;
- sortuje naturalnie przez `Intl.Collator('pl', { numeric: true })`;
- ma wyszukiwanie po nazwie/numerze;
- pojedynczy klik zaznacza i miga grupą pięć razy co 180 ms;
- double-click wykonuje `fitBounds`, padding 80, maxZoom 13, zachowując pitch i bearing.

## 8. Cache i offline

Cache Overpass:

```text
key: maptest:ski-data:v2
TTL: 24 h
storage: localStorage
```

Zachowanie:

- świeży cache: bez fetch;
- przeterminowany: fetch i zapis nowej odpowiedzi;
- błąd fetch + stary cache: użyj starego cache;
- błąd fetch bez cache: błąd w konsoli.

Cache przechowuje surową odpowiedź Overpass, nie gotowy GeoJSON. Po uruchomieniu
jest ponownie normalizowana. Zmiana query albo formatu wymaga podbicia wersji
klucza.

Sama mapa nie ma jeszcze service workera. PWA jest instalowalne, ale nie daje
pełnego offline dla map i danych sieciowych. Szusownik powinien rozdzielić:

- offline dane użytkownika i ostatni znany model tras;
- opcjonalny cache kafelków;
- jawny komunikat, kiedy mapa/routing działa na danych nieaktualnych.

## 9. GPS i map-matching - czego jeszcze nie ma

W `MapyTest` nie ma:

- `navigator.geolocation`;
- `watchPosition`;
- zapisu śladu;
- automatycznego dopasowania punktu do trasy;
- zaliczania trasy;
- statystyk pokrycia.

Planowana ścieżka implementacji:

1. zapisać próbki GPS lokalnie;
2. odrzucić oczywiste błędy dokładności i skoki;
3. znaleźć najbliższą trasę w buforze około 20-30 m;
4. dopasować punkt do segmentu i zachować pozycję `location`;
5. uwzględnić kierunek, wysokość i ciągłość kolejnych punktów;
6. policzyć pokrycie geometrii i zaliczenie przejazdu;
7. narysować rzeczywisty ślad innym stylem niż planowana trasa.

Przydatne funkcje Turf wymienione w projekcie:

```text
nearestPointOnLine, lineChunk, buffer,
booleanPointInPolygon
```

Nie wystarczy pojedynczy najbliższy punkt. Przy równoległych trasach lub
skrzyżowaniach potrzebna jest ciągłość czasowa i kierunek, inaczej ślad będzie
przeskakiwał między trasami.

## 10. Wydajność

Dobre decyzje do zachowania:

- worker MapLibre;
- bounds źródeł;
- cache 24 h;
- osobne źródła tras i wyciągów;
- szerokie hit-area zamiast skomplikowanych zapytań;
- bbox przed dokładnym porównaniem segmentów;
- lokalne przybliżenie metryczne dla małego ośrodka.

Kosztowne miejsca:

- kwadratowe porównywanie tras i segmentów;
- wielokrotne `queryTerrainElevation`;
- budowa grafu synchronicznie po kliknięciu celu;
- sortowana tablica zamiast kopca w Dijkstrze;
- serializacja dużej odpowiedzi Overpass do localStorage;
- wszystkie warstwy i logika w jednym komponencie.

Docelowa kolejność optymalizacji:

1. zmierzyć czas budowy grafu i liczbę tras;
2. cache'ować znormalizowane geometrie i wysokości;
3. dodać indeks przestrzenny, jeśli bbox nie wystarcza;
4. przenieść ciężką budowę grafu do workera;
5. dopiero potem zastąpić kolejkę Dijkstry kopcem/A*.

## 11. Testy akceptacyjne routingu

- start i cel na tej samej trasie;
- start i cel na różnych trasach połączonych bezpośrednio;
- połączenie przez wyciąg;
- alternatywa: dłuższa trasa bez dodatkowego wyciągu kontra krótsza z wyciągiem;
- wariant z backcountry/mogul;
- wariant z czarną trasą;
- połączenie do 15 m w górę i ponad 15 m w górę;
- brak danych DEM (`null`);
- klik w polygon, linię i hit-area wyciągu;
- brak ścieżki;
- duplikaty odcinków tej samej nazwy;
- pusta odpowiedź Overpass i użycie starego cache;
- test mobilny z dużymi hit-area i panelem wyników.
