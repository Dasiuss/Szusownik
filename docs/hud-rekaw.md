# HudRekaw — odbiornik HUD (ESP8266 + ST7789)

Drugie urządzenie obok Szusownika: dostaje przez ESP-NOW pozycję i statystyki,
rysuje mapę z bieżącą pozycją albo ekran statystyk. Nie zapisuje danych i nie
pobiera plików — to wyłącznie wyświetlacz.

> Projekt powstał przez przeniesienie projektu testowego DisplayTest
> (`hud_receiver`) do tego repo jako rozwiązanie docelowe. DisplayTest zostaje
> jako archiwum i nie jest dalej rozwijany.

## 1. Sprzęt

- Moduł: **ESP-12F / NodeMCU ESP8266**, flash **4 MB**.
- Ekran: **ST7789 1,54" 240×240** po sprzętowym SPI.
- Wyświetlacz GeekMagic SmallTV / SmallTV-Ultra.

| Sygnał | GPIO |
| --- | --- |
| MOSI | 13 |
| SCK | 14 |
| CS | — (zwarty do GND) |
| DC | 0 |
| RST | 2 |
| Podświetlenie (aktywne w stanie niskim) | 5 |

Podświetlenie jest włączane w `setup()` (`Display::begin`). Układ pinów jest w
`firmware/HudRekaw/src/config/config.h`.

## 2. Łączność (ESP-NOW + WiFi)

ESP-NOW nie ma asocjacji — oba radia muszą być na tym samym kanale. Schemat:

- Szusownik zawsze nadaje na **kanale `HUD_LINK_CHANNEL` (1)**, broadcast.
- HudRekaw próbuje sieci z `secrets.h`. Gdy żadnej nie ma w zasięgu, wiąże
  radio na `HUD_LINK_CHANNEL` (`wifi_set_channel`) i co 30 s ponawia skan.
- Gdy HudRekaw **połączy się z routerem**, przechodzi na kanał routera. Jeśli
  router nie nadaje na kanale 1, traci łączność z Szusownikiem (który zostaje na
  kanale 1). Router na kanale 1 (jak sieć testowa `Doas`) nie przeszkadza — oba
  radia zostają na tym samym kanale. W terenie dobieramy więc sieć na kanale 1
  albo nie trzymamy żadnej w zasięgu.
- SoftAP `HudRekaw` / `hudrekaw` służy tylko do programowania/OTA.

Sekrety (lista sieci, hasło OTA) są w `firmware/HudRekaw/secrets.h`
(gitignored). Szablon: `secrets.example.h`. Bez `secrets.h` firmware buduje się
z listą pustą i domyślnym hasłem OTA.

## 3. Protokół ESP-NOW

SSOT: `protocol/hud-espnow-v1.json`. Generator `scripts/gen-hud-protocol.mjs`
tworzy ten sam nagłówek do obu firmware:

- `firmware/Szusownik/src/config/hud_protocol.h` (nadajnik),
- `firmware/HudRekaw/src/config/hud_protocol.h` (odbiornik).

Zmiana protokołu: edytuj JSON, uruchom `node scripts/gen-hud-protocol.mjs`
(albo `npm run gen:hud-protocol` w `web/`). Test
`web/src/lib/hudProtocol.test.ts` pilnuje, że oba pliki są aktualne.

### Pakiet `S` — telemetria, 13 B

| Bajt | Znaczenie |
| --- | --- |
| 0 | `S` |
| 1 | sekwencja uint8 |
| 2..3 | speed uint16 LE [km/h] |
| 4..5 | navAngle int16 LE [°], −1 = nieznany |
| 6..7 | average/MAX uint16 LE [km/h] |
| 8..9 | remaining/REM uint16 LE (na razie stałe 0) |
| 10..11 | total/TOT uint16 LE |
| 12 | flagi: bit0 = frame |

**TOT jest w jednostkach `km × HUD_TOT_SCALE` (×10)**, czyli km z jednym
miejscem po przecinku (np. `1234` → `123.4 km`). Odbiornik formatuje to przez
`hudFormatTenthsKm` (`src/core/hud_format`).

### Pakiet `L` — pozycja, 16 B

| Bajt | Znaczenie |
| --- | --- |
| 0 | `L` |
| 1 | sekwencja uint8 |
| 2 | mode: 0 = statystyki, 1 = mapa |
| 3 | zoom (indeks 0..4) |
| 4..7 | lat int32 LE (stopnie × 1e7) |
| 8..11 | lon int32 LE (stopnie × 1e7) |
| 12..13 | heading int16 LE [°] |
| 14..15 | fisheye uint16 LE (klamp 100..500) |

Tryb ekranu odbiornik poznaje **wyłącznie z pakietu `L`** (bajt `mode`).

## 4. Reguła trybu i częstotliwość wysyłki

Szusownik wybiera tryb po własnej prędkości:

- `speed > HUD_STATS_ABOVE_KMH (5 km/h)` → **statystyki**,
- `speed <= 5 km/h` (w tym postój) → **mapa**.

Wysyłka jest zależna od trybu (żadnych zbędnych pakietów):

| Tryb | Pakiety okresowe |
| --- | --- |
| statystyki | `S` co `HUD_SEND_TELEMETRY_MS` (1 s) |
| mapa | `L` co `HUD_SEND_LOCATION_MS` (5 s), tylko gdy jest pozycja |

**Zmiana trybu** wysyła natychmiast jeden `L` z nowym `mode` (także przy
wejściu w statystyki), bo tylko `L` przenosi tryb. W mapie pozycją jest ostatnia
znana (żeby ekran nie gasł przy chwilowej utracie fixa).

Pola realne: speed, TOT, MAX (max dnia), navAngle (kurs), lat/lon/heading.
Pola stałe na razie: REM `0`, zoom `HUD_LOCATION_ZOOM` (1), fisheye
`HUD_FISHEYE` (220).

### Współistnienie z BLE

WiFi/ESP-NOW dzieli radio z BLE. W trakcie transferu pliku (`BleFiles::busy()`)
Szusownik **wstrzymuje** wysyłkę ESP-NOW, żeby nie zabierać pasma sprawdzonemu
profilowi BLE (`docs/ble-transfer.md`). Po zakończeniu transferu wysyłka wraca.

## 5. Mapa

Odbiornik trzyma całą mapę w flash: `firmware/HudRekaw/src/map/map_data.h`
(generowany — nie edytować ręcznie). Generuje go `scripts/build-map.mjs` z
danych OpenStreetMap (Overpass) i waliduje kierunek tras przez Open-Meteo:

```powershell
node scripts/build-map.mjs                      # profil solden (domyślny)
node scripts/build-map.mjs --profile wroclaw    # profil Wrocław (testy)
node scripts/build-map.mjs --refresh            # ponowne pobranie z Overpass
```

Cache danych i raport kierunków lądują w `scripts/data/`. Mapa jest rysowana
środkowo na rowerzyście z projekcją „rybiego oka"; przy profilu Wrocław nie ma
tras narciarskich, więc widok pozostaje zorientowany na północ.

Rysowanie jest pełnym przerysowaniem (żadnego dirty-rect — obrót i fisheye
zmieniają układ nieliniowo). Wszystkie polilinie lecą w **jednej transakcji
SPI** (`startWrite`/`endWrite` w `Display::drawMap`), a segmenty rysuje
niskopoziomowy `Display::drawMapLine` przez `writePixel()`. Uwaga: `drawLine`
z Adafruit_GFX sam otwiera i zamyka transakcję na segment, więc nie da się go
użyć wewnątrz wspólnej transakcji. Bez zmiany wyglądu.

Przerysowanie ma **martwą strefę**: odpala się dopiero, gdy rower przesunął się
o `MAP_REDRAW_MOVE_M` (5 m) względem **ostatnio narysowanej** pozycji albo kurs
zmienił się o `MAP_REDRAW_BEARING_DEG` (8°, z zawijaniem 0/360). Zmiana trybu,
zoomu lub fisheye wymusza rysunek niezależnie od progu. Dzięki temu przy postoju
(i szumie GNSS) ekran nie miga — tryb mapy jest aktywny tylko ≤5 km/h.
Logika progu jest czysta (`mapShouldRedraw` w `src/core/map_math`) i pokryta
testami hostowymi (`firmware/test/host/hudrekaw/test_map_math.cpp`).

W repo jest zbudowany profil **Wrocław** (2818 punktów, 1156 dróg). `build-map.mjs`
domyślnie buduje jednak profil `solden`, więc do wgrania mapy Wrocław trzeba
jawnie podać `--profile wroclaw`.

Bufor kandydatów labeli (`gLabelCandidates`) jest **statyczny** — nigdy lokalny.
ESP8266 ma tylko 4 KB stosu zadania `loop()` (`CONT_STACKSIZE`), a tablica
`MAP_MAX_CANDIDATES` (220 × ~20 B ≈ 4,4 KB) na stosie przepełnia go i resetuje
urządzenie przy pierwszej ramce `L` (objaw: mapa mignie i wraca ekran statystyk,
a podgląd pokazuje `last packet: never`).

## 6. Budowanie i wgrywanie

```powershell
# kompilacja
arduino-cli compile --fqbn "esp8266:esp8266:nodemcuv2:eesz=4M1M" firmware/HudRekaw

# wgranie po kablu
arduino-cli upload -p COMx --fqbn "esp8266:esp8266:nodemcuv2:eesz=4M1M" firmware/HudRekaw

# albo OTA (po WiFi, hasło z secrets.h, użytkownik admin)
arduino-cli upload -p <ip> --fqbn "esp8266:esp8266:nodemcuv2:eesz=4M1M" --upload-field password=<OTA_PASSWORD> firmware/HudRekaw

# UWAGA: espota bywa zawodne — po "Authenticating...OK" kończy się
# "No response from device". Niezawodnie działa wgranie przez HTTP /update:
arduino-cli compile --fqbn "esp8266:esp8266:nodemcuv2:eesz=4M1M" --output-dir build/hudrekaw firmware/HudRekaw
curl -u admin:<OTA_PASSWORD> -F "firmware=@build/hudrekaw/HudRekaw.ino.bin" http://<ip>/update
```

Biblioteki: `Adafruit GFX`, `Adafruit ST7735 and ST7789`, `ESP8266WiFi`,
`ESP8266WebServer`, `ESP8266HTTPUpdateServer`, `ESP8266mDNS`, `ArduinoOTA`
(część core ESP8266). Odbiornik ma też podgląd stanu pod `http://<ip>/` oraz
`/update`.

## 7. Struktura modułów

- `src/config/` — piny, kolory, stałe, `hud_protocol.h` (generowany).
- `src/core/` — czysta logika bez Arduino (dekodowanie pakietów, matematyka
  mapy, format TOT); pokryta testami hostowymi.
- `src/display/` — ST7789: layout statystyk (przyrostowo) i rysowanie mapy.
- `src/link/` — hybryda WiFi + odbiór ESP-NOW + stan łącza.
- `src/web/` — serwer HTTP, ArduinoOTA, `/update`.
- `src/map/map_data.h` — wygenerowana mapa.

## 8. Testy

- Hostowe (Catch2): `firmware/test/host/hudrekaw/test_*.cpp` —
  `powershell -ExecutionPolicy Bypass -File firmware/test/host/run.ps1`
  (buduje też testy Szusownika).
- Kontrakt protokołu: `web/src/lib/hudProtocol.test.ts` (`npm test` w `web/`).
- Render, realne ESP-NOW, WiFi i OTA pozostają manualne (`docs/testy.md`).

## 9. Ograniczenia

- Brak potwierdzeń/retry na ESP-NOW — pojedynczy, niepotwierdzony broadcast
  (jak w DisplayTest). Kolejny pakiet i tak nadchodzi w następnym okresie.
- Utrata fixa w trybie mapy nie czyści ekranu — rysowana jest ostatnia pozycja.
- Przy połączeniu z routerem HudRekaw zmienia kanał i traci łączność z
  Szusownikiem (kanał 1). Docelowo oba urządzenia są poza zasięgiem routera.
- Nazwa pola `average` nadal odpowiada etykiecie `MAX` (spadek z DisplayTest).
