# Wymagania PWA — analiza i prezentacja

> Status: **WIP (draft)** — dokument żywy.
> Data: 2026-08-18

## 1. Cel

Prezentacja i analiza przejazdów: **dzień → zjazdy → wykresy**. Aplikacja działa offline
(IndexedDB). Docelowo dane z urządzenia przez BLE, na start — dane mockowane.

## 2. Zasady UI

- Maksymalizacja przestrzeni na ekranie; **bez nazwy aplikacji w nagłówkach**.
- **Język PL**. Jednostki i formaty: prędkość **km/h**, dystans **km**, czas **min:sec**, zegar **24 h**.

## 3. Auth i użytkownicy

- Logowanie przez **Supabase Auth** (email + hasło).
- **2 użytkowników**; każdy widzi **tylko swoje** dane — po stronie bazy wymusza to **RLS**
  (`user_id = auth.uid()`), lokalnie dane w IndexedDB też są oznaczone użytkownikiem.

## 4. Ekran główny (aktywność / dzień)

- Przycisk **„Pobierz dane"** — na razie ładuje mockowe dane z pliku CSV.
- Po kliknięciu: PWA pobiera nowe pliki z urządzenia (patrz „Transfer"), przetwarza CSV
  (wycina zjazdy) i pokazuje **bieżącą aktywność (dzień)**.
- **Statystyki całej aktywności:** dystans w dół (suma zjazdów), max prędkość.
- **Lista zjazdów** ze statystykami: max prędkość, dystans, max nachylenie.
- Klik w zjazd → ekran szczegółów.

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

Dostrojenie parametrów nastąpi po nagraniu prawdziwej jazdy (roadmapa) — na mocku
(syntetyczne, gładkie dane) defaulty wystarczą.

## 7. Transfer z urządzenia (BLE)

- PWA prosi urządzenie o **listę plików** (nazwa + rozmiar + czas startu).
- Porównuje z plikami już posiadanymi w IndexedDB (**po nazwie**) i pobiera **tylko nowe**.
- **Żądanie pobrania rotuje plik na urządzeniu** — pobierane pliki są zawsze kompletne.
- Sync po nazwie pliku (nie po zakresie timestampów): całe pliki, idempotentne, bez problemu
  dryfu zegara.

## 8. Dane mockowane

- Plik **CSV** reprezentujący **10 min**: 3 min zjazd, 2 min wyciąg (góra), 4 min zjazd,
  1 min góra → dają **2 zjazdy**.
- Pola zgodne z formatem urządzenia: `timestamp, lat, lon, speed, altitude, heading`.

## 9. Stack technologiczny (propozycja do potwierdzenia)

- **React + TypeScript + Vite**.
- **vite-plugin-pwa** — manifest + service worker + offline.
- **@supabase/supabase-js** — auth + baza.
- **Dexie.js** — IndexedDB.
- **papaparse** — parsowanie CSV.
- **Recharts** — wykresy (ComposedChart, dual-axis, `ReferenceArea` dla czerwonego pasma).
- **react-router** — lista → szczegóły.
- **Tailwind CSS** — styling.

## 10. Otwarte pytania

1. **Dostrojenie wygładzania** — po nagraniu prawdziwych danych (roadmapa).
