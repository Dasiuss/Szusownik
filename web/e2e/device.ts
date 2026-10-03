// Symulator urządzenia wstrzykiwany do przeglądarki w testach e2e.
//
// W przeciwieństwie do wersji z Vitest (`test/device-emulator.ts`) ta wersja
// działa w kontekście strony i nie może używać `node:zlib`. Dlatego ramki
// protokołu (zlib/DEFLATE, seq, end marker) są wyliczane w Node i przekazywane
// jako base64; strona tylko je odtwarza. Semantykę protokołu pilnują testy
// integracyjne w Node — tutaj chodzi o przepływ UI.

import { deflateSync } from "node:zlib";
import {
  SZ_BLE_PAYLOAD_SIZE,
  SZ_CMD_LIST,
  SZ_CMD_ROTATE,
  SZ_CMD_START_FILE,
  SZ_CMD_STOP,
  SZ_VOL_HIGH_DEFAULT,
  SZ_VOL_LOW_DEFAULT,
  SZ_FREQ_LONG_DEFAULT,
  SZ_FREQ_SHORT_DEFAULT,
  SZ_BEEP_GAP_DEFAULT_MS,
  SZ_BEEP_INTERVAL_DEFAULT_MS,
  SZ_BEEP_LONG_DEFAULT_MS,
  SZ_BEEP_MIN_KMH_DEFAULT,
  SZ_BEEP_SHORT_DEFAULT_MS,
  SZ_WIRE_PROTO,
} from "../src/lib/protocol.ts";
import { crc32 } from "../test/crc32.ts";

export interface E2eTransfer {
  frames: string[]; // base64 ramek danych + end marker
  raw: number;
  comp: number;
  framesCount: number;
  crc: string;
}

export interface E2eDeviceConfig {
  info: Record<string, number | string>;
  list: { name: string; size: number }[];
  transfers: Record<string, E2eTransfer>;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** Buduje config urządzenia z surowej treści CSV (jednego pliku). */
export function buildDeviceConfig(name: string, csv: string): E2eDeviceConfig {
  const raw = new TextEncoder().encode(csv);
  const comp = new Uint8Array(deflateSync(Buffer.from(raw)));
  const totalFrames = comp.length === 0 ? 0 : Math.ceil(comp.length / SZ_BLE_PAYLOAD_SIZE);
  const frames: string[] = [];
  for (let seq = 0; seq <= totalFrames; seq++) {
    const header = new Uint8Array([
      seq & 0xff,
      (seq >>> 8) & 0xff,
      (seq >>> 16) & 0xff,
      (seq >>> 24) & 0xff,
    ]);
    const payload =
      seq < totalFrames ? comp.slice(seq * SZ_BLE_PAYLOAD_SIZE, (seq + 1) * SZ_BLE_PAYLOAD_SIZE) : new Uint8Array(0);
    const frame = new Uint8Array(header.length + payload.length);
    frame.set(header, 0);
    frame.set(payload, header.length);
    frames.push(toBase64(frame));
  }
  const crc = crc32(raw).toString(16).toUpperCase().padStart(8, "0");
  return {
    info: {
      proto: SZ_WIRE_PROTO,
      fw: "e2e",
      fileCount: 1,
      volLow: SZ_VOL_LOW_DEFAULT,
      volHigh: SZ_VOL_HIGH_DEFAULT,
      freqShort: SZ_FREQ_SHORT_DEFAULT,
      freqLong: SZ_FREQ_LONG_DEFAULT,
      beepShortMs: SZ_BEEP_SHORT_DEFAULT_MS,
      beepLongMs: SZ_BEEP_LONG_DEFAULT_MS,
      beepGapMs: SZ_BEEP_GAP_DEFAULT_MS,
      signalGapMs: SZ_BEEP_INTERVAL_DEFAULT_MS,
      minBeepKmh: SZ_BEEP_MIN_KMH_DEFAULT,
    },
    list: [{ name, size: raw.length }],
    transfers: {
      [name]: { frames, raw: raw.length, comp: comp.length, framesCount: totalFrames, crc },
    },
  };
}

/**
 * Uruchamiane w przeglądarce przez `page.addInitScript`. Podmienia
 * `navigator.bluetooth` na symulator. Musi być samodzielne (bez importów).
 */
export function deviceInitScript(config: E2eDeviceConfig): void {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const toDV = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const b64 = (value: string) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));

  let status = "ok";
  let streaming = false;

  class Characteristic {
    value: DataView | null = null;
    listeners = new Set<(event: { target: Characteristic }) => void>();
    constructor(readonly uuid: string) {}
    async startNotifications() {}
    async readValue(): Promise<DataView> {
      if (this.uuid === "3f9a0002-7c4e-4b2a-9e11-000000000002") {
        return toDV(encoder.encode(JSON.stringify(config.info)));
      }
      if (this.uuid === "3f9a0005-7c4e-4b2a-9e11-000000000005") {
        return toDV(encoder.encode(status));
      }
      return toDV(this.value ? new Uint8Array(this.value.buffer, this.value.byteOffset, this.value.byteLength) : new Uint8Array(0));
    }
    async writeValueWithResponse(bytes: Uint8Array): Promise<void> {
      const command = decoder.decode(bytes);
      if (command.startsWith("ROTATE") || command.startsWith("STOP")) {
        streaming = false;
        status = "ok";
      } else if (command.startsWith("LIST:")) {
        const since = command.slice(5);
        const echo = since || "0";
        let message = `list ${echo}`;
        for (const entry of config.list.filter((entry) => entry.name > since)) {
          message += ` ${entry.name} ${entry.size}`;
        }
        status = message;
      } else if (command.startsWith("START_FILE:")) {
        const name = command.slice("START_FILE:".length);
        const transfer = config.transfers[name];
        if (!transfer) {
          status = `err:open ${name}`;
          return;
        }
        status = `streaming ${name}`;
        streaming = true;
        void (async () => {
          const data = characteristics.get("3f9a0004-7c4e-4b2a-9e11-000000000004")!;
          for (const frame of transfer.frames) {
            if (!streaming) return;
            data.push(frame);
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          status = `done ${name} raw=${transfer.raw} comp=${transfer.comp} frames=${transfer.framesCount} crc=${transfer.crc}`;
          streaming = false;
        })();
      }
    }
    addEventListener(_type: string, listener: (event: { target: Characteristic }) => void) {
      this.listeners.add(listener);
    }
    removeEventListener(_type: string, listener: (event: { target: Characteristic }) => void) {
      this.listeners.delete(listener);
    }
    push(base64Frame: string) {
      const bytes = b64(base64Frame);
      this.value = toDV(bytes);
      for (const listener of [...this.listeners]) listener({ target: this });
    }
  }

  const characteristics = new Map<string, Characteristic>([
    ["3f9a0002-7c4e-4b2a-9e11-000000000002", new Characteristic("3f9a0002-7c4e-4b2a-9e11-000000000002")],
    ["3f9a0003-7c4e-4b2a-9e11-000000000003", new Characteristic("3f9a0003-7c4e-4b2a-9e11-000000000003")],
    ["3f9a0004-7c4e-4b2a-9e11-000000000004", new Characteristic("3f9a0004-7c4e-4b2a-9e11-000000000004")],
    ["3f9a0005-7c4e-4b2a-9e11-000000000005", new Characteristic("3f9a0005-7c4e-4b2a-9e11-000000000005")],
  ]);

  const service = {
    getCharacteristic: async (uuid: string) => characteristics.get(uuid)!,
  };
  const server = {
    getPrimaryService: async () => service,
    disconnect: () => {},
  };
  const device = {
    gatt: { connect: async () => server, disconnect: () => {} },
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  Object.defineProperty(navigator, "bluetooth", {
    value: { requestDevice: async () => device, getDevices: async () => [] },
    configurable: true,
  });
}
