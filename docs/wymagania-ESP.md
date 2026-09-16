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
- Mapowanie prędkość → piknięcia (im szybciej, tym więcej): <60 cisza;
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
  (duty = vol·128/100, max 50%).
- **Głośność adaptacyjna**: kotwice volLow @60 km/h i volHigh @120 km/h
  (0..100, domyślnie 20/70), pomiędzy liniowo, powyżej 120 wartość ze 120.
- Ustawiane z PWA (`SETVOL:LOW:` / `SETVOL:HIGH:`, też `GETVOL`; odpowiedź
  STATUS `vol low=.. high=..`), trzymane w NVS (`szusownik/volLow/volHigh`).
  INFO niesie `volLow/volHigh` oraz `freqShort/freqLong` dla PWA. Każde SETVOL gra feedback
  (LOW → sygnał 60, HIGH → sygnał 120); każde SETFREQ gra podgląd
  (1 długi + 2 krótkie nowymi częstotliwościami, przy głośności HIGH).
- Sygnał startowy (setup): identyczny do 120 (1 długi + 2 krótkie),
  ale przy głośności 60.

## 6. Zapis CSV + rotacja plików

- Pola: `timestamp (UTC), lat, lon, speed, altitude, heading`.
- Nazwa pliku od czasu startu: **`YYYYMMDD_HHMMSS.csv`** (bez `:` — FAT32 na SD).
- **Rotacja co ~5 zjazdów** (detekcja wyciągu — patrz niżej), aby pliki nie rosły bez końca.
- **Rotacja też przy żądaniu pobrania** — pobierane pliki zawsze kompletne/zamknięte.

## 7. Detekcja wyciągu (do rotacji)

- Heurystyka: segment, w którym **wysokość rośnie** o próg (np. >20 m) przy **niskiej
  prędkości** (np. <15 km/h) = wyciąg. Koniec zjazdu = początek wyciągu.
- Zliczanie granic zjazdów; po **5** → zamknij plik, otwórz nowy.
- Dokładne progi do dostrojenia (patrz „Otwarte punkty").

## 8. Transfer BLE + sprzątanie

- PWA prosi o **listę plików** (nazwa + rozmiar + czas startu) i pobiera **tylko nowe**
  (porównanie po nazwie — patrz `docs/wymagania-PWA.md`).
- **Nie kasujemy danych z SD** — zostają jako backup. Oznaczanie „wysłane" na urządzeniu
  nie jest potrzebne (PWA śledzi co ma w IndexedDB).
- Sprzątanie: gdy karta jest pełna — kasuj **najstarsze pliki** (FIFO) lub ręcznie.

## 9. Otwarte punkty

1. **Progi detekcji wyciągu** (Δwysokości, próg prędkości) — do ustalenia i dostrojenia.
2. **Współbieżność** — jednoczesny zapis na SD + transfer BLE + buzzer na ESP32 (wydajność, bufory) — do weryfikacji.
3. **Rozmiar pliku przy 5 zjazdach** — zweryfikować w praktyce (szacunek ~0,3–0,55 MB, patrz koncepcja).
