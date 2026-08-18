# Supabase — integracja z repozytorium

> Status: WIP. Data: 2026-08-18

## Co to jest Supabase

Zarządzany **Postgres** + warstwy wokół: **Auth**, **Storage**, **Edge Functions**,
**Realtime**. Nad bazą automatycznie wystawia REST (PostgREST) i GraphQL.

## Jak działa połączenie z GitHubem (bez instalowania nic lokalnie)

- W dashboardzie Supabase: **Project Settings → Integrations → GitHub** (lub przycisk
  „Connect to GitHub" na stronie projektu).
- Autoryzujesz Supabase do dostępu do repo i wybierasz **repo + branch** (np. `main`).
- Supabase czyta folder **`supabase/`** z tego brancha i przy każdym **push**:
  - aplikuje migracje z `supabase/migrations/*.sql`,
  - wdraża Edge Functions z `supabase/functions/*`.
- **Nie potrzebujesz Docker ani CLI** — definicje żyją w repo, Supabase pobiera je sam.

### A co to były komendy `supabase start`?

`supabase start` (oraz `supabase init`, `db push`, `functions deploy`) to **CLI do
lokalnego developmentu** — odpala cały stack w Dockerze na Twoim komputerze (offline).
To **opcjonalne**. Przy integracji z GitHubem **pomijasz to całkowicie**: commit → push →
Supabase w chmurze sam to aplikuje.

## Struktura folderu `supabase/`

```
supabase/
├── config.toml          # konfiguracja (generowana przez supabase init / dashboard)
├── migrations/          # *.sql — wersjonowane zmiany schematu bazy
├── functions/           # Edge Functions (np. strava-upload/index.ts)
└── seed.sql             # dane startowe (opcjonalnie)
```

## Auth i użytkownicy (RLS)

- **Supabase Auth** dostarcza użytkowników (email + hasło).
- **2 użytkowników**; każdy widzi **tylko swoje** dane.
- **RLS (Row Level Security)** na tabelach: wiersze mają `user_id`, polityka
  `user_id = auth.uid()` — filtrowanie po stronie bazy (nie w kodzie PWA).
- PWA: ekran logowania; zapytania przez `supabase-js` są automatycznie filtrowane przez RLS.

## Klucze i sekrety

- **Publishable key** — bezpieczny, trafia do PWA (`@supabase/supabase-js`).
- **Secret key** — tylko serwer / Edge Function.
- `client_secret` Strava trzymasz jako **secret projektu** (Edge Function → Dashboard →
  Edge Functions → Secrets), **nie** w kodzie.

## U nas

- `supabase/migrations/` — schemat bazy (użytkownik, zjazdy, próbki/metadane).
- `supabase/functions/strava-upload/` — proxy do Strava (OAuth + upload FIT), na końcu.

PWA łączy się z bazą przez `@supabase/supabase-js`:
`createClient(url, publishableKey)` + `supabase.functions.invoke('strava-upload', ...)`.
