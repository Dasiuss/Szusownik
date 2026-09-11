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
- **Statystyki całej aktywności:** dystans w dół (suma zjazdów), max prędkość.
- **Lista zjazdów** ze statystykami: max prędkość, dystans, max nachylenie.
- Klik w zjazd → ekran szczegółów.
- Sekcja **„Głośność pikania"**: dwa suwaki 0..100 — „Wolno (60 km/h)"
  i „Szybko (120 km/h)" (pomiędzy liniowo, powyżej 120 wartość ze 120).
  Połączenie BLE osobne od sync, wartości startowe z INFO (`volLow/volHigh`),
  wysyłka `SETVOL` z debounce; każde ustawienie gra feedback na urządzeniu.

## 5. Ekran szczegółów zjazdu

- Wykresy w funkcji **dystansu** (nie czasu): **prędkość** i **nachylenie (przekrój stoku)**.
- Wykresy **osobne, jeden pod drugim** (wspólna oś dystansu), aby dało się je ogarniać
  jednocześnie.
- Oś prędkości **0-based**: domyślnie 0–100 km/h; przy przekroczeniu 100 — skala 0–150 km/h,
  a zakres **100–150 na lekko czerwonym tle** (wyróżnienie).

## 6. Przetwarzanie danych (wycinanie zjazdów)

- **Reguła cięcia:** ruch w górę trwający **> 30 s** rozdziela dwa zjazdy.
- Dla każdego zjazdu: dystans (haversine z lat/lon), max prędkość, max nachylenie.
- **Nachylenie w stopniach**, liczone z **Δwysokości / Δdystansu**.
- „Dystans w dół" = suma dystansów zjazdów (bez podjazdów/wyciągów).
- **Cięcie dla Strava** (klik „wyślij"): aktywność = dane od poprzedniego cięcia do bieżącego
  kliknięcia, maksymalnie **bieżący dzień**.

### Wygładzanie (defaulty, do dostrojenia po realnych danych)

Surowe dane GPS są zaszumione — bez wygładzania wykres nachylenia będzie „iglasty".
Przyjęte wartości domyślne (konfigurowalne):

- **Wysokość:** średnia ruchoma, okno ~5 próbek.
- **Nachylenie:** liczone na oknie ~15 m skumulowanego dystansu; wynik dodatkowo wygładzony
  średnią ruchomą (okno ~3 próbek).
- **Prędkość:** średnia ruchoma, okno ~3 próbek (redukuje pojedyncze skoki, zachowując max).

Dostrojenie parametrów nastąpi po nagraniu prawdziwej jazdy na stoku (roadmapa) —
na nagraniach z auta defaulty wystarczą.

## 7. Transfer z urządzenia (BLE)

- PWA prosi urządzenie o **listę plików** (nazwa + rozmiar + czas startu).
- Porównuje z plikami już posiadanymi w IndexedDB (**po nazwie**) i pobiera **tylko nowe**.
- **Żądanie pobrania rotuje plik na urządzeniu** — pobierane pliki są zawsze kompletne.
- Sync po nazwie pliku (nie po zakresie timestampów): całe pliki, idempotentne, bez problemu
  dryfu zegara.

## 8. Dane testowe (rzeczywiste nagranie, nie mock)

- Plik **CSV nagrany urządzeniem** (np. przejazd autem) wpięty jako fixture
  do developmentu PWA — **nie generujemy syntetycznego mocka**.
- Format pól zgodny z urządzeniem: `timestamp, lat, lon, speed, altitude, heading`.
- Fixture ma zawierać co najmniej **2 zjazdy** (jazda + postój/wolny odcinek
  rozdzielający).

## 9. Stack technologiczny (potwierdzony 2026-09-11, `web/package.json`)

- **React 19 + TypeScript (strict) + Vite 6**.
- **vite-plugin-pwa** — manifest + service worker + offline (cacheId `szusownik-v1`).
- **Dexie.js 4** — IndexedDB, schemat v1.
- **papaparse 5** — parsowanie + walidacja schematu CSV.
- **Recharts 2** — wykresy (ComposedChart, `ReferenceArea` dla czerwonego pasma).
- **react-router-dom 7 (HashRouter)** — lista → szczegóły; działa z GitHub Pages.
- **Tailwind CSS v4** — styling.
- Deploy: GitHub Pages przez `.github/workflows/deploy.yml` (build `web/`,
  `base: /Szusownik/`).
- `@supabase/supabase-js` — DOPIERO faza D (nie instalować przedwcześnie).

## 10. Otwarte pytania

1. **Dostrojenie wygładzania** — po nagraniu prawdziwych danych (roadmapa).
