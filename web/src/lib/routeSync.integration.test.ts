// Testy integracyjne wysyłki trasy: prawdziwy SzusownikBle + symulator
// urządzenia. Pokrywa dedykowaną charakterystykę WRITE, składanie porcji po
// stronie urządzenia, walidację CRC i odczyt trasy z INFO.

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { DeviceEmulator, installFakeBluetooth } from "../../test/device-emulator.ts";
import { DeviceDisconnectedError, SzusownikBle } from "./ble.ts";
import { db } from "./db.ts";
import type { Position } from "./mapData.ts";
import type { RouteResult } from "./mapRouting.ts";
import { emptyRouteBlob, encodeRoute } from "./routeTransfer.ts";

async function freshDb(): Promise<void> {
  db.close();
  await db.delete();
  await db.open();
}

function sampleRoute(): RouteResult {
  const coordinates: Position[] = [
    [11.0, 46.95],
    [11.002, 46.948],
    [11.004, 46.945],
  ];
  return {
    distanceM: 0,
    cost: [0, 0, 0, 0, 0, 0],
    sequence: [{ uid: "way/1", label: "1", kind: "piste", color: "#1557b0", aerialway: "" }],
    segments: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { kind: "piste", color: "#1557b0", uid: "way/1", label: "1" },
          geometry: { type: "LineString", coordinates },
        },
      ],
    },
    start: coordinates[0],
    end: coordinates[coordinates.length - 1],
  };
}

beforeEach(async () => {
  await freshDb();
});

describe("wysyłka trasy przez BLE", () => {
  it("składa porcje i waliduje CRC; INFO raportuje trasę", async () => {
    installFakeBluetooth(new DeviceEmulator({ files: [] }));
    const ble = new SzusownikBle();
    const info = await ble.connect();
    expect(info.routeCrc).toBe(0);
    expect(info.routePoints).toBe(0);

    const encoded = encodeRoute(sampleRoute());
    const status = await ble.sendRoute(encoded.bytes);
    expect(status.startsWith("route ok ")).toBe(true);

    const after = await ble.readInfo();
    expect(after.routeCrc).toBe(encoded.crc);
    expect(after.routePoints).toBeGreaterThan(1);
  });

  it("wysyła pusty blob jako CLEAR", async () => {
    installFakeBluetooth(new DeviceEmulator({ files: [] }));
    const ble = new SzusownikBle();
    await ble.connect();
    await ble.sendRoute(encodeRoute(sampleRoute()).bytes);
    expect((await ble.readInfo()).routePoints).toBeGreaterThan(0);

    const empty = emptyRouteBlob();
    const status = await ble.sendRoute(empty.bytes);
    expect(status.startsWith("route ok ")).toBe(true);
    const after = await ble.readInfo();
    expect(after.routePoints).toBe(0);
    expect(after.routeCrc).toBe(empty.crc);
  });

  it("raportuje błąd, gdy CRC bloba się nie zgadza", async () => {
    installFakeBluetooth(new DeviceEmulator({ files: [] }));
    const ble = new SzusownikBle();
    await ble.connect();
    const encoded = encodeRoute(sampleRoute());
    const corrupted = encoded.bytes.slice();
    corrupted[corrupted.length - 1] = (corrupted[corrupted.length - 1] + 1) & 0xff; // psuje CRC
    const status = await ble.sendRoute(corrupted);
    expect(status.startsWith("route err ")).toBe(true);
  });

  it("ciche zerwanie łącza zgłasza onDisconnected i blokuje wysyłkę trasy", async () => {
    const emulator = new DeviceEmulator({ files: [] });
    installFakeBluetooth(emulator);
    const ble = new SzusownikBle();
    let dropped = 0;
    ble.onDisconnected = () => {
      dropped += 1;
    };
    await ble.connect();
    expect(ble.connected).toBe(true);

    // To samo, co robi przeglądarka, gdy urządzenie zniknie z zasięgu.
    emulator.disconnectGatt();

    expect(dropped).toBe(1);
    expect(ble.connected).toBe(false);
    // Zamiast surowego DOMException z GATT — własny typ, który UI mapuje na offline.
    await expect(ble.sendRoute(encodeRoute(sampleRoute()).bytes)).rejects.toBeInstanceOf(DeviceDisconnectedError);
    await expect(ble.readInfo()).rejects.toBeInstanceOf(DeviceDisconnectedError);
  });

  it("jawne Rozłącz nie udaje awarii łącza (brak zdarzenia)", async () => {
    const emulator = new DeviceEmulator({ files: [] });
    installFakeBluetooth(emulator);
    const ble = new SzusownikBle();
    let dropped = 0;
    ble.onDisconnected = () => {
      dropped += 1;
    };
    await ble.connect();
    ble.disconnect();
    expect(dropped).toBe(0);
    expect(ble.connected).toBe(false);
  });
});
