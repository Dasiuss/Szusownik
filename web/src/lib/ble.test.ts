import assert from "node:assert/strict";
import test from "node:test";
import { buildQueue, parseListStatus, PermanentDownloadError } from "./ble.ts";

// Rozróżnienie trwałego uszkodzenia (pomijamy) od błędu przejściowego (ponawiamy)
// opiera się wyłącznie na typie błędu — stąd ten test.
test("trwałe uszkodzenie jest odróżniane od błędu przejściowego", () => {
  assert.ok(new PermanentDownloadError("Niezgodny rozmiar: 100 vs 200") instanceof PermanentDownloadError);
  assert.ok(!(new Error("Timeout transferu (120 s)") instanceof PermanentDownloadError));
});

test("pusta lista LIST oznacza brak nowych plików", () => {
  assert.deepEqual(parseListStatus("list"), []);
});

test("LIST zwraca nazwy z rozmiarami w kolejności", () => {
  assert.deepEqual(parseListStatus("list 20260101_120000.csv 100 20260102_080000.csv 250"), [
    { name: "20260101_120000.csv", size: 100 },
    { name: "20260102_080000.csv", size: 250 },
  ]);
});

test("LIST odrzuca odpowiedzi niezgodne z formatem", () => {
  assert.throws(() => parseListStatus("file 0 a.csv 10"));
  assert.throws(() => parseListStatus("list a.csv"));
  assert.throws(() => parseListStatus("list a.csv brak"));
});

test("kolejka scala ponowienia z nowymi, dedup i sort rosnąco, pomija znane", () => {
  const pending = [{ name: "20260103_000000.csv", size: 30 }];
  const listed = [
    { name: "20260102_000000.csv", size: 20 },
    { name: "20260103_000000.csv", size: 31 }, // duplikat ponowienia
    { name: "20260104_000000.csv", size: 40 }, // już znany
  ];
  const known = new Set(["20260104_000000.csv"]);
  assert.deepEqual(buildQueue(pending, listed, known), [
    { name: "20260102_000000.csv", size: 20 },
    { name: "20260103_000000.csv", size: 30 },
  ]);
});

test("kolejka normalizuje wiodący ukośnik i znane nazwy", () => {
  const listed = [{ name: "/20260101_000000.csv", size: 10 }];
  assert.deepEqual(buildQueue([], listed, new Set(["20260101_000000.csv"])), []);
  assert.deepEqual(buildQueue([], listed, new Set()), [{ name: "20260101_000000.csv", size: 10 }]);
});
