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
| `supabase/` | Edge Functions; bazą zarządzamy preferencyjnie przez Supabase MCP |

## Dokumentacja

- `docs/koncepcja.md` — wizja, bieżący zakres MVP i roadmapa.
- `docs/wymagania-PWA.md` — wymagania PWA (analiza i prezentacja).
- `docs/wymagania-ESP.md` — wymagania urządzenia (ESP32).
- `docs/supabase.md` — architektura Supabase, Auth, RLS i preferowany przepływ MCP.
- `docs/bom.md` — lista podzespołów (MVP).
- `docs/ustalenia-z-projektow-testowych.md` — synteza wiedzy z `BleTest`, `DisplayTest` i `MapyTest`.
- `docs/ble-transfer.md` — sprawdzony transfer BLE, kompresja i retransmisje.
- `docs/hud-display.md` — ekran statystyk OLED i kroki trasy.
- `docs/hud-rekaw.md` — odbiornik HudRekaw (ESP8266 + ST7789) i link ESP-NOW.
- `docs/mapy-routing.md` — dane mapowe, wizualizacja i routing.
- `docs/testy.md` — strategia i komendy testów (Vitest, Playwright, host firmware).
