# Szusownik - kontekst projektu

Szusownik to docelowa aplikacja PWA + urządzenie ESP32-S3 do rejestrowania,
przesyłania i analizowania zjazdów narciarskich. Projekt korzysta z ustaleń
wypracowanych w trzech projektach testowych:

- `BleTest` - niezawodny transfer większych plików przez BLE.
- `DisplayTest` - prototyp lokalnego HUD-u na OLED SSD1306.
- `MapyTest` - wizualizacja tras narciarskich i lokalny routing.

## Charakter projektu

To projekt **greenfield**. Nie ma jeszcze użytkowników, nie istnieją żadne dane,
o których utratę się boimy, i nie ma żadnej potrzeby utrzymywania
kompatybilności wstecznej. Projekt zawsze testuje jedna osoba i zawsze na
najnowszej wersji firmware i PWA. Dlatego:

- Nie pisz migracji danych, kodu kompatybilności wstecznej, fallbacków starych
  wersji ani ścieżek deprecjacji.
- Zmieniaj formaty, protokoły, schematy i interfejsy wprost, bez warstw
  pośrednich „na wszelki wypadek" i bez oglądania się na starsze wydania.
- Zamiast migrować lub wspierać starą wersję — po prostu zaktualizuj kod i dane
  do najnowszej postaci.

## Dokumentacja referencyjna

- `docs/ustalenia-z-projektow-testowych.md` - architektura docelowa, wspólne decyzje,
  granice odpowiedzialności, ryzyka i plan integracji.
- `docs/ble-transfer.md` - szczegóły sprawdzonego transferu BLE, kompresji,
  okna ramek, ACK/NACK i zapisu po stronie PWA.
- `docs/hud-display.md` - OLED Szusownika: ekran statystyk, hero „max zjazdu"
  (port ZigZag z PWA), formatowanie i linia kroków nawigacyjnych.
- `docs/hud-rekaw.md` - odbiornik HudRekaw (ESP8266 + ST7789), link ESP-NOW
  z Szusownikiem, protokół `S`/`L` i generator mapy.
- `docs/mapy-routing.md` - źródła danych mapowych, warstwy MapLibre, graf tras,
  routing, koszt leksykograficzny i cache.
- `docs/koncepcja.md` - wizja produktu i zakres funkcjonalny.
- `docs/wymagania-ESP.md` - wymagania sprzętu i firmware.
- `docs/wymagania-PWA.md` - wymagania PWA, analiza zjazdów i widoki.
- `docs/supabase.md` - architektura Supabase, RLS, granice modułów i preferowany
  przepływ pracy przez MCP.
- `docs/jakosc-danych.md` - przepływ pól jakości GNSS, algorytm potwierdzania
  rekordów, miejsca implementacji i aktualny status weryfikacji.

## Zasady pracy

1. Dokument referencyjny jest źródłem prawdy. Przed zmianą protokołu, layoutu
   OLED, algorytmu routingu lub analizy jakości GNSS i rekordów prędkości
   przeczytaj odpowiedni dokument. Po zmianie decyzji technicznej zaktualizuj
   ten dokument, a `AGENTS.md` tylko wtedy, gdy zmienia reguły pracy kolejnych
   sesji.
2. Firmware zapisuje dane surowe. Ciężkie przetwarzanie — map-matching,
   statystyki oraz numeracja i SSOT cięcia zjazdów — należy do PWA. Urządzenie
   może robić tylko lekką, strumieniową derywację na potrzeby HUD
   (np. `core::RunTracker`).
3. PWA i firmware mają identyczne definicje wspólnego protokołu i wspólny SSOT
   w `protocol/*.json`; wygenerowanych plików nie edytuje się ręcznie.
4. Nie zmieniaj potwierdzonych sprzętowo profili i progów (zamrożony profil BLE,
   reguły cięcia zjazdu) bez osobnego benchmarku na realnym ESP32 i Androidzie
   albo wyraźnego uzgodnienia.
5. PWA nie bramkuje funkcji po wersji firmware; bieżące ustawienia urządzenia
   czyta wprost z INFO.
6. Pracuj test-first: bug i nową funkcję zaczynaj od testu (czerwony, potem
   zielony), a test zostaje jako regresyjny. Warstwę dobieraj wiernie wobec
   problemu. Czego nie da się przetestować (sprzęt, render OLED, realne BLE,
   wygląd mapy), krótko uzasadnij w zmianie; zanim uznasz coś za nietestowalne,
   wydziel czystą logikę do `core/` albo czystych helperów.
7. Wyniki niepotwierdzone sprzętowo oznaczaj jako niepotwierdzone.
8. Nie sprawdzaj statusu GitHub Actions po wypchnięciu i nie wspominaj, że tego
   nie zrobiłeś(-aś) — build weryfikuje użytkownik.
9. W rozmowie z użytkownikiem nigdy nie nazywaj pakietów protokołu samą literą.
   Zawsze dopisz, co to za pakiet, np. `'Q' (odpowiedź na parowanie)` zamiast
   samo „pakiet Q". Użytkownik nie pamięta liter — litera bez opisu jest dla
   niego bezużyteczna.
10. Zmiany w projekcie Supabase wykonuj preferencyjnie przez projektowo
   ograniczony MCP, zgodnie z `docs/supabase.md`. Repozytorium nie używa lokalnego
   `supabase/migrations/` ani automatycznego wdrażania schematu przez GitHub.

## Procedura wgrywania firmware (obowiązkowa)

Dwa urządzenia, dwie różne drogi:

- **Szusownik (ESP32-S3)** — po kablu, port `COMx` z `arduino-cli board list`
  (Windows nadaje COM per urządzenie: u nas czerwona = **COM7**, niebieska =
  **COM6**).
- **HudRekaw (ESP8266 + ST7789)** — **tylko przez OTA** (WiFi, bez kabla).

### Szusownik (COM7/COM6, po kablu)

FQBN: `esp32:esp32:esp32s3:FlashSize=4M,PSRAM=enabled,USBMode=hwcdc,CDCOnBoot=cdc`.
Monitor szeregowy blokuje port, więc kolejność jest sztywna:

1. Zamknij monitor (jeśli działa — zajmuje port i upload się nie powiedzie):
   `taskkill /F /IM arduino-cli.exe`.
2. Skompiluj jawnie i wgraj ten build **z nazwą BLE tej sztuki** (z katalogu
   repo; biblioteki: TinyGPSPlus, NimBLE, SSD1306, miniz vendored). Każda sztuka
   ma własną nazwę w reklamie, więc build bez nazwy jest błędem:
   ```powershell
   flash_szusownik.cmd "Szusownik Red"            # czerwona, COM7
   flash_szusownik.cmd "Szusownik Blue" COM6      # niebieska, COM6
   ```
   Port zależy od sztuki (Windows nadaje COM per urządzenie, nie per projekt):
   sprawdź `arduino-cli board list`. Domyślnie skrypt bierze COM7.
   Skrypt robi krok 1–2; monitor uruchom osobno (krok 3). Ręcznie (komenda
   **musi iść z pliku `.cmd`** — PowerShell 5.1 gubi cudzysłowy w wartości
   `--build-property`; `\040` to spacja w literale C (ósemkowo, bo `\x20B`
   skleiłoby się w jeden znak 0x20B), a surowa spacja rozcina argument):
   ```bat
   rem czerwona (COM7)
   arduino-cli compile --fqbn "<FQBN>" --build-property "compiler.cpp.extra_flags=-DSZ_DEVICE_NAME=\"Szusownik\040Red\"" --output-dir build/szusownik firmware/Szusownik
   arduino-cli upload -p COM7 --fqbn "<FQBN>" --input-dir build/szusownik firmware/Szusownik
   rem niebieska (COM6)
   arduino-cli compile --fqbn "<FQBN>" --build-property "compiler.cpp.extra_flags=-DSZ_DEVICE_NAME=\"Szusownik\040Blue\"" --output-dir build/szusownik firmware/Szusownik
   arduino-cli upload -p COM6 --fqbn "<FQBN>" --input-dir build/szusownik firmware/Szusownik
   ```
3. Od razu po wgraniu odpal monitor w osobnym oknie: czerwona →
   `monitor_COM7.cmd`, niebieska → `monitor_COM6.cmd` (z katalogu repo; nie
   blokuje wywołania):
   `Start-Process -FilePath "<repo>\monitor_COM6.cmd"`
   żeby widać było logi od startu urządzenia. Skrypt pokazuje logi na konsoli
   **i** zapisuje je do `monitor_COM7.log` / `monitor_COM6.log` w katalogu repo
   (UTF-8, plik jest czyszczony przy każdym starcie) — agent może czytać ten
   plik, gdy nie widzi okna konsoli. Po wgraniu musi być w logu
   `BLE start name=Szusownik <Red|Blue>`.

Uwagi: `arduino-cli upload` bez `--input-dir` potrafi użyć przeterminowanego
cache build i wgrać starą binarkę, ignorując zmianę w nagłówku (`config.h`,
`log.h`). Dlatego zawsze kompiluj jawnie do `--output-dir` i wgrywaj ten katalog.

`arduino-cli monitor` odpalone przez agenta w tle (bez TTY) wychodzi
natychmiast z pustym logiem — dlatego używamy `monitor_COM7.cmd`, który działa
poprawnie. Joby/processy w tle (`Start-Job`, `Start-Process` z samym monitorem)
nie przetrwają do kolejnego wywołania `bash` — ale okno konsoli z `.cmd`
zostaje (osobny proces systemowy), więc logi są widoczne dla użytkownika.

Nie odwracać kolejności (monitor → upload kończy się błędem zajętego portu).

### HudRekaw (tylko OTA)

HudRekaw nie ma osobnego portu `COM`. Po podłączeniu do WiFi jest widoczny w
`arduino-cli board list` jako **port sieciowy** (np. `hud-rekaw at 192.168.100.107`),
a podgląd stanu odpowiada pod `http://<ip>/` (nagłówek `HudRekaw v1`) i pod
`http://hud-rekaw.local/`.

Warunki OTA: działająca sieć WiFi z `firmware/HudRekaw/secrets.h` (gitignored),
hasło `OTA_PASSWORD` z tego pliku (domyślnie `hud-ota`, użytkownik `admin`) oraz
router na kanale 1 — inaczej odbiornik traci ESP-NOW z Szusownikiem.

FQBN: `esp8266:esp8266:nodemcuv2:eesz=4M1M`.

Kolejność:

1. Ustal adres IP: `arduino-cli board list` (albo `http://hud-rekaw.local/`).
2. Sprawdź, że urządzenie odpowiada: `curl.exe http://<ip>/`.
3. Skompiluj jawnie, potem `arduino-cli upload` (espota):
   ```powershell
   arduino-cli compile --fqbn "esp8266:esp8266:nodemcuv2:eesz=4M1M" --output-dir build/hudrekaw firmware/HudRekaw
   arduino-cli upload -p <ip> --fqbn "esp8266:esp8266:nodemcuv2:eesz=4M1M" --input-dir build/hudrekaw --upload-field password=<OTA_PASSWORD> firmware/HudRekaw
   ```
   To potrafi się wysypać po `Authenticating...OK` błędem
   `No response from device`. Wtedy użyj kroku 4.
4. **Niezawodnie — wgranie przez HTTP `/update`** (kompilacja do binarki + POST):
   ```powershell
   arduino-cli compile --fqbn "esp8266:esp8266:nodemcuv2:eesz=4M1M" --output-dir build/hudrekaw firmware/HudRekaw
   curl.exe -u admin:<OTA_PASSWORD> -F "firmware=@build/hudrekaw/HudRekaw.ino.bin" http://<ip>/update
   ```
   Sukces = `Update Success! Rebooting...`. Urządzenie restartuje się i wraca do
   sieci po ~15–30 s — w tym czasie HTTP może nie odpowiadać.
5. Weryfikacja: `curl.exe http://<ip>/` (nagłówek `HudRekaw v1`, świeży
   `last packet` gdy Szusownik ma fix).

Bez `secrets.h` (brak sieci) HudRekaw startuje jako SoftAP **`HudRekaw` /
`hudrekaw`** na `192.168.4.1`, z wymuszonym kanałem 1. Po podłączeniu komputera
do tego AP wgraj tak samo przez `http://192.168.4.1/update`.

Do OTA nie jest potrzebny zamknięty monitor `COM7` — to inne urządzenie.

## Praca w worktree (zależności PWA)

`node_modules` nie jest współdzielone między worktree. Domyślna zasada:

1. W worktree **nie instaluj** — zrób junction `web\node_modules` do
   `web\node_modules` w głównym checkoutcie:
   `New-Item -ItemType Junction -Path web\node_modules -Target <glowny-checkout>\web\node_modules`
   (junction, nie symlink — nie wymaga admina).
2. Brakuje zależności? `npm i` w worktree — zapis idzie przez junction, link
   zostaje i jest szybko.
3. Zmienił się `web/package-lock.json`? Wtedy `npm ci` **w katalogu głównym**
   (deterministycznie, nie modyfikuje locka) — odświeży shared `node_modules`
   dla wszystkich worktree.
4. Nie uruchamiaj instalacji równolegle w kilku worktree — to ten sam katalog.
5. Kiedy użytkownik prosi o wypchnięcie zmian do repozytorium, zawsze przenoś sesję do folderu głównego, upewnij się, że pracujesz na najnowszym main, wypchnij zmiany a następnie usuń nie używany już worktree.
