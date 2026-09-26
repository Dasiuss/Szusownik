import assert from "node:assert/strict";
import test from "node:test";
import { PermanentDownloadError } from "./ble.ts";

// Rozróżnienie trwałego uszkodzenia (pomijamy) od błędu przejściowego (ponawiamy)
// opiera się wyłącznie na typie błędu — stąd ten test.
test("trwałe uszkodzenie jest odróżniane od błędu przejściowego", () => {
  assert.ok(new PermanentDownloadError("Niezgodny rozmiar: 100 vs 200") instanceof PermanentDownloadError);
  assert.ok(!(new Error("Timeout transferu (120 s)") instanceof PermanentDownloadError));
});
