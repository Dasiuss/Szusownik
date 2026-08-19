# GpsSpeedTracker

Urządzenie + PWA do pomiaru i analizy prędkości narciarza (rekordy prędkości ~150 km/h).

## Struktura repozytorium

| Ścieżka     | Zawartość |
|-------------|-----------|
| `docs/`     | Dokumentacja: koncepcja, wymagania PWA, wymagania ESP, Supabase, BOM |
| `web/`      | PWA (React + TS + Vite) — prezentacja i analiza |
| `firmware/` | Kod urządzenia (ESP32-S3, PlatformIO/Arduino) |
| `supabase/` | Migracje bazy i Edge Functions (wdrażane przez integrację z GitHubem) |

## Dokumentacja

- `docs/koncepcja.md` — wizja, zakres, szczegóły implementacyjne, architektura, otwarte punkty.
- `docs/wymagania-PWA.md` — wymagania PWA (analiza i prezentacja).
- `docs/wymagania-ESP.md` — wymagania urządzenia (ESP32).
- `docs/supabase.md` — integracja z Supabase (auth, baza, Edge Functions).
- `docs/bom.md` — lista podzespołów (MVP).
