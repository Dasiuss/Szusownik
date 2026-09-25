# Jakość danych GNSS i potwierdzanie rekordu prędkości

> **Status:** implementacja jest gotowa; nie została jeszcze zweryfikowana na
> nowym nagraniu narciarskim ani sprzętowo.
> **Data:** 2026-09-24

## 1. Cel i zasady

Aplikacja służy m.in. do bicia rekordów prędkości. Ma odróżniać wiarygodny
odczyt od błędnego piku, a jednocześnie zachowywać wszystkie surowe próbki.

Ustalony model wyniku:

1. Każda próbka-kandydat na maksimum otrzymuje trzy niezależne wyniki: dodatnie
   przyspieszenie, jakość GNSS oraz kształt piku.
2. **Wynik jest potwierdzony tylko wtedy, gdy wszystkie trzy kryteria
   przechodzą.** Każda próbka otrzymuje najwyżej trzy zielone albo czerwone
   ikonki. Brak danych do sprawdzenia kryterium oznacza ikonę czerwoną.
3. Widoczny wynik potwierdzony jest prędkością rzeczywiście zapisaną w próbce,
   nie wartością interpolowaną ani wartością z wierzchołka dopasowanej krzywej.
4. Filtry nie usuwają ani nie nadpisują surowego CSV. Podejrzane maksimum może
   pozostać widoczne jako osobny surowy kandydat.
5. Nie wyliczamy procentowego „confidence score” i nie wyświetlamy tekstowego
   statusu „potwierdzony/niepotwierdzony”. Stan wynika z trzech ikonek.
6. Zostajemy przy bieżącym strumieniu NMEA i prędkości RMC. Nie przechodzimy na
   UBX-NAV-PVT. Nie przebudowujemy teraz milisekund w timestampie CSV.

## 2. Aktualny stan implementacji

### Firmware i zapis

- `firmware/Szusownik/src/gnss/gnss.cpp` używa TinyGPS++ do parsowania NMEA.
  Prędkość pochodzi z RMC i jest prędkością Dopplerowską odbiornika; snapshot
  próbki zawiera też ważność/wiek fixa, satelity i HDOP z ich wiekiem.
- `Gnss::hasFix()` nadal wymaga ważnej pozycji, jej odpowiedniej świeżości oraz
  co najmniej trzech satelitów. Wskaźnik GNSS w PWA dodatkowo wymaga co najmniej
  pięciu satelitów i HDOP ≤2,5.
- Nowy wiersz jest wyzwalany nową próbką GNSS (`consumeNewSample()`), nie
  zegarem pętli. Tempo próbkowania jest adaptacyjne; rzeczywiste odstępy należy
  odczytywać z timestampów, a nie zakładać stałego 10 Hz.
- Nowy CSV v2 ma nagłówek:

  ```text
  timestamp,lat,lon,speed,altitude_gps,heading,altitude_baro,gnss_fix_valid,gnss_fix_age_ms,gnss_satellites,gnss_satellites_age_ms,gnss_hdop,gnss_hdop_age_ms
  ```

- `speed` zapisuje się z dokładnością do 0,1 km/h. Część milisekundowa
  `timestamp` jest wyliczana z `millis()` zakotwiczonego na sekundach czasu GPS;
  nie zmieniamy teraz tego sposobu.
- `hasFix()` nadal odrzuca próbki bez ważnej pozycji/fixa lub bez wymaganej
  liczby satelitów; zapis zachowuje wyzwalanie na nowej epoce GNSS.

### PWA

- `web/src/lib/csv.ts` parsuje CSV v1/v2; v1 pozostaje archiwum bez analizy,
  a puste pola jakości v2 stają się `null`.
- `web/src/lib/runs.ts` liczy dodatnie przyspieszenie, jakość GNSS i odporny
  kształt piku. MA3 nadal służy tylko do wykresu.
- `DayView`, `DaySummaryView` i `HistoryView` pokazują wyłącznie potwierdzone
  maksimum; szczegóły zjazdu pokazują wskaźniki i osobny surowy pik, jeśli jest
  wyższy albo nie ma wyniku potwierdzonego.
- Surowe CSV jest zachowywane w IndexedDB. Wyniki analizy są wersjonowane;
  stare, zmaterializowane zjazdy nie wchodzą do nowych widoków.

## 3. Dane jakości GNSS w obecnym trybie NMEA

NMEA/RMC pozostaje źródłem prędkości. Nie przełączamy odbiornika na NAV-PVT.
Z dostępnych zdań NMEA zapisujemy kontekst jakości fixa:

| Pole CSV v2 | Źródło | Znaczenie |
|---|---|---|
| `gnss_fix_valid` | ważność pozycji/fixa NMEA przy zapisie próbki | Czy próbka ma ważny fix zgodnie z bramką `hasFix()`. |
| `gnss_fix_age_ms` | wiek pozycji TinyGPS++ w chwili zapisu | Świeżość fixa RMC. |
| `gnss_satellites` | liczba satelitów użytych w rozwiązaniu z GGA | Warunek jakości fixa, nie miara dokładności prędkości. |
| `gnss_satellites_age_ms` | wiek pola satelitów w TinyGPS++ | Czy liczba satelitów jest aktualna względem badanego rekordu. |
| `gnss_hdop` | HDOP z GGA | Geometria/rozrzut jakości pozycji; nie jest bezpośrednią dokładnością prędkości. |
| `gnss_hdop_age_ms` | wiek pola HDOP w TinyGPS++ | Czy HDOP jest aktualny względem badanego rekordu. |

Rekomendowany nagłówek nowych plików CSV v2:

```text
timestamp,lat,lon,speed,altitude_gps,heading,altitude_baro,gnss_fix_valid,gnss_fix_age_ms,gnss_satellites,gnss_satellites_age_ms,gnss_hdop,gnss_hdop_age_ms
```

Nieznane wartości zapisujemy jako puste pola, nie jako `0`. Znane wartości
zapisujemy razem z ich wiekiem, nawet jeśli mogą być już nieświeże; PWA odrzuca
je według limitu z §3. Parser PWA odwzorowuje puste pola na `null`; wartość
zerowa nie może udawać poprawnego pomiaru. Wiek pól GNSS należy odczytać z
TinyGPS++ w chwili zapisu próbki, a nie odtwarzać później.

### Kryterium ikonki GNSS

Ikonka GNSS jest zielona wyłącznie wtedy, gdy wszystkie warunki są spełnione:

1. próbka ma ważny fix pozycji według `hasFix()`;
2. w rozwiązaniu użyto co najmniej **5 satelitów**;
3. HDOP jest dostępny i wynosi **nie więcej niż 2,5**;
4. wiek fixa, pola satelitów i HDOP nie przekracza limitu świeżości:

   ```text
   freshLimitMs = min(500, 2 * medianSampleIntervalMs)
   ```

   `medianSampleIntervalMs` liczymy jako medianę **dodatnich** odstępów próbek w
   oknie `±1 s` kandydata; duplikaty czasu nie są odstępem pomiarowym. Jeśli nie
   da się go obliczyć albo dowolne wymagane pole jest
   brakujące/przestarzałe, ikonka jest czerwona.

HDOP i liczba satelitów opisują jakość fixa/geometrię, **nie** gwarantowany błąd
prędkości. Aktualny strumień NMEA nie dostarcza bezpośredniego `sAcc`. `sAcc`
byłoby wartościowym dodatkiem, ale wymagałoby przejścia na NAV-PVT; nie robimy
tego w tej implementacji. Wartość `0,05 m/s` z karty u-blox nie jest używana jako
próg ani gwarancja dla obecnego pomiaru w konkretnym urządzeniu i montażu.

## 4. Trzy kryteria potwierdzenia piku

Analiza odbywa się w PWA dla każdego zjazdu. Dla każdego kandydata przechowujemy
wynik trzech kryteriów jako osobne wartości logiczne. Niedostępne dane oznaczają
`false`, a więc czerwoną ikonkę.

### 4.1 Dodatnie przyspieszenie

Filtr ogranicza **wyłącznie wzrost prędkości**. Hamowanie i inne ujemne
przyspieszenie — nawet duże — nie oblewa tego kryterium.

Dla kolejnych użytecznych próbek, gdzie `timestamp` jest polem ISO z CSV:

```text
dt_s = (Date.parse(timestamp_i) - Date.parse(timestamp_prev)) / 1000
a_plus_mps2 = max(0, (speed_i_kmh - speed_prev_kmh) / 3.6 / dt_s)
g_plus = a_plus_mps2 / 9.81
```

- Kryterium przechodzi, gdy każdy wzrost prędkości istotny dla kandydata wymaga
  **nie więcej niż 1 g** (`a_plus_mps2 <= 9.81`). To twardy próg; nie dodajemy
  marginesu na szum ani odchylenie czasu.
- Spadków prędkości w tym filtrze nie oceniamy. Nie wolno odrzucać piku za
  gwałtowne hamowanie po nim.
- Dla kandydata sprawdzamy wszystkie kolejne przejścia w jego lokalnym oknie
  `±1 s`. Próbki oznaczone przez kryterium kształtu jako odstające pomijamy
  jako kontekst sąsiednich kandydatów; odstęp między sąsiednimi użytecznymi
  próbkami pozostaje różnicą ich rzeczywistych timestampów. Sam oceniany
  kandydat pozostaje w swoim teście przyspieszenia.
- Jeżeli odstęp `dt_s` jest niedodatni albo nie ma wcześniejszej próbki, której
  można użyć do sprawdzenia, kryterium nie przechodzi.
- Kandydaty sprawdzamy od najwyższej prędkości w dół. Po odrzuceniu maksimum
  ponawiamy ocenę dla następnego, pomijając próbki odrzucone przez kształt.
  Dzięki temu błędne `182` nie może sztucznie oblać realistycznego `138` po nim.

Przykład przy odstępach 0,2 s:

| Odcinek | Wymagane przyspieszenie | Wynik tego kryterium |
|---|---:|---|
| `136 → 182 km/h` | ok. `6,5 g` | Czerwone dla kandydata `182`. |
| `136 → 138 km/h` | ok. `0,28 g` | Zielone dla `138`, jeśli `182` pominięto i `dt` wynosi 0,2 s. |
| `138 → 134 km/h` | spadek ok. `0,57 g` | Ignorowany przez filtr przyspieszenia. |

Jeśli `182` zostaje pominięte, rzeczywisty odstęp `136 → 138` obejmuje dwa
interwały (0,4 s); wymagane przyspieszenie jest wtedy jeszcze mniejsze.

Timestamp pozostaje przybliżony w tej fazie. Zgodnie z decyzją produktową
stosujemy jednak twardy limit 1 g; tę regułę trzeba zweryfikować na nowym
nagraniu testowym.

### 4.2 Kształt piku

Nie stosujemy mediany z trzech próbek jako maksimum — mogłaby obniżyć prawdziwy,
krótki szczyt. Nie liczymy wariancji z surowych prędkości, bo miesza ona szum
z rzeczywistym przyspieszaniem i spowalnianiem.

Do oceny wykorzystujemy odporną lokalną krzywą kwadratową:

```text
tau_i = timestamp_i - timestamp_candidate
v(tau) = beta0 + beta1 * tau + beta2 * tau^2
```

Ustalona reguła:

1. Okno obejmuje **wszystkie próbki w zakresie ±1 s** od kandydata.
2. W oknie musi być co najmniej **5 próbek łącznie**, w tym co najmniej **2
   przed** i **2 po** kandydacie. Brak wymaganej liczby próbek daje czerwoną
   ikonkę.
3. Dopasowanie ma być odporne na outliery (Huber M-estimation/IRLS) i używać
   rzeczywistych timestampów. Startujemy od zwykłego dopasowania kwadratowego.
   W każdej iteracji liczymy reszty `r_i`, ich skalę
   `s=max(1,4826*MAD(r), 0,1 km/h)`, a następnie wagi:

   ```text
   u_i = abs(r_i) / s
   w_i = 1                         if u_i <= 1.345
   w_i = 1.345 / u_i               otherwise
   ```

   Ponownie rozwiązujemy ważone dopasowanie kwadratowe. Kończymy po 10
   iteracjach albo gdy maksymalna zmiana przewidywanej prędkości w oknie jest
   mniejsza niż `1e-4 km/h`. Model dopuszcza zarówno niemal płaski przebieg
   (`beta1`, `beta2` bliskie zeru), jak i zaokrąglony szczyt.
4. Resztę kandydata liczymy jako różnicę między jego prędkością a wartością
   dopasowanej krzywej w jego chwili. Wierzchołka krzywej nie przedstawiamy
   jako zmierzonej prędkości.
5. Z reszt dopasowania liczymy:

   ```text
   MAD = median(abs(residual_i - median(residual)))
   robustSigma = 1.4826 * MAD
   shapeLimitKmh = max(1.0, 3 * robustSigma)
   ```

   Kształt przechodzi, gdy bezwzględna reszta kandydata nie przekracza
   `shapeLimitKmh`. MAD opisuje lokalny rozrzut; mnożnik nie oznacza procentowej
   gwarancji ani przedziału ufności.
6. Jeżeli w lokalnym oknie występuje luka większa niż
   `freshLimitMs = min(500, 2 * medianSampleIntervalMs)`, ikonka jest czerwona.

Przykłady:

- `131, 131, 132, 131, 132` — plateau z niewielkimi wahaniami, nie należy
  automatycznie uznawać `132` za błąd.
- `130, 133, 136, 134, 131` — dopuszczalny lokalny szczyt; pojedyncze najwyższe
  wskazanie może przejść, jeśli pasuje do zaokrąglonego przebiegu i spełnia
  pozostałe kryteria.
- `131, 134, 136, 182, 138, 134, 130, 128` — `182` odstaje od lokalnego
  przebiegu, a po jego pominięciu `138` może przejść jako realny rekord.

### 4.3 Ikonka jakości GNSS

Kryterium GNSS stosuje progi i świeżość z §3. Nie jest to ocena bezwzględnej
dokładności prędkości; przy obecnym źródle NMEA informuje o jakości fixa i
geometrii satelitów.

## 5. Kandydaci, wynik i ikonki

Dla zjazdu kandydatami są rzeczywiste próbki, sprawdzane w kolejności malejącej
prędkości (przy remisie wcześniejsza próbka). Dla zjazdu przechowujemy co
najmniej:

- `rawMaxSpeed` i próbkę, z której pochodzi, wraz z trzema wynikami;
- `confirmedMaxSpeed`: najwyższą **rzeczywistą próbkę**, dla której wszystkie
  trzy kryteria są zielone, wraz z jej próbką i wynikami; nie interpolujemy i
  nie zastępujemy jej krzywą. Gdy takiego kandydata nie ma, wartość jest `null`.

Zielona ikona oznacza przejście swojego kryterium, czerwona — niespełnienie lub
brak danych. Wynik jest potwierdzony wyłącznie przy trzech zielonych ikonach.
W logice PWA są tylko dwa stany wyniku: `confirmed` (trzy zielone) i
`unconfirmed` (co najmniej jedna czerwona). Ikony są jedynym widocznym statusem;
nie wyświetlamy tekstu „potwierdzony/niepotwierdzony” ani procentu.

Ikonki oznaczają kolejno:

1. dodatnie przyspieszenie;
2. GNSS (ważny fix, satelity, HDOP i ich świeżość);
3. kształt piku.

W szczegółach zjazdu pokazujemy potwierdzony wynik z ikonkami. Jeżeli surowe
maksimum jest wyższe lub nie ma żadnego potwierdzonego wyniku, pokazujemy je
dodatkowo jako surowe maksimum z trzema czerwonymi/zielonymi ikonkami — bez
tekstowej etykiety statusu. Wartość dopasowana z modelu nie zastępuje żadnego
odczytu.

## 6. Zachowanie widoków

- Strona główna zachowuje obecny wygląd i pojedyncze pole prędkości. Wartość to
  najwyższy `confirmedMaxSpeed`; bez potwierdzonego wyniku pokazujemy `—`.
- Dzisiaj, Historia i Cały dzień agregują wyłącznie potwierdzone rekordy.
- Ikony jakości pojawiają się tylko w szczegółach zjazdu, obok odpowiedniej
  wartości prędkości. Nie dodajemy ikon na stronie głównej.
- Każda ikona ma dostępny opis dla technologii asystujących; nie dodaje to
  widocznego tekstowego statusu.

## 7. CSV i zgodność danych

- Firmware zapisuje nowy nagłówek v2 z polami GNSS z §3. `Gnss::consumeNewSample()`
  nadal wyzwala jeden zapis na nową epokę GNSS; nie wracamy do timera pętli.
- PWA parsuje pola v2 jako opcjonalne wartości, z pustymi polami mapowanymi na
  `null`, i liczy wiek/tempo z zapisanych timestampów bez przebudowy ich formatu.
- Istniejące pliki i zmaterializowane wyniki sprzed wdrożenia traktujemy w nowym
  systemie tak, jakby nie istniały: nie wchodzą do analiz, potwierdzonych
  maksimów, widoków rekordu ani warstwy śladów. Surowe archiwum pozostaje
  zachowane. Nie odtwarzamy brakującej jakości GNSS i nie przypisujemy im
  zielonych ikon. Parser może odczytać CSV v1 do archiwum, ale nie materializuje
  z niego zjazdów.
- Surowe archiwalne CSV nie są modyfikowane. Fixture PWA pozostaje w użyciu:
  przy seedowaniu PWA dopisuje do niego syntetyczne pola v2 (`fix=1`, `8`
  satelitów, `HDOP=0,9`, wiek pól `100 ms`) wyłącznie do testowania interfejsu i
  analizy. Nie jest to pomiar jakości sprzętu; rzadkie timestampy obecnego
  śladu mogą nie spełnić lokalnego okna i pozostawić maksimum niepotwierdzone.
  Po teście fixture należy zastąpić nagraniem v2 wykonanym na urządzeniu.
- `materializeFile()` musi rozróżniać nową wersję analizy i nie może zwracać
  starych, zmaterializowanych rekordów jako potwierdzonych. Etykiety użytkownika
  nie mogą być kasowane przy rematerializacji.

## 8. Miejsca implementacji

### Firmware

- `firmware/Szusownik/src/gnss/gnss.h/.cpp` — pobranie świeżych pól TinyGPS++:
  ważność/wiek pozycji, satelity/wiek oraz HDOP/wiek; zachować prędkość RMC,
  NMEA i istniejący wyzwalacz nowej próbki.
- `firmware/Szusownik/Szusownik.ino` — przekazać komplet jednej próbki z epoki
  GNSS do zapisu.
- `firmware/Szusownik/src/config/config.h` oraz
  `firmware/Szusownik/src/storage/storage.h/.cpp` — nagłówek v2 i zapis pól.

### PWA

- `web/src/lib/csv.ts` — parser CSV v1/v2, kontrola liczb oraz wartości
  opcjonalnych; CSV v1 pozostaje surowym archiwum bez analizy.
- Walidator nagłówka pliku w ścieżce importu akceptuje v1 i v2; v1 nie jest
  materializowany.
- `web/src/lib/runs.ts` — analiza trzech kryteriów, lokalne dopasowanie,
  kandydaci i najwyższa próbka potwierdzona.
- `web/src/lib/db.ts` oraz `web/src/lib/data.ts` — przechowywanie wyników,
  wersjonowanie analizy i pominięcie starych danych w nowym widoku rekordów.
- `web/src/routes/RunView.tsx` — trzy ikony obok potwierdzonego wyniku oraz
  osobne surowe maksimum, jeśli jest wyższe lub nie istnieje wynik potwierdzony.
- `web/src/routes/DayView.tsx`, `DaySummaryView.tsx` i `HistoryView.tsx` —
  agregowanie wyłącznie potwierdzonych maksimów, bez zmiany układu strony
  głównej.

## 9. Kryteria odbioru

### Testy algorytmu

1. `131, 131, 132, 131, 132` — plateau nie jest odrzucane wyłącznie z powodu
   małych wahań.
2. `130, 133, 136, 134, 131` — gładki lokalny szczyt może przejść mimo jednej
   najwyższej próbki.
3. `131, 134, 136, 182, 138, 134, 130, 128` z równymi odstępami 0,2 s —
   `182` wymaga ok. 6,5 g dodatniego przyspieszenia i nie jest potwierdzane;
   po jego pominięciu `138` jest oceniane względem poprzedniej użytecznej
   próbki, a ujemne hamowanie nie oblewa filtra.
4. Brak fixa, mniej niż 5 satelitów, HDOP >2,5, brak/starość któregokolwiek
   pola GNSS — czerwona ikonka GNSS.
5. Mniej niż 5 próbek w oknie, mniej niż 2 po jednej ze stron, zbyt duża luka,
   niedodatni `dt` albo brak timestampów — odpowiednia ikonka czerwona.
6. Potwierdzenie wymaga trzech zielonych ikon. Dwie zielone i jedna czerwona
   nie wchodzą do maksimum zbiorczego.
7. Bez potwierdzonego wyniku strona główna i agregaty pokazują brak wyniku.
8. Stare rekordy nie są widoczne jako rekordy nowej jakości; po wdrożeniu
   potwierdzenie sprawdzamy na nowym nagraniu.

### Nagranie testowe na urządzeniu

Po wdrożeniu należy wykonać nowe nagranie i sprawdzić:

- czy NMEA GGA faktycznie dostarcza satelity i HDOP oraz czy ich wiek mieści
  się w limicie;
- rzeczywiste odstępy próbek przy prędkości rekordu;
- trzy kryteria na kilku rzeczywistych zjazdach, w tym rekordzie z płynnym
  szczytem oraz przejeździe ze sztucznym/oczywistym pojedynczym skokiem;
- zgodność potwierdzonego maksimum na widoku zjazdu, Dzisiaj, Historii i Całym
  dniu.

„Potwierdzony” oznacza przejście powyższych reguł produktu. Nie oznacza
certyfikowanej dokładności metrologicznej. Dokładność praktyczną należy oceniać
na nowym nagraniu i porównać z niezależnym źródłem prędkości. Analiza jest
czystą funkcją i ma deterministyczne testy uruchamiane przez `npm test`.
