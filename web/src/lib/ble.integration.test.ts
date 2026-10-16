// Testy integracyjne transferu BLE: prawdziwy SzusownikBle napędzany symulatorem
// urządzenia, z zapisem do IndexedDB (fake-indexeddb). Pokrywają całą ścieżkę
// protokołu poniżej UI: LIST z echem, kolejka ponowień, NACK/replay, duplikaty,
// błędy trwałe vs przejściowe i kursor.

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { DeviceEmulator, crc32, installFakeBluetooth } from "../../test/device-emulator.ts";
import { bytesOf, goldenDone, realRideBytes, syntheticDescentCsv } from "../../test/fixtures.ts";
import { PermanentDownloadError, SzusownikBle, FileGoneError } from "./ble.ts";
import { db } from "./db.ts";

async function freshDb(): Promise<void> {
  db.close();
  await db.delete();
  await db.open();
}

function file(name: string, csv: string) {
  return { name, bytes: bytesOf(csv) };
}

function useEmulator(emulator: DeviceEmulator): void {
  installFakeBluetooth(emulator);
}

async function syncAll(ble: SzusownikBle) {
  const queue = await ble.collectNewFiles();
  const result = await ble.downloadFiles(queue, () => {});
  return { queue, result };
}

beforeEach(async () => {
  await freshDb();
});

describe("transfer pojedynczego pliku", () => {
  it("pobiera realne nagranie i zapisuje surowy CSV bajt w bajt", async () => {
    const bytes = realRideBytes();
    const golden = goldenDone();
    const emulator = new DeviceEmulator({ files: [{ name: golden.file, bytes }] });
    useEmulator(emulator);

    const ble = new SzusownikBle();
    await ble.connect();
    const queue = await ble.collectNewFiles();
    expect(queue).toEqual([{ name: golden.file, size: bytes.length }]);

    const progress: number[] = [];
    const downloaded = await ble.downloadFiles(queue, (p) => progress.push(p.receivedFrames));
    expect(downloaded.done).toHaveLength(1);
    expect(downloaded.transient).toHaveLength(0);
    expect(downloaded.corrupt).toHaveLength(0);

    const stored = await db.files.get(`/${golden.file}`);
    expect(stored).toBeDefined();
    expect(stored!.raw).toBe(new TextDecoder().decode(bytes));
    expect(progress.length).toBeGreaterThan(0);

    // Kursor = największa rozwiązana nazwa.
    const cursor = await db.meta.get("syncCursor");
    expect(cursor?.value).toBe(golden.file);

    // Kolejny sync w tej samej sesji nie widzi już nic nowego.
    const again = await ble.collectNewFiles();
    expect(again).toEqual([]);
  });

  it("CRC symulatora zgadza się z goldenem z prawdziwego urządzenia", () => {
    expect(crc32(realRideBytes()).toString(16).toUpperCase().padStart(8, "0")).toBe(
      goldenDone().crc,
    );
  });
});

describe("lista plików i kursor", () => {
  it("stronicuje LIST echem kursora powyżej jednej strony", async () => {
    const unique = Array.from({ length: 15 }, (_, index) => ({
      name: `20260101_${String(index).padStart(6, "0")}.csv`,
      bytes: bytesOf(syntheticDescentCsv(5)),
    }));
    const emulator = new DeviceEmulator({ files: unique, listPageSize: 12 });
    useEmulator(emulator);

    const ble = new SzusownikBle();
    await ble.connect();
    const queue = await ble.collectNewFiles();
    expect(queue.map((entry) => entry.name)).toEqual([...unique.map((entry) => entry.name)].sort());
  });

  it("pomija pliki postojowe (bez .meta)", async () => {
    const emulator = new DeviceEmulator({
      files: [
        file("20260101_000000.csv", syntheticDescentCsv(5)),
        { name: "20260101_010000.csv", bytes: bytesOf(syntheticDescentCsv(5)), hidden: true },
      ],
    });
    useEmulator(emulator);

    const ble = new SzusownikBle();
    await ble.connect();
    const queue = await ble.collectNewFiles();
    expect(queue.map((entry) => entry.name)).toEqual(["20260101_000000.csv"]);
  });
});

describe("odporność na uszkodzenia i błędy", () => {
  it("pomija raz trwałe uszkodzenie (złe CRC) i nie ponawia", async () => {
    const emulator = new DeviceEmulator({
      files: [file("20260101_000000.csv", syntheticDescentCsv(20))],
      corruptCrc: true,
    });
    useEmulator(emulator);

    const ble = new SzusownikBle();
    await ble.connect();
    const { result } = await syncAll(ble);
    expect(result.corrupt).toHaveLength(1);
    expect(result.done).toHaveLength(0);

    const ignored = await db.ignoredFiles.get("20260101_000000.csv");
    expect(ignored).toBeDefined();

    const next = await ble.collectNewFiles();
    expect(next).toEqual([]);
  });

  it("traktuje err:open jak trwałą nieobecność pliku", async () => {
    const emulator = new DeviceEmulator({
      files: [file("20260101_000000.csv", syntheticDescentCsv(20))],
      failOpen: ["20260101_000000.csv"],
    });
    useEmulator(emulator);

    const ble = new SzusownikBle();
    await ble.connect();
    const { result } = await syncAll(ble);
    expect(result.corrupt).toHaveLength(1);
    const ignored = await db.ignoredFiles.get("20260101_000000.csv");
    expect(ignored?.reason).toContain("err:open");
  });

  it("zapisuje błąd przejściowy (err:read) w kolejce i ponawia po nazwie", async () => {
    const csv = syntheticDescentCsv(40);
    const failing = new DeviceEmulator({
      files: [file("20260101_000000.csv", csv)],
      readErrorAfterFrames: { name: "20260101_000000.csv", frames: 2 },
    });
    useEmulator(failing);

    const first = new SzusownikBle();
    await first.connect();
    // Przerwanie bez end markera wykrywamy po ciszy strumienia (~1 s), a nie
    // dopiero po timeoutcie transferu (120 s).
    const startedAt = Date.now();
    const firstResult = await syncAll(first);
    expect(Date.now() - startedAt).toBeLessThan(2500);
    expect(firstResult.result.transient).toHaveLength(1);
    expect(failing.commands.some((cmd) => cmd === "STOP")).toBe(true);

    const pending = await db.pendingFiles.get("20260101_000000.csv");
    expect(pending?.attempts).toBe(1);

    // Druga próba (zdrowe urządzenie) rozwiązuje plik z kolejki po nazwie.
    const healthy = new DeviceEmulator({ files: [file("20260101_000000.csv", csv)] });
    useEmulator(healthy);
    const second = new SzusownikBle();
    await second.connect();
    const secondResult = await syncAll(second);
    expect(secondResult.result.done).toHaveLength(1);
    expect(await db.pendingFiles.get("20260101_000000.csv")).toBeUndefined();
  });

  it("odrzuca plik ze złym nagłówkiem CSV jako trwałe uszkodzenie", async () => {
    const emulator = new DeviceEmulator({
      files: [file("20260101_000000.csv", "zly,naglowek\n1,2\n")],
    });
    useEmulator(emulator);

    const ble = new SzusownikBle();
    await ble.connect();
    const { result } = await syncAll(ble);
    expect(result.corrupt).toHaveLength(1);
    const ignored = await db.ignoredFiles.get("20260101_000000.csv");
    expect(ignored?.reason).toContain("nagłówek");
  });

  it("uszkodzona ramka (błąd dekompresora) to błąd przejściowy, a nie zawieszenie", async () => {
    const csv = syntheticDescentCsv(40);
    const emulator = new DeviceEmulator({
      files: [file("20260101_000000.csv", csv)],
      corruptSeqs: [0], // psuje nagłówek zlib -> DecompressionStream zgłasza błąd
    });
    useEmulator(emulator);

    const ble = new SzusownikBle();
    await ble.connect();
    // `writer.write()` odrzuca z `undefined`; bez normalizacji błąd znika w
    // `if (failed)` i transfer wisi do timeoutu 120 s.
    const startedAt = Date.now();
    const { result } = await syncAll(ble);
    expect(Date.now() - startedAt).toBeLessThan(3000);
    expect(result.transient.map((entry) => entry.name)).toEqual(["20260101_000000.csv"]);
    expect(emulator.commands.some((cmd) => cmd === "STOP")).toBe(true);
  });
});

describe("NACK/replay i duplikaty", () => {
  it("doretransmituje pominiętą ramkę po NACK", async () => {
    const bytes = realRideBytes();
    const golden = goldenDone();
    const emulator = new DeviceEmulator({
      files: [{ name: golden.file, bytes }],
      dropSeqs: [5, 40, 120],
    });
    useEmulator(emulator);

    const ble = new SzusownikBle();
    await ble.connect();
    const { result } = await syncAll(ble);
    expect(result.done).toHaveLength(1);
    const stored = await db.files.get(`/${golden.file}`);
    expect(stored?.raw).toBe(new TextDecoder().decode(bytes));
    expect(stored?.raw.length).toBe(golden.raw);
    // Jeden NACK na dziurę (throttle w downloadFile), a nie NACK na każdą ramkę
    // poza kolejnością — inaczej zapis CTRL blokuje odbiór i łącze się dusi.
    const nacks = emulator.commands.filter((cmd) => cmd.startsWith("NACK:"));
    // Trzy porzucone sekwencje (5, 40, 120) => dokładnie trzy żądania.
    expect(nacks).toEqual(["NACK:5", "NACK:40", "NACK:120"]);
  });

  it("ignoruje zdublowane ramki", async () => {
    const csv = syntheticDescentCsv(40);
    const emulator = new DeviceEmulator({
      files: [file("20260101_000000.csv", csv)],
      duplicateSeqs: [3, 4, 33],
    });
    useEmulator(emulator);

    const ble = new SzusownikBle();
    await ble.connect();
    const { result } = await syncAll(ble);
    expect(result.done).toHaveLength(1);
    const stored = await db.files.get("/20260101_000000.csv");
    expect(stored?.raw).toBe(csv);
  });
});

describe("jakość łącza: szeregowanie GATT i postęp", () => {
  it("odczyt INFO i zapis ustawień nie nakładają się (jedna kolejka GATT)", async () => {
    const emulator = new DeviceEmulator({ files: [] });
    useEmulator(emulator);
    const ble = new SzusownikBle();
    await ble.connect();

    // Bez kolejki odczyt (INFO) i zapis (CTRL) poszłyby równolegle — na
    // Chrome/Androidzie kończy się to `NotSupportedError`.
    await Promise.all([ble.readInfo(), ble.setVolume("low", 50)]);
    expect(emulator.maxConcurrentGattOps).toBe(1);
  });

  it("w trakcie transferu żadne dwie operacje GATT się nie nakładają", async () => {
    const bytes = realRideBytes();
    const golden = goldenDone();
    const emulator = new DeviceEmulator({ files: [{ name: golden.file, bytes }] });
    useEmulator(emulator);
    const ble = new SzusownikBle();
    await ble.connect();
    const { result } = await syncAll(ble);
    expect(result.done).toHaveLength(1);
    expect(emulator.maxConcurrentGattOps).toBe(1);
  });

  it("raportuje postęp rzadko, ale domyka licznik na pełnej liczbie ramek", async () => {
    const bytes = realRideBytes();
    const golden = goldenDone();
    const emulator = new DeviceEmulator({ files: [{ name: golden.file, bytes }] });
    useEmulator(emulator);
    const ble = new SzusownikBle();
    await ble.connect();
    const queue = await ble.collectNewFiles();

    const progress: number[] = [];
    const result = await ble.downloadFiles(queue, (p) => progress.push(p.receivedFrames));
    expect(result.done).toHaveLength(1);
    // Duży plik, ale oddawany szybko → kilka raportów, nie setki ramek.
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i]).toBeGreaterThan(progress[i - 1]);
    }
    // Ostatni raport jest wymuszony na końcu pliku — pełna liczba ramek, nie
    // wartość z ostatniego okna throttle.
    expect(progress[progress.length - 1]).toBe(emulator.lastTransferFrames);
  });
});

describe("typy błędów", () => {
  it("PermanentDownloadError i FileGoneError są rozróżnialne od błędu przejściowego", () => {
    expect(new PermanentDownloadError("x")).toBeInstanceOf(PermanentDownloadError);
    expect(new FileGoneError("x")).toBeInstanceOf(FileGoneError);
    expect(new Error("timeout")).not.toBeInstanceOf(PermanentDownloadError);
  });
});

describe("parowanie HUD", () => {
  it("powtórne parowanie zwraca świeży wynik, nie poprzedni", async () => {
    const emulator = new DeviceEmulator({ files: [], peerMac: "AA:BB:CC:DD:EE:FF" });
    useEmulator(emulator);

    const ble = new SzusownikBle();
    const info = await ble.connect();
    expect(info.peerMac).toBe("");

    expect(await ble.pairHud()).toBe("paired AA:BB:CC:DD:EE:FF");
    expect((await ble.readInfo()).peerMac).toBe("AA:BB:CC:DD:EE:FF");

    // Drugie parowanie bez Huda w zasięgu: stary "paired ..." nie może wygrać —
    // PWA czeka na STATUS inny niż sprzed parowania.
    emulator.setPairDevices(0);
    expect(await ble.pairHud()).toBe("err:pair-none");
    expect((await ble.readInfo()).peerMac).toBe("");
  });

  it("zgłasza wiele Hudów jako err:pair-multi", async () => {
    const emulator = new DeviceEmulator({ files: [], pairDevices: 2 });
    useEmulator(emulator);

    const ble = new SzusownikBle();
    await ble.connect();
    expect(await ble.pairHud()).toBe("err:pair-multi");
  });
});

describe("ustawienia urządzenia", () => {
  it("SET* zwracają wartości po clamp i odświeżają INFO", async () => {
    const emulator = new DeviceEmulator({ files: [] });
    useEmulator(emulator);

    const ble = new SzusownikBle();
    const info = await ble.connect();
    expect(info.fileCount).toBe(0);

    expect(await ble.setVolume("low", 250)).toEqual({ low: 100, high: info.volHigh });
    expect(await ble.setFrequency("short", 100)).toEqual({ short: 600, long: info.freqLong });
    expect(await ble.setTiming("short", 5000)).toEqual({
      short: 200,
      long: info.beepLongMs,
      gap: info.beepGapMs,
      interval: info.signalGapMs,
    });
    expect(await ble.setMinBeepKmh(5)).toBe(60);

    const refreshed = await ble.readInfo();
    expect(refreshed.volLow).toBe(100);
    expect(refreshed.freqShort).toBe(600);
  });
});

describe("odporność listowania i kolejka ponowień", () => {
  it("ponawia LIST po odpowiedzi złego formatu, zamiast wywalać sync", async () => {
    const emulator = new DeviceEmulator({
      files: [file("20260101_000000.csv", syntheticDescentCsv(5))],
      malformedListOnce: true,
    });
    useEmulator(emulator);

    const ble = new SzusownikBle();
    await ble.connect();
    const queue = await ble.collectNewFiles();
    expect(queue.map((entry) => entry.name)).toEqual(["20260101_000000.csv"]);
  });

  it("pendingQueue zwraca trwałe ponowienia (bez znanych) — fallback, gdy LIST padnie", async () => {
    installFakeBluetooth(new DeviceEmulator({ files: [] }));
    const ble = new SzusownikBle();
    await ble.connect();

    await db.pendingFiles.put({
      name: "20260102_000000.csv",
      size: 20,
      attempts: 1,
      lastError: "err:read",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await db.pendingFiles.put({
      name: "20260101_000000.csv",
      size: 10,
      attempts: 1,
      lastError: "err:read",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    // Ten plik zdążył się rozwiązać w poprzedniej sesji — nie wraca w kolejce.
    await db.files.put({
      name: "/20260102_000000.csv",
      size: 20,
      receivedAt: "2026-01-01T00:00:00.000Z",
      userId: "local",
      raw: "",
    });

    expect(await ble.pendingQueue()).toEqual([{ name: "20260101_000000.csv", size: 10 }]);
    expect(await db.pendingFiles.get("20260102_000000.csv")).toBeUndefined();
  });
});
