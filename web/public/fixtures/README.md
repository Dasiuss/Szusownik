# Fixture PWA — nagranie testowe

Plik `ride.csv` zawiera rzeczywisty ślad i prędkości używane jako dane
demonstracyjne. Obecny plik ma nagłówek v1 bez pól jakości GNSS. Przy seedowaniu
PWA dopisuje syntetyczne metryki (`fix=1`, 8 satelitów, `HDOP=0,9`, wiek pól
100 ms), serializuje dane jako v2 i przesuwa timestampy do bieżącego czasu.
Metryki są tylko do testowania wskaźników i nie potwierdzają jakości urządzenia.
Obecny ślad ma rzadkie timestampy; zgodnie z wymaganiami lokalnego okna może
więc pokazywać `—` jako potwierdzony rekord, mimo zielonej ikonki GNSS.

Podmiana fixture (development):

1. Zgrać plik v2 z karty SD urządzenia (np. `20260911_101530.csv`).
2. Skopiować tutaj jako `public/fixtures/ride.csv`.
3. Zwiększyć wersję klucza `DEMO_SEEDED_KEY` w `web/src/lib/data.ts` albo
   wyczyścić dane aplikacji, a następnie odpalić `npm run dev`.
4. Seeder zachowa rzeczywiste metryki GNSS z pliku v2; wartości syntetyczne
   dopisuje tylko do źródła v1.

Plik źródłowy może mieć jeden z nagłówków:

```text
timestamp,lat,lon,speed,altitude_gps,heading,altitude_baro
timestamp,lat,lon,speed,altitude_gps,heading,altitude_baro,gnss_fix_valid,gnss_fix_age_ms,gnss_satellites,gnss_satellites_age_ms,gnss_hdop,gnss_hdop_age_ms
```

Uwaga: obecny `ride.csv` to nagranie **sprzed barometru** — kolumna
`altitude_baro` jest w nim wypełniona syntetycznie (wygładzona wysokość GPS),
żeby demo działało. Docelowo podmienić na rzeczywisty przejazd z BME280.

Fixture powinien zawierać co najmniej **2 zjazdy** (jazda + postój/wolny
odcinek rozdzielający), żeby było widać cięcie i listę.
