# Szusownik - referencyjny transfer BLE

> Źródło wiedzy: `BleTest/agents.md` oraz implementacja `BleTest`.
> Status: parametry bazowe sprawdzone na sprzęcie w profilu `v4.5`; kandydat
> `v5` wymaga ponownego potwierdzenia po wgraniu.

## 1. Cel i wynik testów

`BleTest` mierzył transfer większego pliku z ESP32-S3-Zero do Chrome (głównie na
Windowsie, sprawdzany też na Androidzie) wyłącznie przez BLE. Klient nie
przełączał się na Wi-Fi.

Najlepszy potwierdzony profil sprzętowy:

| Parametr | Wynik |
| --- | --- |
| Firmware | `v4.5` |
| PWA | `v4.6` |
| Dane surowe | `1 001 000 B` |
| Dane po kompresji | `109 532 B` |
| Redukcja | `9.14x` |
| Czas strumienia | około `3.44 s` według podsumowania; w historii `3.53 s` |
| Przepływność skompresowana | około `30.5 KiB/s`, `249.6 kbit/s` |
| Ramki | około `467` |
| NACK | `0` |
| Retransmisje | `0` |
| Błędy NimBLE | `0` |

Różnica `3.44 s` kontra `3.53 s` pozostaje nierozstrzygnięta, bo w repozytorium
nie ma surowego logu benchmarku. Nie należy używać jednej z tych wartości jako
formalnego limitu bez ponownego pomiaru.

## 2. Architektura transportu

```text
ESP32-S3
  PROGMEM/SD -> strumieniowy zlib/DEFLATE -> ramki BLE NOTIFY
                                              |
Chrome PWA (Windows/Android) <----------------+
  Web Bluetooth -> sekwencje -> ACK/NACK -> DecompressionStream
  -> CRC32 / rozmiar / liczba linii -> OPFS lub Blob/IndexedDB
```

W `BleTest` źródłem był testowy NMEA CSV w `PROGMEM`. W Szusowniku źródłem
produkcji będzie zamknięty plik CSV na microSD. Mechanizm strumieniowania,
kompresji i retransmisji powinien pozostać taki sam, ale należy usunąć
`ROUTE_TEST_REPEATS` i obsłużyć listę plików.

## 3. GATT i ramka danych z testu

Testowy service:

```text
Service:    7e6d0001-7b9e-4f5b-a6c2-320000000001
route info: 7e6d0006-7b9e-4f5b-a6c2-320000000006  READ
route ctrl:  7e6d0007-7b9e-4f5b-a6c2-320000000007  WRITE
route data:  7e6d0008-7b9e-4f5b-a6c2-320000000008  NOTIFY
```

Dla Szusownika UUID-y należy traktować jako testowe. Można zachować ich
strukturę lub przejąć je, jeśli nie ma zewnętrznych konsumentów, ale decyzję
trzeba zapisać jako formalny kontrakt finalnego protokołu.

Ramka aplikacyjna ma maksymalnie `244 B`:

```text
4 B  uint32_t little-endian - numer sekwencyjny
240 B                  - kolejny fragment ciągłego strumienia zlib
```

ESP32 ustawia lokalne MTU `517`, ale telefon negocjuje rzeczywiste MTU. Przy
MTU 23 dostępny payload jest mniejszy. Aktualny testowy limit pozostaje 244 B,
więc każdy mniejszy MTU musi być sprawdzony przed uznaniem transportu za
przenośny.

## 4. Protokół sterowania

Komendy tekstowe wysyłane przez charakterystykę control:

```text
START
STOP
ACK:<next_sequence>
NACK:<expected_sequence>
```

`ACK:32` oznacza, że odbiorca ma poprawnie ramki `0..31` i oczekuje ramki 32.

Przebieg transferu:

1. PWA wyszukuje urządzenie, łączy się z GATT i odkrywa charakterystyki.
2. PWA włącza `startNotifications()` na charakterystyce danych.
3. PWA odczytuje JSON `route info` i sprawdza wersję/profil.
4. PWA uruchamia `DecompressionStream("deflate")`.
5. PWA wysyła `START`.
6. Firmware kompresuje dane w `loop()`, numeruje ramki od zera i wysyła NOTIFY.
7. PWA przyjmuje tylko numer równy `expectedSequence`.
8. Po każdych 32 zaakceptowanych ramkach wysyła skumulowany ACK.
9. Przy numerze późniejszym od oczekiwanego wysyła NACK dla pierwszej brakującej ramki.
10. Firmware odtwarza ramki z pierścienia retransmisji.
11. Pusta ramka z samym nagłówkiem jest end markerem.
12. PWA zamyka wejście dekompresora, kończy walidację i wysyła ACK obejmujący end marker.
13. Firmware kończy transfer dopiero po otrzymaniu tego ACK.

Zachowanie odbiornika:

- numer wcześniejszy niż oczekiwany: duplikat, nie wolno ponownie przekazywać
  payloadu do dekompresora;
- numer późniejszy: luka, wysłać NACK;
- numer oczekiwany: przekazać tylko payload do dekompresora i zwiększyć oczekiwanie.

## 5. Parametry, których nie wolno zmieniać bez benchmarku

| Stała | Wartość referencyjna | Znaczenie |
| --- | ---: | --- |
| `ROUTE_MAX_FRAME_SIZE` | `244 B` | rozmiar ramki z nagłówkiem |
| `ROUTE_FRAME_HEADER_SIZE` | `4 B` | sekwencja LE |
| payload | `240 B` | maksymalna porcja kompresowanego strumienia |
| `ROUTE_INPUT_BUFFER_SIZE` | `512 B` | porcja wejścia z flash/źródła |
| `ROUTE_NOTIFY_ACK_BLOCK_SIZE` | `32` | liczba zaakceptowanych ramek na skumulowany ACK |
| `ROUTE_NOTIFY_WINDOW_SIZE` | `128` | maksymalna liczba niepotwierdzonych ramek |
| `ROUTE_NOTIFY_INTERVAL_MS` | `4 ms` | minimalny odstęp prób NOTIFY |
| `ROUTE_ACK_TIMEOUT_MS` | `500 ms` | timeout oczekiwania na ACK |
| `ROUTE_ACK_RETRY_LIMIT` | `6` | maksymalna liczba replay po timeoutach (2026-10-15: `3`→`6`, ~3 s tolerancji; do potwierdzenia benchmarkiem) |
| PWA output flush | `16 KiB` | agregacja danych przed zapisem |
| PWA transfer timeout | `120 s` | zabezpieczenie przed zawieszeniem |

`window_chunks=32` w metadanych testu jest blokiem ACK, a `inflight_chunks=128`
jest rozmiarem okna. Te nazwy nie oznaczają liczby bezpiecznych równoległych
wywołań `notify()`.

## 6. Kompresja na ESP32

`BleTest` używa lokalnego `miniz` i niskopoziomowego API `tdefl_*`:

```cpp
TDEFL_DEFAULT_MAX_PROBES |
TDEFL_WRITE_ZLIB_HEADER |
TDEFL_COMPUTE_ADLER32
```

Włączone jest `TDEFL_LESS_MEMORY=1`, co oznacza mniejszy profil pamięci kosztem
potencjalnie niższej szybkości. Kompresor:

- pracuje bez dynamicznej alokacji;
- czyta źródło porcjami po 512 B;
- utrzymuje jeden słownik DEFLATE przez cały plik;
- podaje dane przez `TDEFL_NO_FLUSH`;
- wywołuje `TDEFL_FINISH` dopiero na końcu;
- generuje zlib header i Adler-32.

Nie należy zmieniać profilu kompresji wyłącznie na podstawie czasu CPU. Trzeba
mierzyć jednocześnie czas kompresji ESP32 i rozmiar danych przesłanych przez
BLE. Szybszy kompresor może wygenerować większy wire i wydłużyć całość.

## 7. Okno retransmisji i NimBLE

Bufor aplikacyjny:

```cpp
uint8_t routeWindowBuffer[128][244];
```

Zajmuje około 31,2 KiB na ramki, około 32 KiB z długościami i numerami. Jest
niezależny od wewnętrznej puli `os_mbuf`/`MSYS_1` NimBLE.

Najważniejszy wynik eksperymentów:

- zwiększenie okna zmniejsza koszt oczekiwania na ACK;
- zmniejszenie odstępu NOTIFY do 1 ms przepełnia wewnętrzną pulę NimBLE;
- błąd `ble_att_svr_pkt rc=6` oznacza `BLE_HS_ENOMEM`;
- próba sterowania wysyłką przez liczbę wolnych mbufów nie rozwiązała problemu;
- pacing `4 ms` był najszybszym potwierdzonym profilem bez błędów;
- `8 ms` było bezpieczne, ale wolniejsze.

`BLECharacteristic::notify()` zwraca `false`, gdy NimBLE **nie przyjął** pakietu
(najczęściej brak wolnych mbufów). Tego `false` nie wolno ignorować — ramka
przepada, a przy dużych plikach NACK/replay nie odrobią masowych strat (pomiar
2026-10-16 na Windowsie: `notifyFail=597` przy 183-ramkowym pliku i `err:ack-timeout`).
Dlatego Szusownik **ponawia** ramkę po `false` (z pacing backoff), zamiast liczyć
ją jako wysłaną. Samo `true` nadal nie jest potwierdzeniem dostarczenia —
stabilność profilu wynika ze stałego tempa, a brakujące ramki dodatkowo odzyskuje
ACK/NACK i ring buffer.

## 8. Firmware: zasady implementacji

- Callback BLE ma przyjmować komendy i ustawiać flagi, nie wykonywać kompresji.
- Kompresję i pompę NOTIFY wykonywać w `loop()` lub osobnym kontrolowanym tasku.
- Nie blokować callbacku BLE operacją na karcie SD.
- Przy `START` wyzerować sekwencje, okno, CRC, liczniki i stan pliku.
- Po `STOP`, rozłączeniu lub błędzie zwolnić uchwyt pliku i zatrzymać pompę.
- Po timeoutach ACK rozpocząć replay od najstarszej niepotwierdzonej ramki.
- `tdefl_compress()` zwraca w `*pIn_buf_size` liczbę **skonsumowanych**
  bajtów wejścia, a w `*pOut_buf_size` liczbę **zapisanych** bajtów wyjścia
  (a nie „ile zostało"). Traktowanie ich jak „pozostało" powoduje re-kompresję
  tego samego bufora wejściowego i doklejanie śmieci ze stosu — dokładnie objaw
  „Junk found after end of compressed data" po stronie PWA.
- Bufor stagingu ramki (`pend_`) musi pomieścić **cały** output kompresora
  (użyty `out` ma 256 B > payload 240 B). Przy pacingu `emitFrame()` nie kopiuje
  danych i zwraca `false`; `return` w tym miejscu nie może zgubić reszty bufora,
  bo powstałby dziurawy strumień zlib (PWA: „Junk found after end of compressed
  data"). Najpierw dokładamy cały output do stagingu, potem wysyłamy pełne ramki
  i przesuwamy resztę.
- Zaakceptować ACK tylko w zakresie `oldestUnacked < ack <= nextSequence`.
- Po trzech nieudanych replay zgłosić jawny błąd do PWA, a nie tylko do Serial.
- W finalnej wersji dodać status transferu lub characteristic error/status.

## 9. PWA: odbiór i zapis

W `BleTest`:

- `ReadableStream` przyjmuje payloady po kolejności;
- `DecompressionStream("deflate")` dekompresuje ciągły strumień;
- odbiornik aktualizuje CRC32, rozmiar i liczbę linii na podstawie `LF`;
- wynik jest buforowany do zapisu;
- preferowane jest OPFS, a fallbackiem jest tablica chunków i finalny `Blob`;
- flush wyniku następuje co 16 KiB, a nie po każdym fragmencie;
- po end markerze wykonywana jest walidacja przed udostępnieniem pliku.

Walidacja testowa obejmowała:

- rozmiar pliku;
- liczbę linii;
- CRC32.

W Szusowniku należy dodatkowo walidować schemat CSV, nazwę pliku, wersję
formatu, zakresy liczbowe, nagłówek oraz zgodność `compressed_bytes` z liczbą
otrzymanych danych.

## 10. Protokół plików Szusownika v1 (zaprojektowany i zaimplementowany 2026-09-11)

> Stan: zaimplementowane w `firmware/Szusownik/src/ble/` i `web/src/lib/ble.ts`.
> Listowanie przeprojektowane 2026-09-26 na przyrostowe `LIST:<since>` + trwałą
> kolejkę ponowień po nazwie (szczegóły w „Decyzje" niżej). Test e2e z telefonem
> — przed nami.
> 2026-09-26: widoczność plików przez `.meta` + klasyfikacja błędów po stronie PWA.

GATT v1 (nowe UUID, nie mieszać z testowymi `7e6d…` / `5f8a…`):

```text
Service: 3f9a0001-7c4e-4b2a-9e11-000000000001  (nazwa reklamowana: "Szusownik")
INFO:    3f9a0002-...  READ    — JSON {proto, fw, fileCount, routeCrc, routePoints, ...ustawienia}
CTRL:    3f9a0003-...  WRITE   — komendy tekstowe (patrz niżej)
DATA:    3f9a0004-...  NOTIFY  — ramki 244 B (seq LE32 + do 240 B payload)
STATUS:  3f9a0005-...  READ+NOTIFY — stan i kody błędów. Statusy transferu niosą
                          nazwę pliku, żeby PWA odróżniła odpowiedź bieżącego
                          transferu od poprzedniego: "streaming <nazwa>",
                          "done <nazwa> raw=.. comp=.. frames=.. crc=..",
                          "err:<kod> <nazwa>" (np. err:open, err:read,
                          err:ack-timeout, err:no-storage).
ROUTE:   3f9a0006-...  WRITE   — binarny blob trasy (SSOT protocol/route-v1.json).
                          Porcja = [offset u16 LE, totalLen u16 LE, payload...];
                          PWA pisze porcje przez writeValueWithResponse (potwierdzenie
                          GATT), urządzenie składa je w RAM i waliduje CRC32 całości.
                          STATUS: "route ok crc=.. points=.." / "route err crc=..".
```

Komendy CTRL:

```text
LIST:<since>          — pliki o nazwie > since, rosnąco, do SZ_BLE_LIST_MAX (12)
                        na odpowiedź: STATUS "list <since> <nazwa> <rozmiar> ...".
                        Firmware echo-uje since ("0", gdy puste) — PWA czeka na
                        status z DOKŁADNIE swoim kursorem, inaczej odczytałaby
                        poprzednią odpowiedź (ten sam prefiks `list`) i kursor
                        nie rósłby. Pusta lista = "list <since>"; PWA pyta dalej
                        z since = ostatnia nazwa, aż dostanie pustą.
ROTATE                — zamknij bieżący plik na SD + odśwież INFO
DRYRUN:<nazwa>        — lokalny test SD+miniz+CRC bez radia (wynik w STATUS/logu)
START_FILE:<nazwa>    — start strumienia (plik najpierw zamykany = kompletny)
STOP                  — przerwij transfer
ACK:<next>            — skumulowane potwierdzenie (mam 0..next-1)
NACK:<expected>       — retransmisja od pierwszej brakującej
SETVOL:LOW:<0-100>    — głośność przy 60 km/h (NVS) + feedback: sygnał 60
SETVOL:HIGH:<0-100>   — głośność przy 120 km/h (NVS) + feedback: sygnał 120
SETFREQ:SHORT:<600-1500> — ton krótki w Hz (NVS) + feedback: 1 długi + 2 krótkie
SETFREQ:LONG:<600-1500>  — ton długi w Hz (NVS) + feedback: 1 długi + 2 krótkie
SETTIMING:SHORT:<20-200>       — długość krótkiego tonu w ms (NVS) + 3 sygnały 120
SETTIMING:LONG:<40-500>        — długość długiego tonu w ms (NVS) + 3 sygnały 120
SETTIMING:GAP:<0-500>          — przerwa między tonami wzoru w ms (NVS) + 3 sygnały 120
SETTIMING:INTERVAL:<100-5000>  — przerwa między wzorami w ms (NVS) + 3 sygnały 120
SETMINBEEP:<60-120>            — minimalna prędkość pikania w km/h (NVS) + 3 sygnały 120
```

Ponowne wysłanie `SETVOL`, `SETFREQ`, `SETTIMING` lub `SETMINBEEP` z tą samą wartością również
odtwarza feedback. `SETTIMING` odtwarza trzy pełne wzory 120 km/h, aby można było
ocenić długości i odstępy. Każdy zapis CTRL to jedna pełna komenda (PWA wysyła
jedną komendę na zapis i czeka na STATUS), więc identyczna komenda może być
wysłana ponownie bez dodatkowego numeru.

**Odbiór komend CTRL (2026-09-27, naprawa `CORRUPT HEAP`):** komendy są
przechwytywane w `NimBLECharacteristicCallbacks::onWrite` i wrzucane do
pierścieniowej kolejki (`g_ctrlQ`), którą konsumuje pętla główna. NIE wolno
czytać `chrCtrl->getValue()` z pętli głównej: w NimBLE-Arduino 2.5.1
`writeEvent()` woła w tasku hosta `setValue()` (realloc `m_value`), a `getValue()`
robi `deepCopy()` czytające `source.m_capacity` poza sekcją krytyczną i kopiujące
`m_attr_len + 1` bajtów — równoległy odczyt z zapisem przepełnia bufor i niszczy
stertę (objaw: `CORRUPT HEAP ... got 0x00767363` = końcówka `...csv` komendy
`START_FILE`). Z tego samego powodu bufory `INFO` i `STATUS` są rozgrzewane
(`setValue` z 480-bajtowym wypełnieniem w `begin()`), żeby późniejsze `setValue`
z pętli nie robiło `realloc` w trakcie odczytu przez hosta.

INFO niesie `volLow/volHigh`, `freqShort/freqLong`,
`beepShortMs/beepLongMs/beepGapMs/signalGapMs` oraz `minBeepKmh`. Dodatkowo
`routeCrc` (CRC32 trzymanej trasy w RAM, 0 = brak/pusty) i `routePoints` (liczba
punktów trasy) — PWA porównuje `routeCrc` ze swoją trasą i dosyła tylko różnicę
(szczegóły niżej). PWA nie odpytuje
urządzenia przez `GET*` (komendy usunięte z firmware) — bieżące ustawienia czyta
wprost z INFO po połączeniu, a INFO jest odświeżane po każdym `SET*`. PWA nie
sprawdza wersji firmware ani nie bramkuje sekcji ustawień. Transport ramek
(244/240/128/ACK32/pacing 4 ms) bez zmian — profil zamrożony.

Reklamowanie (advertising) — doprecyzowane 2026-09-25 (NimBLE-Arduino 2.5.1):

- `NimBLEServer::advertiseOnDisconnect(true)` jest **wymagane**. W NimBLE 2.x
  domyślna wartość to `false`, więc po rozłączeniu centrala firmware przestawał
  reklamować i urządzenie znikało z wyboru do momentu restartu ESP.
- `enableScanResponse(true)` przed `setName()`. 128-bitowy UUID usługi
  (18 B) + flagi (3 B) nie zostawiają miejsca na pełną nazwę w pakiecie
  advertising (limit 31 B), a `NimBLEAdvertising::setName()` w tej sytuacji
  zwraca `false` i nazwa nie trafia nigdzie — Android pokazuje wtedy
  „unrecognized device". Nazwa musi iść w scan response.
- Service UUID pozostaje w pakiecie advertising, więc filtr
  `filters: [{ services: [SZ_UUID_SVC] }]` w Web Bluetooth nadal działa.

Decyzje względem pierwotnej granicy funkcjonalnej:

- Pełna lista plików **nie** jest w INFO ani w jednej odpowiedzi. Wartość
  atrybutu ATT ma twardy limit 512 B, a Web Bluetooth nie odczyta więcej;
  przekroczenie limitu zeruje wartość w NimBLE (`setValue` → `append` odrzuca
  `len > max`) i PWA dostaje 0 B („Unexpected end of JSON input"). Dlatego INFO
  niesie tylko `fileCount`, a metadane plików zwraca stronicowane
  `LIST:<since>` (STATUS `list <since> <nazwa> <rozmiar> ...` z echem kursora,
  do `SZ_BLE_LIST_MAX=12`
  wpisów ~30 B każdy). Filtr po nazwie `YYYYMMDD_HHMMSS` (UTC z GNSS) jest
  naturalnym kursorem: PWA pyta o nazwy > ostatnio rozwiązana i dostaje pustą
  listę, gdy nie ma nic nowego — O(nowe), a nie O(ile jest). Odporne na
  niestabilną kolejność katalogu FAT i na kasowanie FIFO (to drugie psuje
  indeksy `FILE:<i>`, dlatego zrezygnowano z indeksowego listowania).
- Metadane zawierają nazwę FAT32 i rozmiar surowy; **bez wersji formatu** w INFO.
  Schemat CSV jest **ewolucyjny** i walidowany po nagłówku. PWA akceptuje
  wyłącznie CSV v2; obecny nagłówek v2 i metryki GNSS opisuje
  `docs/jakosc-danych.md`. Zmiana schematu wymaga jednoczesnej aktualizacji
  firmware i walidatora PWA.
- CRC32 liczone w locie podczas streamingu (nie przy zamykaniu pliku);
  wynik w STATUS `done`; PWA porównuje z własnym CRC po dekompresji.
- Kompresor i okno retransmisji w **PSRAM** (~165 KB + ~31 KB), nie w DRAM.
- **Odczyt SD pojedynczymi sektorami** (2026-09-27): `Storage::openRead` ustawia
  bufor pliku na `512 B` (`File::setBufferSize(512)`). Domyślny bufor stdio 4 KB
  sprawia, że FatFs scala pełne sektory w jeden multi-sektorowy transfer `CMD18`
  (`disk_read` z `count>1`), który na tej karcie/złączu zawodził: pliki >= 1 KB
  dawały `read=0` przy `pos=0`, a <= 1 KB (odpowiednio `count=1`, `CMD17`)
  czytały się. Numery klastrów nie miały znaczenia. Nie usuwaj tego bufora
  „bo domyślny jest szybszy" — bez niego każdy transfer pliku > 1 KB wraca do
  multi-sektorowego odczytu.
- **Kolejność w `pumpStream` (staging `pend_`)** (2026-09-27): najpierw wysyłaj
  pełne ramki ze stagingu, a output kompresora dopisuj tylko, gdy `pendLen_ < 240`.
  Odwrotna kolejność (dopisz, potem wyślij) przy zablokowanym pacingu (`emitFrame`
  zwraca `false` i funkcja robi `return`) pozwalała stagingowi rosnąć między
  `poll()` i przepełnić `pend_[512]` — crash `StoreProhibited` dopiero przy
  plikach wieloramkowych. `pend_` jest wymiarowany na 256 B output + częściową
  ramkę 240 B (razem <= 496).
- **NACK raz na dziurę + scalanie replay** (2026-10-03): pojedyncza zgubiona
  ramka pociąga wiele ramek poza kolejnością, a PWA wysyłała NACK dla każdej z
  nich. Każdy NACK to zapis CTRL z potwierdzeniem (kilkadziesiąt ms), więc
  lawina NACK-ów blokowała odbiór, pogłębiała gubienie i kończyła się błędem
  GATT `NotSupportedError` przy ~28. ramce. Teraz PWA wysyła NACK **tylko raz na
  daną dziurę** (`nackSentFor`), a firmware ignoruje NACK, gdy replay od <= e już
  trwa (`replaying_ && replayPos_ <= e`) — restart cofałby wysyłkę i dusił łącze.
  Test integracyjny pilnuje liczby NACK-ów (3 dziury => dokładnie 3 żądania,
  wcześniej 74). Profil ramek/pacingu bez zmian; odzyskiwanie uzupełnia timeout
  ACK firmware.
- Błędy mają jawne kody (`err:open`, `err:read`, `err:deflate`, `err:ack-timeout`,
  `err:busy`, `err:no-storage`, `err:nomem`); PWA po błędzie zawsze wysyła `STOP`.
  `err:read` = `read()` zwrócił 0 mimo `pos < size` (uszkodzony/nośnik), a nie EOF —
  firmware nie raportuje wtedy pustego pliku jako sukcesu.
- **Trasa nawigacyjna po BLE** (2026-10-10): dedykowana charakterystyka WRITE
  `3f9a0006-…` (SSOT `protocol/route-v1.json` + `scripts/gen-route-protocol.mjs`).
  Blob jest binarny (nagłówek + punkty int16 + odcinki + CRC32), dzielony na
  porcje po 4 B nagłówka + do 508 B; `writeValueWithResponse` daje potwierdzenie
  GATT, a urządzenie składa porcje w staging i waliduje CRC w pętli głównej
  (`commitRoute`). Tożsamość trasy = CRC32; PWA wysyła po każdej zmianie geometrii
  i dosyła raz po reconnect. Nie mieszamy tego z kanałem komend CTRL ani z
  zamrożonym profilem ramek plików — to osobny kanał.
- **Ciche zerwanie łącza po `gattserverdisconnected`** (2026-10-11):
  `SzusownikBle` nasłuchuje zdarzenia, zeruje charakterystyki i woła
  `onDisconnected`; operacje GATT przechodzą przez bramkę `requireLink()`
  (`server.connected` + obecna charakterystyka trasy), która rzuca
  `DeviceDisconnectedError`. `DeviceProvider` wraca wtedy do stanu rozłączonego,
  więc panel trasy pokazuje podpowiedź offline z przyciskiem, a nie surowy
  `DOMException` z Web Bluetooth. Jawny `disconnect()` z PWA tego zdarzenia nie
  wysyła — nie udajemy awarii łącza.
- **Widoczność plików przez `.meta`** (2026-09-26): `countCsv`/`listCsv` listują
  wyłącznie CSV z plikiem towarzyszącym `<nazwa>.csv.meta`, który powstaje po
  potwierdzonym ruchu (`docs/wymagania-ESP.md` §7). Pliki postojowe są ukryte, więc
  PWA ich nie pobiera; `INFO.fileCount` również liczy tylko widoczne pliki.
- **Kolejka ponowień po nazwie + trwały kursor** (2026-09-26): PWA trzyma
  `pendingFiles` (błędy przejściowe) i `meta.syncCursor` = największa rozwiązana
  nazwa. Sync = `ROTATE` → kolejka (`pendingFiles` ∪ nowe z `LIST:<kursor>`) →
  `START_FILE:<nazwa>` po nazwie. Błąd przejściowy wraca po nazwie **bez
  listowania**, więc kursor może przeskoczyć plik, który wypadł, a plik i tak
  zostanie pobrany. Walidacja rozmiaru idzie po `STATUS done raw=..`, nie po
  rozmiarze z listy — ponowienie po nazwie nie potrzebuje metadanych.
- **PWA rozdziela błędy trwałe od przejściowych** (2026-09-26): niezgodny
  rozmiar/CRC, zły nagłówek i brak próbek rzucają `PermanentDownloadError`, a
  `STATUS err:open` (plik zniknął z karty) rzuca `FileGoneError`; oba trafiają do
  `ignoredFiles` (zero ponowień) z jednorazowym ostrzeżeniem. Timeout, rozłączenie
  oraz pozostałe kody `err:` (w tym `err:read`) są przejściowe i lądują w
  `pendingFiles`. Statusy transferu niosą nazwę pliku, więc PWA wykrywa błąd
  (otwarcie/odczyt SD) w kilka sekund, zamiast czekać na timeout transferu: raz w
  oknie startu, a potem sprawdzając STATUS co ~250 ms w trakcie odbioru ramek
  (firmware przerywa bez end markera).
  PWA nie bramkuje tego po wersji firmware.
- **Skan SD nie może zjadać zegara ACK na starcie transferu** (2026-10-11): przy
  `START_FILE` firmware woła `refreshInfo()`, które liczy widoczne pliki
  (`countCsv`). Wersja licząca `SD.exists()` na każdym CSV trwała przy kilkunastu
  plikach ~0,7-0,9 s — dłużej niż `SZ_BLE_ACK_TIMEOUT_MS` (500 ms). Skutek: tuż
  po starcie „ack timeout, replay od 0" zjadał jedną retransmisję (limit 3), a
  pętla notowała stall. Pierwszy (mały) plik przechodził, kolejne kończyły się
  `err:ack-timeout` albo STOP-em PWA — „1 z 10 plików". Poprawki: (1)
  `lastProgressMs_` ustawiane **po** `refreshInfo()` w `startStream`, (2)
  `countCsv` liczy pliki `.meta` w jednym przebiegu katalogu (bez `SD.exists`
  per plik). Na sprzęcie: kilkanaście plików pod rząd `replay=0 ackTimeout=0`.
- **Skan katalogu przez `opendir("/sd")`/`readdir`, bez otwierania plików**
  (2026-10-15): `openNextFile()` (i dawne `SD.exists()`) konstruuje `VFSFileImpl`,
  którego konstruktor woła `fopen()` — FatFs rozwiązuje nazwę liniowo w katalogu,
  więc dla n wpisów koszt rośnie ~O(n²) i skan blokuje pętlę na sekundy
  (`listCsv` ~1,6 s, `countCsv` ~0,8 s). Teraz `countCsv`, `listCsv` i
  `ensureFreeSpace` iterują katalog tanio: nazwy z `readdir`, a rozmiar tylko dla
  ≤ `SZ_BLE_LIST_MAX` zwracanych wpisów przez `stat` (nie czyta danych pliku).
  Znika też ~10 KB statycznych tablic `listCsv`. **Uwaga:** wcześniejsza próba
  (commit `c1527b5`) użyła `opendir("/")` — to korzeń VFS bez zamontowanego
  systemu plików, więc zwracał NULL. Poprawna ścieżka to mountpoint `SZ_SD_MOUNT`
  = `/sd` (`SD.begin` montuje tam domyślnie); `vfs_fat_opendir`/`vfs_fat_readdir`
  są w `libfatfs.a`. PWA ma osobny, dłuższy timeout listowania
  (`LIST_TIMEOUT_MS`, 6 s) i ponawia `LIST` także przy złej odpowiedzi formatu.
- **Skan i fsync nie mogą zjadać zegara ACK w trakcie transferu** (2026-10-15):
  pełny skan katalogu (`refreshInfo`→`countCsv`, wołany m.in. z `commitRoute`
  po wysłaniu trasy) oraz `Storage::sync()` (fsync co 10 s) dzielą pętlę z pompą
  NOTIFY. `refreshInfo()` w trakcie transferu tylko ustawia `infoDirty_` i jest
  doganiany w `finishStream()`; `storage.sync()` jest pomijany, gdy `ble.busy()`.
  PWA nie wysyła trasy równolegle z pobieraniem (sekwencjonuje `flushRoute`).
- **Jedna kolejka operacji GATT po stronie PWA** (2026-10-16): wszystkie operacje
  (INFO/STATUS/CTRL/ROUTE) przechodzą przez `GattQueue`
  (`web/src/lib/gattQueue.ts`), więc odczyt STATUS nie nakłada się na zapis
  potwierdzenia. Chrome potrafi odrzucić nakładającą się operację komunikatem
  `NotSupportedError: GATT operation failed for unknown reason`; objaw na
  urządzeniu: PWA wyrywa się błędem, a firmware nie dostaje **żadnego** ACK
  (okno rośnie do pełnego `unacked` i transfer trzeba przerwać `STOP`).
- **Postęp raportowany rzadko** (2026-10-16): `onFrames`/`onProgress` wołane
  najwyżej co 500 ms (pierwsza ramka od razu, ostatnia wymuszona na końcu pliku),
  a nie na każdą ramkę (~250/s). Setki aktualizacji stanu React na sekundę
  obciążały wątek główny i opóźniały zapisy ACK, pogłębiając gubienie ramek.
- **STATUS odpytywany tylko po ciszy strumienia** (2026-10-16): pętla odbioru
  czyta STATUS dopiero, gdy przez ~1 s nie przyszła żadna ramka (wcześniej co
  250 ms). W zdrowym transferze to zero odczytów STATUS, a przerwanie `err:`
  bez end markera (np. `err:read`) i tak jest wykrywane w ~1 s.
- **Logi diagnostyczne BLE** (2026-10-16): PWA loguje zdarzenia transferu
  (`start`, `NACK n=`, `done` z liczbą dziur, wygaszenie z odczytanym STATUS), bez
  logu każdej ramki (ten zmieniał wynik benchmarku). Firmware `HudLink` loguje
  przełączenie radia ESP-NOW na czas transferu BLE z kosztem
  `esp_wifi_stop()`/`esp_wifi_start()` (`HUD radio OFF/ON`).
- **`writer.write()` z `undefined` nie może zniknąć** (2026-10-16): przy
  uszkodzonym strumieniu `DecompressionStream` odrzuca zapis z `undefined`, a
  `if (failed)` było wtedy fałszywe — błąd dekompresora był połykany i transfer
  wisiał do timeoutu. Teraz każdy błąd jest normalizowany do `Error` i kończy
  się błędem przejściowym (plik wraca do kolejki ponowień).
- **Nieudany zapis kontrolny nie przerywa transferu** (2026-10-16): `ACK:`/`NACK`
  idą przez `safeWriteCtrl`, które toleruje pojedyncze hiccupy GATT — zgubiony
  zapis jest samokorygowalny, bo urządzenie replayuje po własnym timeoucie ACK
  (500 ms). Dopiero **3 nieudane pod rząd** przerywają plik błędem przejściowym,
  a `DeviceDisconnectedError` zawsze przerywa natychmiast. Bez tego jeden
  `NotSupportedError` na zapisie potwierdzenia wywalał cały (poprawnie odebrany)
  plik — to był zaobserwowany tryb awarii przy dużych plikach.
- **Pomiar: czy ramki gubi nadajnik** (2026-10-16): firmware liczy wywołania
  `chrData->notify()` zwracające `false` (`notifyFail=` w logach `BLE done`/
  `BLE abort` i `nf=` w linii SYS). `notify()` nie raportuje sukcesu, więc to
  jedyny tani sposób odróżnienia gubienia po stronie esp32 od gubienia w stosie
  klienta.
- **Retry `notify()` zamiast cichego gubienia ramki** (2026-10-16): pomiar na
  Windowsie pokazał `notifyFail=597` przy 183-ramkowym pliku i `err:ack-timeout`
  (a `notifyFail=0` przy małych plikach) — czyli to **nadajnik** gubił ramki, bo
  `notify()` zwracało `false` (brak mbufów), a firwmare liczył je jako wysłane.
  Teraz `emitFrame`, `sendEndMarker` i replay nie zwiększają sekwencji po
  `false` — ramka wraca po pacing backoff i jest ponawiana. `notifyFail` powinien
  spaść do ~0, a pacing/rozmiar ramki bez zmian (profil zamrożony).

> Status (2026-10-16, po pomiarze): duże pliki padały, bo **nadajnik** masowo
> gubił ramki (`notifyFail` 297–597 dla 95–183 ramek), co dawało `err:ack-timeout`;
> małe pliki (`notifyFail=0`) przechodziły zawsze. `HUD radio` wykluczone.
> Wprowadzone: retry `notify()`, `safeWriteCtrl` (pojedynczy hiccup ACK/NACK nie
> wywala pliku), normalizacja błędu dekompresora. Do potwierdzenia na sprzęcie:
> oczekiwane `notifyFail≈0`, `ackTimeout=0`, `replay` bliski 0 przy dużych plikach.
> Zmiana pacing (zamrożony profil) — tylko jeśli to nie wystarczy i po benchmarku.

PWA pobiera pliki tylko nowe lub z kolejki ponowień, porównując nazwy z IndexedDB.
Dane pozostają na karcie jako backup. Żądanie synchronizacji zamyka najpierw
aktualny plik (`ROTATE`), aby transfer nie czytał pliku, który nadal jest zapisywany.

## 11. Znane problemy z testu — status po implementacji v1 (2026-09-11)

1. Utrata ACK end markera — ZŁAGODZONO z obu stron: firmware retransmituje
   end marker po timeoutcie (jest w oknie), PWA ACK-uje także duplikat
   end markera. Formalny test utraty ACK end markera — przed nami (§12).
2. Brak kanału błędów — ROZWIĄZANE: charakterystyka STATUS z kodami `err:..`.
3. PWA nie zawsze wysyła `STOP` — ROZWIĄZANE: `STOP` w `finally` transferu.
4. Metadane — CZĘŚCIOWO: PWA waliduje protokół, listę, rozmiar, CRC32
   i nagłówek CSV; pełny schemat metadanych (czas startu, wersja) — roadmapa.
5. Brak testu kontrolowanej utraty ramek i wszystkich MTU — NADAL OTWARTE (§12).
6. Niespójności `route_data.h`/generatora BleTest — NIE DOTYCZY Szusownika
   (osobne dane, osobny schemat CSV).

Problemy 1 (test) i 5 trzeba zamknąć testami z §12 przed oznaczeniem protokołu
jako produkcyjny, a nie tylko opisem w dokumentacji.

## 12. Testy akceptacyjne BLE

- Kompletne pliki 1 MB, 5 MB i większe niż dostępny RAM.
- MTU 23, 247 i 517.
- Brak ramek, duplikat ramki, opóźniona ramka i ramka poza kolejnością.
- Utrata ACK zwykłego bloku i utrata ACK end markera.
- Rozłączenie w trakcie kompresji, replay i ponowne połączenie.
- `STOP` z PWA i błąd zapisu na SD.
- CRC, rozmiar, liczba linii i semantyczna poprawność CSV.
- Chrome na Windowsie i na Androidzie (kilka wersji).
- Benchmark z wyłączonym szczegółowym logiem DOM, bo logowanie każdej ramki
  zmienia wynik.
