# HudRekaw — odbiornik HUD (ESP8266 + ST7789)

Drugie urządzenie obok Szusownika: dostaje przez ESP-NOW pozycję i statystyki,
rysuje mapę z bieżącą pozycją albo ekran statystyk. Nie zapisuje danych i nie
pobiera plików — to wyłącznie wyświetlacz.

> Projekt powstał przez przeniesienie projektu testowego DisplayTest
> (`hud_receiver`) do tego repo jako rozwiązanie docelowe. DisplayTest zostaje
> jako archiwum i nie jest dalej rozwijany.

> **Status sprzętowy: zmiany protokołu ESP-NOW (unicast, parowanie
> `'P'`/`'Q'`, potwierdzenie trasy `'K'`, okna radia z backoffem) NIE zostały
> jeszcze potwierdzone na sprzęcie** — brak testu na realnym ESP32-S3 + ESP8266.
> Niepotwierdzone jest m.in. to, czy ESP8266 odbiera niezaszyfrowany unicast bez
> dodania nadawcy do listy peerów (wg dokumentacji ESP-NOW tak, ale nie
> zweryfikowano tego na sprzęcie).

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

- Oba radia pracują na **kanale `HUD_LINK_CHANNEL` (1)**. Pakiety `'S'`
  (telemetria), `'L'` (pozycja + tryb), `'R'` (chunk trasy) i `'K'`
  (potwierdzenie trasy) idą **unicastem** do MAC-a Huda zapisanego w NVS
  Szusownika. **`'P'` (prośba o parowanie) jest jedynym broadcastem** i leci
  wyłącznie w trybie parowania.
- Radio Szusownika jest **domyślnie wyłączone** (oszczędzanie SoC). Szusownik
  otwiera je na krótkie okno tylko na czas wysyłki zaległych pakietów i gasi po
  sprzętowym ACK-u unicastu (albo po marginesie `HUD_TX_ACK_GRACE_MS`).
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

### Pakiet `'S'` (telemetria) — 14 B, Szusownik -> HudRekaw, unicast

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
| 13 | segmentIndex uint8: bieżący odcinek trasy, `HUD_SEGMENT_NONE` = brak |

**TOT jest w jednostkach `km × HUD_TOT_SCALE` (×10)**, czyli km z jednym
miejscem po przecinku (np. `1234` → `123.4 km`). Odbiornik formatuje to przez
`hudFormatTenthsKm` (`src/core/hud_format`).

### Pakiet `'L'` (pozycja + tryb) — 17 B, Szusownik -> HudRekaw, unicast

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
| 16 | segmentIndex uint8: bieżący odcinek trasy, `HUD_SEGMENT_NONE` = brak |

Tryb ekranu odbiornik poznaje **wyłącznie z pakietu `'L'`** (pozycja + tryb), z bajtu `mode`.

### Pakiet `'P'` (prośba o parowanie) — 2 B, Szusownik -> broadcast

| Bajt | Znaczenie |
| --- | --- |
| 0 | `P` |
| 1 | sekwencja uint8 |

Jedyny pakiet nadawany **broadcastem** i tylko w trybie parowania (gdy Szusownik
nie zna MAC-a Huda).

### Pakiet `'Q'` (odpowiedź na parowanie) — 2 B, HudRekaw -> Szusownik, unicast

| Bajt | Znaczenie |
| --- | --- |
| 0 | `Q` |
| 1 | sekwencja uint8 |

MAC Huda Szusownik bierze z metadanych ESP-NOW (adres nadawcy ramki), nie z
treści pakietu.

### Pakiet `'K'` (potwierdzenie trasy) — 8 B, HudRekaw -> Szusownik, unicast

| Bajt | Znaczenie |
| --- | --- |
| 0 | `K` |
| 1 | sekwencja uint8 |
| 2..5 | routeCrc uint32 LE (CRC32 trzymanego bloba) |
| 6 | flagi: bit0 = ma trasę |
| 7 | zarezerwowane (0) |

Wysyłany po złożeniu i walidacji całej trasy oraz **od razu po tym, jak Hud
uzna się za sparowanego** (żeby Szusownik poznał, jaką trasę Hud trzyma — po
restarcie Huda jest pusta). Zastąpił dawny heartbeat `'H'`: obecność Huda
wykrywa teraz sprzętowy ACK ESP-NOW dla unicastu.

### Pakiet `'R'` (chunk trasy) — 10 B nagłówka + do 200 B, Szusownik -> HudRekaw, unicast

| Bajt | Znaczenie |
| --- | --- |
| 0 | `R` |
| 1 | sekwencja uint8 |
| 2 | chunkIndex uint8 (0..chunkCount-1) |
| 3 | chunkCount uint8 |
| 4..5 | totalLen uint16 LE (długość bloba) |
| 6..9 | routeCrc uint32 LE (CRC32 całego bloba) |
| 10.. | payload (do `HUD_ROUTE_CHUNK_BYTES` = 200 B) |

Szusownik dzieli blob trasy (SSOT `protocol/route-v1.json`) na chunki i wysyła je
tylko, gdy odbiornik jest dostępny (niedawny ACK) i zgłasza inną wersję
(`routeCrc`). HudRekaw składa chunki, waliduje CRC całości, zapamiętuje trasę w
RAM i odpowiada pakietem `'K'` (potwierdzenie trasy). Pusty blob (pointCount=0) =
CLEAR.

Bez potwierdzenia Szusownik ponawia wysyłkę **rzadko, nie non-stop**: jedno okno
(burst = do `HUD_ROUTE_MAX_CYCLES` cykli chunków) startuje co najwyżej raz na
`SZ_HUD_ROUTE_RESEND_MS` (**9 s**), a nowa trasa (`setRoute`) wysyła się od razu,
z pominięciem progu. Każdy chunk czeka na sprzętowy ACK najwyżej
`HUD_ROUTE_CHUNK_ACK_TIMEOUT_MS` (250 ms); jego brak przerywa transfer. Po
wysłaniu całego burstu Szusownik czeka na `'K'` (potwierdzenie trasy) przez
`HUD_ROUTE_CONFIRM_TIMEOUT_MS` (1 s) i w razie braku powtarza cykl (do
`HUD_ROUTE_MAX_CYCLES` = 3). Bramką potwierdzenia jest zgodność `routeCrc` z CRC
trzymanego bloba; tożsamością jest sam CRC32, także dla pustej trasy (CLEAR):
flaga `hasRoute` jest dla niej fałszywa, więc **nie** bramkuje potwierdzenia.
`'K'` liczy się tylko od **sparowanego** Huda (porównanie MAC-a nadawcy), więc po
przypisaniu innego odbiornika stary CRC nie zablokuje wysyłki.

Podmiana trasy w trakcie wysyłki (`setRoute`, np. na krótszą albo CLEAR) przerywa
bieżący burst i przelicza liczbę chunków — dalej leci już nowy blob, a długość
chunku jest zawsze brana z aktualnej trasy (żadnego odczytu poza bloba).

### Parowanie (z PWA)

W PWA (Ustawienia → „HUD (HudRekaw)") jest przycisk **„Paruj"**. PWA wysyła do
Szusownika komendę CTRL `PAIR`; Szusownik czyści zapisany MAC w NVS i przez
`HUD_PAIR_COLLECT_MS` (0,6 s) nadaje `'P'` (prośba o parowanie) co
`HUD_PAIR_REQ_MS` (200 ms), zbierając odpowiedzi `'Q'` (odpowiedź na parowanie),
deduplikowane po MAC nadawcy. Wynik jest raportowany do PWA przez STATUS:

- dokładnie jeden -> MAC zapisany w NVS i natychmiastowy unicast (żeby Hud
  oznaczył się jako sparowany), STATUS `paired <MAC>`,
- zero -> STATUS `err:pair-none`,
- więcej niż jeden -> nie parujemy, STATUS `err:pair-multi`.

Szusownik od razu po odebraniu `PAIR` ustawia STATUS `pair wait` (początek
parowania), a MAC trafia do INFO (`peerMac`) **przed** STATUS-em wyniku — PWA
czyta INFO zaraz po STATUS-ie, więc przy odwrotnej kolejności pokazałaby stary
`peerMac`. PWA uznaje wynik dopiero, gdy STATUS różni się od tego sprzed
parowania (dzięki temu powtórne „Paruj" nie zwraca poprzedniego wyniku), a
przycisk jest zablokowany, gdy trwa transfer pliku. W trakcie transferu firmware
odpowiada `err:busy` — wtedy radio HUD jest zamknięte (transfer ma priorytet), a
parowanie wykonałoby się dopiero po nim. W NVS Szusownika jest zawsze najwyżej
jeden MAC.

HudRekaw **nie trzyma MAC-a w NVS**: po starcie jest niesparowany i uznaje się za
sparowanego, gdy dostanie od Szusownika pakiet inny niż `'P'` (prośba o
parowanie), czyli unicast `'S'` (telemetria), `'L'` (pozycja + tryb) lub `'R'`
(chunk trasy) — zapamiętując wtedy nadawcę w RAM i **od razu wysyłając `'K'`
(potwierdzenie trasy)** ze swoim aktualnym stanem trasy. Na `'P'` (prośba o
parowanie) odpowiada `'Q'` (odpowiedź na parowanie), gdy jest niesparowany
**albo** gdy `'P'` (prośba o parowanie) przyszło od jego Szusownika — to pozwala
sparować ponownie po wyczyszczeniu MAC-a w Szusowniku bez restartu Huda, a obcy
Szusownik nadal nie przejmie Huda. Reguła jest czystą funkcją
`hudShouldAnswerPair()` w `src/core/hud_packet`.

## 4. Reguła trybu i częstotliwość wysyłki

Szusownik wybiera tryb po własnej prędkości:

- `speed > HUD_STATS_ABOVE_KMH (30 km/h)` → **statystyki**,
- `speed <= HUD_STATS_ABOVE_KMH (30 km/h)` (w tym postój) → **mapa**.

Wysyłka jest zależna od trybu (żadnych zbędnych pakietów):

| Tryb | Pakiety okresowe |
| --- | --- |
| statystyki | `'S'` (telemetria) co `HUD_SEND_TELEMETRY_MS` (1 s) |
| mapa | `'L'` (pozycja + tryb) co `HUD_SEND_LOCATION_MS` (5 s), tylko gdy jest pozycja |

**Zmiana trybu** wysyła natychmiast jeden `'L'` (pozycja + tryb) z nowym `mode`
(także przy wejściu w statystyki), bo tylko `'L'` (pozycja + tryb) niesie tryb. W
mapie pozycją jest ostatnia znana (żeby ekran nie gasł przy chwilowej utracie
fixa).

### Okna radia i backoff

Radio Szusownika jest **domyślnie wyłączone** — używamy wariantu „light"
(`esp_wifi_stop()` / `esp_wifi_start()`): sterownik WiFi zostaje zainicjowany,
gaśnie tylko PHY. Zmierzony koszt przełączenia na realnym ESP32-S3 to ~1,45 ms
(OFF) + ~2,73 ms (ON) ≈ 4,2 ms na cykl, bez wycieków heapy. Szusownik otwiera
radio tylko na czas wysyłki i gasi je po sprzętowym ACK-u unicastu (albo po
`HUD_TX_ACK_GRACE_MS` jako margines).

- Okres okien zależy od trybu: w statystykach `'S'` (telemetria) co
  `HUD_SEND_TELEMETRY_MS` (1 s), w mapie `'L'` (pozycja + tryb) co
  `HUD_SEND_LOCATION_MS` (5 s).
- Gdy łącze **nie jest potwierdzone** (brak niedawnego ACK), Szusownik nadaje nie
  częściej niż `HUD_SEND_BACKOFF_MS` (3 s).
- Obecność Huda wykrywamy **wyłącznie po sprzętowym ACK-u ESP-NOW** dla unicastu
  (send callback, `ESP_NOW_SEND_SUCCESS`). Łącze uznajemy za aktualne, gdy ACK
  był w ciągu `HUD_LINK_TIMEOUT_MS` (11 s).

Pola realne: speed, TOT, MAX (max dnia), navAngle (kurs), lat/lon/heading.
Pola stałe na razie: REM `0`, zoom `HUD_LOCATION_ZOOM` (1), fisheye
`HUD_FISHEYE` (220).

### Zdarzenia z callbacków ESP-NOW (synchronizacja)

Callback odbioru i wysyłki ESP-NOW działają w tasku WiFi, obok pętli głównej.
Zamiast dzielić z nimi stan, Szusownik **przekazuje zdarzenia do pętli głównej**:

- odbiór (`'Q'` — odpowiedź na parowanie, `'K'` — potwierdzenie trasy) trafia do
  małego pierścienia (`HudLink::rxQ_`, 8 slotów) chronionego spinlockiem
  (`portMUX_TYPE`); licznik odpowiedzi na `'P'` (prośba o parowanie) i stan
  potwierdzenia trasy zmienia wyłącznie `tick()`, po opróżnieniu pierścienia.
  Spóźniona odpowiedź `'Q'` poza oknem parowania jest ignorowana.
- z callbacku wysyłki pętla czyta tylko licznik wysyłek i znacznik błędu
  (akcesory pod tym samym spinlockiem) oraz czas ostatniego ACK-a.

`volatile` samo nie synchronizuje między rdzeniami, więc wszystkie wspólne pola
przechodzą przez sekcję krytyczną albo przez pierścień zdarzeń.

Znacznik czasu dla `tick()` bierzemy **na miejscu wywołania** (świeży `millis()`),
bo od początku `loop()` do `tick()` może wystąpić blokujący skan katalogu SD
(`refreshInfo` po wyczyszczeniu MAC-a przy parowaniu). Ze starym czasem okno
zbierania odpowiedzi na `'P'` startowałoby z przeszłości i domykało się po
pierwszej prośbie.

### Współistnienie z BLE

WiFi/ESP-NOW dzieli radio z BLE. W trakcie transferu pliku (`BleFiles::busy()`)
Szusownik **zamyka radio** i wstrzymuje wysyłkę ESP-NOW, żeby nie zabierać pasma
sprawdzonemu profilowi BLE (`docs/ble-transfer.md`). Po zakończeniu transferu
wznawia od razu (bez czekania na koniec okresu).

## 5. Mapa

Odbiornik trzyma całą mapę w flash: `firmware/HudRekaw/src/map/map_data.h`
(generowany — nie edytować ręcznie). Generuje go `scripts/build-map.mjs` z
danych OpenStreetMap (Overpass) i waliduje kierunek tras przez Open-Meteo:

```powershell
node scripts/build-map.mjs                      # profil solden (domyślny)
node scripts/build-map.mjs --profile wroclaw    # profil Wrocław (testy)
node scripts/build-map.mjs --refresh            # ponowne pobranie z Overpass
```

Cache danych i raport kierunków lądują w `scripts/data/`.

Profil `solden` używa **tego samego obszaru i tego samego wycinka OSM co PWA**
(bbox `10.905, 46.886957, 11.028039, 46.999242`, źródło
`scripts/data/overpass-pwa.json`). Dzięki temu HUD ma te same trasy i wyciągi
co aplikacja — wcześniej korzystał z osobnego cache z mniejszym bboxem i gubił
południowo-zachodnią część ośrodka. Elementy spoza obszaru są odsiewane przy
generowaniu, a statusy `proposed`/`construction`/`disused` pomijane. Mapa jest rysowana
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
(i szumie GNSS) ekran nie miga — tryb mapy jest aktywny do `HUD_STATS_ABOVE_KMH`
(30 km/h).
Logika progu jest czysta (`mapShouldRedraw` w `src/core/map_math`) i pokryta
testami hostowymi (`firmware/test/host/hudrekaw/test_map_math.cpp`).

W repo jest zbudowany profil **Wrocław** (2818 punktów, 1156 dróg). `build-map.mjs`
domyślnie buduje jednak profil `solden`, więc do wgrania mapy Wrocław trzeba
jawnie podać `--profile wroclaw`.

Bufor kandydatów labeli (`gLabelCandidates`) jest **statyczny** — nigdy lokalny.
ESP8266 ma tylko 4 KB stosu zadania `loop()` (`CONT_STACKSIZE`), a tablica
`MAP_MAX_CANDIDATES` (220 × ~20 B ≈ 4,4 KB) na stosie przepełnia go i resetuje
urządzenie przy pierwszej ramce `'L'` (pozycja + tryb) (objaw: mapa mignie i wraca ekran statystyk,
a podgląd pokazuje `last packet: never`).

### Tryb nawigacji (trasa na mapie)

Gdy Szusownik przekazał trasę (pakiety `'R'` — chunk trasy), odbiornik rysuje ją **na wierzchu**
mapy jako grubą jasnofioletową linię (`COLOR_ROUTE`, grubość
`ROUTE_LINE_THICKNESS`), bez zmiany
obecnej orientacji mapy (nadal wg najbliższej trasy zjazdowej). Punkty trasy są w
metrach względem origin trasy; odbiornik przesuwa je do układu własnej mapy
(`MAP_ORIGIN_*`) i przepuszcza przez tę samą projekcję „rybiego oka".

Na dole ekranu pojawiają się **bieżący + 2 następne odcinki trasy**
(`HUD_SEGMENTS_SHOWN`), z bieżącym w kolorze trasy. `segmentIndex` przychodzi z
pakietów `'S'` (telemetria) i `'L'` (pozycja + tryb) (liczy go Szusownik z GNSS),
więc lista działa zarówno na
mapie (≤30 km/h), jak i na ekranie statystyk (>30 km/h). Ekran statystyk przy
aktywnej trasie rezerwuje dolny pas: wiersz `TOT` przesuwa się wyżej, a nazwy
odcinków zajmują dolną krawędź. Trasa trzymana jest **tylko w RAM** (brak zapisu
we flashu). Po restarcie odbiornik ma pustą trasę i nie zna jeszcze Szusownika;
gdy Szusownik przypisze go unicastem, Hud od razu zgłasza pakietem `'K'`
(potwierdzenie trasy) swój aktualny stan (pusty blob), więc CRC się nie zgadza
i Szusownik dosyła trasę ponownie. Potwierdzeniem dostarczenia jest jawny pakiet
`'K'` (potwierdzenie trasy) — patrz §3 — a nie heartbeat.
Zmiana trasy wymusza przerysowanie mapy (`routeCrc` w martwej strefie)
i unieważnienie layoutu statystyk.

Nazwy odcinków trasy i nazwy wgrane w mapę flash są czystym ASCII. Zarówno PWA
(`routeTransfer.ts`), jak i generator mapy (`scripts/build-map.mjs`) korzystają
ze wspólnej transliteracji `web/src/lib/asciiFold.mjs`: niemieckie `ä/ö/ü`→`a/o/u`,
`ß`→`ss`, polskie `ł`→`l` i pokrewne. Bez tego znaki bez rozkładu NFD (np. `ß`,
`ł`) byłyby po prostu wyrzucane, a oba wyświetlacze mają czcionki tylko ASCII.

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
- `src/core/` — czysta logika bez Arduino (dekodowanie pakietów, reguła
  parowania `hudShouldAnswerPair`, matematyka
  mapy, format TOT); pokryta testami hostowymi.
- `src/display/` — ST7789: layout statystyk (przyrostowo) i rysowanie mapy.
- `src/link/` — hybryda WiFi + odbiór ESP-NOW + stan łącza.
- `src/web/` — serwer HTTP, ArduinoOTA, `/update`.
- `src/map/map_data.h` — wygenerowana mapa.

## 8. Testy

- Hostowe (Catch2): `firmware/test/host/hudrekaw/test_*.cpp` —
  `powershell -ExecutionPolicy Bypass -File firmware/test/host/run.ps1`
  (buduje też testy Szusownika). Reguła parowania Huda
  (`hudShouldAnswerPair`) ma test w `test_hud_packet.cpp`.
- Kontrakt protokołu: `web/src/lib/hudProtocol.test.ts` (`npm test` w `web/`).
- Render, realne ESP-NOW, WiFi i OTA pozostają manualne (`docs/testy.md`).

## 9. Ograniczenia

- Telemetria `'S'` i pozycja `'L'` to pojedynczy unicast potwierdzony tylko
  sprzętowym ACK-iem link-layer (bez retransmisji na poziomie aplikacji) —
  kolejny pakiet i tak nadchodzi w następnym okresie, więc brak ACK nie zatrzymuje
  nadawania (łącze przechodzi tylko w backoff `HUD_SEND_BACKOFF_MS`). Trasa `'R'`
  ma mocniejszą ochronę: chunki z indeksem i CRC całości, a potwierdzeniem
  dostarczenia jest jawny pakiet `'K'` z CRC trzymanego bloba (ponawianie w
  oknach, max `HUD_ROUTE_MAX_CYCLES` cykli; sam CRC32 — obejmuje też CLEAR).
- Utrata fixa w trybie mapy nie czyści ekranu — rysowana jest ostatnia pozycja.
- Przy połączeniu z routerem HudRekaw zmienia kanał i traci łączność z
  Szusownikiem (kanał 1). Docelowo oba urządzenia są poza zasięgiem routera.
- Nazwa pola `average` nadal odpowiada etykiecie `MAX` (spadek z DisplayTest).
