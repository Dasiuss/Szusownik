# Szusownik

Urządzenie + PWA do nagrywania i analizy tras narciarskich, statystyk przejazdów
i bicia rekordów prędkości. Wcześniejsza nazwa robocza projektu to `GpsSpeedTracker`.

- Repo: https://github.com/Dasiuss/Szusownik
- PWA (GitHub Pages): https://dasiuss.github.io/Szusownik/

## Struktura repozytorium

| Ścieżka     | Zawartość |
|-------------|-----------|
| `docs/`     | Dokumentacja: koncepcja, wymagania PWA, wymagania ESP, Supabase, BOM |
| `web/`      | PWA (React + TS + Vite) — prezentacja i analiza |
| `firmware/` | Firmware urządzeń: Szusownik (ESP32-S3) i HudRekaw (ESP8266 + ST7789) |
| `protocol/` | SSOT protokołów (BLE plikowy, ESP-NOW HUD) |
| `supabase/` | Migracje bazy i Edge Functions (wdrażane przez integrację z GitHubem) |

## Dokumentacja

- `docs/koncepcja.md` — wizja, zakres, szczegóły implementacyjne, architektura, otwarte punkty.
- `docs/wymagania-PWA.md` — wymagania PWA (analiza i prezentacja).
- `docs/wymagania-ESP.md` — wymagania urządzenia (ESP32).
- `docs/supabase.md` — integracja z Supabase (auth, baza, Edge Functions).
- `docs/bom.md` — lista podzespołów (MVP).
- `docs/ustalenia-z-projektow-testowych.md` — synteza wiedzy z `BleTest`, `DisplayTest` i `MapyTest`.
- `docs/ble-transfer.md` — sprawdzony transfer BLE, kompresja i retransmisje.
- `docs/hud-display.md` — OLED, layout i animacja trasy.
- `docs/hud-rekaw.md` — odbiornik HudRekaw (ESP8266 + ST7789) i link ESP-NOW.
- `docs/mapy-routing.md` — dane mapowe, wizualizacja i routing.
- `docs/testy.md` — strategia i komendy testów (Vitest, Playwright, host firmware).
