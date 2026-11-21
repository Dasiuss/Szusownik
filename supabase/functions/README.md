# supabase/functions/

Tu trafiają **Edge Functions** (każda w osobnym podfolderze z `index.ts`).

Planowane w kroku 2: `strava-upload/` — proxy do Stravy (OAuth + upload FIT).

Bazą i konfiguracją projektu Supabase zarządzamy preferencyjnie przez
projektowo ograniczony MCP; nie wdrażamy schematu przez lokalny katalog migracji.
Kod Edge Functions pozostaje w repozytorium. Zgodnie z planem kroku 2, po
skonfigurowaniu integracji Supabase ↔ GitHub funkcje będą wdrażane automatycznie
przy pushu na `main`.
