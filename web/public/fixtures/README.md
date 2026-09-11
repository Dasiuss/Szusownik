# Fixture PWA — RZECZYWISTE nagranie, nie mock

Sposób użycia (development):

1. Zgrać plik CSV z karty SD urządzenia (np. `20260911_101530.csv`).
2. Skopiować tutaj jako `public/fixtures/ride.csv`.
3. Odpalić `npm run dev` — widok dnia wczyta ten plik przyciskiem „Pobierz dane".

Plik musi mieć nagłówek i pola urządzenia:

```text
timestamp,lat,lon,speed,altitude,heading
```

Fixture powinien zawierać co najmniej **2 zjazdy** (jazda + postój/wolny
odcinek rozdzielający), żeby było widać cięcie i listę.
