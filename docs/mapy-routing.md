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

Zakres pobierania danych dla Sölden:

```js
[10.75, 46.85, 11.05, 47.1] // west, south, east, north
```

Bounds są ustawione na źródłach raster i DEM i ograniczają pobieranie danych do
obszaru Sölden. Nie są ograniczeniem interfejsu mapy: mapa celowo nie ma
`maxBounds`, więc użytkownik może swobodnie przesuwać widok dalej, tylko zobaczy
tło/fog poza obszarem danych.

Konfiguracja referencyjna:

- początkowy środek kamery `[10.977123714520985, 46.95802633395613]`;
- zoom desktop `13`, telefon `12` przy breakpoint `768px`;
- pitch `40`, bearing `-90`, max pitch `85`, max zoom `19`;
- terrain exaggeration `0.6`;
- `ScaleControl` w lewym dolnym rogu; bez klikalnego zoomu i kompasu;
- stały marker domu `32x42`, kolor `#0b3d66`, pozycja `[11.0095, 46.9726]`;
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
pisteType, grooming, openingHours, warning, site
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
7. `pistes-hit` - niewidoczna linia klikana, szerokość 18 px.
8. `lifts-line` - czerwona przerywana linia wyciągu.
9. `lifts-hit` - niewidoczna linia klikana, szerokość 18 px.
10. `route-casing` / `route-piste` / `route-lift` - wstęga wyznaczonej trasy.
11. `pistes-labels` - numer/nazwa wzdłuż trasy.
12. `lifts-icons-line` - ikony wyciągów kafelkowane wzdłuż linii.
13. `lifts-names` - nazwa wyciągu pośrodku linii.
14. `route-piste-labels` / `route-lift-labels` - etykiety wyznaczonej trasy.

Warstwy są dodawane po pobraniu danych. Kolejność dodawania jest kolejnością
rysowania. Wszystkie etykiety leżą POWYŻEJ wstęgi trasy, żeby ta ich nie
zamalowywała. `feature-state` reaguje na `selected`: wybrany element dostaje
żółty obrys i większą szerokość/opacity. Grupa może obejmować wiele odcinków
tej samej trasy.

Etykiety:

- trasy: `symbol-placement: line`, `symbol-spacing: 150`, Noto Sans Bold 11,
  białe halo, brak overlap;
- wyciągi: ikony i nazwy na osobnych warstwach. Ikony (`lifts-icons-line`,
  `symbol-placement: line`, `symbol-spacing: 75`, `icon-keep-upright: true`)
  renderują się zawsze (`icon-allow-overlap` + `icon-ignore-placement`),
  więc długa nazwa nie jest w stanie ich przykryć. Nazwy (`lifts-names`,
  `symbol-placement: line-center`) chowają się przy kolizji;
- aktywna trasa: obiekty wchodzące w trasę są wykluczane z bazowych warstw
  etykiet po `uid` (`!in`), żeby bazowa i trasowa etykieta się nie dublowały.

Ikony wyciągów:

- źródło: `docs/assets/ikonki.png`, wycięte do przezroczystych PNG
  64x64 w `web/src/assets/lift-icons/` (bundlowane jako data URL, działają offline);
- mapowanie `aerialway` (definicja: `web/src/components/LiftIcon.tsx`):
  `chair_lift`, `gondola`, `cable_car`, `t-bar`, `platter`, `rope_tow`,
  `magic_carpet` mają własne ikony; `j-bar` i `drag_lift` używają talerzyka,
  `mixed_lift` używa gondoli;
- `zip_line` i nieznane typy celowo nie mają ikony (decyzja użytkownika) —
  karta wyciągu pokazuje wtedy sam typ tekstowo z `AERIALWAY_LABELS`.

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

Referencyjny `MapyTest` ma Turf w zależnościach, ale PWA nie dodaje go do
bundle'a. Lokalny routing używa jednego przybliżenia metrycznego zarówno do
odległości, jak i projekcji segmentów:

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
Dla każdej pary tras graf dostaje: najlepszy styk w promieniu (jak dotąd) plus
bliskie kontakty tras — kontakty do `5 m` (`JUNCTION_DISTANCE_M`), grupowane
przechodnio (single linkage, union-find) w klastry min. `10 m` od siebie
wzdłuż obu geometrii (`pistePairContacts`). W klastrze zostaje najbliższy
kontakt, nie pierwszy w kolejności segmentów OSM.
Każdy styk jest dodawany w obu kierunkach, po czym filtruje je kontrola
wysokości. Sam najlepszy styk nie wystarcza: odnogi tej samej trasy (np.
wspólny start + dolne połączenie w kształcie T) stykają się w dwóch miejscach
i drugie połączenie byłoby niewidoczne dla grafu. Branie wszystkich par
segmentów w promieniu (bez progu `5 m`) jest zabronione: w rozwidleniach daje
dziesiątki fałszywych „połączeń” 10–100 m, które rozdmuchują graf (wolny
Dijkstra na sortowanej tablicy) i pozwalają routerowi ciąć przez teren zamiast
jechać trasą.

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
Szusownik używa obecnie tego samego algorytmu i kolejności kosztów, aby wynik
był zgodny z referencyjną mapą. Dla dużego obszaru można rozważyć kopiec
binarny lub A*, ale dopiero po benchmarku, żeby nie zmienić reguł wyboru trasy.

## 7. Wynik routingu i UI

`routePathFeatures` tworzy osobny GeoJSON z faktycznie użytymi odcinkami:

- trasy i połączenia: niebieski `#1557b0`, szerokość 6 px;
- wyciągi: fioletowy `#7c3aed`, szerokość 6 px i kreskowanie;
- biała obwódka;
- osobne etykiety nadpisujące kolizje zwykłych etykiet.

Panel wyniku jest mały i pokazuje przede wszystkim łączny dystans oraz sekwencję
przejazdu, na przykład `[8 km] 12 -> Giggijochbahn -> 15 -> 16`. Sekwencja
używa kolorowych badge'y: numery tras mają kolory odpowiadające trudności, a
wyciągi są wyróżnione fioletem.
Panel nie pokazuje dodatkowych statystyk routingu i jest testowo umieszczony u
góry mapy. Przycisk routingu uruchamia trzyklikowy flow: przycisk, punkt startowy,
punkt docelowy. Po drugim kliknięciu wynik jest liczony automatycznie. Początek
i koniec są markerami MapLibre, nie punktami circle-layer.

Karta zaznaczonej trasy pokazuje `opening_hours`, `grooming`, długość oraz bezwzględną różnicę
między najniższą i najwyższą próbką geometrii z DEM. Ma również przycisk
`Nawiguj`, który używa pozycji GPS jako startu lub markera domu przy braku GPS.
Po zaznaczeniu kliknięciem na mapie prowadzi do dokładnego miejsca kliknięcia;
wybór z listy używa punktu referencyjnego w środku geometrii.

`classic` nie jest wyświetlane. Dla niestandardowego groomingu informacja jest
pokazywana pod trudnością. Długość, różnica wysokości i średnie nachylenie są
pokazywane w jednej linii z ikonami. Nachylenie to `różnica DEM / długość * 100`.

Menu:

- grupuje po ośrodku oraz `site + label`;
- deduplikuje odcinki tej samej trasy;
- sortuje naturalnie przez `Intl.Collator('pl', { numeric: true })`;
- ma wyszukiwanie po nazwie/numerze;
- pokazuje przybliżoną długość elementu;
- ma osobny przycisk `X` do zamknięcia panelu;
- zaczyna się od górnej krawędzi mapy i można je przełączać drugim kliknięciem lupki;
- pojedynczy klik zaznacza i miga grupą pięć razy co 180 ms;
- double-click wykonuje `fitBounds`, padding 80, maxZoom 13, zachowując pitch i bearing.

## 8. Cache i offline

Cache Overpass:

```text
key: maptest:ski-data:v2
TTL: 8 dni
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

Ośmiodniowy TTL dotyczy wektorowych danych tras i wyciągów z Overpass. Kafelkowy
podkład i DEM mają osobną politykę cache, ponieważ nie są tym samym zbiorem danych.
Sama mapa nie ma jeszcze pełnego cache kafelków. PWA jest instalowalne, ale nie
daje pełnego offline dla map i danych sieciowych. Szusownik powinien rozdzielić:

- offline dane użytkownika i ostatni znany model tras;
- opcjonalny cache kafelków;
- jawny komunikat, kiedy mapa/routing działa na danych nieaktualnych.

## 9. GPS, ślad i map-matching

W referencyjnym `MapyTest` nie ma:

- `navigator.geolocation`;
- `watchPosition`;
- zapisu śladu;
- automatycznego dopasowania punktu do trasy;
- zaliczania trasy;
- statystyk pokrycia.

W Szusowniku bieżąca pozycja mapy pochodzi bezpośrednio z telefonu przez
`navigator.geolocation.watchPosition` i jest rysowana jako niebieska kropka.
Domyślnie bieżąca pozycja telefonu jest początkiem nawigacji z karty elementu.
Przy braku GPS nawigacja z karty zaczyna się ze stałego markera domu. Ręczny
routing zaczyna się przyciskiem i wymaga dwóch kliknięć na mapie.
Odmowa uprawnień lub brak sygnału GPS nie blokuje mapy ani ręcznego routingu.

GPS jest używany jako start tylko wtedy, gdy mieści się w `SOLDEN_BOUNDS`
(tych samych, co limity pobierania kafelków i DEM). Pozycja poza obszarem
Sölden jest traktowana jak brak GPS i nawigacja startuje z markera domu.
Dzięki temu testy z domu nie próbują wyznaczać trasy z lokalizacji poza
ośrodkiem.

`SOLDEN_BOUNDS` to prostokąt pokrycia danych, a nie granica ośrodka. Jest
szerszy niż same stoki, więc dopuszcza pozycję w dolinie lub na okolicznym
szczycie. To celowo tania, pierwsza bramka: jeśli GPS przejdzie prostokąt, ale
jest dalej niż `ROUTE_SNAP_RADIUS_M = 100 m` od trasy, `findRoute` zwróci
czytelny błąd zamiast wyznaczać trasę z domu. Twardsza bramka (snap do trasy
albo osobny polygon ośrodka) to ewentualne rozszerzenie, jeśli okaże się, że
prostokąt przepuszcza zbyt wiele punktów.

Nawigacja rozpoczęta z żywego GPS jest odświeżana:

- co `NAVIGATION_REFRESH_MS = 5000` — jest to minimalny odstęp; faktyczne
  odświeżenie następuje przy kolejnym fixie z `watchPosition`. `maximumAge:
  5000` w `watchPosition` steruje wiekiem cache pozycji, nie częstotliwością
  callbacków, dlatego kod nie zakłada sztywnego cyklu 5 s;
- tylko gdy pozycja przesunęła się o co najmniej
  `NAVIGATION_MOVE_THRESHOLD_M = 15` od ostatniego startu trasy (żeby nie
  przeliczać na szumie GPS w miejscu);
- po przekroczeniu `NAVIGATION_ARRIVAL_M = 30 m` od celu trasa jest czyszczona;
  sprawdzenie przybycia działa na każdym fixie, niezależnie od odstępu i progu
  ruchu, więc oscylujący GPS nie trzyma trasy w nieskończoność.

Fixy z dokładnością gorszą niż `NAVIGATION_MAX_ACCURACY_M = 50 m` są pomijane w
tej iteracji (bez przycinania i bez routingu od nowa), żeby słaby sygnał nie
przyciął trasy do złego fragmentu.

Odświeżanie jest zoptymalizowane przez przycinanie zamiast pełnego routingu.
Jeśli nowa pozycja leży na zaplanowanej trasie (offset do polilinii nie większy
niż `max(dokładność GPS, NAVIGATION_ON_ROUTE_M = 25 m)`), `snapToRoute` liczy
postęp wzdłuż trasy, a `trimRoute` odcina przebytą część i zachowuje kolejność
oraz etykiety pozostałych odcinków. Pełny `findRoute` jest uruchamiany dopiero,
gdy pozycja zjedzie z trasy. To ważne, bo `findRoute` przy każdym wywołaniu
synchronicznie normalizuje geometrie i buduje graf Dijkstry na głównym wątku;
odpalenie go co 5 s powodowałoby zacięcia. Nawigacja z markera domu i routing
ręczny nie są odświeżane cyklicznie.

`trimRoute` przelicza cały koszt trasy, nie tylko dystans. Każda krawędź trasy
niesie w `properties` swój wkład (`liftCount`, `downhillLiftCount`,
`ungroomedDistance`, `blackDistance`, `transferDistance`), więc po przycięciu
liczniki i dystanse są sumowane od nowa. Dystanse skaluje się proporcjonalnie do
pozostałej części krawędzi, a przejazd wyciągiem liczy się, dopóki z krawędzi
coś zostało (przycięcie w połowie wyciągu to nadal jeden przejazd).

`calculateRouteFor` używa tokenu generacji. Wyczyszczenie trasy albo nowy cel
podczas routingu unieważnia wynik, więc spóźniony `setRoute` nie może ponownie
pokazać starej trasy.

Mapa pokazuje również zapisany ślad z ostatnich pięciu minut czasu telefonu.
Są to próbki z plików, których timestamp mieści się w przedziale od `now - 5 min`
do `now`. Ślad jest rysowany bez map-matchingu, bez przypisywania go do tras i
nie zastępuje niebieskiej kropki bieżącej pozycji.

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
- cache 8 dni;
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
