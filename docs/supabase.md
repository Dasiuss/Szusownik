# Supabase — architektura i sposób pracy

> Aktualizacja: 2026-11-21. Supabase jest rozwijane modułowo; aktualnie obsługuje
> opcjonalne logowanie i udostępnianie bieżącej pozycji na mapie.

## Preferowany sposób pracy: Supabase MCP

**MCP jest preferowaną formą interakcji z projektem Supabase.** Połączenie
`supabase-szusownik` w OpenCode jest ograniczone do Project Ref Szusownika,
używa OAuth i nie przechowuje tokenów w repozytorium.

- Zanim zmienisz bazę, sprawdź przez MCP istniejące schematy, tabele, polityki
  RLS i uprawnienia. Nie zakładaj, że schemat `public` należy do Szusownika.
- Operacje DDL wykonuj przez narzędzie MCP `apply_migration`; zapytania
  inspekcyjne wykonuj przez `execute_sql`. Historia tych zmian jest zapisywana
  bezpośrednio w projekcie Supabase.
- **Nie używamy lokalnego `supabase/migrations/` ani automatycznego wdrażania
  schematu przez integrację GitHub.** Katalog migracji w repozytorium został
  usunięty. Zmiany aplikacji i ich dokumentację nadal wersjonujemy w Git.
- Do połączenia PWA używaj wyłącznie klucza **publishable**. Klucz `service_role`
  nigdy nie trafia do kodu przeglądarkowego ani repozytorium.
- Nie uruchamiaj publicznej rejestracji. Konta są tworzone/zapraszane z panelu
  Supabase; ustawienie Auth „Allow new users to sign up” musi pozostać wyłączone.

MCP może zmieniać zdalną bazę, dlatego przed DDL sprawdź zakres i SQL. Nie
wykonuj operacji na danych lub tabelach niezwiązanych z bieżącym zadaniem.

## Namespace i API

- Dane Szusownika trafiają do osobnego schematu PostgreSQL **`szusownik`**, nie
  do `public`.
- Schemat musi być dodany w Dashboardzie w **Project Settings → API → Exposed
  schemas**. W bazie nadajemy dostęp do schematu wyłącznie roli
  `authenticated`; tabele mają RLS. Anonimowy klient nie odczytuje tych danych.
- Istniejące tabele w `public` (np. `public.meetings`) są poza zakresem tej
  aplikacji i nie należy ich zmieniać.

## Aktualny zakres: profile i pozycje grupy

PWA pozostaje użyteczna bez logowania i działa lokalnie/offline. Logowanie
Supabase Auth e-mail/hasło jest opcjonalne i dostępne w Ustawieniach. Obecna
grupa liczy cztery osoby. PWA nie ma formularza rejestracji; konta dodaje się
przez zaproszenie.

Schemat `szusownik` ma obecnie dwie tabele:

- **`profiles`** — `user_id`, nazwa wyświetlana i `share_enabled`. Pierwsza nazwa
  to trzy pierwsze znaki części e-maila przed `@`; można ją edytować. Udostępnianie
  jest domyślnie włączone dla nowego profilu.
- **`live_locations`** — jeden rekord na użytkownika, nadpisywany kolejnym
  zaakceptowanym fixem. Zawiera szerokość, długość, dokładność oraz
  `recorded_at` równy czasowi pomiaru GPS (`GeolocationPosition.timestamp`).
  Nie gromadzimy historii śladu.

Wszystkie zalogowane konta mogą czytać profile oraz pozycje osób, które mają
włączone udostępnianie. Użytkownik może zmieniać i usuwać wyłącznie własny
profil/rekord lokalizacji. To celowy wyjątek RLS dla danych grupowych; pozostałe
przyszłe dane osobiste powinny domyślnie pozostać właścicielskie
(`user_id = auth.uid()`).

Wysyłanie działa best-effort tylko na widoku Mapy, po zalogowaniu i przy
włączonym udostępnianiu: pierwszy fix od razu, kolejne najwyżej co 10 s z
zachowaniem najnowszego odczytu. Pozycje pozostałych są odpytywane co 10 s, gdy
mapa jest otwarta i jest Internet. Na mapie pokazujemy ostatni punkt nie starszy
niż 1 h; etykieta wieku pojawia się od 3 min. Po wyłączeniu udostępniania lub
wylogowaniu PWA próbuje usunąć własny rekord. Nie kolejkujemy usunięcia offline.

Nie ma okresowego czyszczenia rekordów: pozycje starsze niż godzinę są pomijane
przez PWA, ale mogą pozostać w bazie do nadpisania lub jawnego usunięcia. Brak
GPS, sieci, uśpienie strony lub ograniczenia systemu mogą zatrzymać aktualizacje.

## Moduł PWA i dalszy rozwój

Cała integracja kliencka jest zamknięta w **`web/src/lib/supabase/`**. Widoki
korzystają z modułów domenowych, a nie wywołują `supabase-js` bezpośrednio.
Obecne obszary to klient, Auth, profile i pozycje na żywo. Przyszłe synchronizacje
rekordów, tras, nagrań i ustawień dodawaj jako osobne moduły domenowe w tym
katalogu, z osobnymi typami, politykami RLS i testami. Nie zmieniaj obecnej
polityki współdzielenia lokalizacji w ogólną regułę odczytu wszystkich przyszłych
danych.

Klient korzysta z `@supabase/supabase-js` i klucza publishable w PWA. Sekrety
Stravy i inne klucze serwerowe mogą być używane wyłącznie po stronie Edge
Function. `supabase/functions/` pozostaje miejscem na przyszłe funkcje
serwerowe; plan kroku 2 zakłada ich automatyczne wdrażanie po skonfigurowaniu
integracji Supabase ↔ GitHub, niezależnie od zarządzania schematem przez MCP.
