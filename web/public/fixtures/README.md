# Fixture PWA — RZECZYWISTE nagranie, nie mock

Plik `ride.csv` jest rzeczywistym nagraniem używanym jako dane demonstracyjne.
Przy pierwszym uruchomieniu PWA zostaje zapisany lokalnie, a jego timestampy są
przesuwane do bieżącego czasu, żeby od razu wypełnić ekran „Dzisiaj”.

Podmiana fixture (development):

1. Zgrać plik CSV z karty SD urządzenia (np. `20260911_101530.csv`).
2. Skopiować tutaj jako `public/fixtures/ride.csv`.
3. Odpalić `npm run dev` — aplikacja wczyta ten plik jako dane demo.

Plik musi mieć nagłówek i pola urządzenia:

```text
timestamp,lat,lon,speed,altitude,heading
```

Fixture powinien zawierać co najmniej **2 zjazdy** (jazda + postój/wolny
odcinek rozdzielający), żeby było widać cięcie i listę.
