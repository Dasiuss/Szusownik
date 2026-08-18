# Wymagania ESP32 (urządzenie)

> Status: **WIP (draft)** — dokument żywy.
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
- Mapowanie prędkość → bipnięcia (tabela w `docs/koncepcja.md`), sygnał co **1 s**,
  rekord = **1 s dźwięku ciągłego**.

## 5. Sterowanie dźwiękiem

- **Pasywny buzzer piezo**, tony generowane PWM przez GPIO.
- Interwał sygnału konfigurowalny (domyślnie 1 s).

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
