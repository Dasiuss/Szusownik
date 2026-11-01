# Szusownik — dokument koncepcyjny

> Status: bieżący zakres produktu i roadmapa; szczegółowe decyzje techniczne są
> opisane w dokumentach referencyjnych wskazanych w `AGENTS.md`.
> Data ostatniej aktualizacji: 2026-11-01

## 1. Wizja i cel

Zestaw urządzenie + aplikacja do pomiaru i analizy prędkości narciarza, nastawiony na
**bicie rekordów prędkości** (rekreacyjnie, okolice **150 km/h**).

Dwa główne elementy:

1. **Urządzenie pomiarowe** (dedykowany sprzęt — GPS w telefonie jest zbyt wolny).
2. **Aplikacja do analizy wyników** — lokalna, offline-first PWA. Integracja
   chmurowa jest planowana w kroku 2, poza MVP.

## 2. Zakres

### MVP — bieżący zakres

- Pomiar GNSS (do 10 Hz) z adaptacyjnym próbkowaniem, surowy zapis CSV na
  microSD, sygnały dźwiękowe (w tym prowizoryczny sygnał nowego globalnego rekordu)
  oraz transfer plików BLE do PWA.
- Wymagany barometr BME280: wysokość GNSS ma zbyt małą dokładność pionową, by
  samodzielnie zapewnić użyteczny profil wysokości i stabilną analizę zjazdów.
  Bieżąca fuzja baro+GPS jest komplementarna; nie jest to jeszcze fuzja IMU/EKF.
- Lokalny ekran statystyk OLED; PWA do analizy zjazdów, wykresów i pracy z
  lokalnymi danymi mapowymi oraz routingiem.
- Opcjonalny zewnętrzny moduł HudRekaw: osobny ekran mapy/statystyk i nawigacji.

MVP nie obejmuje synchronizacji danych z chmurą ani eksportu do Stravy.

### Krok 2 — chmura i eksport

Planowana integracja, poza MVP:

- generowanie FIT w PWA;
- Supabase (uwierzytelnianie, baza i Edge Function);
- OAuth i wysyłka aktywności do Stravy przez Edge Function.

Szczegóły przepływu OAuth, przechowywania tokenów i obsługi ponowień trzeba
ustalić przed implementacją (`docs/supabase.md`).

### Dalsza roadmapa (poza MVP; kolejność do ustalenia)

- **IMU:** pomiar nachylenia i „bumpiness"; ocena, czy rozszerzyć obecną fuzję
  baro+GPS o IMU i filtr EKF. Barometr pozostaje wymaganym elementem MVP.
- **Zaawansowana analityka:** ocena tras pod kątem potencjału na rekord, analiza
  współczynnika złożenia i ślizgu, teoretycznej prędkości maksymalnej oraz kosztu
  zakrętu na podstawie zmiany trajektorii i prędkości.
- **RTK:** lokalna baza w ośrodku — długoterminowy, najpóźniejszy etap roadmapy.

## 3. Szczegóły implementacyjne

### Urządzenie
- **MCU ESP32-S3** z PSRAM (min. 2 MB), programowany w **C/C++ (Arduino/arduino-cli)**.
- **Moduł GNSS (u-blox, ≥10 Hz)** po UART — źródło pozycji i prędkości.
- **Zapis surowego CSV na microSD** (SPI) w czasie rzeczywistym.
- **Feedback dźwiękowy** przez **pasywny buzzer piezo** (tony generowane PWM).
- **Barometr BME280 (I2C)** — wymagany; GNSS ma ograniczoną dokładność
  wysokościową. Wysokość barometryczna jest łączona z GPS; firmware obsługuje
  również BMP280.
- **Wyświetlacz OLED 0,96" (SSD1306, I2C)** — ekran statystyk: **max
  ostatniego zjazdu** (hero, na żywo w zjeździe / zamrożony na wyciągu), **max
  od uruchomienia**, **dystans od uruchomienia**, **wysokość** (fuzja baro+GPS)
  i **czas lokalny**. Layout w `docs/hud-display.md`.
- **Opcjonalny, zewnętrzny ekran HudRekaw** (ESP8266 + ST7789 240×240) dostaje przez **ESP-NOW**
  (kanał 1) pozycję i statystyki: mapę z bieżącą pozycją na postoju albo ekran
  statystyk w ruchu (`docs/hud-rekaw.md`).
- **Tryb nawigacji**: wyznaczona w PWA trasa trafia przez BLE do Szusownika
  (RAM), a stamtąd przez ESP-NOW do HudRekaw. Szusownik liczy bieżący odcinek,
  HudRekaw rysuje trasę wyróżnioną i pokazuje kolejne odcinki; dotarcie do celu
  kończy nawigację (`docs/hud-rekaw.md`, `docs/wymagania-ESP.md` §13).
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

### Sygnał globalnego rekordu
- Rekord jest globalny dla urządzenia/PWA, a nie dla pojedynczego zjazdu ani dnia.
  PWA wyznacza go z potwierdzonych maksimów realnych zjazdów dostępnych w lokalnej
  historii; demo jest wykluczone. Wartość początkowa wynosi **50 km/h**.
- Podczas jazdy urządzenie porównuje świeżą próbkę Dopplera z maksimum i sygnalizuje
  natychmiast nowe maksimum. Sygnał jest prowizoryczny do czasu analizy CSV przez
  PWA; niepotwierdzony pik może zostać cofnięty przy następnym syncu BLE.
- Kolejny sygnał: wzrost o co najmniej **5 km/h** ponad ostatni zasygnalizowany rekord
  może zagrać wcześniej; jeśli przez **60 s** nie padł kolejny sygnał, wystarczy
  następny nowy rekord niezależnie od wielkości wzrostu. Blokada jest tylko w RAM.
- Melodyjka rekordu omija minimalny próg zwykłego pikania. Przerywa bieżący wzór
  prędkości; po niej wraca zwykły harmonogram. Alarm termiczny ma wyższy priorytet.
  Szczegóły stanu SD i synchronizacji opisują `docs/wymagania-ESP.md` §5 oraz
  `docs/wymagania-PWA.md` §7.

### Dane i transfer
- Pola CSV: timestamp (UTC z GPS), lat/lon, prędkość, wysokość GPS, heading,
  wysokość barometryczna (wymagany barometr BME280; firmware rozpoznaje również
  BMP280).
- **Rotacja plików** na urządzeniu: domknięcie pliku po postoju i przed żądaniem
  pobrania; nie powstaje osobny plik na każdy zjazd. PWA pobiera pliki po nazwie,
  scala ich próbki przed cięciem zjazdów i nie usuwa ich po transferze. Najstarsze
  pliki są usuwane FIFO dopiero po spadku wolnego miejsca poniżej minimum.
- **Pliki z jazdą znaczone `.meta`**: plik `<nazwa>.csv.meta` powstaje po
  potwierdzonym ruchu; bez niego CSV jest „postojowy" i nie trafia na listę
  pobierania, więc PWA nie widzi śmieci z postoju.
- **Transfer BLE** do PWA (Chrome/Web Bluetooth), chunkowany.
- Dane urządzenia są przechowywane i analizowane lokalnie w PWA; integracja z
  chmurą i eksport FIT/Strava należą do kroku 2.

### PWA i integracje późniejsze
- PWA serwowane z **GitHub Pages** (HTTPS).
- **IndexedDB** — lokalne przechowywanie danych i analiza offline.
- W kroku 2: Supabase (baza + Edge Function jako proxy do Stravy, przechowujące
  sekret po stronie serwera i obsługujące OAuth oraz upload).

## 4. Wstępna architektura

```
[GNSS u-blox] ────────┐
[BME280, wymagany] ───┴─► [ESP32-S3] ──► buzzer piezo
                               ├─► microSD (surowe CSV)
                               ├─► OLED 0,96" (I2C)
                               ├─► ESP-NOW ──► HudRekaw (opcjonalny ESP8266 + ST7789)
                               └─► BLE ──► PWA (GitHub Pages, IndexedDB)
                                              └─► krok 2: FIT → Supabase Edge Function → Strava
```

- Moduł pomiarowy (GPS) wydzielony w kodzie — interfejs stabilny.
- Barometr jest częścią wymaganego zestawu MVP; IMU pozostaje rozszerzeniem
  roadmapy.

## 5. Status i następne etapy

Główne przepływy MVP — rejestracja danych przez firmware, transfer BLE, lokalna
analiza PWA, mapy i routing — są zaimplementowane. Szczegółowy stan testów
automatycznych i walidacji sprzętowej opisują `docs/testy.md`,
`docs/ble-transfer.md`, `docs/hud-display.md` i `docs/hud-rekaw.md`.

Następnym wydzielonym etapem produktowym jest **krok 2: Supabase i Strava**.
IMU, zaawansowana analityka oraz RTK pozostają dalszą roadmapą, poza MVP i bez
ustalonych terminów.
