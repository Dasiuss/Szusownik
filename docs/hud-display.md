# Szusownik - HUD i wyświetlacz OLED

> Status: layout i render zaimplementowane w firmware (`firmware/Szusownik/src/hud/`,
> `src/core/run_tracker`, `src/core/hud_format`). Mapa/trasa/bitmapy/animation
> usunięte z planu (greenfield). Linia trasy z PWA: **transport, dane i render
> zaimplementowane** (Szusownik trzyma trasę + `segmentIndex`, dolna linia pokazuje
> kolejne odcinki).

## 1. Zasada działania

```text
GNSS (predkosc, pozycja, UTC) ─┐
BME280 (wysokosc baro) ────────┼─► core::RunTracker (fuzja + ZigZag)
                               │      │
                               │      ├─ hero "max zjazdu" (live/zamrozony)
                               │      └─ wygladzona wysokosc z fuzji
                               └─► HudData ─► Hud::draw() ─► SSD1306 128x64
```

ESP32 renderuje ekran lokalnie. Jeden, w pełni autonomiczny ekran (urządzenie nie
ma przycisku — tylko GPIO0=BOOT). Ekran czyta się **na postoju i na wyciągu**
(nie w szybkim ruchu), dlatego nie ma tu dużych wskazań „na żywo” poza hero.

## 2. Sprzęt i pinout

- SSD1306 128x64, I2C `400 kHz`, adres `0x3C`.
- OLED SDA: GPIO8, SCL: GPIO9.
- SD używa GPIO1-4 (nie koliduje).
- BME280/BMP280 dzieli magistralę I2C z OLED (adres `0x76`/`0x77`).

## 3. Layout 128x64

Dwie kolumny, etykieta nad wartością. Font Adafruit GFX jest **ASCII** — brak
polskich znaków (`WYSOKOSC`) i brak glifu strzałki (linia trasy używa ASCII
`<`/`>`).

```text
x=0..63    kolumna lewa  (MAX ZJAZDU hero + DYSTANS)
x=76..127  kolumna prawa (czas, SPEED/SPD, MAX DNIA, WYSOKOSC)
```

### 3.1 Bez trasy (pełny ekran)

```text
MAX ZJAZDU              14:23
 1 4 5                   (przerwa)
                        SPEED
DYSTANS                 12
1 2 . 3 km              MAX DNIA
                       145
                        WYSOKOSC
                        2013m
```

- Hero: rozmiar 3 (24 px), `y=8`.
- DYSTANS: wartość rozmiar 2 (16 px), jednostka `km` rozmiarem 1 (bez spacji).
- Prawa kolumna: czas na górze (bez etykiety), przerwa, potem SPEED, MAX DNIA,
  WYSOKOSC (każda etykieta nad wartością).

### 3.2 Z trasą

```text
MAX ZJAZDU              14:23
 1 4 5                  SPD 12
DYSTANS                 MAX DNIA
1 2 . 3 km             145
                        WYSOKOSC
                        2013m
      (odstęp)
────────────────────────────────
1->Gai.gl
```

- Gdy `HudData.routeLine != nullptr` (trasa z PWA): hero maleje do rozmiaru 2,
  `SPEED` + wartość zwijają się do jednej linii `SPD n` (co daje odstęp nad
  dolną linią), a dolna linia (separator `y=55`, tekst `y=56`, font 1, `x=1`)
  pokazuje **kolejne odcinki od bieżącego**.
- Linię buduje `Szusownik.ino` przez `core::routeFormatLine(activeRoute, start, …)`.
  `start` = bieżący `segmentIndex`; przy chwilowym braku fixa zostaje ostatni
  znany odcinek (ekran nie migocze), a świeżo odebrana trasa bez fixa startuje od
  pierwszego odcinka.
- Etykiety łączone są ASCII `->`. `core::formatRouteLabel`: nazwy **≤ 6 znaków**
  bez zmian, **≥ 7** → pierwsze 3 + `.` + ostatnie 2 (np. `Gaislachkogl` →
  `Gai.gl`).
- Mieści się `SZ_HUD_ROUTE_CHARS` (21) znaków; nadmiar jest urywany w środku
  nazwy, bez wiszącego `->`.
- **Bez kierunków skrętów**: blob trasy (`protocol/route-v1.json`) niesie dla
  odcinka tylko etykietę, typ (`piste`/`lift`) i zakres dystansu. Strzałki
  kierunku wymagałyby rozszerzenia protokołu i PWA (poza zakresem).
- Bez trasy (`routeLine == nullptr`, także gdy `segmentCount == 0`) cały ekran to
  statystyki (§3.1).

### 3.3 Brak fixa

`NO FIX` zastępuje slot SPEED (pod czasem). Czas zostaje (ostatni znany),
wartości pokazują ostatni znany stan.

## 4. Wartości i formatowanie

| Pole | Źródło | Format | Uwagi |
| --- | --- | --- | --- |
| MAX ZJAZDU (hero) | `RunTracker::displayMaxKmh()` | `%d`, clamp 999 | live w zjeździe, zamrożony na wyciągu |
| DYSTANS | `totalKm` (haversine, od włączenia) | `%.1f` + `km` | jednostka bez spacji |
| czas | UTC z GNSS + `SZ_HUD_TZ_OFFSET_MIN` | `HH:MM` | brak UTC => `--:--` |
| SPEED | `gnss.speedKmh()` | `%d`, clamp 999 | zawsze bieżąca |
| MAX DNIA | `maxDayKmh` (od włączenia) | `%d`, clamp 999 | reset przy starcie |
| WYSOKOSC | `RunTracker::altitudeM()` (fuzja baro+GPS) | `%dm` | wygładzona, m n.p.m. |

Formatowanie liczb i czasu mieszka w czystym `src/core/hud_format.*` (testy
hostowe). Renderowanie pozycji jest w `src/hud/hud.cpp` (manualne).

## 5. Hero „max zjazdu" — port ZigZag z PWA

Hero to maksimum bieżącego zjazdu: **live** w trakcie schodzenia (trend
malejący albo jeszcze nierozpoznany), **zamrożone** na podejściu (wyciąg).
Dzięki temu na wyciągu widać wynik zjazdu, który dopiero co zakończyłeś.

Implementacja: `src/core/run_tracker.*` — strumieniowy port algorytmu z PWA
(`web/src/lib/runs.ts`):

1. **Filtr komplementarny wysokości** (baro daje kształt, GPS kotwiczy wartość
   absolutną; `SZ_RUN_ALT_TAU_S = 10 s`). Bez barometru (`altBaro = 0`) wynik
   zbiega do GPS.
2. **Średnia ruchoma MA5** na wysokości z fuzji.
3. **ZigZag z histerezą** `SZ_RUN_REVERSAL_M = 5 m`: śledzi trend (szczyt/dołek)
   i wykrywa zwroty. Dołek = koniec zjazdu (zamrożenie hero). Przerwa
   `>= SZ_RUN_MAX_GAP_MS (1 h)` to twarda granica (zjazd nie przechodzi przez
   lukę w danych).

Moduł jest czysty (bez `Arduino.h`), karmiony jedną próbką na epokę GNSS z
`millis()` jako czasem. Bez fixa stan jest zamrażany.

SSOT cięcia zjazdów pozostaje w PWA (`docs/wymagania-PWA.md` §6/§7, `AGENTS.md`
pkt 13). Port urządzeniowy używa tej samej reguły wysokościowej, żeby hero było
spójne z numeracją zjazdów w PWA.

## 6. Co usunięto z planu

- mapa i warstwy bitmapowe na Szusowniku (mapę ma osobny HudRekaw, `docs/hud-rekaw.md`);
- algorytm kolejności pikseli trasy i animowanych przerw;
- protokół małych pakietów HUD z DisplayTest (`M`/`R`, chunki);
- separator `x=87` i pusty panel mapy 40 px.

## 7. Testy

- Hostowe (Catch2): `firmware/test/host/test_run_tracker.cpp` (hero live/zamrożony,
  brak fixa, przerwa 1 h, wysokość z fuzji), `test_hud_format.cpp` (czas z
  offsetem, clampy, dystans/wysokość, skrót nazwy odcinka) i `test_route.cpp`
  (dekod bloba, indeks odcinka, dotarcie, linia kroków od bieżącego z urywaniem
  bez wiszącego `->`). Runner:
  `powershell -ExecutionPolicy Bypass -File firmware/test/host/run.ps1`.
- Render OLED, realny GNSS, baro i odczyt kątem oka — **manualne** (`docs/testy.md`).
- Testy akceptacyjne (manualne): brak fixa (`NO FIX` w slocie SPEED), czas
  `--:--` przed pierwszym fixem, hero zamrożony na wyciągu i live w zjeździe,
  dystans/wysokość po clampach, dolna linia trasy (kolejne odcinki od bieżącego).
