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

## Zasady pracy

1. Przed zmianą protokołu, layoutu OLED lub algorytmu routingu przeczytaj
   odpowiedni dokument referencyjny.
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
7. Wyniki testów, które nie były potwierdzone sprzętowo lub są znane tylko z
   implementacji testowej, oznaczaj jako niepotwierdzone.
8. Po zmianie decyzji technicznej aktualizuj dokument referencyjny oraz ten
   plik, jeśli zmiana wpływa na zasady pracy kolejnych sesji.

## Procedura wgrywania firmware (obowiązkowa)

Port: `COM7`. FQBN: `esp32:esp32:esp32s3:FlashSize=4M,PSRAM=enabled,USBMode=hwcdc,CDCOnBoot=cdc`.
Monitor szeregowy blokuje port, więc kolejność jest sztywna:

1. Zamknij monitor (jeśli działa — zajmuje `COM7` i upload się nie powiedzie).
2. Wgraj: `arduino-cli upload -p COM7 --fqbn "<FQBN>" firmware/Szusownik`
   (z katalogu repo; biblioteki: TinyGPSPlus, NimBLE, SSD1306, miniz vendored).
3. Od razu po wgraniu podepnij podgląd logów, żeby widać było start urządzenia.

Podgląd ręczny (interaktywny terminal): `monitor_COM7.cmd` w katalogu repo.

Podgląd z agenta (nieinteraktywny): `arduino-cli monitor` NIE działa bez TTY
(wychodzi natychmiast, log pusty) — zamiast tego jednorazowy zrzut przez
.NET SerialPort, wszystko w JEDNYM wywołaniu:

```powershell
$p = New-Object System.IO.Ports.SerialPort("COM7", 115200)
$p.ReadTimeout = 1000
$p.Open()
$t0 = Get-Date
while (((Get-Date) - $t0).TotalSeconds -lt 15) { try { $p.ReadLine() } catch { } }
$p.Close()
```

Uwagi: otwarcie portu zwykle resetuje ESP32-S3 (USB CDC), więc zrzut pokazuje
logi od bootu; każda komenda `bash` to osobny runspace — joby/processy w tle
(`Start-Job`, `Start-Process` z monitorem) nie przetrwają do kolejnego wywołania.

Nie odwracać kolejności (monitor → upload kończy się błędem zajętego portu).

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
