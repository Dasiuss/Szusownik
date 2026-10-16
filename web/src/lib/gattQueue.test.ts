import assert from "node:assert/strict";
import { test } from "vitest";
import { GattQueue } from "./gattQueue.ts";

// Kolejka GATT: następna operacja startuje dopiero po zakończeniu poprzedniej.
// Bez tego odczyt STATUS (odpytywanie w trakcie transferu) może nakładać się na
// zapis ACK — Android/Chrome odpowiada wtedy
// `NotSupportedError: GATT operation failed for unknown reason`.

test("kolejka nie dopuszcza równoległych operacji i zachowuje kolejność", async () => {
  const queue = new GattQueue();
  const events: string[] = [];
  let active = 0;
  let maxActive = 0;
  const op = (name: string) => async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    events.push(`start:${name}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
    events.push(`end:${name}`);
    active -= 1;
  };

  await Promise.all([queue.run(op("a")), queue.run(op("b")), queue.run(op("c"))]);

  assert.equal(maxActive, 1);
  assert.deepEqual(events, [
    "start:a",
    "end:a",
    "start:b",
    "end:b",
    "start:c",
    "end:c",
  ]);
});

test("błąd jednej operacji wraca do wywołującego i nie blokuje kolejnych", async () => {
  const queue = new GattQueue();

  await assert.rejects(
    queue.run(async () => {
      throw new Error("boom");
    }),
    /boom/,
  );

  assert.equal(
    await queue.run(async () => 42),
    42,
  );
});

test("kolejka oddaje wyniki w kolejności wywołań", async () => {
  const queue = new GattQueue();
  const results = await Promise.all([1, 2, 3].map((n) => queue.run(async () => n * 2)));
  assert.deepEqual(results, [2, 4, 6]);
});
