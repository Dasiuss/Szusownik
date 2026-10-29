# Szusownik - mapy, wizualizacja i routing

> Źródło wiedzy: `MapyTest/AGENTS.md` oraz implementacja `MapyTest/src/App.jsx`.
> Status: wizualizacja i routing są referencyjnymi algorytmami. W Szusowniku
> działa GPS (kropka + surowy ślad 5 min), **mini-mapa 2D** śladu zjazdu/dnia
> (§5) oraz **uproszczone dopasowanie zjazdu do tras** (§9). Pełny map-matching
> per próbka (HMM/ciągłość) i zaliczanie całej trasy nie są zaimplementowane.

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

Wszystkie zasoby mapy są **lokalne (self-hosted)** i precache'owane przez
service worker. Aplikacja nie odpytuje żadnego zewnętrznego dostawcy map.

| Zasób | Plik w `web/public/` | Typ | Zastosowanie |
| --- | --- | --- | --- |
| Podkład wektorowy | `solden.pmtiles` (OSM/Protomaps) | vector | podkład |
| DEM | `dem/{z}/{x}/{y}.png` (AWS Terrain Tiles, terrarium) | raster-dem | teren 3D, cieniowanie, poziomice |
| Glify | `fonts/{fontstack}/{range}.pbf` (Noto Sans: Regular, Medium, Bold, Italic) | glyphs | etykiety |
| Sprity | `sprites/v4/light` | sprite | ikony POI |
| Trasy i wyciągi | `overpass-solden.json` (snapshot OSM) | JSON | trasy, wyciągi, routing |

Zasoby odtwarza `scripts/build-map-assets.mjs` (DEM, glify, sprity, snapshot).
Kafelki podkładu buduje osobno CLI Protomaps (`pmtiles extract`).

Komplet krojów musi odpowiadać wszystkim `text-font` użytym w `web/src`
(Regular/Medium/Italic ze stylu Protomaps + Bold z własnych etykiet tras
i wyciągów). `basemaps-assets` nie publikuje Bold, więc ten jeden krój
pobiera fonty MapLibre demo (ten sam Noto Sans, OFL).
Pilnuje tego `web/src/lib/mapFonts.test.ts`: brakujący albo podmieniony na HTML
plik glifów wywala test, zamiast sypać w konsoli „Unimplemented type: 4".

Poziomice liczy `maplibre-contour` z 3×3 kafelków DEM, a brak choćby jednego
sąsiada wywala cały kafelek (dziura w środku obszaru). Dlatego DEM ma wokół
bboxa pierścień „pustych" kafelków (biały PNG = brak danych, ~750 B każdy):
sąsiad istnieje, ale nie rysuje poziomic poza obszarem. Bez tego pierścienia
poziomice urywają się w połowie mapy, a z prawdziwym DEM wokół — wychodzą
daleko poza bbox. Komplet sąsiadów pilnuje `web/src/lib/mapDem.test.ts`.

Gotowa geometria poziomic jest dodatkowo przycinana do bboxa
(`web/src/lib/tileClip.ts`): kafelek DEM na niskim zoomie obejmuje teren
znacznie większy niż obszar mapy (z8 to ~1,4° szerokości), więc bez przycięcia
linie leją się daleko poza dane przy oddaleniu widoku.

Ten sam mechanizm przycina **podkład wektorowy**: `pmtiles extract --bbox`
zostawia całe kafelki, więc drogi, woda i pokrycie terenu wystawałyby poza
obszar. Protokół `pmtiles://` (`web/src/lib/pmtilesSource.ts`) przycina każdy
kafelek do bboxa przed oddaniem go do MapLibre. Kafelki w całości wewnątrz
obszaru wracają bez przetwarzania (koszt tylko na krawędziach).

Testy pilnujące mapy (poza `protocol`/routingiem):

| Test | Co chroni |
| --- | --- |
| `mapFonts.test.ts` | komplet glifów dla każdego kroju z `text-font` |
| `mapDem.test.ts` | pierścień sąsiadów DEM (poziomice bez dziur) |
| `tileClip.test.ts` | przycinanie linii, poligonów i punktów do bboxa |
| `mapDataClip.test.ts` | przycinanie tras/wyciągów + odsiew wyciągów „w projekcie" |
| `mapSnapshot.test.ts` | dane OSM: obszar, brak wyciągów w budowie, trasy 36/38/39/40 |
| `e2e/app.spec.ts` | mapa renderuje się na lokalnym snapshocie (bez sieci) |

Zakres danych mapy (bbox):

```js
[10.905, 46.886957, 11.028039, 46.999242] // west, south, east, north
```

Bounds są ustawione na źródłach raster-dem i wektorowym i ograniczają pobieranie
danych do obszaru Sölden. Nie są ograniczeniem interfejsu mapy: mapa celowo nie
ma `maxBounds`, więc użytkownik może swobodnie przesuwać widok dalej, tylko
zobaczy tło/fog poza obszarem danych.

Licencje: dane OSM — ODbL (atrybucja i share-alike dla archiwum kafelków);
glify — SIL OFL; sprity — MIT; DEM — AWS Open Data (Mapzen/Joerd) z wymaganą
atrybucją (m.in. Austria DGM, EU-DEM, SRTM/USGS).

Konfiguracja referencyjna:

- początkowy środek kamery `[10.977123714520985, 46.95802633395613]`;
- zoom desktop `13`, telefon `12` przy breakpoint `768px`;
- pitch `40`, bearing `-90`, max pitch `85`, max zoom `19`;
- terrain exaggeration `0.6`;
- `ScaleControl` w lewym dolnym rogu; bez klikalnego zoomu i kompasu;
- stały marker domu `32x42`, kolor `#0b3d66`, pozycja `[11.0095, 46.9726]`;
- sky/fog: `#a5d6f5`, `#f0f6fa`, `#e8eef2`;
- worker MapLibre ładowany z bundla Vite przez `setWorkerUrl`.

## 3. Dane OSM i normalizacja

Aplikacja **nie odpytuje Overpassa w czasie działania**. Snapshot tras powstaje
przy budowie (`scripts/build-map-assets.mjs --refresh`) i leży w
`web/public/overpass-solden.json`. Zapytanie obejmuje bbox mapy powiększony
o 0,03° (żeby elementy przecinające granicę były kompletne):

```text
[out:json][timeout:90];
(
  way["piste:type"](46.856957,10.875,47.029242,11.058039);
  relation["piste:type"](46.856957,10.875,47.029242,11.058039);
  way["aerialway"](46.856957,10.875,47.029242,11.058039);
  relation["site"="piste"](46.856957,10.875,47.029242,11.058039);
);
out body geom;
```

`normalizeSkiData` zwraca dwa `FeatureCollection`: `pistes` i `lifts`.

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

### Mini-mapa 2D (ślad zjazdu / dnia)

`web/src/components/TraceMap.tsx` (ładowany przez `React.lazy`, współdzieli chunk
MapLibre z `MapView`) pokazuje nad wykresami w `RunView` i `DaySummaryView`
trasy OSM, wyciągi i ślad GPS kolorowany prędkością. Kamera jest płaska i ma
**stałą orientację** jak duża mapa: `pitch 0`, `maxPitch 0`, obrót wyłączony
(`dragRotate` + `touchZoomRotate`/`keyboard` bez rotacji), `bearing -90`, ten
sam wektorowy podkład co duża mapa oraz poziomice 50 m, ale bez terenu 3D
i cieniowania (`dem`/`sky` nie są dodawane). W prawym górnym rogu kafelka jest przycisk powiększenia: przełącza
wysokość mapy z 240 px na 75vh (ten sam przycisk zwija z powrotem).

Warstwy (kolejność rysowania): `pistes-casing` (biała 4, opacity 0.55),
`pistes-line` (kolor trudności 2, opacity 0.55), `lifts-line` (czerwona
przerywana), `trace-casing` (biała 8, opacity 0.65), `trace-line` (kolor z
`properties.color`, 4.5), `pistes-labels` (numer/nazwa). Trasy są celowo
delikatne (cieńsze i bledsze niż w dużej mapie), żeby ślad był pierwszym planem.
Ślad rysowany jest nad trasami, etykiety nad śladem. Dopasowane trasy nie są
wyróżniane („wszystko równo") — kontekst daje ślad na tle numerów.

Ślad to cały zjazd (wyciąg + zjazd). Kolejne odcinki o tym samym przedziale
prędkości (5 km/h) są scalane w jedną polilinię, więc ślad nie rozpada się na
„fasolki" przy oddaleniu. Kolor wg `speedSm` (`web/src/lib/traceMap.ts`):
0 km/h zielony → 30 niebieski → 60 pomarańczowy → 85 czerwony → ≥105 ciemna
czerwień. Gęste ślady są decymowane (limit ~4000 pkt/ślad), a punkt bez
poprawnych współrzędnych przerywa ciąg. Widok dopasowuje się do bounding box
śladu. Brak danych OSM (cache-first, w razie braku `loadSkiData` best-effort)
nie ukrywa mapy — zostaje sam ślad.

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

Wyznaczona trasa jest też kodowana (`web/src/lib/routeTransfer.ts`, SSOT
`protocol/route-v1.json`) i wysyłana do Szusownika dedykowaną charakterystyką BLE
(`docs/ble-transfer.md` §10). Nazwy odcinków przechodzą przy kodowaniu przez
wspólną transliterację do czystego ASCII (`web/src/lib/asciiFold.mjs`), bo oba
firmware mają czcionki wyłącznie ASCII: umlauty składają się do pojedynczej litery
(`ä/ö/ü`→`a/o/u`), `ß`→`ss`, polskie `ł`→`l` i pokrewne. Tego samego helpera używa
generator mapy flash HudRekaw (`docs/hud-rekaw.md` §5). Wysyłka ponawia się po każdej zmianie geometrii —
także po każdym `trimRoute` w nawigacji (~5 s) — więc urządzenie trzyma aktualny,
przycięty odcinek. `clearRoute` wysyła `CLEAR`, a po ponownym połączeniu PWA
porównuje wersję trasy urządzenia z własną i dosyła raz tylko przy różnicy
(restart Szusownika nie wymaga ponownego planowania). Wiersz stanu w panelu trasy
runda się z `web/src/lib/routeSyncNotice.ts` i pokazuje kolejno: „Łączę z
urządzeniem…" (w trakcie próby połączenia przycisk „Połącz" jest schowany),
„Połączono, sprawdzam urządzenie…", „Wysyłam trasę na urządzenie…", a bez
połączenia „Połącz, aby wysłać trasę na urządzenie" z przyciskiem. Nieudane
łączenie pokazuje powód zamiast ciszy, z „Połącz" do ponowienia. Udana wysyłka
nie ma komunikatu: domyślnie zakładamy, że trasa dotarła — dzięki temu automatyczne
dosyłki (np. `trimRoute` w nawigacji) nie migają komunikatem.

Ciche zerwanie łącza (urządzenie wyłączone albo poza zasięgiem, bez „Rozłącz"
z PWA) jest wykrywane po `gattserverdisconnected`: `SzusownikBle` zgłasza je
przez `onDisconnected`, `DeviceProvider` wraca do stanu rozłączonego, a brak
łącza wyprzedza dotknięcie GATT (`DeviceDisconnectedError`) — panel trasy
pokazuje wtedy podpowiedź offline z przyciskiem, a nie surowy błąd Web Bluetooth.
Dalsza droga trasy (Szusownik -> HudRekaw) i rysowanie są w `docs/hud-rekaw.md`.

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

Mapa jest w pełni offline po pierwszym wejściu. Wszystkie zasoby leżą w
`web/public/` i są **precache'owane przez Workbox przy instalacji service
workera** (czyli przy pierwszym otwarciu strony, nie w momencie „Dodaj do
ekranu głównego"):

```text
solden.pmtiles, dem/**, fonts/**, sprites/**, overpass-solden.json
```

Konfiguracja: `vite.config.ts` → `workbox.globPatterns` oraz
`maximumFileSizeToCacheInBytes` (10 MB, bo `.pmtiles` ma ~3 MB).

Cache jest **stabilny** (`cacheId: "szusownik"`), a Workbox używa rewizji
poszczególnych plików. Aktualizacja PWA dociąga więc tylko zmienione zasoby,
a nie całą paczkę mapy. `cleanupOutdatedCaches` usuwa stare cache.

Trasy i wyciągi pochodzą z lokalnego snapshotu (`overpass-solden.json`) —
aplikacja **nie odpytuje Overpassa** i nie ma już cache w `localStorage` ani
TTL. Snapshot jest przefiltrowany do bboxu mapy przy budowie
(`scripts/build-map-assets.mjs`) ze źródła `scripts/data/overpass-pwa.json`
(wycinek OSM dla PWA; `node scripts/build-map-assets.mjs --refresh` pobiera go
z Overpassa). To osobny plik od cache HudRekawa (`overpass-solden.json`), bo
ten miał mniejszy bbox i gubił trasy w południowo-zachodniej części ośrodka.

Przy wczytaniu snapshot jest normalizowany i przycinany do bboxa
(`clipSkiDataToBounds`): trasy przecinające granicę kończą się na niej, a te
całkowicie poza obszarem znikają — spójnie z podkładem i poziomicami.
Wyciągi w statusie `proposed`/`construction`/`abandoned`/`disused`/`razed`
nie są pokazywane (to projekty, nie czynne koleje).

**PMTiles i HTTP Range.** PMTiles normalnie czyta archiwum przez `Range`
(206). Service worker precache'ujący plik zwraca go w całości (200), co psuje
taki odczyt. Dlatego `web/src/lib/pmtilesSource.ts` wczytuje archiwum (~3 MB)
do pamięci i rejestruje je w protokole `pmtiles://` — offline nie zależy od
Range.

Atrybucja na mapie: `Protomaps © OpenStreetMap` oraz teren
(Mapzen/Joerd, EU-DEM, DGM Österreich, SRTM/USGS).

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

### Dopasowanie zjazdu do tras (zaimplementowane)

`web/src/lib/routeMatching.ts` (czysta logika, testy `routeMatching.test.ts`):

- tożsamość trasy: grupa OSM po `site + label` (spójna z `mapItemsFor` w
  mapie); odcinki bez nazwy trzymane osobno per `uid`;
- wejście: liniowe trasy (`SkiData.lines`, tylko `piste`) i ślad zjazdu
  (`EnrichedSample[]`); dopasowywana jest wyłącznie schodząca część od
  najwyższego punktu zjazdu (`altSm`) w dół, więc podejście wyciągiem nie
  przypisuje trasy pod nim;
- każda próbka trafia do najbliższej trasy w promieniu
  `ROUTE_MATCH_RADIUS_M = 50` m; przerwy krótsze niż `ROUTE_MATCH_MERGE_M = 60`
  m po śladzie są scalane z sąsiadami;
- trasę zalicza odcinek co najmniej `MIN_ROUTE_DISTANCE_M = 100` m liczonych
  **wzdłuż geometrii trasy**; pokrycie całej trasy nie jest wymagane;
- wynik to spany `{routeKey, label, difficulty, startT, endT, distanceM,
  durationS, maxSpeed}` oraz sekwencja tras (np. `15 → 8`).

Dopasowanie liczone jest przy materializacji zjazdów (`web/src/lib/data.ts`)
na cache OSM wczytanym na starcie (`mapData.loadCachedSkiData`). Brak cache →
zjazdy powstają bez tras; po pobraniu `ensureRouteMatchingBackfill()` dorabia
dopasowanie raz. Odświeżenie cache OSM nie przelicza już zmaterializowanych
zjazdów. Ręcznej korekty dopasowania nie ma — wynik jest w pełni automatyczny.

Czego nadal nie ma: dopasowania per próbka z ciągłością i kierunkiem (HMM),
pokrycia/zaliczenia całej trasy, oceny warunków i score tras.

### Pokrycie tras na mapie (zaimplementowane)

Przycisk ikonowy na dużym widoku mapy (narty z checkiem) włącza tryb pokrycia:
każda trasa liniowa dostaje pogrubioną obwódkę (casing) — jasnozieloną, gdy
przejechana, jasnoczerwoną, gdy nieodwiedzona (celowo wyraźnie jaśniejszą od
czerwieni tras z tabeli kolorów trudności); kolor trudności trasy zostaje na linii pod
obwódką, zaznaczona trasa pozostaje żółta. Przy włączonym trybie pod przyciskami
widnieje licznik „przejechane X z Y tras". Stan przełącznika nie jest
zapamiętywany (domyślnie wyłączony).

Tożsamość i uniwersum tras liczy `web/src/lib/routeCoverage.ts` (czysta logika,
testy `routeCoverage.test.ts`):

- uniwersum to trasy-pisty z geometrią liniową (dokładnie te, które widzi
  matcher) grupowane po `site + label` (odcinki bez nazwy osobno per `uid`);
  trasy zamknięte (polygon) i wyciągi są pomijane;
- przejechana = zjazd z `routeSpans` do danego klucza, z ostatnich
  `COVERAGE_WINDOW_DAYS = 30` dni (po lokalnym dniu telefonu); wystarcza odcinek
  ≥ 100 m (jak w matcherze), a zjazd demo liczy się jak normalny przejazd;
- licznik `X z Y`: X to część wspólna przejechanych z uniwersum (klucz trasy,
  którego nie ma już w danych OSM, nie zawyża licznika), Y to liczba tras w
  uniwersum.

Stan liczony jest na bieżąco ze zjazdów (`getAllRuns`), bez zmiany schematu Dexie
i bez materializacji. Obwódka korzysta ze `feature-state` (`traveled`) na
istniejącym źródle `pistes` (MapLibre scala stany, więc `selected` zostaje). Bez
danych tras lub przy nieświeżym cache OSM (`mapData.stale`) przycisk jest
zablokowany bez komunikatu.

## 10. Wydajność

Dobre decyzje do zachowania:

- worker MapLibre;
- bounds źródeł;
- lokalne (precache'owane) kafelki, DEM, glify i sprity;
- osobne źródła tras i wyciągów;
- szerokie hit-area zamiast skomplikowanych zapytań;
- bbox przed dokładnym porównaniem segmentów;
- lokalne przybliżenie metryczne dla małego ośrodka.

Kosztowne miejsca:

- kwadratowe porównywanie tras i segmentów;
- wielokrotne `queryTerrainElevation`;
- budowa grafu synchronicznie po kliknięciu celu;
- sortowana tablica zamiast kopca w Dijkstrze;
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
