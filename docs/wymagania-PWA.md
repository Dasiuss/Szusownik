# Wymagania PWA — analiza i prezentacja

> Status: **WIP (draft)** — dokument żywy.
> Data: 2026-08-18

## 1. Cel

Prezentacja i analiza przejazdów: **dzień → zjazdy → wykresy**. Aplikacja działa offline
(IndexedDB). Dane z urządzenia przez BLE; do developmentu i testów PWA służy
**rzeczywiste nagranie z urządzenia** (plik CSV z karty SD wpięty jako fixture).

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
  (patrz „Transfer"); w trybie deweloperskim ładuje rzeczywiste nagranie-fixture
  z pliku CSV.
- Po kliknięciu: PWA pobiera nowe pliki z urządzenia (patrz „Transfer"), przetwarza CSV
  (wycina zjazdy) i pokazuje **bieżącą aktywność (dzień)**.
- Po połączeniu PWA automatycznie sprawdza listę plików. Nowe pliki są zapowiadane kartą
  na górze widoku „Dzisiaj”; użytkownik zatwierdza pobranie wszystkich jednym kliknięciem.
- **Statystyki całej aktywności:** dystans w dół (suma zjazdów), max prędkość.
- **Lista zjazdów** ze statystykami: max prędkość, dystans, max nachylenie; najnowszy zjazd jest pierwszy.
- Kafelek **„Cały dzień”** otwiera połączone statystyki i wykresy wszystkich zjazdów tego dnia.
- Klik w zjazd → ekran szczegółów.
- Historia grupuje zjazdy według lokalnej strefy czasowej telefonu. Zjazd może mieć krótką,
  edytowalną nazwę; użytkownik może usunąć pojedynczy zjazd.

## 5. Ekran szczegółów zjazdu

- Wykresy w funkcji **dystansu** (nie czasu): **prędkość** i **zmierzona wysokość**.
- Wykres wysokości pokazuje wygładzoną wysokość w metrach, dzięki czemu spadki wysokości
  wizualnie odpowiadają zjazdom stoku. Wysokość to **fuzja barometru i GPS** (patrz §6),
  używana też do nachylenia i cięcia zjazdów.
- Wykresy **osobne, jeden pod drugim** (wspólna oś dystansu), aby dało się je ogarniać
  jednocześnie.
- Na osi X stosować czytelne, zaokrąglone przedziały dystansu: co 250 m dla tras poniżej
  2 km, co 500 m poniżej 6 km i co 1 km dla dłuższych tras; zakres osi zaokrąglać do
  pełnego przedziału.
- Na widoku „Cały dzień” oznaczać granice zjazdów pionowymi liniami na wykresach oraz
  pokazywać pod nimi klikalny pasek segmentów o szerokości proporcjonalnej do dystansu;
  kliknięcie segmentu otwiera szczegóły zjazdu.
- Oś prędkości **0-based**: domyślnie 0–100 km/h; przy przekroczeniu 100 — skala 0–150 km/h,
  a zakres **100–150 na lekko czerwonym tle** (wyróżnienie).

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
- **Reguła cięcia testowa:** skumulowany wzrost wygładzonej wysokości o **>= 5 m**
  rozdziela dwa zjazdy, ale granica jest ustawiana na początku wykrytego wzrostu;
  poprzedni zjazd kończy się przed odcinkiem wyciągu, a kolejny zaczyna się od niego.
  Drobne zmiany wysokości między próbkami są ignorowane.
- **Stabilny identyfikator zjazdu:** `${dayKey}::${startT}`. Etykiety użytkownika i
  usunięcia (tombstone) kluczują się tym id i przeżywają dodanie kolejnego pliku
  oraz ponowną analizę. Usunięcie zjazdu nie usuwa surowego pliku.
- Dla każdego zjazdu: dystans (haversine z lat/lon), max prędkość, max nachylenie.
- **Nachylenie w stopniach**, liczone z **Δwysokości / Δdystansu**.
- „Dystans w dół" = suma dystansów zjazdów (bez podjazdów/wyciągów).
- **Cięcie dla Strava** (klik „wyślij"): aktywność = dane od poprzedniego cięcia do bieżącego
  kliknięcia, maksymalnie **bieżący dzień**.

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

- PWA prosi urządzenie o **listę plików** (nazwa + rozmiar + czas startu).
- Porównuje z plikami już posiadanymi w IndexedDB (**po nazwie**) i pobiera **tylko nowe**.
- **Pliki postojowe są niewidoczne**: firmware listuje wyłącznie CSV z plikiem
  towarzyszącym `.meta` (patrz `docs/wymagania-ESP.md` §7), więc PWA nigdy nie widzi
  ani nie próbuje pobierać plików bez jazdy. Zero błędów i ponowień dla śmieci.
- **Klasyfikacja błędów pobierania.** Trwałe uszkodzenie danych (niezgodny
  rozmiar/CRC, zły nagłówek, brak próbek) zapisujemy w `ignoredFiles` i **nie
  ponawiamy**; użytkownik dostaje jednorazowe ostrzeżenie z podpowiedzią, że plik
  zostaje na karcie i można spróbować odzyskać go na komputerze. Błędy przejściowe
  (timeout, rozłączenie, `err:ack-timeout`/`err:nomem`/`err:busy`) zostają w
  kolejce do ponowienia.
- **Żądanie pobrania rotuje plik na urządzeniu** — pobierane pliki są zawsze kompletne.
- Sync po nazwie pliku (nie po zakresie timestampów): całe pliki, idempotentne, bez problemu
  dryfu zegara.
- IndexedDB przechowuje **wyłącznie surowe CSV** jako archiwum; zjazdy są **pochodną**
  materializowaną ze scalonego śladu (patrz §6) — do szybkiego wyświetlania i edycji.
  Usunięcie zjazdu nie usuwa pliku źródłowego. Etykiety i tombstone'y usunięć są
  trzymane osobno, po stabilnym id zjazdu, więc ponowna materializacja ich nie gubi.
- Materializacja jest idempotentna i wykonywana tylko wtedy, gdy zmienił się zbiór
  plików albo wersja analizy (`QUALITY_ANALYSIS_VERSION`); inaczej jest pomijana.
  Schemat Dexie v5: `files`, `runs`, `runLabels`, `deletedRuns`, `ignoredFiles`, `meta`.

## 8. Dane testowe (rzeczywisty ślad, metryki GNSS z urządzenia)

- Plik **CSV nagrany urządzeniem** (np. przejazd autem) wpięty jako fixture
  do developmentu PWA. Fixture to nagranie **v2** z rzeczywistymi metrykami GNSS
  i wysokością barometryczną; PWA nie dopisuje żadnych syntetycznych pomiarów.
- Nagłówek i semantykę pól v2 opisuje `docs/jakosc-danych.md`.
- Fixture ma zawierać co najmniej **2 zjazdy** (jazda + postój/wolny odcinek
  rozdzielający).

## 9. Stack technologiczny (potwierdzony 2026-09-11, `web/package.json`)

- **React 19 + TypeScript (strict) + Vite 6**.
- **vite-plugin-pwa** — manifest + service worker + offline (cacheId `szusownik-v1`).
- **Dexie.js 4** — IndexedDB, schemat v5 (surowe pliki + materializowane zjazdy +
  etykiety/tombstone'y + trwale pominięte pliki + metadane).
- **papaparse 5** — parsowanie + walidacja schematu CSV.
- **Recharts 2** — wykresy (ComposedChart, `ReferenceArea` dla czerwonego pasma).
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
