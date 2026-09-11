# Szusownik - HUD i wyświetlacz OLED

> Źródło wiedzy: `DisplayTest/agents.md` oraz implementacje firmware i PWA.
> Status: algorytm renderowania i animacji jest referencyjny; protokół
> bitmapowy wymaga wzmocnienia przed użyciem produkcyjnym.

## 1. Zasada działania

```text
PWA: wartości telemetryczne + mapa + trasa
  -> pakiety BLE
ESP32: stan lokalny + bitmapy
  -> renderHud()
OLED SSD1306 128x64 przez I2C
```

ESP32 jest odpowiedzialne za finalny render. PWA ma podgląd i edytor, ale nie
przesyła pełnego framebufferu przy każdym odświeżeniu. Dzięki temu mały pakiet
telemetrii nie wymaga transferu 1024 bajtów bufora OLED.

## 2. Sprzęt i pinout

### Ustalenia DisplayTest

- Waveshare ESP32-S3-Zero.
- SSD1306 128x64.
- I2C `400 kHz`.
- adres OLED `0x3C`.
- w `DisplayTest`: SDA GPIO1, SCL GPIO2.

### Ważne dla Szusownika

Pinout finalnego urządzenia z `firmware/README.md` ma pierwszeństwo:

- OLED SDA: GPIO8;
- OLED SCL: GPIO9;
- SD używa GPIO1, GPIO2, GPIO3 i GPIO4.

Nie wolno kopiować pinów GPIO1/GPIO2 z `DisplayTest`, ponieważ kolidują z
magistralą microSD w Szusowniku. Algorytm renderingowy można przenieść, ale
inicjalizacja I2C musi używać finalnego pinoutu.

## 3. Layout 128x64

Najlepiej zachować rozdział na panel telemetryczny i mapę:

```text
x=0..86    telemetria
x=87       separator
x=88..127  mapa/trasa, 40 px szerokości
y=0..63    pełna wysokość mapy
```

Aktualny layout referencyjny firmware:

> Stan MVP1 (2026-09-11, `firmware/Szusownik/src/hud/`): zaimplementowane
> `SPD` / prędkość / `MAX` / max / `TOTAL` / total / separator.
> NIE zaimplementowane: `REM` + remaining, strzałka, panel mapy 40 px
> (prawa strona pusta). Wartości >999 clampowane do 999. Mapa, strzałka
> i REM — roadmapa. Pozycje zaimplementowanych elementów jak w tabeli.

| Element | Pozycja | Rozmiar | Uwagi |
| --- | --- | --- | --- |
| `SPD` | `(1, 0)` | 1 | etykieta prędkości |
| prędkość | `(1, 9)` | 3 | `%3u`, duży odczyt |
| `REM` | `(1, 37)` | 1 | etykieta wartości dolnej |
| remaining | `(1, 48)` | 2 | dochodzi do wiersza 63 |
| strzałka | środek `(69, 10)` | linie | 0 stopni wskazuje górę |
| `MAX` | `(62, 27)` | 1 | obecnie pole nazwane `average` |
| max/average | `(62, 35)` | 1 | `%3u` |
| `TOTAL` | `(50, 48)` | 1 | wyrównane prawą krawędzią z `MAX` |
| total | `(62, 56)` | 1 | dochodzi do wiersza 63 |
| separator | `x=87` | 1 px | oddziela mapę |

Font Adafruit GFX ma przy rozmiarze 1 przesuw o 6 px na znak. `MAX` ma trzy
znaki, a `TOTAL` pięć, więc `TOTAL` zaczyna się w `62 - (5 - 3) * 6 = 50`.
Wartości większe niż 999 mogą wyjść poza założony obszar i trzeba je obsłużyć
przed użyciem finalnym.

PWA canvas używa baseline, nie cursor origin Adafruit GFX. Podgląd nie jest
bitowo identyczny z OLED-em, więc współrzędne firmware są fizycznym źródłem
prawdy. Jeżeli zmieniamy layout, należy zmienić i przetestować oba renderery.

## 4. Warstwy bitmapowe

Mapa i trasa są niezależne:

| Parametr | Wartość |
| --- | ---: |
| szerokość | 40 px |
| wysokość | 64 px |
| bajty na wiersz | 5 |
| rozmiar bitmapy | 320 B |
| chunk BLE | 16 B |
| liczba chunków | 20 |

Kolejność renderowania (docelowa, z mapą i animacją):

1. wyczyść framebuffer;
2. narysuj telemetrię;
3. narysuj strzałkę;
4. narysuj separator;
5. narysuj mapę;
6. narysuj trasę;
7. narysuj czarne przerwy animacji trasy;
8. wykonaj pełne `display.display()`.

MVP1 renderuje tylko kroki 1–2 (SPD/MAX/TOTAL), 4 i 8.

Mapa i trasa są białe na fizycznym monochromatycznym OLED. PWA używa różnych
kolorów wyłącznie w celu ułatwienia edycji.

## 5. Animacja trasy

### Kolejność pikseli

Trasa nie jest grafem sąsiednich pikseli. Jest deterministyczną listą powstałą
przez skan:

1. wiersz `y=63`, kolumny `x=0..39` od lewej do prawej;
2. potem wiersze `y=62..0`;
3. dodawane są tylko ustawione piksele trasy.

To jest sweep od dołu do góry. Nie należy nazywać tego prawdziwym śledzeniem
ścieżki. Algorytm sąsiedztwa wymagałby osobnej polityki dla rozgałęzień, pętli,
przerw i odłączonych fragmentów.

### Przerwy

Stała długość jednej przerwy to 5 pikseli. Liczba przerw `K` zależy od liczby
aktywnych pikseli `N`:

| `N` | `K` |
| --- | ---: |
| `N <= 15` | 1 |
| `16..30` | 2 |
| `31..45` | 3 |
| `>45` | 4 |

Wszystkie przerwy używają jednego kursora `C`, a początek przerwy `i` wyznacza:

```text
gapStart(i) = (C + floor(i * N / K)) mod N
```

Następnie czernione są elementy:

```text
routeOrder[(gapStart(i) + offset) mod N]
offset = 0..4
```

Przerwy są równomierne względem postępu listy pikseli, nie względem ćwiartek
ekranu. Wspólny kursor zapobiega dryfowaniu osobnych timerów.

### Czas

- PWA: `28 ms` między krokami, około 35,7 kl./s.
- firmware: `ROUTE_STEP_MS = 28`.
- każda klatka zwiększa wspólny kursor o 1;
- kompletna aktualizacja bitmapy trasy zeruje kursor firmware;
- firmware renderuje, jeśli ekran jest dirty i minęło co najmniej 10 ms;
- OLED jest odświeżany pełnym buforem 1024 B.

PWA musi używać tej samej kolejności, progów, długości przerwy i wzoru. W
`DisplayTest` PWA nie zerowała własnego kursora przy każdej zmianie bitmapy,
więc faza PWA i OLED mogła się różnić. W Szusowniku trzeba albo zaakceptować
podgląd niezależny, albo dodać synchronizację fazy.

## 6. Protokół z DisplayTest (historyczny — NIE używać w Szusowniku)

> Decyzja 2026-09-11: Szusownik używa GATT v1 z `docs/ble-transfer.md` §10
> (UUID `3f9a…`, charakterystyki INFO/CTRL/DATA/STATUS). UUID `5f8a…`
> i pakiety poniżej to materiał referencyjny z testu. Zdalny podgląd/sterowanie
> HUD przez BLE — roadmapa (protokół małych pakietów do zaprojektowania
> wg `docs/ustalenia-z-projektow-testowych.md` §5).

Service:

```text
5f8a0001-4e56-4e46-9a7c-000000000001
```

Characteristic writable:

```text
5f8a0001-4e56-4e46-9a7c-000000000002
```

### Pakiet stanu, 13 B

| Bajt | Znaczenie |
| --- | --- |
| 0 | `S` / `0x53` |
| 1 | sekwencja uint8 |
| 2..3 | speed uint16 LE |
| 4..5 | angle int16 LE |
| 6..7 | average/MAX uint16 LE |
| 8..9 | remaining uint16 LE |
| 10..11 | total uint16 LE |
| 12 | marker `1` |

Firmware wymagało tylko długości co najmniej 12 bajtów, nie weryfikowało
markera, nie sprawdzało sekwencji i przyjmowało potencjalnie starszy pakiet.
To jest akceptowalne jako test edytora, ale nie jako finalny kontrakt.

### Pakiet bitmapy

| Bajt | Znaczenie |
| --- | --- |
| 0 | `M` mapa albo `R` trasa |
| 1 | sekwencja bitmapy |
| 2 | indeks chunka |
| 3 | liczba chunków |
| 4..19 | do 16 B danych |

Firmware zapisuje chunki do bufora tymczasowego i dopiero po formalnym
otrzymaniu wszystkich 20 kopiuje kompletną bitmapę do aktywnej warstwy.
Używana jest maska 32-bitowa. Transfer mapy i trasy jest niezależny.

Brakuje CRC, timeoutu transferu, ACK, retry i walidacji zawartości. W finalnym
Szusowniku należy dodać te elementy albo przesyłać stan HUD przez wspólny,
wersjonowany kanał z potwierdzeniem.

## 7. PWA i BLE małych pakietów

`DisplayTest` serializował zapisy przez łańcuch Promise:

- preferował `writeValueWithoutResponse`;
- miał fallback do `writeValueWithResponse`;
- dodawał 3 ms między zapisami;
- debounce bitmap wynosił 100 ms;
- `pointerup` wysyłał bitmapę natychmiast.

To chroniło przed równoległymi zapisami, ale szybkie wpisywanie telemetrii
mogło zbudować długą kolejkę. W Szusowniku należy coalescować stan: wysyłać
najnowszą wartość, a nie wszystkie historyczne wartości z kolejki.

## 8. Wydajność i ograniczenia

Każdy render firmware:

- czyści cały framebuffer;
- skanuje obszar bitmapy;
- liczy kolejność i przerwy trasy;
- wysyła pełne 1024 B przez I2C.

Przy 400 kHz pełne odświeżenie może być znaczącym kosztem. Jeżeli trwa dłużej
niż 28 ms, animacja zwolni. `DisplayTest` nie mierzył czasu renderowania, więc
trzeba go zmierzyć w finalnym hardware.

PWA tworzyła nową listę `routeOrder` w każdej klatce. Dla 40x64 jest to
akceptowalne, ale w wersji finalnej można policzyć listę ponownie tylko po
zmianie bitmapy, a w klatce zmieniać wyłącznie kursor.

## 9. Co przenieść do Szusownika

- fizyczny podział ekranu na telemetrię i 40x64 mapę;
- lokalny rendering na ESP32;
- dwie warstwy bitmapowe;
- wspólny algorytm kolejności pikseli i animowanych przerw;
- bufor tymczasowy i atomową podmianę kompletnej bitmapy;
- prosty, bezframeworkowy podgląd o natywnych wymiarach 128x64;
- 3 ms serializacji małych zapisów jako punkt startowy, ale po benchmarku.

## 10. Testy akceptacyjne HUD

- wartości 0, 1, 99, 999 i większe niż 999;
- kąt `-359`, `-1`, `0`, `1`, `359` i wartości poza zakresem;
- bitmapy puste, pełne, 1 piksel, 4 piksele i krótsze niż 5 pikseli;
- progi animacji dla `N=15,16,30,31,45,46`;
- brakujący chunk, duplikat chunku, zła sekwencja i niepełna bitmapa;
- jednoczesny zapis GNSS/SD, BLE i pełny refresh OLED;
- zgodność fazy animacji podglądu i urządzenia po aktualizacji trasy;
- pomiar czasu `display.display()` i rzeczywistej częstotliwości klatek.
