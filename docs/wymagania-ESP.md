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
  i długi niezależnie ustawialne z PWA (`SETFREQ:SHORT:` / `SETFREQ:LONG:`,
  też `GETFREQ`; odpowiedź STATUS `freq short=.. long=..`), trzymane w NVS
  (`szusownik/freqShort/freqLong`), defaulty 880/1100 Hz, zakres 600-1500 Hz.
  Stałe `SZ_FREQ_*` w `config.h`. Krótki może być >= długi (pełna swoboda
  użytkownika, bez ostrzeżeń). Ponowne `SETFREQ` z tą samą wartością odtwarza
  wybrany ton bez zmiany nastawy.

## 5. Sterowanie dźwiękiem

- **Pasywny buzzer piezo**, GPIO10, sterowanie LEDC 8-bit
  (kwadratowe mapowanie poziomu na duty, max 50%).
- **Głośność adaptacyjna**: kotwice volLow @60 km/h i volHigh @120 km/h
  (0..100, domyślnie 20/70), pomiędzy liniowo, powyżej 120 wartość ze 120.
- Ustawiane z PWA (`SETVOL:LOW:` / `SETVOL:HIGH:`, też `GETVOL`; odpowiedź
  STATUS `vol low=.. high=..`), trzymane w NVS (`szusownik/volLow/volHigh`).
  INFO niesie `volLow/volHigh` oraz `freqShort/freqLong` dla PWA. Każde SETVOL gra feedback
  (LOW → sygnał 60, HIGH → sygnał 120); każde SETFREQ gra podgląd
  (1 długi + 2 krótkie nowymi częstotliwościami, przy głośności HIGH).
- Sygnał startowy (setup): identyczny do 120 (1 długi + 2 krótkie),
  ale przy głośności 60.
- Czasy wzoru są konfigurowalne z PWA przez `SETTIMING:SHORT/LONG/GAP/INTERVAL`,
  odpowiedź `GETTIMING` ma postać `timing short=.. long=.. gap=.. interval=..`.
  Wartości są trzymane w NVS (`beepShort/beepLong/beepGap/signalGap`):
  odpowiednio 20..200 ms, 40..500 ms, 0..500 ms i 100..5000 ms.
  Po każdej zmianie firmware odtwarza trzy wzory 120 km/h. Przerwa `GAP` jest
  ciszą między tonami w jednym wzorze, a `INTERVAL` ciszą między pełnymi wzorami.
- Mapowanie głośności na duty LEDC jest kwadratowe zamiast liniowego, aby niskie
  poziomy były praktycznie cichsze; przy ustawieniu 1% duty wynosi 0 w 8-bitowej
  skali. Wartość ustawienia pozostaje logicznym procentem 0..100.
- Minimalna prędkość pikania jest konfigurowalna z PWA przez `SETMINBEEP` / `GETMINBEEP`,
  trzymana w NVS jako `minBeep`, zakres 60..120 km/h, domyślnie 60 km/h. Próg tylko
  wycisza niższe prędkości; nie zmienia liczby tonów dla prędkości, która już pika.

## 6. Zapis CSV + rotacja plików

- Pola: `timestamp (UTC), lat, lon, speed, altitude_gps, heading, altitude_baro`.
  `altitude_baro` liczone na urządzeniu z ciśnienia BME280 (I2C, wspólna magistrala
  z OLED) ze standardowej atmosfery (ref. 1013,25 hPa). Temperatura czujnika jest
  wewnętrzna i służy do kompensacji ciśnienia; nie trafia do CSV, ale jest
  logowana diagnostycznie na Serial jako `air` w linii STATUS (patrz §9).
- Nagłówek CSV v2 dodaje metryki fixa, liczby satelitów, HDOP oraz wiek tych pól;
  bieżące źródło prędkości pozostaje RMC/NMEA. Szczegółowy schemat i świeżość
  opisano w `docs/jakosc-danych.md`.
- Nazwa pliku od czasu startu: **`YYYYMMDD_HHMMSS.csv`** (bez `:` — FAT32 na SD).
- **Rotacja co ~5 zjazdów** (detekcja wyciągu — patrz niżej), aby pliki nie rosły bez końca.
- **Rotacja też przy żądaniu pobrania** — pobierane pliki zawsze kompletne/zamknięte.

## 7. Detekcja wyciągu (do rotacji)

- Heurystyka: segment, w którym **wysokość rośnie** o próg (np. >20 m) przy **niskiej
  prędkości** (np. <15 km/h) = wyciąg. Koniec zjazdu = początek wyciągu.
- Wysokość do detekcji pochodzi z **barometru** (`altitude_baro`) — stabilniejsza niż
  GPS; gdy brak baro, fallback na `altitude_gps`.
- Zliczanie granic zjazdów; po **5** → zamknij plik, otwórz nowy.
- Dokładne progi do dostrojenia (patrz „Otwarte punkty").

## 8. Transfer BLE + sprzątanie

- PWA prosi o **listę plików** (nazwa + rozmiar + czas startu) i pobiera **tylko nowe**
  (porównanie po nazwie — patrz `docs/wymagania-PWA.md`).
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
- Diagnostyka: linia STATUS co 2 s niesie `die=..C air=..C` (die z SoC, air z
  BME280) — do oceny termiki wnętrza obudowy.

## 10. Otwarte punkty

1. **Progi detekcji wyciągu** (Δwysokości, próg prędkości) — do ustalenia i dostrojenia.
2. **Współbieżność** — jednoczesny zapis na SD + transfer BLE + buzzer na ESP32 (wydajność, bufory) — do weryfikacji.
3. **Rozmiar pliku przy 5 zjazdach** — zweryfikować w praktyce (szacunek ~0,3–0,55 MB, patrz koncepcja).
