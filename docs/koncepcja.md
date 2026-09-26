# Szusownik — dokument koncepcyjny

> Status: **WIP (draft)** — dokument żywy, aktualizowany w trakcie dyskusji.
> Data ostatniej aktualizacji: 2026-08-19

## 1. Wizja i cel

Zestaw urządzenie + aplikacja do pomiaru i analizy prędkości narciarza, nastawiony na
**bicie rekordów prędkości** (rekreacyjnie, okolice **150 km/h**).

Dwa główne elementy:

1. **Urządzenie pomiarowe** (dedykowany sprzęt — GPS w telefonie jest zbyt wolny).
2. **Aplikacja do analizy wyników** — PWA (web) + chmura.

## 2. Zakres

### MVP
- Pomiar pozycji i prędkości (GPS, do 10 Hz).
- Adaptacyjna częstotliwość próbkowania.
- Feedback dźwiękowy (bipnięcia piezo) + sygnał rekordu.
- Zapis surowy CSV na microSD.
- Transfer BLE do PWA (Android), podgląd offline (IndexedDB).
- Warstwa prezentacyjna w PWA: spis zjazdów (czasy + max prędkość), po wejściu w zjazd — wykresy.
- Generowanie FIT w PWA + wysyłka do Strava przez proxy serverless.
- Baza w chmurze: Supabase.

### Roadmapa
- IMU + baro + fuzja (EKF), pomiar nachylenia i „bumpiness".
- Kompresja danych przy transferze BLE.
- RTK z lokalną bazą w ośrodku (na samym końcu).
- Analiza: score tras — wskazywanie tras z potencjałem na rekord.
- Wyliczanie współczynnika złożenia, ślizgu oraz teoretycznej prędkości maksymalnej.
- Wykres prędkości na przekroju stoku na OLED — widać, gdzie wypadł max, żeby wiedzieć, gdzie „przycisnąć".
- Dopracowanie score tras.
- Wyliczanie kosztu zakrętu na podstawie zmiany trajektorii i zmiany prędkości.

## 3. Szczegóły implementacyjne

### Urządzenie
- **MCU ESP32-S3** z PSRAM (min. 2 MB), programowany w **C/C++ (Arduino/arduino-cli)**.
- **Moduł GNSS (u-blox, ≥10 Hz)** po UART — źródło pozycji i prędkości.
- **Zapis surowego CSV na microSD** (SPI) w czasie rzeczywistym.
- **Feedback dźwiękowy** przez **pasywny buzzer piezo** (tony generowane PWM).
- **Wyświetlacz OLED 0,96" (SSD1306, I2C)** pokazuje podstawowe dane: **max prędkość
  ostatniego zjazdu** i **max prędkość dnia** (od włączenia urządzenia).
- **Zasilanie 5 V przez USB-C z power banka** (min. 5000 mAh, tryb low-current);
  szyna 3,3 V zasila peryferia (GNSS, SD, buzzer).
- **Montaż**: cała elektronika w jednej obudowie na kasku; zasilanie kablem USB-C
  do power banka w kieszeni. Mocowanie na kasku bezpieczne/łamliwe.

### Pomiar
- Odczyt pozycji i prędkości w **wydzielonym module kodu** (stabilny interfejs — ułatwia
  późniejsze dołożenie IMU).
- Prędkość liczona z **przesunięcia Dopplera**.
- **Adaptacyjna częstotliwość próbkowania** (na podstawie prędkości):

  | Prędkość [km/h] | Częstotliwość |
  |-----------------|---------------|
  | < 20            | 0,5 Hz        |
  | 20–50           | 1 Hz          |
  | 50–70           | 3 Hz          |
  | 70–80           | 6 Hz          |
  | ≥ 80            | 10 Hz         |

- **Histereza ±3 km/h** (konfigurowalna): podbicie częstotliwości, gdy prędkość
  ≥ próg + 3 km/h; obniżenie, gdy prędkość ≤ próg − 3 km/h.
  Przykład: 1 Hz → 3 Hz przy 53 km/h, 3 Hz → 1 Hz przy 47 km/h.

### Sygnały dźwiękowe
- Sygnał co **1 s** (konfigurowalny), punkt odniesienia **100 km/h**.
- Poniżej 100 km/h liczba krótkich piknięć rośnie od 1 do 4 wraz z prędkością;
  od 100 km/h używane są długie piknięcia oraz krótkie za kolejne dziesiątki.
- Poniżej ustawionej minimalnej prędkości pikania — cisza (domyślnie poniżej **60 km/h**).

| Prędkość [km/h] | Sygnał |
|-----------------|--------|
| < próg          | brak |
| 60–69           | 1 krótkie piknięcie |
| 70–79           | 2 krótkie piknięcia |
| 80–89           | 3 krótkie piknięcia |
| 90–99           | 4 krótkie piknięcia |
| 100–109         | 1 długie piknięcie |
| 110–119         | 1 długie + 1 krótkie |
| 120–129         | 1 długie + 2 krótkie |
| 130–139         | 1 długie + 3 krótkie |
| 140–149         | 1 długie + 4 krótkie |
| 150–159         | 2 długie |
| 160–169         | 2 długie + 1 krótkie |
| …               | … |

- Reguła: poniżej 100 — 1/2/3/4 krótkie piknięcia dla przedziałów 60–69/70–79/80–89/90–99;
  powyżej 100 — kolejne długie piknięcie co **50 km/h** (100 → 1, 150 → 2, 200 → 3…),
  a krótkie piknięcia liczą dziesiątki ponad aktualnym progiem.

### Dane i transfer
- Pola CSV: timestamp (UTC z GPS), lat/lon, prędkość, wysokość GPS, heading,
  wysokość barometryczna (BME280).
- **Rotacja plików** na urządzeniu: domknięcie pliku na postoju (ochrona przed odcięciem zasilania) oraz przy żądaniu pobrania; PWA pobiera
  pliki po nazwie (lista + porównanie), bez kasowania danych z karty.
- **Pliki z jazdą znaczone `.meta`**: plik `<nazwa>.csv.meta` powstaje po
  potwierdzonym ruchu; bez niego CSV jest „postojowy" i nie trafia na listę
  pobierania, więc PWA nie widzi śmieci z postoju.
- **Cięcie trasy przy kliknięciu w PWA**: aktywność = dane od poprzedniego cięcia do bieżącego
  kliknięcia. Ograniczenie: maksymalnie **bieżący dzień** — jeśli poprzednie cięcie było
  wcześniejszego dnia, uwzględniane są tylko dane z dzisiaj (starsze zostają niewrzucone).
- **Transfer BLE** do PWA (Android, Chrome/Web Bluetooth), chunkowany.
- **FIT generowane w PWA** (`@garmin-fit/sdk`).
- **Dwie akcje w PWA**: (1) pobierz z urządzenia (BLE → IndexedDB),
  (2) wyślij do Strava (FIT → Edge Function).

### PWA i chmura
- PWA serwowane z **GitHub Pages** (HTTPS).
- **IndexedDB** — podgląd danych offline.
- **Supabase**: baza + **Edge Function** jako proxy do Strava
  (Edge Function = funkcja serverless hostowana w chmurze; trzyma `client_secret`,
  robi OAuth + upload, omija CORS).

## 4. Wstępna architektura

```
[GNSS u-blox] ──► [ESP32-S3] ──► [buzzer piezo]
                     │
                     ├─► microSD (surowe CSV)
                     ├─► OLED 0,96" (I2C)
                     └─► BLE ──► PWA (GitHub Pages, IndexedDB)
                                    ├─► generowanie FIT
                                    └─► Supabase Edge Function ──► Strava
```

- Moduł pomiarowy (GPS) wydzielony w kodzie — interfejs stabilny.
- FIT generowane w PWA z surowego CSV.

## 5. Otwarte punkty i kolejne kroki

Punkty wymagające decyzji/projektu przed lub w trakcie budowy MVP. Każdy rozpisany
na konkretne zadania.

### 1. Flow Strava: OAuth + upload przez Edge Function
- **Co ustalić:** przepływ OAuth2 (Authorization Code + PKCE), gdzie przechowywać tokeny
  (localStorage po stronie PWA vs po stronie Supabase), jak Edge Function wykonuje
  `POST /uploads` (multipart z plikiem FIT), obsługa błędów/retry.
- **Do zrobienia:** projekt przepływu + prototyp Edge Function (wymiana tokenu, upload
  testowego FIT, logowanie błędów).

### 2. Warstwa prezentacji (analiza offline)
- **Co ustalić:** co pokazujemy w PWA offline — spis zjazdów (czas + max prędkość),
  po wejściu w zjazd wykresy (prędkość/wysokość w funkcji czasu), ewentualne dodatkowe
  metryki (średnia, przyrost, porównanie przejazdów).
- **Do zrobienia:** szkic widoków i metryk → statyczny prototyp UI przed podpięciem danych.

### Kolejność prac (aktualizacja 2026-09-11: komponenty dojechały, mock niepotrzebny)
1. **PWA + warstwa prezentacji na rzeczywistym nagraniu z urządzenia** (punkt 2).
2. **Firmware urządzenia** — DONE MVP1: pomiar (adaptacyjne próbkowanie), logowanie CSV,
   buzzer, OLED, autokonfiguracja UBX; pozostał streaming BLE (etap 2).
3. **Integracja** urządzenie → PWA (BLE) → Supabase.
4. **Flow Strava** (punkt 1) — na samym końcu.
