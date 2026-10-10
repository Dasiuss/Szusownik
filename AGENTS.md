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

1. Przed zmianą protokołu, layoutu OLED, algorytmu routingu lub analizy jakości
   GNSS i rekordów prędkości przeczytaj odpowiedni dokument referencyjny.
2. Nie zmieniaj potwierdzonego profilu BLE `244 B / 240 B payload / 128 ramek /
   ACK co 32 / pacing 4 ms` bez osobnego benchmarku na rzeczywistym ESP32 i
   Androidzie.
3. Nie traktuj bufora aplikacyjnego ramek jako kolejki wewnętrznej NimBLE.
   Stabilność transferu wynika ze stałego pacingu, a nie z prób sterowania
   licznikiem mbufów. W `pumpStream` **najpierw opróżniaj `pend_`** (wyślij pełne
   ramki), a dopiero potem dopisuj output kompresora — odwrotna kolejność przy
   zablokowanym pacingu przepełnia `pend_[512]` i crashuje przy plikach
   wieloramkowych.
4. Firmware zapisuje dane surowe. Ciężkie przetwarzanie (map-matching,
   statystyki, **numeracja i SSOT cięcia zjazdów**) należy do PWA; urządzenie może
   robić lekką, strumieniową derywację na potrzeby HUD (np. `core::RunTracker` —
   port ZigZag dla hero, reguła 19).
5. PWA i firmware muszą mieć identyczne definicje wspólnego protokołu
   (SSOT: `protocol/*.json`) i zgodną wersję protokołu.
6. Pinout `Szusownik` ma pierwszeństwo przed pinoutem `DisplayTest`. W finalnym
   projekcie OLED używa I2C na GPIO8/GPIO9, bo GPIO1-4 są przeznaczone dla SD.
   Barometr BME280 (adres `0x77`) dzieli tę samą magistralę I2C.
7. Wyniki testów, które nie były potwierdzone sprzętowo lub są znane tylko z
   implementacji testowej, oznaczaj jako niepotwierdzone.
8. Po zmianie decyzji technicznej aktualizuj dokument referencyjny oraz ten
   plik, jeśli zmiana wpływa na zasady pracy kolejnych sesji.
9. Zapis próbki GPS na SD jest wyzwalany **nadejściem nowej epoki GNSS**
   (`Gnss::consumeNewSample()`), a nie zegarem pętli (`nextLog`). Nie wracaj do
   zapisu sterowanego osobnym interwałem `millis()` — powodował duplikaty i cichy
   hold pozycji przy dudnieniu z meas rate odbiornika. Szczegóły w
   `docs/wymagania-ESP.md`.
10. PWA **nie bramkuje funkcji po wersji firmware** (żadnych „To urządzenie wymaga
    firmware X+"). Dystrybucja zawsze dostarcza najnowszy FW. Bieżące ustawienia
    urządzenia PWA czyta wprost z INFO (odświeżanego po każdym `SET*`); komendy
    `GETVOL/GETFREQ/GETTIMING/GETMINBEEP` zostały usunięte z firmware. Nie
    przywracaj fallbacków wersji ani komend `GET*`.
11. Nie sprawdzaj statusu GitHub Actions po wypchnięciu na repo i nie wspominaj,
    że tego nie zrobiłeś(-aś) — to domyślne zachowanie, nie trzeba o nim
    przypominać. Build weryfikuje sam użytkownik i zgłasza, jeśli coś się nie
    powiodło.
12. Nie wkładaj pełnej listy plików do INFO. Wartość atrybutu ATT ma limit 512 B
    (Web Bluetooth nie odczyta więcej), a przekroczenie zeruje ją w NimBLE — PWA
    dostaje 0 B. INFO niesie tylko `fileCount` i ustawienia; metadane plików
    pobiera się stronicowanym `LIST:<since>` (STATUS `list <since> <nazwa> <rozmiar> ...`,
    echo kursora, "0" = puste, do 12 wpisów). Kursor = największa rozwiązana nazwa; pusta lista = brak
    nowych. Nieudane pobrania wracają po nazwie z `pendingFiles` bez listowania.
    Szczegóły w `docs/ble-transfer.md` §10.
13. PWA liczy zjazdy ze **scalonego śladu wszystkich plików** (jedna oś czasu,
    sortowanie po `Date.parse(t)`, dedup tylko realnych powtórek na styku plików),
    grupowanego po lokalnym dniu i ciętego raz na dzień. Nie wracaj do analizy
    per plik: rotacja na postoju rozbijałaby jeden zjazd na kilka. Identyfikator
    zjazdu jest stabilny (`dayKey::startT`), a etykiety (tabela `runLabels`) i
    usunięcia (tombstone `deletedRuns`) kluczują się tym id i muszą przeżyć
    re-analizę. Reguła cięcia: podejścia (wyciągi) >= 5 m wykrywamy histerezą
    (ZigZag), ale cięcie robimy **jedno, na dołku** — „Zjazd X" = wyciąg + zjazd,
    a odcinki są ciągłe. Próg nie jest liczony per próbka (odporność na szum i
    częstotliwość próbkowania). Zmiana progu/reguły wymaga osobnego uzgodnienia.
    Szczegóły w `docs/wymagania-PWA.md` §6/§7. Gdzie to żyje: SSOT to ZigZag
    w PWA; firmware pisze surowe dane, a `runActive` i rolka na urządzeniu to
    **nie** zjazd; hero HUD to port ZigZag (`core::RunTracker`, reguła 19).
14. Logi mają poziomy `E/W/I/D` (`src/config/log.h`, próg `SZ_LOG_LEVEL`).
    Domyślny INFO = zdarzenia (fix acquired/lost, SD, cykl życia BLE, health,
    boot) oraz szczegółowy przebieg transferu BLE. Status okresowy, per-próbka
    GNSS i diagnostyka UBX/BLE są tylko w DEBUG i wycinane kompilacyjnie.
    Nie przywracaj osobnych `SZ_DEBUG_*`/`SZ_STOK_MODE` ani per-próbkowego
    `FIX`/`SAMPLE` — dane per próbka są trwale w CSV.
15. Plik CSV bez pliku towarzyszącego `<nazwa>.csv.meta` jest „postojowy":
    firmware go **nie listuje** (`countCsv`/`csvAt` tylko z `.meta`), więc PWA go
    nie widzi i nie pobiera. `.meta` powstaje po potwierdzonym ruchu (>5 km/h
    przez 3 s, `Storage::ensureMeta`), a jego brak ma niezawodnie znaczyć „brak
    jazdy". Nie wracaj do progu rozmiaru ani migracji starych plików (greenfield).
    Trwale uszkodzone pliki z `.meta` (rozmiar/CRC/nagłówek/brak próbek) PWA
    zapisuje w tabeli `ignoredFiles` i nie ponawia; ostrzega raz, z podpowiedzią
    odzyskania z karty na komputerze. Błędy przejściowe (timeout, rozłączenie,
    kody `err:`) zostają w kolejce do ponowienia. Szczegóły w
    `docs/wymagania-ESP.md` §6/§7 i `docs/wymagania-PWA.md` §7.
16. Testy: przepływy i funkcje integracyjnie/e2e, unitowe tylko dla cięższej
    logiki, uruchamiane **lokalnie** (bez joba w CI, bez progu pokrycia). PWA: Vitest
    (`web/src/lib/*.test.ts`, integracja z `fake-indexeddb`) i Playwright
    (`web/e2e/`). Firmware: czysta logika w `firmware/Szusownik/src/core/`
    (bez `Arduino.h`) i testy hostowe Catch2
    (`firmware/test/host/run.ps1`, wymaga MinGW-w64). Wspólny protokół ma SSOT
    w `protocol/ble-file-v1.json`; po zmianie uruchom `node scripts/gen-protocol.mjs`
    — test `web/src/lib/protocol.test.ts` pilnuje zgodności wygenerowanych plików.
    Testy sprzętowe (docs §12/§10/§11) zostają manualne. Szczegóły w `docs/testy.md`.
17. Praca test-first (TDD): bugi i nowe funkcje zaczynaj od testu.
    - **Bug**: najpierw dodaj test, który go reprodukuje (czerwony), potem napraw.
      Test zostaje jako regresyjny.
    - **Nowa funkcja / zmiana zachowania**: najpierw test (czerwony), potem
      implementacja (zielony).
    - Warstwę dobieraj wiernie wobec problemu, ale preferuj integracyjne/e2e;
      unitowe tylko dla izolowanej, cięższej logiki.
    - **Refaktor** opiera się na istniejących testach; test charakteryzujący dodaj
      tylko, gdy brakuje pokrycia.
    - Nie wszystko da się przetestować (sprzęt, render OLED, realne BLE, wygląd
      mapy). Wtedy agent decyduje sam i krótko uzasadnia brak testu w zmianie/
      commicie. Zanim uzna zmianę za nietestowalną, próbuje wydzielić czystą
      logikę do `core/` albo czystych helperów, żeby dała się pokryć.
    - Testy sprzętowe zostają manualne (`docs/testy.md`).

18. Link HUD Szusownik -> HudRekaw działa po **ESP-NOW** (kanał `HUD_LINK_CHANNEL`
    = 1, broadcast). Tryb odbiornika zależy od prędkości: `> 5 km/h` (próg
    `HUD_STATS_ABOVE_KMH`) -> statystyki, inaczej mapa. Wysyłka jest zależna od
    trybu: statystyki -> tylko `S` co 1 s, mapa -> tylko `L` co 5 s; **zmiana
    trybu wysyła natychmiast jeden `L`** (tylko `L` niesie `mode`). TOT w `S`
    jest w **0,1 km** (`km × HUD_TOT_SCALE`). Transfer BLE ma priorytet: gdy
    `BleFiles::busy()`, wysyłka ESP-NOW jest wstrzymana. SSOT protokołu:
    `protocol/hud-espnow-v1.json` + `scripts/gen-hud-protocol.mjs` (generuje
    identyczny `hud_protocol.h` do obu firmware; pilnuje tego
    `web/src/lib/hudProtocol.test.ts`). Odbiornik (ESP8266 + ST7789) mieszka w
    `firmware/HudRekaw/` i jest rozwiązaniem docelowym — nie rozwijamy już
    projektu testowego DisplayTest. Bufor kandydatów labeli mapy w odbiorniku
    (`gLabelCandidates`) jest **statyczny, nigdy lokalny**: ESP8266 ma 4 KB
    stosu `loop()`, a ~4,4 KB tablica na stosie resetuje urządzenie przy
    pierwszej ramce `L`. Szczegóły: `docs/hud-rekaw.md`.

19. OLED Szusownika to **jeden ekran statystyk**: hero „MAX ZJAZDU", MAX DNIA,
    DYSTANS, WYSOKOSC (fuzja baro+GPS) i czas lokalny (UTC + `SZ_HUD_TZ_OFFSET_MIN`,
    bez etykiety). **Nie ma tam mapy, bitmap trasy ani animacji** — mapę ma
    HudRekaw. Hero liczy `core::RunTracker` (strumieniowy port ZigZag z PWA:
    fuzja baro+GPS τ=10 s → MA5 → histereza 5 m): **live w zjeździe, zamrożony na
    wyciągu**. Font Adafruit GFX jest ASCII — brak polskich znaków (`WYSOKOSC`)
    i glifu strzałki (linia trasy używa `<`/`>`). Dolna linia to zarezerwowane
    miejsce na przyszłą trasę z PWA (roadmapa; bez protokołu wysyłki). Szczegóły:
    `docs/hud-display.md`.

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

