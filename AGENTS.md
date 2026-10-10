# Szusownik - kontekst projektu

Szusownik to docelowa aplikacja PWA + urządzenie ESP32-S3 do rejestrowania,
przesyłania i analizowania zjazdów narciarskich. Projekt korzysta z ustaleń
wypracowanych w trzech projektach testowych:

- `BleTest` - niezawodny transfer większych plików przez BLE.
- `DisplayTest` - lokalny HUD na OLED SSD1306 oraz bitmapowy protokół ekranu.
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
- `docs/hud-display.md` - OLED Szusownika: layout jednego ekranu statystyk, hero
  „max zjazdu" (port ZigZag z PWA), formatowanie; bez mapy/bitmap/animacji.
- `docs/hud-rekaw.md` - odbiornik HudRekaw (ESP8266 + ST7789), link ESP-NOW
  z Szusownikiem, protokół `S`/`L` i generator mapy.
- `docs/mapy-routing.md` - źródła danych mapowych, warstwy MapLibre, graf tras,
  routing, koszt leksykograficzny i cache.
- `docs/koncepcja.md` - wizja produktu i zakres funkcjonalny.
- `docs/wymagania-ESP.md` - wymagania sprzętu i firmware.
- `docs/wymagania-PWA.md` - wymagania PWA, analiza zjazdów i widoki.
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
9. Tryb nawigacji: PWA wysyła wyznaczoną trasę do Szusownika dedykowaną
   charakterystyką BLE (binarny blob; SSOT `protocol/route-v1.json` +
   `scripts/gen-route-protocol.mjs`). Trasa = uporządkowane odcinki (nazwa+typ) +
   uproszczona polilinia (`int16` metry od origin, decymacja 10 m, limity 512
   punktów / 24 odcinki) + CRC32; **tożsamość trasy = CRC32**. Szusownik trzyma
   trasę w RAM i przekazuje ją do HudRekaw po ESP-NOW (heartbeat `H` + chunki `R`
   z CRC; `segmentIndex` bieżącego odcinka w `S`/`L`). Wysyłka po każdej zmianie
   geometrii (także trim), `CLEAR` przy czyszczeniu, dotarcie ≤30 m czyszczone
   lokalnie na Szusowniku; po reconnect PWA dosyła raz tylko przy różnicy wersji.
   HudRekaw: próg mapy/statystyk 30 km/h, trasa wyróżniona (gruba niebieska linia),
   na dole bieżący + 2 odcinki. Bez trwałego zapisu trasy i bez bramkowania wersji.
   Szczegóły: `docs/hud-rekaw.md`, `docs/ble-transfer.md` §10, `docs/wymagania-ESP.md` §13.

## Procedura wgrywania firmware (obowiązkowa)

Dwa urządzenia, dwie różne drogi:

- **Szusownik (ESP32-S3)** — po kablu, port **`COM7`** (port szeregowy/Szusownik).
- **HudRekaw (ESP8266 + ST7789)** — **tylko przez OTA** (WiFi, bez kabla).

### Szusownik (COM7, po kablu)

FQBN: `esp32:esp32:esp32s3:FlashSize=4M,PSRAM=enabled,USBMode=hwcdc,CDCOnBoot=cdc`.
Monitor szeregowy blokuje port, więc kolejność jest sztywna:

1. Zamknij monitor (jeśli działa — zajmuje `COM7` i upload się nie powiedzie):
   `taskkill /F /IM arduino-cli.exe`.
2. Wgraj: `arduino-cli upload -p COM7 --fqbn "<FQBN>" firmware/Szusownik`
   (z katalogu repo; biblioteki: TinyGPSPlus, NimBLE, SSD1306, miniz vendored).
3. Od razu po wgraniu odpal monitor w osobnym oknie przez `monitor_COM7.cmd`
   z katalogu repo (nie blokuje wywołania):
   `Start-Process -FilePath "<repo>\monitor_COM7.cmd"`
   żeby widać było logi od startu urządzenia.

Uwagi: `arduino-cli monitor` odpalone przez agenta w tle (bez TTY) wychodzi
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
3. `arduino-cli upload` (espota):
   ```powershell
   arduino-cli upload -p <ip> --fqbn "esp8266:esp8266:nodemcuv2:eesz=4M1M" --upload-field password=<OTA_PASSWORD> firmware/HudRekaw
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

## Termika i monitoring (Health)

- ESP32-S3 **nie ma sprzętowego zabezpieczenia termicznego** — sam się nie
  wyłączy przy przegrzaniu. Ochrona jest programowa: moduł `src/health/`
  (`Health`) wołany z głównej pętli (`millis`, bez tasków/ISR).
- Co 30 s (`SZ_HEALTH_CHECK_MS`) czyta `temperatureRead()` (temperatura
  **rdzenia/die**, nie otoczenia; słabo skalibrowana). ≥95 °C po 3 kolejnych
  potwierdzeniach → alarm buzzerem 3 s przy każdym kolejnym odczycie ≥95 °C;
  ≥100 °C → zamknięcie SD, ekran „PRZEGRZANIE" (die/air), alarm i deep sleep.
  Progi/histereza w `config.h` (`SZ_HEALTH_*`).
- Diagnostyka na Serial: linia statusu SYS co 5 s (poziom DEBUG) z
  `die=..C air=..C`; domyślny poziom INFO pokazuje tylko zdarzenia.
- Deep sleep **nie odcina 3V3** — GNSS dalej pobiera ~30 mA i dogrzewa. Na
  stoku nieistotne; przy testach w domu nie trzymać szczelnej obudowy.

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

