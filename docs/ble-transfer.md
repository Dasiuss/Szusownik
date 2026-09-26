# Szusownik - referencyjny transfer BLE

> Źródło wiedzy: `BleTest/agents.md` oraz implementacja `BleTest`.
> Status: parametry bazowe sprawdzone na sprzęcie w profilu `v4.5`; kandydat
> `v5` wymaga ponownego potwierdzenia po wgraniu.

## 1. Cel i wynik testów

`BleTest` mierzył transfer większego pliku z ESP32-S3-Zero do Chrome na
Androidzie wyłącznie przez BLE. Telefon nie przełączał się na Wi-Fi.

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
Chrome Android PWA <-------------------------+
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
| `ROUTE_ACK_RETRY_LIMIT` | `3` | maksymalna liczba replay po timeoutach |
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

`BLECharacteristic::notify()` nie raportuje, czy NimBLE przyjął pakiet. Nie
wolno traktować jego wywołania jako potwierdzenia wysłania. Stabilność profilu
wynika ze stałego tempa, a utracone ramki odzyskuje ACK/NACK i ring buffer.

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
> Test e2e z telefonem — przed nami.

GATT v1 (nowe UUID, nie mieszać z testowymi `7e6d…` / `5f8a…`):

```text
Service: 3f9a0001-7c4e-4b2a-9e11-000000000001  (nazwa reklamowana: "Szusownik")
INFO:    3f9a0002-...  READ    — JSON {proto, fw, fileCount, ...ustawienia}
CTRL:    3f9a0003-...  WRITE   — komendy tekstowe (patrz niżej)
DATA:    3f9a0004-...  NOTIFY  — ramki 244 B (seq LE32 + do 240 B payload)
STATUS:  3f9a0005-...  READ+NOTIFY — stan i kody błędów ("ok", "streaming",
                          "done raw=.. comp=.. frames=.. crc=..", "err:..")
```

Komendy CTRL:

```text
LIST_FILES            — odśwież INFO (bez efektów ubocznych)
ROTATE                — zamknij bieżący plik na SD + odśwież INFO
FILE:<i>              — metadane i-tego CSV (kolejność katalogu): STATUS "file <i> <nazwa> <rozmiar>"
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
ocenić długości i odstępy. Firmware konsumuje komendę po odczycie, więc identyczna
komenda może zostać wysłana ponownie bez dodatkowego numeru.

INFO niesie `volLow/volHigh`, `freqShort/freqLong`,
`beepShortMs/beepLongMs/beepGapMs/signalGapMs` oraz `minBeepKmh`. PWA nie odpytuje
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

- Pełna lista plików **nie** jest w INFO. Wartość atrybutu ATT ma twardy limit
  512 B, a Web Bluetooth nie odczyta więcej; przekroczenie limitu zeruje wartość
  w NimBLE (`setValue` → `append` odrzuca `len > max`) i PWA dostaje 0 B
  („Unexpected end of JSON input"). Dlatego INFO niesie tylko `fileCount`, a
  metadane plików PWA pobiera pojedynczo przez `FILE:<i>`
  (STATUS `file <i> <nazwa> <rozmiar>`). Kolejność `i` = kolejność katalogu FAT.
  Indeks musi być w odpowiedzi — PWA dopasowuje status do konkretnego żądania;
  bez indeksu czyta stary status poprzedniego pliku (identyczny wzorzec).
- Metadane zawierają nazwę FAT32 i rozmiar surowy; **bez wersji formatu** w INFO.
  Schemat CSV jest **ewolucyjny** i walidowany po nagłówku. PWA akceptuje
  wyłącznie CSV v2; obecny nagłówek v2 i metryki GNSS opisuje
  `docs/jakosc-danych.md`. Zmiana schematu wymaga jednoczesnej aktualizacji
  firmware i walidatora PWA.
- CRC32 liczone w locie podczas streamingu (nie przy zamykaniu pliku);
  wynik w STATUS `done`; PWA porównuje z własnym CRC po dekompresji.
- Kompresor i okno retransmisji w **PSRAM** (~165 KB + ~31 KB), nie w DRAM.
- Błędy mają jawne kody (`err:open`, `err:deflate`, `err:ack-timeout`,
  `err:busy`, `err:no-storage`, `err:nomem`); PWA po błędzie zawsze wysyła `STOP`.

PWA porównuje nazwy plików z IndexedDB i pobiera tylko nowe. Dane pozostają na
karcie jako backup. Żądanie synchronizacji zamyka najpierw aktualny plik
(`ROTATE`), aby transfer nie czytał pliku, który nadal jest zapisywany.

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
- Dwa różne telefony Android i kilka wersji Chrome.
- Benchmark z wyłączonym szczegółowym logiem DOM, bo logowanie każdej ramki
  zmienia wynik.
