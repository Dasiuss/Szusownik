# Fixture PWA — nagranie testowe

Plik `ride.csv` zawiera rzeczywisty ślad, prędkości, wysokość barometryczną i
metryki jakości GNSS z urządzenia (nagłówek v2). Służy jako dane demonstracyjne
przy pierwszym uruchomieniu PWA. Plik źródłowy: `test data/LOG_1641.csv`.

Przy seedowaniu PWA przesuwa timestampy do bieżącego czasu i zapisuje plik jako
`demo-ride.csv` (`DEMO_SOURCE_FILE`). Metryki GNSS pochodzą wprost z urządzenia —
PWA niczego nie dopisuje ani nie zmyśla. Osierocone pliki `demo-*` są usuwane.

Podmiana fixture (development):

1. Zgrać plik v2 z karty SD urządzenia (np. `20260911_101530.csv`).
2. Skopiować tutaj jako `public/fixtures/ride.csv` (bez zmian zawartości).
3. Zwiększyć wersję klucza `DEMO_SEEDED_KEY` w `web/src/lib/data.ts` albo
   wyczyścić dane aplikacji, a następnie odpalić `npm run dev`.

Plik źródłowy musi mieć nagłówek v2:

```text
timestamp,lat,lon,speed,altitude_gps,heading,altitude_baro,gnss_fix_valid,gnss_fix_age_ms,gnss_satellites,gnss_satellites_age_ms,gnss_hdop,gnss_hdop_age_ms
```

Fixture powinien zawierać co najmniej **2 zjazdy** (jazda + postój/wolny
odcinek rozdzielający), żeby było widać cięcie i listę.
