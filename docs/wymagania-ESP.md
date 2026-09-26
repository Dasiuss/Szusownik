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
  listuje** (`countCsv`/`csvAt`), więc PWA go nie widzi i nie pobiera. Format
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

- PWA prosi o **listę plików** (nazwa + rozmiar + czas startu) i pobiera **tylko nowe**
  (porównanie po nazwie — patrz `docs/wymagania-PWA.md`). Na liście są wyłącznie
  CSV z plikiem `.meta` (czyli takie, które miały ruch) — pliki postojowe są ukryte.
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
- Reguły dla kolejnych sesji: `AGENTS.md` pkt 14.
