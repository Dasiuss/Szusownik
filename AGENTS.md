# Szusownik - kontekst projektu

Szusownik to docelowa aplikacja PWA + urządzenie ESP32-S3 do rejestrowania,
przesyłania i analizowania zjazdów narciarskich. Projekt korzysta z ustaleń
wypracowanych w trzech projektach testowych:

- `BleTest` - niezawodny transfer większych plików przez BLE.
- `DisplayTest` - lokalny HUD na OLED SSD1306 oraz bitmapowy protokół ekranu.
- `MapyTest` - wizualizacja tras narciarskich i lokalny routing.

## Dokumentacja referencyjna

- `docs/ustalenia-z-projektow-testowych.md` - architektura docelowa, wspólne decyzje,
  granice odpowiedzialności, ryzyka i plan integracji.
- `docs/ble-transfer.md` - szczegóły sprawdzonego transferu BLE, kompresji,
  okna ramek, ACK/NACK i zapisu po stronie PWA.
- `docs/hud-display.md` - OLED, layout, animacja trasy, pakiety bitmap i zasady
  synchronizacji firmware z podglądem PWA.
- `docs/mapy-routing.md` - źródła danych mapowych, warstwy MapLibre, graf tras,
  routing, koszt leksykograficzny i cache.
- `docs/koncepcja.md` - wizja produktu i zakres funkcjonalny.
- `docs/wymagania-ESP.md` - wymagania sprzętu i firmware.
- `docs/wymagania-PWA.md` - wymagania PWA, analiza zjazdów i widoki.
- `docs/jakosc-danych.md` - przepływ pól jakości GNSS, algorytm potwierdzania
  rekordów, miejsca implementacji i aktualny status weryfikacji.

## Zasady pracy

1. Przed zmianą protokołu, layoutu OLED, algorytmu routingu lub analizy jakości
   GNSS i rekordów prędkości przeczytaj odpowiedni dokument referencyjny.
2. Nie zmieniaj potwierdzonego profilu BLE `244 B / 240 B payload / 128 ramek /
   ACK co 32 / pacing 4 ms` bez osobnego benchmarku na rzeczywistym ESP32 i
   Androidzie.
3. Nie traktuj bufora aplikacyjnego ramek jako kolejki wewnętrznej NimBLE.
   Stabilność transferu wynika ze stałego pacingu, a nie z prób sterowania
   licznikiem mbufów.
4. Firmware zapisuje dane surowe. Ciężkie przetwarzanie, cięcie zjazdów,
   wygładzanie, map-matching i statystyki należą do PWA.
5. PWA i firmware muszą mieć identyczne definicje wspólnego protokołu,
   wymiarów bitmap, kolejności pikseli i wersji protokołu.
6. Pinout `Szusownik` ma pierwszeństwo przed pinoutem `DisplayTest`. W finalnym
   projekcie OLED używa I2C na GPIO8/GPIO9, bo GPIO1-4 są przeznaczone dla SD.
   Barometr BME280 (adres `0x77`) dzieli tę samą magistralę I2C.
7. Wyniki testów, które nie były potwierdzone sprzętowo lub są znane tylko z
   implementacji testowej, oznaczaj jako niepotwierdzone.
8. Po zmianie decyzji technicznej aktualizuj dokument referencyjny oraz ten
   plik, jeśli zmiana wpływa na zasady pracy kolejnych sesji.
9. Zapis próbki GPS na SD jest wyzwalany **nadejściem nowej epoki GNSS**
   (`Gnss::consumeNewSample()`), a nie zegarem pętli (`nextLog`). Nie wracaj do
   zapisu sterowanego osobnym interwałem `millis()` — powodował duplikaty i cichy
   hold pozycji przy dudnieniu z meas rate odbiornika. Szczegóły w
   `docs/wymagania-ESP.md`.
10. PWA **nie bramkuje funkcji po wersji firmware** (żadnych „To urządzenie wymaga
    firmware X+"). Dystrybucja zawsze dostarcza najnowszy FW. Bieżące ustawienia
    urządzenia PWA czyta wprost z INFO (odświeżanego po każdym `SET*`); komendy
    `GETVOL/GETFREQ/GETTIMING/GETMINBEEP` zostały usunięte z firmware. Nie
    przywracaj fallbacków wersji ani komend `GET*`.
11. Nie sprawdzaj statusu GitHub Actions po wypchnięciu na repo. Build weryfikuje
    sam użytkownik i zgłasza, jeśli coś się nie powiodło.
12. Nie wkładaj pełnej listy plików do INFO. Wartość atrybutu ATT ma limit 512 B
    (Web Bluetooth nie odczyta więcej), a przekroczenie zeruje ją w NimBLE —
    PWA dostaje 0 B. INFO niesie tylko `fileCount` i ustawienia; metadane plików
    pobiera się komendą `FILE:<i>` (STATUS `file <nazwa> <rozmiar>`). Szczegóły w
    `docs/ble-transfer.md` §10.

## Procedura wgrywania firmware (obowiązkowa)

Port: `COM7`. FQBN: `esp32:esp32:esp32s3:FlashSize=4M,PSRAM=enabled,USBMode=hwcdc,CDCOnBoot=cdc`.
Monitor szeregowy blokuje port, więc kolejność jest sztywna:

1. Zamknij monitor (jeśli działa — zajmuje `COM7` i upload się nie powiedzie):
   `taskkill /F /IM arduino-cli.exe`.
2. Wgraj: `arduino-cli upload -p COM7 --fqbn "<FQBN>" firmware/Szusownik`
   (z katalogu repo; biblioteki: TinyGPSPlus, NimBLE, SSD1306, miniz vendored).
3. Od razu po wgraniu odpal monitor w osobnym oknie przez `monitor_COM7.cmd`
   z katalogu repo (nie blokuje wywołania):
   `Start-Process -FilePath "<repo>\monitor_COM7.cmd"`
   żeby widać było logi od startu urządzenia.

Uwagi: `arduino-cli monitor` odpalone przez agenta w tle (bez TTY) wychodzi
natychmiast z pustym logiem — dlatego używamy `monitor_COM7.cmd`, który działa
poprawnie. Joby/processy w tle (`Start-Job`, `Start-Process` z samym monitorem)
nie przetrwają do kolejnego wywołania `bash` — ale okno konsoli z `.cmd`
zostaje (osobny proces systemowy), więc logi są widoczne dla użytkownika.

Nie odwracać kolejności (monitor → upload kończy się błędem zajętego portu).

## Termika i monitoring (Health)

- ESP32-S3 **nie ma sprzętowego zabezpieczenia termicznego** — sam się nie
  wyłączy przy przegrzaniu. Ochrona jest programowa: moduł `src/health/`
  (`Health`) wołany z głównej pętli (`millis`, bez tasków/ISR).
- Co 30 s (`SZ_HEALTH_CHECK_MS`) czyta `temperatureRead()` (temperatura
  **rdzenia/die**, nie otoczenia; słabo skalibrowana). ≥95 °C po 3 kolejnych
  potwierdzeniach → alarm buzzerem 3 s przy każdym kolejnym odczycie ≥95 °C;
  ≥100 °C → zamknięcie SD, ekran „PRZEGRZANIE" (die/air), alarm i deep sleep.
  Progi/histereza w `config.h` (`SZ_HEALTH_*`).
- Diagnostyka na Serial: linia STATUS co 2 s z `die=..C air=..C`.
- Deep sleep **nie odcina 3V3** — GNSS dalej pobiera ~30 mA i dogrzewa. Na
  stoku nieistotne; przy testach w domu nie trzymać szczelnej obudowy.

## Aktualne ograniczenia odziedziczone z testów

- `BleTest` nie ma jeszcze pełnego testu wszystkich MTU ani kontrolowanej utraty
  ramek.
- `BLECharacteristic::notify()` nie zwraca wiarygodnego statusu przyjęcia przez
  NimBLE.
- `DisplayTest` używa małych pakietów bitmap bez CRC, ACK i retry.
- `MapyTest` nie ma jeszcze GPS, nagrywania śladu ani map-matchingu.
- Routing MapyTest działa synchronicznie w głównym wątku i używa prostego sortowania
  kolejki Dijkstry.

Te ograniczenia są opisane szerzej w dokumentach `docs/ble-transfer.md`,
`docs/hud-display.md` i `docs/mapy-routing.md`.
