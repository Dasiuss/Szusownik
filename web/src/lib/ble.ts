import { db } from "./db.ts";

// BLE v1 Szusownika — transfer plików (faza C).
// Kontrakt z firmware/src/config/config.h i docs/ble-transfer.md:
// zlib/DEFLATE strumieniowo, ramki 244 B (seq LE32 + 240 B payload),
// skumulowany ACK co 32, NACK z pierwszą brakującą, end marker (sam nagłówek),
// STATUS "done raw=.. comp=.. frames=.. crc=..", walidacja end-to-end.
export const SZ_UUID_SVC = "3f9a0001-7c4e-4b2a-9e11-000000000001";
export const SZ_UUID_INFO = "3f9a0002-7c4e-4b2a-9e11-000000000002";
export const SZ_UUID_CTRL = "3f9a0003-7c4e-4b2a-9e11-000000000003";
export const SZ_UUID_DATA = "3f9a0004-7c4e-4b2a-9e11-000000000004";
export const SZ_UUID_STAT = "3f9a0005-7c4e-4b2a-9e11-000000000005";

export const SZ_BLE_FRAME = 244;
export const SZ_BLE_HEADER = 4;
export const SZ_BLE_PAYLOAD = 240;
export const SZ_BLE_ACK_BLOCK = 32;
const TRANSFER_TIMEOUT_MS = 120000;

export interface FileMeta {
  name: string;
  size: number;
}

interface InfoJson {
  proto: string;
  fw: string;
  files: FileMeta[];
}

export interface SyncProgress {
  file: string;
  receivedFrames: number;
  fileIndex: number;
  fileCount: number;
}

export interface SyncedFile {
  name: string;
  size: number;
  samples: number;
}

let crcTable: Uint32Array | null = null;
function crc32Update(crc: number, data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
  }
  for (let i = 0; i < data.length; i++) {
    crc = (crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return crc >>> 0;
}

function dvBytes(v: DataView): Uint8Array {
  return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
}

export class SzusownikBle {
  private server: BluetoothRemoteGATTServer | null = null;
  private ctrl: BluetoothRemoteGATTCharacteristic | null = null;
  private info: BluetoothRemoteGATTCharacteristic | null = null;
  private data: BluetoothRemoteGATTCharacteristic | null = null;
  private stat: BluetoothRemoteGATTCharacteristic | null = null;

  async connect(): Promise<InfoJson> {
    if (!navigator.bluetooth) {
      throw new Error("Brak Web Bluetooth — użyj Chrome na Androidzie (HTTPS)");
    }
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SZ_UUID_SVC] }],
      optionalServices: [SZ_UUID_SVC],
    });
    this.server = (await device.gatt?.connect()) ?? null;
    if (!this.server) throw new Error("Brak połączenia GATT");
    const svc = await this.server.getPrimaryService(SZ_UUID_SVC);
    this.info = await svc.getCharacteristic(SZ_UUID_INFO);
    this.ctrl = await svc.getCharacteristic(SZ_UUID_CTRL);
    this.data = await svc.getCharacteristic(SZ_UUID_DATA);
    this.stat = await svc.getCharacteristic(SZ_UUID_STAT);
    await this.data.startNotifications();
    await this.stat.startNotifications();
    return this.readInfo();
  }

  disconnect() {
    try {
      this.server?.disconnect();
    } catch {
      /* ignoruj */
    }
    this.server = null;
  }

  private async writeCtrl(cmd: string): Promise<void> {
    await this.ctrl!.writeValueWithResponse(new TextEncoder().encode(cmd));
  }

  async readInfo(): Promise<InfoJson> {
    const v = await this.info!.readValue();
    const info = JSON.parse(new TextDecoder().decode(dvBytes(v))) as InfoJson;
    if (!Array.isArray(info.files)) throw new Error("Zły format INFO z urządzenia");
    if (typeof info.proto === "string" && !info.proto.startsWith("szusownik/ble-file-")) {
      throw new Error(`Niezgodny protokół urządzenia: ${info.proto}`);
    }
    return info;
  }

  private async readStatus(): Promise<string> {
    const v = await this.stat!.readValue();
    return new TextDecoder().decode(dvBytes(v));
  }

  /**
   * Pobiera JEDEN plik: START_FILE → ramki → end marker → walidacja.
   * Zwraca surowy tekst CSV (do zapisania w IndexedDB przed analizą).
   */
  async downloadFile(meta: FileMeta, onFrames: (n: number) => void): Promise<string> {
    const decomp = new DecompressionStream("deflate");
    const writer = decomp.writable.getWriter();
    const reader = decomp.readable.getReader();
    const outChunks: Uint8Array[] = [];
    let outLen = 0;
    let crc = 0xffffffff;
    let lines = 0;
    let readerDone = false;

    // Ssij dekompresora na bieżąco (inaczej backpressure zablokuje writer).
    const drain = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        outChunks.push(value);
        outLen += value.length;
        crc = crc32Update(crc, value);
        for (let i = 0; i < value.length; i++) if (value[i] === 10) lines++;
      }
      readerDone = true;
    })();
    drain.catch(() => {
      readerDone = true;
    });

    let expected = 0;
    let finished = false;
    let finalAck = 0;
    let failed: unknown = null;
    let chain: Promise<void> = Promise.resolve();

    const finish = () => {
      finished = true;
    };

    const handleFrame = async (view: DataView) => {
      const bytes = dvBytes(view);
      if (bytes.length < SZ_BLE_HEADER) return;
      const seq =
        bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] * 0x1000000);
      const payload = bytes.slice(SZ_BLE_HEADER);
      if (bytes.length === SZ_BLE_HEADER) {
        // End marker. Duplikat po zakończeniu też ACK-ujemy (znany problem §11).
        if (seq === expected && !finished) {
          await writer.close();
          await drain;
          finalAck = seq + 1;
          await this.writeCtrl(`ACK:${finalAck}`);
          finish();
        } else if (finished && seq === finalAck - 1) {
          await this.writeCtrl(`ACK:${finalAck}`);
        }
        return;
      }
      if (finished) return;
      if (seq < expected) return; // duplikat — nie pchaj drugi raz do dekompresora
      if (seq > expected) {
        await this.writeCtrl(`NACK:${expected}`);
        return;
      }
      await writer.write(payload);
      expected++;
      onFrames(expected);
      if (expected % SZ_BLE_ACK_BLOCK === 0) {
        await this.writeCtrl(`ACK:${expected}`);
      }
    };

    const onNotify = (e: Event) => {
      const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
      if (!v) return;
      chain = chain.then(() => handleFrame(v)).catch((err) => {
        failed = err;
      });
    };
    this.data!.addEventListener("characteristicvaluechanged", onNotify);

    const timeout = setTimeout(() => {
      failed = failed ?? new Error(`Timeout transferu (${TRANSFER_TIMEOUT_MS / 1000} s)`);
    }, TRANSFER_TIMEOUT_MS);

    try {
      await this.writeCtrl(`START_FILE:${meta.name}`);
      for (;;) {
        await chain;
        if (failed) throw failed;
        if (finished && readerDone) break;
        await new Promise((r) => setTimeout(r, 20));
        if (failed) throw failed;
      }
      // Walidacja end-to-end: rozmiar (INFO), CRC (STATUS done), schemat CSV.
      const status = await this.readStatus();
      const mCrc = /crc=([0-9A-Fa-f]{8})/.exec(status);
      const gotCrc = (crc ^ 0xffffffff) >>> 0;
      if (!mCrc || parseInt(mCrc[1], 16) >>> 0 !== gotCrc) {
        throw new Error(`Niezgodne CRC (STATUS: ${status})`);
      }
      if (outLen !== meta.size) {
        throw new Error(`Niezgodny rozmiar: ${outLen} vs ${meta.size} (INFO)`);
      }
      const flat = new Uint8Array(outLen);
      let off = 0;
      for (const c of outChunks) {
        flat.set(c, off);
        off += c.length;
      }
      const text = new TextDecoder().decode(flat);
      const header = text.slice(0, text.indexOf("\n")).trim();
      if (header !== "timestamp,lat,lon,speed,altitude,heading") {
        throw new Error(`Zły nagłówek CSV: ${header}`);
      }
      if (lines < 2) throw new Error("Plik bez próbek");
      return text;
    } finally {
      clearTimeout(timeout);
      this.data!.removeEventListener("characteristicvaluechanged", onNotify);
      try {
        await writer.abort();
      } catch {
        /* już zamknięty */
      }
      try {
        await reader.cancel();
      } catch {
        /* jw. */
      }
    }
  }

  /**
   * Sync: ROTATE (domknięcie bieżącego pliku) → lista → pobierz tylko nowe
   * (porównanie po nazwie z IndexedDB) → zapis surowego CSV → IndexedDB.
   */
  async syncNewFiles(onProgress: (p: SyncProgress) => void): Promise<SyncedFile[]> {
    const done: SyncedFile[] = [];
    try {
      await this.connect();
      await this.writeCtrl("ROTATE");
      const info = await this.readInfo();
      const known = new Set((await db.files.toCollection().primaryKeys()) as string[]);
      const fresh = info.files.filter((f) => !known.has(f.name) && !known.has(`/${f.name}`));
      let i = 0;
      for (const meta of fresh) {
        i++;
        const name = meta.name.startsWith("/") ? meta.name : `/${meta.name}`;
        const text = await this.downloadFile(meta, (n) =>
          onProgress({ file: name, receivedFrames: n, fileIndex: i, fileCount: fresh.length }),
        );
        await db.files.put({
          name,
          size: text.length,
          receivedAt: new Date().toISOString(),
          userId: "local",
          raw: text,
        });
        const samples = text.split("\n").length - 1;
        done.push({ name, size: text.length, samples });
      }
      return done;
    } finally {
      this.disconnect();
    }
  }
}
