# GpsSpeedTracker — dokument koncepcyjny

> Status: **WIP (draft)** — dokument żywy, aktualizowany w trakcie dyskusji.
> Data ostatniej aktualizacji: 2026-08-18

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
- IMU + fuzja (EKF), pomiar nachylenia i „bumpiness".
- Kompresja danych przy transferze BLE.
- RTK z lokalną bazą w ośrodku (na samym końcu).
- Analiza: score tras — wskazywanie tras z potencjałem na rekord.
- Dopracowanie progów dźwiękowych i score tras.

## 3. Szczegóły implementacyjne

### Urządzenie
- **MCU ESP32-S3** z PSRAM (min. 2 MB), programowany w **C/C++ (Arduino/PlatformIO)**.
- **Moduł GNSS (u-blox, ≥10 Hz)** po UART — źródło pozycji i prędkości.
- **Zapis surowego CSV na microSD** (SPI) w czasie rzeczywistym.
- **Feedback dźwiękowy** przez **pasywny buzzer piezo** (tony generowane PWM).
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
- Sygnał co **1 s** (konfigurowalny), mapa prędkość → liczba bipnięć:

| Prędkość [km/h] | Sygnał            |
|-----------------|-------------------|
| < 50            | 1 bipnięcie       |
| 50–70           | 2 bipnięcia       |
| 70–80           | 3 bipnięcia       |
| 80–90           | 4 bipnięcia       |
| 90–100          | 5 bipnięć         |
| pobity rekord   | 1 s dźwięku ciągłego |

### Dane i transfer
- Pola CSV: timestamp (UTC z GPS), lat/lon, prędkość, wysokość, heading.
- **Rotacja plików** na urządzeniu co ~5 zjazdów oraz przy żądaniu pobrania; PWA pobiera
  pliki po nazwie (lista + porównanie), bez kasowania danych z karty.
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

### Analiza (roadmapa)
- Wyliczanie **nachylenia**, **długości stoku**, **bumpiness** (IMU).
- **Score tras** wskazujący trasy z potencjałem na rekord.

## 4. Wstępna architektura

```
[GNSS u-blox] ──► [ESP32-S3] ──► [buzzer piezo]
                     │
                     ├─► microSD (surowe CSV)
                     └─► BLE ──► PWA (GitHub Pages, IndexedDB)
                                    ├─► generowanie FIT
                                    └─► Supabase Edge Function ──► Strava
```

- Moduł pomiarowy (GPS) wydzielony w kodzie — interfejs stabilny.
- FIT generowane w PWA z surowego CSV.

## 5. BOM — lista podzespołów (MVP)

Bez konkretnych marek/modeli (poza wskazanymi wymaganiami).

| Lp. | Podzespół | Wymagania / uwagi |
|----|-----------|-------------------|
| 1 | **MCU ESP32-S3** (np. ESP32-S3-Zero) | dual-core 240 MHz, **z PSRAM** (min. 2 MB), WiFi + BLE 5, USB-C |
| 2 | **Moduł GNSS** (u-blox) | **≥10 Hz**, multi-GNSS, konfigurowalny rate, prędkość z Dopplera, UART; antena ceramiczna/patch z widokiem nieba |
| 3 | **Czytnik microSD** (SPI) | z regulatorem 3,3 V |
| 4 | **Karta microSD** | np. 8–32 GB |
| 5 | **Buzzer piezo (pasywny)** | mały, sterowany PWM |
| 6 | **Power bank** | min. **5000 mAh**, **tryb low-current**, USB-C |
| 7 | **Kabel USB-C** | power bank → MCU; odporny na zimno, odpowiednia długość |
| 8 | **Płytka prototypowa (perfboard) lub PCB** | do montażu i lutowania |
| 9 | **Przewody/złącza** | połączenia UART/SPI, koszulki termokurczliwe |
| 10 | **Obudowa na kask** | pudełko (druk 3D lub gotowe) + bezpieczne/łamliwe mocowanie |
| 11 | **Materiały montażowe** | rzepy, taśmy |

**Roadmapa (nie MVP):** IMU (MPU-6xxx / ICM-xxx).

## 6. Otwarte punkty i kolejne kroki

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

### Kolejność prac
1. **PWA + warstwa prezentacji na danych mockowanych** (punkt 2) — zanim dojadą komponenty.
2. **Firmware urządzenia** — pomiar (adaptacyjne próbkowanie), logowanie CSV, buzzer.
3. **Integracja** urządzenie → PWA (BLE) → Supabase.
4. **Flow Strava** (punkt 1) — na samym końcu.
