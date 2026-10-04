# Wymagania PWA — analiza i prezentacja

> Status: **WIP (draft)** — dokument żywy.
> Data: 2026-08-18

## 1. Cel

Prezentacja i analiza przejazdów: **dzień → zjazdy → wykresy**. Aplikacja działa offline
(IndexedDB). Dane z urządzenia przez BLE; do developmentu i testów PWA służy
**wbudowane demo** — generowany plik CSV osadzony na prawdziwych trasach Sölden
(`scripts/gen-demo-ride.mjs`).

## 2. Zasady UI

- Maksymalizacja przestrzeni na ekranie; **bez nazwy aplikacji w nagłówkach**.
- **Język PL**. Jednostki i formaty: prędkość **km/h**, dystans **km**, czas **min:sec**, zegar **24 h**.
- UX mobile-first na Androidzie; główna nawigacja: **Dzisiaj / Historia / Mapa / Urządzenie**.
- Kierunek wizualny: jasny outdoor, wysoki kontrast i szybki odczyt wyników.

## 3. Auth i użytkownicy

- Logowanie przez **Supabase Auth** (email + hasło).
- **2 użytkowników**; każdy widzi **tylko swoje** dane — po stronie bazy wymusza to **RLS**
  (`user_id = auth.uid()`), lokalnie dane w IndexedDB też są oznaczone użytkownikiem.

## 4. Ekran główny (aktywność / dzień)

- Przycisk **„Pobierz dane"** — pobiera nowe pliki z urządzenia przez BLE
  (patrz „Transfer"); w trybie deweloperskim ładuje wbudowane demo
  (generowany fixture CSV, patrz §8).
- Po kliknięciu: PWA pobiera nowe pliki z urządzenia (patrz „Transfer"), przetwarza CSV
  (wycina zjazdy) i pokazuje **bieżącą aktywność (dzień)**.
- Po połączeniu PWA automatycznie sprawdza listę plików. Nowe pliki są zapowiadane kartą
  na górze widoku „Dzisiaj”; użytkownik zatwierdza pobranie wszystkich jednym kliknięciem.
- **Statystyki całej aktywności:** dystans w dół (suma zjazdów), max prędkość.
- **Lista zjazdów** ze statystykami: max prędkość, dystans, max nachylenie; najnowszy zjazd jest pierwszy.
  Numeracja jest **chronologiczna** (`runNumbers`): „Zjazd 1" to pierwszy zjazd dnia, niezależnie
  od kolejności na liście. Ten sam numer pokazuje podsumowanie dnia i ekran szczegółów.
- Kafelek **„Cały dzień”** otwiera połączone statystyki, wykresy i mini-mapę
  wszystkich śladów dnia.
- Klik w zjazd → ekran szczegółów.
- Historia grupuje zjazdy według lokalnej strefy czasowej telefonu. Zjazd może mieć krótką,
  edytowalną nazwę; użytkownik może usunąć pojedynczy zjazd.

## 5. Ekran szczegółów zjazdu

- Nazwę zjazdu edytuje się **wprost w tytule**: klik w nagłówek (zawsze widoczny mały
  ołówek tuż za tekstem) zamienia go w kompaktowe pole z jawnym zapisem (check/Enter)
  i anulowaniem (x/Esc). Bez osobnego przycisku „Zmień nazwę". Pusta nazwa czyści
  etykietę i wraca do „Zjazd N".
- Wykresy w funkcji **dystansu** (nie czasu): **prędkość** i **zmierzona wysokość**.
- Wykres wysokości pokazuje wygładzoną wysokość w metrach, dzięki czemu spadki wysokości
  wizualnie odpowiadają zjazdom stoku. Wysokość to **fuzja barometru i GPS** (patrz §6),
  używana też do nachylenia i cięcia zjazdów.
- Wykresy **osobne, jeden pod drugim** (wspólna oś dystansu), aby dało się je ogarniać
  jednocześnie.
- **Mini-mapa 2D** nad wykresami: trasy OSM z numerami, wyciągi oraz ślad GPS
  zjazdu kolorowany prędkością (zielony → niebieski → pomarańczowy → czerwony →
  ciemna czerwień). Kamera płaska o stałej orientacji (bez obrotu) i przycisk
  powiększenia kafelka (240 px ↔ 75vh). W „Całym dniu” pokazuje wszystkie ślady
  zjazdów dnia. Szczegóły: `docs/mapy-routing.md` §5.
- Na osi X stosować czytelne, zaokrąglone przedziały dystansu: co 250 m dla tras poniżej
  2 km, co 500 m poniżej 6 km i co 1 km dla dłuższych tras; oś kończyć na rzeczywistym
  maksimum danych, żeby nie zostawiać pustej końcówki (ticki wypadają w pełnych
  przedziałach wewnątrz zakresu).
- Na widoku „Cały dzień” oznaczać granice zjazdów pionowymi liniami na wykresach oraz
  pokazywać pod nimi klikalny pasek segmentów o szerokości proporcjonalnej do dystansu;
  kliknięcie segmentu otwiera szczegóły zjazdu.
- Oś prędkości **0-based**: domyślnie 0–100 km/h; przy przekroczeniu 100 — skala 0–150 km/h,
  a zakres **100–150 na lekko czerwonym tle** (wyróżnienie).
- Wykresy można **przybliżać i przesuwać po osi dystansu**: na desktopie Ctrl+kółko
  (oraz pinch na trackpadzie, który przychodzi jako Ctrl+wheel) i przeciąganie, na
  dotyku pinch i przeciąganie poziome jednym palcem (ruch pionowy przewija stronę).
  Podwójny klik/tap resetuje do pełnego zakresu. Oba wykresy dzielą jeden zakres X,
  a przybliżenie ograniczone jest do zakresu danych i nie jest zapamiętywane — wejście
  w widok zawsze pokazuje pełny zjazd/dzień.
- Skala ticków dystansu dostosowuje się do szerokości widocznego okna: oprócz progów
  0,25/0,5/1 km dochodzą **0,1 km i 0,05 km** przy mocnym przybliżeniu; przy skrajnym
  przybliżeniu krok zagęszcza się automatycznie, żeby ticki nie znikały. Zakres osi przy
  przybliżeniu nie jest rozciągany poza widoczne okno.
- **Trasy zjazdu (auto):** tytuł to własna nazwa, a gdy jej brak — sekwencja
  dopasowanych tras (np. `15 → 8`, kolory trudności). Gdy jest nazwa, sekwencja
  pokazywana jest pod nią mniejszą czcionką.
- **„Poprzednie przejazdy"** na samym dole szczegółów: grupa całej sekwencji
  tras + osobne grupy per trasa. Każda grupa pokazuje liczbę przejazdów,
  najlepszy czas odcinka i max prędkość, a pod nimi listę wierszy (data/godzina,
  max prędkość, czas i dystans odcinka) od najnowszego, klikalną. Pełna lista
  rozwija się inline („Pokaż wszystkie"), bez osobnego widoku.

## 6. Przetwarzanie danych (wycinanie zjazdów)

- **Jedna wspólna oś czasu:** cięcie liczy się z **wszystkich** surowych plików w
  IndexedDB, scalonych i posortowanych po `Date.parse(t)`. Przy równych
  timestampach porządek jest deterministyczny (nazwa pliku, potem pozycja w pliku).
  Deduplikowane są wyłącznie realne powtórki na styku plików (rotacja może
  powtórzyć skrajną próbkę) — próbki o tym samym `t`, ale innych danych, zostają.
- **Cięcie per lokalny dzień:** próbki są grupowane po lokalnej dacie telefonu
  (`localDayKey`), a `enrich` + `splitRuns` liczone są raz na dzień. Zjazd nie
  przechodzi przez północ — dzień jest jednostką UI. Dzięki temu zjazd rozbity
  rotacją pliku (przerwa rzędu sekund) składa się z powrotem w **jeden** zjazd,
  a małe pliki „postojowe" nie tworzą osobnych zjazdów. `cumDistM`/`distM` są
  liczone po scaleniu, nigdy przez sklejanie już wzbogaconych próbek z plików.
- **Reguła cięcia (ZigZag z histerezą):** podejścia (wyciągi) o wysokości **>= 5 m**
  wykrywamy jako zwroty histerezą, ale cięcie robimy **jedno, na dołku** (początku
  podejścia). Dzięki temu „Zjazd X" = **wyciąg + zjazd**, a odcinki są ciągłe i
  pokrywają cały ślad (brak luk na wykresie). Próg działa jak histereza, więc
  pojedyncze zaszumione próbki (nawet 10 Hz) nie rozbijają zjazdu, a wynik nie
  zależy od częstotliwości próbkowania. Przerwa w danych >= 1 h zamyka odcinek
  (zjazd nie przechodzi przez lukę). Gdy ślad nie ma żadnego podejścia >= 5 m,
  zwracamy jeden zjazd na całości.
- **Stabilny identyfikator zjazdu:** `${dayKey}::${startT}`. Etykiety użytkownika i
  usunięcia (tombstone) kluczują się tym id i przeżywają dodanie kolejnego pliku
  oraz ponowną analizę. Usunięcie zjazdu nie usuwa surowego pliku.
- Dla każdego zjazdu: dystans (haversine z lat/lon), max prędkość, max nachylenie.
- **Nachylenie w stopniach**, liczone z **Δwysokości / Δdystansu**.
- „Dystans w dół" = suma długości części **schodzących** (od najwyższego punktu
  segmentu do jego końca). Wyciąg zostaje na wykresie jako część „Zjazdu X", ale
  nie wchodzi do dystansu.
- Oś dystansu na wykresie **„Cały dzień"** liczona jest po `cumDistM` próbek
  (z wyciągami), więc jest ciągła i nie cofa się na granicach zjazdów. Nie używać
  do tego `distanceM` (bo nie zawiera wyciągów).
- **Cięcie dla Strava** (klik „wyślij"): aktywność = dane od poprzedniego cięcia do bieżącego
  kliknięcia, maksymalnie **bieżący dzień**.

### Dopasowanie zjazdu do tras (auto)

- Zjazd dostaje automatycznie sekwencję tras OSM (grupa po `site + label`;
  odcinki bez nazwy osobno per `uid`) oraz spany odcinków. Progi i algorytm:
  `docs/mapy-routing.md` §9.
- Liczone raz przy materializacji z cache OSM ładowanego na starcie. Brak cache
  → zjazd bez tras, z jednorazowym dorobieniem po ich pobraniu; odświeżenie
  cache OSM nie przelicza zjazdów. **Bez ręcznej korekty** dopasowania.
- Sekwencja i spany są trwałe (przeżywają re-analizę jak etykiety). Auto-nazwa
  (`routeName`) nie nadpisuje ręcznej etykiety użytkownika; gdy jest etykieta,
  sekwencja jest tylko dopiskiem. Fragment trasy wystarcza — nie liczymy
  pokrycia całej trasy.

### Wygładzanie (defaulty, do dostrojenia po realnych danych)

Surowe dane GPS są zaszumione — bez wygładzania wykres nachylenia będzie „iglasty".
Przyjęte wartości domyślne (konfigurowalne):

- **Wysokość (fuzja baro+GPS):** filtr komplementarny — barometr daje kształt (zmiany),
  GPS powoli kotwiczy wartość absolutną. Stała czasowa `tau = 10 s`, waga liczona
  z rzeczywistego odstępu czasu próbek (`alpha = tau/(tau+dt)`), więc działa przy
  zmiennym tempie 0,5–10 Hz. Wynik dodatkowo wygładzany średnią ruchomą (okno ~5 próbek).
- **Nachylenie:** liczone na oknie ~15 m skumulowanego dystansu; wynik dodatkowo wygładzony
  średnią ruchomą (okno ~3 próbek).
- **Prędkość:** średnia ruchoma, okno ~3 próbek (redukuje pojedyncze skoki, zachowując max).

Dostrojenie parametrów nastąpi po nagraniu prawdziwej jazdy na stoku (roadmapa) —
na nagraniach z auta defaulty wystarczą.

## 7. Transfer z urządzenia (BLE)

- PWA odkrywa nowe pliki **przyrostowo**: pyta firmware o pliki o nazwie
  większej niż kursor (`LIST:<since>`, stronicowane), a nie o pełną listę.
  Nazwa pliku to `YYYYMMDD_HHMMSS` (UTC z GNSS), więc sortuje się chronologicznie.
  Pusta odpowiedź = brak nowych plików.
- Kursor = największa **rozwiązana** nazwa (pobrana albo trwale pominięta),
  trzymany w `meta` (`syncCursor`). Porównanie z IndexedDB **po nazwie**.
- **Kolejka ponowień po nazwie.** Błąd przejściowy trafia do tabeli
  `pendingFiles` (nazwa + rozmiar + liczba prób). Przy następnym sync PWA
  pobiera taki plik **wprost po nazwie** (`START_FILE:<nazwa>`), bez listowania,
  i scala go z nowo wylistowanymi w jedną kolejkę (dedup, sort rosnąco).
  Dzięki temu kursor może przeskoczyć plik, który wypadł — nie przepada.
- Rozmiar do walidacji bierze się z urządzenia (`STATUS done raw=..`), nie z
  listy — ponowienie po nazwie nie potrzebuje metadanych.
- **Pliki postojowe są niewidoczne**: firmware listuje wyłącznie CSV z plikiem
  towarzyszącym `.meta` (patrz `docs/wymagania-ESP.md` §7), więc PWA nigdy nie widzi
  ani nie próbuje pobierać plików bez jazdy. Zero błędów i ponowień dla śmieci.
- **Klasyfikacja błędów pobierania.** Trwałe uszkodzenie danych (niezgodny
  rozmiar/CRC, zły nagłówek, brak próbek) oraz zniknięcie pliku z karty
  (`STATUS err:open`) zapisujemy w `ignoredFiles` i **nie ponawiamy**; użytkownik
  dostaje jednorazowe ostrzeżenie, że plik zostaje na karcie jako backup i można
  spróbować odzyskać go na komputerze. Błędy przejściowe (timeout, rozłączenie,
  `err:ack-timeout`/`err:nomem`/`err:busy`) trafiają do `pendingFiles`.
- **Żądanie pobrania rotuje plik na urządzeniu** — pobierane pliki są zawsze kompletne.
- Sync po nazwie pliku (nie po zakresie timestampów): całe pliki, idempotentne, bez problemu
  dryfu zegara.
- IndexedDB przechowuje **wyłącznie surowe CSV** jako archiwum; zjazdy są **pochodną**
  materializowaną ze scalonego śladu (patrz §6) — do szybkiego wyświetlania i edycji.
  Usunięcie zjazdu nie usuwa pliku źródłowego. Etykiety i tombstone'y usunięć są
  trzymane osobno, po stabilnym id zjazdu, więc ponowna materializacja ich nie gubi.
- Materializacja jest idempotentna i wykonywana tylko wtedy, gdy zmienił się zbiór
  plików albo wersja analizy (`QUALITY_ANALYSIS_VERSION`); inaczej jest pomijana.
  Schemat Dexie v6: `files`, `runs`, `runLabels`, `deletedRuns`, `ignoredFiles`,
  `pendingFiles`, `meta`. `runs` niesie też dopasowanie tras: `routeSequence`,
  `routeSpans`, `routeName` (patrz §6). Pola nie są indeksowane, a wersja logiki
  dopasowania wchodzi do podpisu materializacji (`MATCHING_VERSION`).

## 8. Dane demo (generowany ślad na prawdziwych trasach)

- Fixture `web/public/fixtures/ride.csv` jest **generowany** przez
  `scripts/gen-demo-ride.mjs`: syntetyczny dzień narciarski osadzony na
  prawdziwej geometrii OSM Sölden (`scripts/data/demo-solden.json`, snapshot z
  Overpass): pętla **Gaislachkoglbahn II** (wyciąg w górę) + zjazd trasami
  **`1` → `1a`**, powtórzona 3 razy. Dzięki temu działają i wykresy, i
  dopasowanie tras (sekwencja + „poprzednie przejazdy”).
- Plik ma poprawny nagłówek i semantykę **CSV v2** (`docs/jakosc-danych.md`).
  Wartości GNSS (satelity, HDOP, wiek pól) są **modelowane**, ale przechodzą
  trzy kryteria jakości, więc demo ma potwierdzone maksimum prędkości.
- Przy seedowaniu PWA tylko przesuwa timestampy do bieżącego czasu i zapisuje
  plik jako `demo-ride.csv`; nie dopisuje innych pomiarów. Osierocone pliki
  `demo-*` są usuwane.
- Fixture ma zawierać co najmniej **2 zjazdy** (tu: 3 zjazdy, każdy = wyciąg +
  zjazd). Zmiana geometrii/trasy: podmień snapshot i uruchom generator
  (nagłówek i format muszą zostać zgodne z v2).
- **Realne nagranie z urządzenia** (używane przez testy jednostkowe) to
  `test data/20260926_181420.csv`; to nie jest demo PWA.

## 9. Stack technologiczny (potwierdzony 2026-09-11, `web/package.json`)

- **React 19 + TypeScript (strict) + Vite 6**.
- **vite-plugin-pwa** — manifest + service worker + offline (cacheId `szusownik-v1`).
- **Dexie.js 4** — IndexedDB, schemat v6 (surowe pliki + materializowane zjazdy +
  etykiety/tombstone'y + trwale pominięte pliki + kolejka ponowień + metadane).
- **papaparse 5** — parsowanie + walidacja schematu CSV.
- **Recharts 2** — wykresy (ComposedChart, `ReferenceArea` dla czerwonego pasma).
- **MapLibre GL 6** — mapa: pełny widok (`MapView`) oraz mini-mapa śladu
  (`TraceMap`) nad wykresami; oba w osobnych, leniwie ładowanych chunkach.
- **react-router-dom 7 (HashRouter)** — dzień → zjazd → urządzenie; działa
  z GitHub Pages.
- **Tailwind CSS v4** — styling.
- Deploy: GitHub Pages przez `.github/workflows/deploy.yml` (build `web/`,
  `base: /Szusownik/`).
- `@supabase/supabase-js` — DOPIERO faza D (nie instalować przedwcześnie).

## 10. Ekran urządzenia (`#/urzadzenie`, alias `#/ustawienia`, niezależny od dnia)

PWA nie sprawdza wersji firmware ani nie bramkuje żadnej sekcji — zakłada
najnowsze wydanie i czyta bieżące ustawienia wprost z INFO po połączeniu.

- Sekcja **„Głośność pikania"**: dwa suwaki 0..100 — „Wolno (60 km/h)"
  i „Szybko (120 km/h)" (pomiędzy liniowo, powyżej 120 wartość ze 120).
  Połączenie BLE osobne od sync, wartości startowe z INFO (`volLow/volHigh`),
  wysyłka `SETVOL` z debounce; każde ustawienie gra feedback
  na urządzeniu. Przycisk Reset przywraca 20%/70%, a kliknięcie suwaka bez
  przesunięcia ponownie wysyła `SETVOL` z bieżącą wartością.
- Sekcja **„Częstotliwość pikania"**: dwa suwaki 600..1500 Hz krok 25 —
  „Ton krótki" i „Ton długi" (niezależne, krótki może być >= długi). Wspólne
  połączenie BLE z głośnością, wartości startowe z INFO (`freqShort/freqLong`),
  wysyłka `SETFREQ` z debounce; każde ustawienie gra podgląd na urządzeniu
  (1 długi + 2 krótkie nowymi częstotliwościami). Przycisk Reset przywraca
  880/1100 Hz, a kliknięcie suwaka bez przesunięcia ponownie wysyła `SETFREQ`
  z bieżącą wartością.
- Sekcja **„Czasy sygnału"**: cztery suwaki: krótkie piknięcie 20..200 ms
  krok 5, długie piknięcie 40..500 ms krok 5, przerwa w sygnale 0..500 ms
  krok 5 oraz przerwa między sygnałami 100..5000 ms krok 50. Wartości startowe
  są pobierane z INFO (`beepShortMs/beepLongMs/beepGapMs/signalGapMs`), wysyłka
  `SETTIMING` działa z debounce i każde ustawienie odtwarza trzy pełne sygnały
  120 km/h. Reset przywraca 56/140/60/1000 ms, a kliknięcie bez przesunięcia
  ponownie wysyła bieżącą wartość.
- Sekcja **„Minimalna prędkość pikania"**: suwak 60..120 km/h krok 1, domyślnie
  60 km/h. Poniżej ustawionego progu jest cisza, ale wzór sygnału dla prędkości
  powyżej progu pozostaje bez zmian. Wartość startowa z INFO (`minBeepKmh`),
  wysyłka `SETMINBEEP` działa z debounce, a Reset przywraca 60 km/h.
- Tu trafią kolejne opcje urządzenia (progi, interwały, tryb stokowy).

## 11. Otwarte pytania

1. **Dostrojenie wygładzania** — po nagraniu prawdziwych danych (roadmapa).
