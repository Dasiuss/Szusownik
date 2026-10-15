# Wymagania ESP32 (urządzenie)

> Status: **MVP1 zaimplementowane i przetestowane sprzętowo 2026-09-11**
> (`firmware/Szusownik/`, arduino-cli). Dokument żywy — niżej co jest,
> a co w roadmapie.
> Data: 2026-08-18

## 1. Cel

Urządzenie (ESP32-S3) zbiera dane GPS (później IMU), daje feedback dźwiękowy (buzzer),
zapisuje surowe CSV na microSD i przesyła dane do PWA przez BLE.

## 2. Zbieranie danych

- **GPS (u-blox, ≥10 Hz)** po UART: pozycja, prędkość (Doppler), wysokość, heading, czas UTC.
- **Adaptacyjne próbkowanie** (tabela + histereza ±3 km/h, patrz `docs/koncepcja.md`).
- **Wyzwalacz zapisu = próbka, nie zegar pętli.** Wiersz CSV powstaje na nadejście
  nowej epoki GNSS (commit RMC, `Gnss::consumeNewSample()`), z bramką `hasFix()`.
  Gwarantuje to `1 wiersz = 1 pomiar` i eliminuje duplikaty oraz cichy hold pozycji,
  które dawał osobny zegar `nextLog` przy dudnieniu z meas rate odbiornika. Tempo
  zapisu podąża za faktycznym wyjściem modułu (0,5–10 Hz); jeśli w jednym przebiegu
  `poll()` dotrze kilka epok, zapisana zostanie tylko ostatnia (bez fabrykowania danych).
- **IMU** — na roadmapę (moduł pomiarowy wydzielony w kodzie, stabilny interfejs).
- Zapis **surowych** danych (bez filtrowania) na SD — pełna wierność do analizy i FIT.

## 3. Gdzie filtrowanie (podział odpowiedzialności)

| Miejsce | Co się dzieje |
|---------|---------------|
| **Urządzenie → SD** | zapis **surowy**, bez filtrowania |
| **Urządzenie → beeper** | prędkość z Dopplera (już gładka), opcjonalnie lekkie wygładzenie (MA okno 2–3) — niska latencja |
| **PWA** | ciężkie wygładzanie (wysokość/nachylenie/prędkość do wykresów) — patrz `docs/wymagania-PWA.md` |

## 4. Obliczanie prędkości (beeper)

- Prędkość z **Dopplera** (nie z Δ pozycji).
- Mapowanie prędkość → piknięcia (im szybciej, tym więcej): poniżej ustawionej
  minimalnej prędkości pikania cisza (domyślnie <60 km/h);
  60–69: 1× krótki, 70–79: 2×, 80–89: 3×, 90–99: 4×; ≥100: długie + krótkie
  (1 długi na każde 50 km/h, reszta dziesiątek krótkimi — np. 120 = 1 długi
  + 2 krótkie, max 3 długie). Sygnał co **1 s**, nieblokujący scheduler.
- Czasy: krótki 56 ms, długi 140 ms, przerwa 60 ms. Częstotliwości: ton krótki
  i długi niezależnie ustawialne z PWA (`SETFREQ:SHORT:` / `SETFREQ:LONG:`;
  odpowiedź STATUS `freq short=.. long=..`), trzymane w NVS
  (`szusownik/freqShort/freqLong`), defaulty 880/1100 Hz, zakres 600-1500 Hz.
  Stałe `SZ_FREQ_*` w `config.h`. Krótki może być >= długi (pełna swoboda
  użytkownika, bez ostrzeżeń). Ponowne `SETFREQ` z tą samą wartością odtwarza
  wybrany ton bez zmiany nastawy.

## 5. Sterowanie dźwiękiem

- **Pasywny buzzer piezo**, GPIO10, sterowanie LEDC 8-bit
  (kwadratowe mapowanie poziomu na duty, max 50%).
- **Głośność adaptacyjna**: kotwice volLow @60 km/h i volHigh @120 km/h
  (0..100, domyślnie 20/70), pomiędzy liniowo, powyżej 120 wartość ze 120.
- Ustawiane z PWA (`SETVOL:LOW:` / `SETVOL:HIGH:`; odpowiedź
  STATUS `vol low=.. high=..`), trzymane w NVS (`szusownik/volLow/volHigh`).
  INFO niesie `volLow/volHigh` oraz `freqShort/freqLong` dla PWA. Każde SETVOL gra feedback
  (LOW → sygnał 60, HIGH → sygnał 120); każde SETFREQ gra podgląd
  (1 długi + 2 krótkie nowymi częstotliwościami, przy głośności HIGH).
- Sygnał startowy (setup): identyczny do 120 (1 długi + 2 krótkie),
  ale przy głośności 60.
- Czasy wzoru są konfigurowalne z PWA przez `SETTIMING:SHORT/LONG/GAP/INTERVAL`,
  odpowiedź STATUS ma postać `timing short=.. long=.. gap=.. interval=..`.
  Wartości są trzymane w NVS (`beepShort/beepLong/beepGap/signalGap`):
  odpowiednio 20..200 ms, 40..500 ms, 0..500 ms i 100..5000 ms.
  Po każdej zmianie firmware odtwarza trzy wzory 120 km/h. Przerwa `GAP` jest
  ciszą między tonami w jednym wzorze, a `INTERVAL` ciszą między pełnymi wzorami.
- Mapowanie głośności na duty LEDC jest kwadratowe zamiast liniowego, aby niskie
  poziomy były praktycznie cichsze; przy ustawieniu 1% duty wynosi 0 w 8-bitowej
  skali. Wartość ustawienia pozostaje logicznym procentem 0..100.
- Minimalna prędkość pikania jest konfigurowalna z PWA przez `SETMINBEEP`,
  trzymana w NVS jako `minBeep`, zakres 60..120 km/h, domyślnie 60 km/h. Próg tylko
  wycisza niższe prędkości; nie zmienia liczby tonów dla prędkości, która już pika.

## 6. Zapis CSV + rotacja plików

- Pola: `timestamp (UTC), lat, lon, speed, altitude_gps, heading, altitude_baro`.
  `altitude_baro` liczone na urządzeniu z ciśnienia BME280 (I2C, wspólna magistrala
  z OLED) ze standardowej atmosfery (ref. 1013,25 hPa). Temperatura czujnika jest
  wewnętrzna i służy do kompensacji ciśnienia; nie trafia do CSV, ale jest
  pokazywana jako `air` w linii statusu SYS (DEBUG, patrz §9 i §11).
- Nagłówek CSV v2 dodaje metryki fixa, liczby satelitów, HDOP oraz wiek tych pól;
  bieżące źródło prędkości pozostaje RMC/NMEA. Szczegółowy schemat i świeżość
  opisano w `docs/jakosc-danych.md`.
- Nazwa pliku od czasu startu: **`YYYYMMDD_HHMMSS.csv`** (bez `:` — FAT32 na SD),
  z realnego UTC z GNSS. Plik powstaje dopiero, gdy odbiornik poda poprawną datę
  i godzinę — wcześniej nie zapisujemy na SD (brak fallbacku `LOG_<millis>.csv`).
  Próbki z fixem, ale jeszcze bez poprawnego UTC, są pomijane.
- **Rolka na postoju** (mechanizm w §7): po zatrzymaniu bieżący plik jest
  domykany, a nowy otwiera się przy kolejnej próbce. Dane „w ruchu" lądują w
  zamkniętym pliku, więc w chwili odcięcia zasilania otwarty jest tylko plik z
  próbkami z postoju (bezwartościowy). Jeden postój = jedna rolka.
- **Plik towarzyszący `.meta`**: `<nazwa>.csv.meta` powstaje po potwierdzonym
  ruchu (§7). Jego brak oznacza plik postojowy — takiego CSV firmware **nie
  listuje** (`countCsv`/`listCsv`), więc PWA go nie widzi i nie pobiera. Format
  prosty `klucz=wartość` (`v=1`, `csv=<nazwa>`), rozszerzalny bez serializera JSON.
- **Rotacja też przy żądaniu pobrania** — pobierane pliki zawsze kompletne/zamknięte.
- **Okresowy flush pliku** co `SZ_SD_COMMIT_MS` (10 s). `File::flush()` to
  `fflush` + `fsync`, a `fsync` na VFS FAT (`vfs_fat_fsync`, potwierdzone
  deasemblacją) woła FATFS `f_sync`, czyli domyka wpis katalogowy i FAT na
  karcie. Ogranicza **okno utraty danych** przy odcięciu zasilania w trakcie
  jazdy, ale **nie jest gwarancją braku uszkodzeń**: FAT32 nie ma dziennika, a
  karta ma wewnętrzny cache i brak niezawodnej bariery zapisu. Jeśli zasilanie
  zniknie w trakcie zapisu sektora, karta może zapisać go częściowo (rozmiar w
  katalogu OK, łańcuch FAT/dane nie). Dlatego rolka na postoju (domknięcie przed
  wyłączeniem) jest ważniejsza niż sam flush.
- Jeśli inicjalizacja SD (`Storage::begin()`) nie powiedzie się przy starcie,
  firmware nie próbuje później otwierać ani zapisywać plików na karcie w tym
  uruchomieniu. Ponowne wykrycie karty wymaga restartu urządzenia.

## 7. Rolowanie pliku na postoju (ochrona przed odcięciem zasilania)

- Cel: w chwili odcięcia zasilania mieć na karcie **domknięty** plik z danymi
  „w ruchu"; otwarty ma być tylko plik z próbkami z postoju (bezwartościowy).
- Maszyna stanu (`Storage::updateFileRotation`, wołana co iterację pętli na
  `millis()`, nie na próbce):
  - **Rolka**: `fixValid && prędkość < SZ_ROLL_STOP_BELOW_KMH` (0.3 km/h) przez
    `SZ_ROLL_HOLD_MS` (3 s) → `close()`, uzbrojenie zdjęte.
  - **Uzbrojenie**: `fixValid && prędkość > SZ_ROLL_REARM_ABOVE_KMH` (5 km/h)
    przez `SZ_ROLL_HOLD_MS` (3 s) → uzbrojenie włączone.
  - Start: uzbrojenie **wyłączone** — pierwsza rolka dopiero po realnym ruchu.
- Jeden postój = **dokładnie jedna** rolka (zdjęte uzbrojenie blokuje mnożenie
  plików na jednym postoju). Ruch < 5 km/h (korek, kolejka) nie jest chroniony —
  świadomie: takie dane nie są istotne, a ochrona mnożyłaby pliki.
- Wymóg `fixValid`: przy braku fixa prędkość wynosi 0, więc bez tego warunku
  zanik fixa w ruchu (tunel, garaż) fałszywie rolowałby przejazd.
- Zapis trwa cały czas; roll to tylko `close()` — próbki z postoju po rolce
  trafiają do nowego pliku i są świadomie „do stracenia".
- **Zapis `.meta`** (`Storage::ensureMeta()`, wołane co iterację pętli): tworzy
  `<bieżący>.csv.meta` i domyka go (`flush`) w chwili uzbrojenia rolki, czyli po
  potwierdzonym ruchu (> 5 km/h przez 3 s). Kolejność jest istotna — brak `.meta`
  ma niezawodnie znaczyć „ten plik nigdy nie miał jazdy". Jeśli prąd padnie przed
  zapisem `.meta`, w CSV nie ma jeszcze żadnej próbki z jazdy, więc nic cennego
  nie ginie. `.meta` powstaje też dla pliku otwartego, gdy uzbrojenie już trwa
  (np. ruch tuż po starcie urządzenia).
- Pliki bez `.meta` **nie są kasowane** — zostają na karcie. FIFO
  (`ensureFreeSpace`) kasuje CSV razem z jego `.meta`.
- Rolka na podjazd (wysokościowa) **usunięta** — jeden mechanizm, nie dwa.
  Cięcie na zjazdy robi PWA (własna metoda, `web/src/lib/runs.ts`).
- Progi do dostrojenia (patrz „Otwarte punkty").

## 8. Transfer BLE + sprzątanie

- PWA pobiera **tylko nowe** pliki, przyrostowo: pyta o nazwy większe od kursora
  (`LIST:<since>`, stronicowane, po nazwie — patrz `docs/wymagania-PWA.md` §7).
  Na liście są wyłącznie CSV z plikiem `.meta` (czyli takie, które miały ruch) —
  pliki postojowe są ukryte. Błędy przejściowe wracają po nazwie, bez listowania.
- **Nie kasujemy danych z SD** — zostają jako backup. Oznaczanie „wysłane" na urządzeniu
  nie jest potrzebne (PWA śledzi co ma w IndexedDB).
- Sprzątanie: gdy karta jest pełna — kasuj **najstarsze pliki** (FIFO) lub ręcznie.

## 9. Monitoring termiki (Health)

- ESP32-S3 **nie ma sprzętowego zabezpieczenia termicznego** (brak auto-shutdown
  przy przegrzaniu), dlatego ochrona jest programowa w module `src/health/`
  (`Health`), wołanym z głównej pętli (`millis`, bez tasków/ISR).
- Odczyt `temperatureRead()` co **30 s** (`SZ_HEALTH_CHECK_MS`). To temperatura
  **rdzenia (die)**, nie otoczenia, i jest słabo skalibrowana bezwzględnie —
  traktować jako wskaźnik, progi z zapasem (junction max ~125 °C).
- Po **3** kolejnych odczytach ≥ **95 °C** (`SZ_HEALTH_TEMP_WARN_C`) każdy kolejny
  odczyt ≥ 95 °C wywołuje nieblokujący **alarm buzzerem** przez 3 s
  (`SZ_HEALTH_ALARM_MS`). Histereza 2 °C (`SZ_HEALTH_HYST_C`) zeruje licznik po
  ostygnięciu.
- Przy ≥ **100 °C** (`SZ_HEALTH_TEMP_CRIT_C`): zamknięcie pliku SD, ekran OLED
  „PRZEGRZANIE" z obiema temperaturami (die/air), blokujący alarm i
  **deep sleep** (`esp_deep_sleep_start()`). Wznowienie = power-cycle/reset.
  Buzzer po alarmie jest odpinany od LEDC i podtrzymywany w stanie LOW
  (`gpio_hold_en`; GPIO10 = RTC-IO na S3), żeby nie trzymał dźwięku ani nie
  łapał szumu po uśpieniu.
- Ograniczenia: deep sleep nie odcina zasilania peryferiów — GNSS dalej pobiera
  ~30 mA i dogrzewa obudowę (na stoku nieistotne; na biurku odnotować). W pełni
  chłodzące odcięcie GNSS wymagałoby `UBX-RXM-PMREQ` albo load switcha na VCC
  (roadmapa).
- Diagnostyka: linia statusu SYS co 5 s (poziom DEBUG) niesie `die=..C air=..C`
  (die z SoC, air z BME280) — do oceny termiki wnętrza obudowy.
- **Ograniczanie grzania:** poza transferem BLE pętla główna oddaje CPU na
  `SZ_LOOP_IDLE_MS` (3 ms) na końcu `loop()` — bez tego była busy-spinem (100%
  CPU, brak wejścia w idle/DFS); 3 ms nie rusza żadnego interwału (najszybszy to
  GNSS 10 Hz = 100 ms). **W trakcie transferu BLE delay jest pomijany**
  (`if (!ble.busy())`), żeby pompa NOTIFY kręciła się dokładnie jak w zamrożonym
  profilu (pacing 4 ms). Stały zegar CPU to `SZ_CPU_FREQ_MHZ` = 160 MHz
  (ESP32-S3 wspiera 240/160/80/40/20 — 200 nie istnieje); ustawiany raz w
  `setup()`, przed peryferiami. Wcześniejsze „wycofanie" 160 MHz było
  błędną diagnozą: transfer psuł skan SD w `refreshInfo`/`countCsv` (patrz
  `docs/ble-transfer.md`), który zawodził też na 240 MHz.
- **Statystyki per epoka, nie per iteracja:** dystans dnia (haversine,
  `TinyGPSPlus::distanceBetween` — 8 transcendentalnych `double`) i max dnia
  liczy się raz na nową próbkę GNSS (w bloku `consumeNewSample()`), a nie co
  iterację pętli; miary zmieniają się dopiero na nowej epoce.
- **Reklamowanie BLE:** interwał `SZ_BLE_ADV_INTERVAL` = 1600 (NimBLE, jednostka
  0.625 ms → 1 s) zamiast domyślnego „fast" 20–30 ms. Adv trwa tylko, gdy telefon
  nie jest połączony, więc rzadsze reklamowanie ogranicza grzanie (bez wpływu na
  zamrożony profil transferu); kosztem jest dłuższe wykrywanie w PWA (do ~1 s).
- Linia statusu SYS (DEBUG) ma bufor 512 B (`src/config/log.h`), żeby nie ucinać
  ogona z `loop=`/`die=`/`air=`; przy 256 B te pola ginęły.

## 10. Otwarte punkty

1. **Progi rolki na postoju** (`SZ_ROLL_STOP_BELOW_KMH` 0.3, `SZ_ROLL_REARM_ABOVE_KMH` 5, `SZ_ROLL_HOLD_MS` 3 s) — potwierdzone na danych testowych (bezruch 0.0–0.1 km/h), do obserwacji w terenie.
2. **Współbieżność** — jednoczesny zapis na SD + transfer BLE + buzzer na ESP32 (wydajność, bufory) — do weryfikacji.
3. **Rozmiar pliku na jeden zjazd** — zweryfikować w praktyce (szacunek ~0,06–0,11 MB, tj. ~1/5 z ~0,3–0,55 MB dla 5 zjazdów, patrz koncepcja).

## 11. Logowanie i diagnostyka

- Logi mają poziomy `E` (błąd), `W` (ostrzeżenie), `I` (zdarzenie, **domyślny**)
  i `D` (debug), oraz tag modułu (`BOOT`, `GNSS`, `SD`, `BLE`, `BARO`, `HEALTH`,
  `SYS`). Format: `[ms] L TAG: tresc`. Realizacja: `src/config/log.h`, próg
  `SZ_LOG_LEVEL` w `config.h`. Wywołania poniżej progu są **wycinane
  kompilacyjnie** (zero kosztu flash/CPU).
- **INFO = zdarzenia**: cykl życia (`boot ok`, reset reason, fix acquired/lost,
  UTC valid), SD (open/rolka/FIFO/sync), BLE (conn/disconn/MTU, przebieg
  transferu co 32 ramki, retry/replay, done/abort), BARO (fail/recover),
  HEALTH (ostrzeżenie/krytyczne/ostygło). Transfer BLE jest rzadki, więc
  celowo logowany szczegółowo.
- **DEBUG = wszystko cykliczne/strumieniowe**: jedna linia statusu `SYS` co 5 s
  (`SZ_STATUS_MS`) z GNSS/SD/loop/heap/PSRAM/termika/BLE oraz jedna linia
  per-próbka `GNSS smpl` (dane per próbka są trwale w CSV, więc nie dublujemy
  ich w INFO). Diagnostyka UBX (`UBX tx`), `CFG-*`, `BLE INFO` też są w DEBUG.
- Błędy logujemy zawsze (najniższy próg), bez względu na `SZ_LOG_LEVEL`.
- Instrumentacja wspierająca monitoring: licznik błędów zapisu i maks. czas
  `flush` SD, pomiar czasu i maks. przerwy pętli (loop stall), `FreeHeap`/
  `MinFreeHeap`/`FreePSram`, reset reason (`esp_reset_reason()`), statystyki
  retransmisji BLE, licznik nieudanych odczytów barometru.
- Reguły dla kolejnych sesji: `AGENTS.md` (sekcja „Zasady pracy").

## 12. Link HUD (ESP-NOW)

Szusownik nadaje też podgląd do osobnego odbiornika **HudRekaw** (ESP8266 + ST7789)
przez **ESP-NOW** na stałym kanale `HUD_LINK_CHANNEL` (1) — bez asocjacji WiFi.
Pakiety `'S'` (telemetria, 1 s w ruchu) i `'L'` (pozycja + tryb, 5 s na postoju)
idą **unicastem** do MAC-a Huda zapisanego w NVS Szusownika; broadcast (`'P'` —
prośba o parowanie) leci tylko w trybie parowania. Tryb przełącza próg
`HUD_STATS_ABOVE_KMH` (30 km/h). Radio Szusownika jest **domyślnie wyłączone**
(oszczędzanie SoC) — Szusownik otwiera je na krótkie okno na czas wysyłki
zaległych pakietów i gasi po sprzętowym ACK-u unicastu; gdy łącze nie jest
potwierdzone (brak niedawnego ACK), nadaje nie częściej niż
`HUD_SEND_BACKOFF_MS` (3 s). WiFi/ESP-NOW dzieli radio z BLE, więc w trakcie
transferu pliku (`BleFiles::busy()`) radio jest **zamknięte**, a po transferze
wznawia od razu. Parowanie z PWA (CTRL `PAIR`, wynik `paired` / `err:pair-none` /
`err:pair-multi`, w trakcie transferu `err:busy`; MAC w INFO jako `peerMac`
**przed** STATUS-em wyniku) opisano w `docs/hud-rekaw.md` §3. Zdarzenia z
callbacków ESP-NOW (odbiór `'Q'`/`'K'`, wynik wysyłki) trafiają do pętli głównej
przez pierścień chroniony spinlockiem — stan gry zmienia tylko `tick()`; czas dla
niego jest liczony na miejscu wywołania (skan SD `refreshInfo` potrafi opóźnić
pętlę).
Protokół (SSOT `protocol/hud-espnow-v1.json`), odbiornik i wersja firmware
(`1.9.0-hud-espnow`): `docs/hud-rekaw.md`; reguły pracy — `AGENTS.md`.

## 13. Tryb nawigacji (trasa)

- PWA wysyła wyznaczoną trasę do Szusownika **dedykowaną charakterystyką BLE
  WRITE** (binarny blob; SSOT `protocol/route-v1.json`). Blob: nagłówek + punkty
  `int16` w metrach od origin (decymacja 10 m, limit 512) + odcinki (nazwa + typ +
  zakres dystansu, limit 24) + CRC32. Tożsamość trasy = CRC32.
- Szusownik trzyma trasę **tylko w RAM** (start z kanonicznym pustym blobem =
  CLEAR). `BleFiles` składa porcje w staging i waliduje CRC w pętli głównej;
  INFO niesie `routeCrc`/`routePoints`, STATUS `route ok ...` / `route err ...`.
- Szusownik przekazuje trasę dalej do HudRekaw po ESP-NOW: gdy odbiornik jest
  dostępny (niedawny ACK), a Szusownik nie ma od niego potwierdzenia tej samej
  wersji trasy, wysyła chunki `'R'`
  (chunk trasy). Potwierdzeniem dostarczenia jest jawny pakiet `'K'`
  (potwierdzenie trasy) z CRC złożonego bloba (Hud wysyła go też od razu po
  przypisaniu go unicastem, więc po restarcie Huda trasa wraca na ekran). Bez
  potwierdzenia ponawia rzadko — jedno okno wysyłki co najwyżej raz na
  `SZ_HUD_ROUTE_RESEND_MS` (9 s), do
  `HUD_ROUTE_MAX_CYCLES` cykli — żeby radio nie nadawało non-stop (podmiana trasy
  w trakcie wysyłki przerywa burst i przelicza chunki; patrz `docs/hud-rekaw.md`).
- Z GNSS liczy **indeks bieżącego odcinka trasy** i dokłada go do pakietów `'S'`
  (telemetria)/`'L'` (pozycja + tryb)
  (`segmentIndex`, `HUD_SEGMENT_NONE` bez trasy). Decyzja o odcinku to pełny
  przebieg po punktach trasy (O(`pointCount`), `double sqrt`), więc liczymy ją co
  najwyżej raz na `SZ_ROUTE_UPDATE_MS` (**3 s**), a między przeliczeniami pakiet
  niesie ostatni znany odcinek. Odległość do końca ≤ `ROUTE_ARRIVAL_M` (30 m) jest
  O(1), więc sprawdzana jest osobno, co najwyżej raz na `SZ_ROUTE_ARRIVAL_MS`
  (**1 s**) — rzadsze próbkowanie przy dużej prędkości mogłoby przeskoczyć promień
  dotarcia. Wykryte dotarcie **czyści trasę lokalnie** (pusty blob; zniknie też z
  HudRekaw). Bez powiadamiania PWA — PWA ma własną logikę dotarcia.
- **Kroki trasy na OLED Szusownika**: dolna linia pokazuje kolejne odcinki od
  bieżącego (`segmentIndex`), łączone `->` i skracane — szczegóły
  `docs/hud-display.md` §3.2.
