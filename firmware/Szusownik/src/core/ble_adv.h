#pragma once

// Czysta logika interwału reklamowania BLE (bez Arduino) — testy hostowe.
//
// Szusownik reklamuje SZYBKO, gdy stoi (wtedy najczęściej łączy się z PWA),
// a WOLNO w ruchu (adv trwa tylko bez połączenia, więc wolny tryb ogranicza
// grzanie w trakcie jazdy). Przełączenie ma histerezę, żeby szum GNSS w okolicy
// progu nie restartował reklamowania tam i z powrotem.

namespace core {

// Docelowy tryb reklamowania: true = szybki (krótki interwał), false = wolny.
// Na szybki przełączamy poniżej `fastBelowKmh`, a wracamy na wolny dopiero przy
// `fastBelowKmh + hysteresisKmh`. Brak fixu (0) i NaN traktujemy jak postój.
bool bleAdvFastNext(bool fast, float kmh, float fastBelowKmh, float hysteresisKmh);

}  // namespace core
