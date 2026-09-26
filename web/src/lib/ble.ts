import { db } from "./db.ts";
import { DEVICE_CSV_V2_HEADER } from "./csv.ts";

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
const SETTINGS_TIMEOUT_MS = 2000;
const SETTINGS_POLL_MS = 50;

export interface FileMeta {
  name: string;
  size: number;
}

export interface DeviceInfo {
  fw: string;
  fileCount: number;
  volLow: number;
  volHigh: number;
  freqShort: number;
  freqLong: number;
  beepShortMs: number;
  beepLongMs: number;
  beepGapMs: number;
  signalGapMs: number;
  minBeepKmh: number;
}

export interface Volume {
  low: number;
  high: number;
}

export interface Freq {
  short: number;
  long: number;
}

export interface Timing {
  short: number;
  long: number;
  gap: number;
  interval: number;
}

export const SZ_FREQ_MIN_HZ = 600;
export const SZ_FREQ_MAX_HZ = 1500;
export const SZ_FREQ_STEP_HZ = 25;
export const SZ_VOL_LOW_DEFAULT = 20;
export const SZ_VOL_HIGH_DEFAULT = 70;
export const SZ_FREQ_SHORT_DEFAULT = 880;
export const SZ_FREQ_LONG_DEFAULT = 1100;
export const SZ_TIMING_SHORT_MIN_MS = 20;
export const SZ_TIMING_SHORT_MAX_MS = 200;
export const SZ_TIMING_SHORT_STEP_MS = 5;
export const SZ_TIMING_SHORT_DEFAULT_MS = 56;
export const SZ_TIMING_LONG_MIN_MS = 40;
export const SZ_TIMING_LONG_MAX_MS = 500;
export const SZ_TIMING_LONG_STEP_MS = 5;
export const SZ_TIMING_LONG_DEFAULT_MS = 140;
export const SZ_TIMING_GAP_MIN_MS = 0;
export const SZ_TIMING_GAP_MAX_MS = 500;
export const SZ_TIMING_GAP_STEP_MS = 5;
export const SZ_TIMING_GAP_DEFAULT_MS = 60;
export const SZ_TIMING_INTERVAL_MIN_MS = 100;
export const SZ_TIMING_INTERVAL_MAX_MS = 5000;
export const SZ_TIMING_INTERVAL_STEP_MS = 50;
export const SZ_TIMING_INTERVAL_DEFAULT_MS = 1000;
export const SZ_MIN_BEEP_KMH = 60;
export const SZ_MAX_BEEP_KMH = 120;
export const SZ_MIN_BEEP_STEP_KMH = 1;
export const SZ_MIN_BEEP_DEFAULT_KMH = 60;

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

export interface DownloadResult {
  done: SyncedFile[];
  failed: FileMeta[];
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
  private device: BluetoothDevice | null = null;
  private server: BluetoothRemoteGATTServer | null = null;
  private ctrl: BluetoothRemoteGATTCharacteristic | null = null;
  private info: BluetoothRemoteGATTCharacteristic | null = null;
  private data: BluetoothRemoteGATTCharacteristic | null = null;
  private stat: BluetoothRemoteGATTCharacteristic | null = null;
  private settingsLock: Promise<unknown> = Promise.resolve();

  async connect(): Promise<DeviceInfo> {
    if (!navigator.bluetooth) {
      throw new Error("Brak Web Bluetooth — użyj Chrome na Androidzie (HTTPS)");
    }
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SZ_UUID_SVC] }],
      optionalServices: [SZ_UUID_SVC],
    });
    return this.connectToDevice(device);
  }

  private async connectToDevice(device: BluetoothDevice): Promise<DeviceInfo> {
    this.device = device;
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

  async reconnect(): Promise<DeviceInfo | null> {
    if (!navigator.bluetooth) return null;
    const bluetooth = navigator.bluetooth as Bluetooth & {
      getDevices?: () => Promise<BluetoothDevice[]>;
    };
    if (!bluetooth.getDevices) return null;
    const devices = await bluetooth.getDevices();
    const device = devices.find((candidate) => candidate.gatt);
    return device ? this.connectToDevice(device) : null;
  }

  disconnect() {
    try {
      this.server?.disconnect();
    } catch {
      /* ignoruj */
    }
    this.server = null;
    this.device = null;
  }

  private async writeCtrl(cmd: string): Promise<void> {
    await this.ctrl!.writeValueWithResponse(new TextEncoder().encode(cmd));
  }

  private static readonly INFO_NUMBER_FIELDS = [
    "volLow",
    "volHigh",
    "freqShort",
    "freqLong",
    "beepShortMs",
    "beepLongMs",
    "beepGapMs",
    "signalGapMs",
    "minBeepKmh",
  ] as const;

  async readInfo(): Promise<DeviceInfo> {
    const v = await this.info!.readValue();
    const bytes = dvBytes(v);
    const text = new TextDecoder().decode(bytes);
    let info: DeviceInfo;
    try {
      info = JSON.parse(text) as DeviceInfo;
    } catch {
      console.error(`INFO z urządzenia nieparsowalne (${bytes.length} B):`, text);
      throw new Error(
        `Zły JSON INFO z urządzenia (${bytes.length} B): ${text.slice(0, 160)}${text.length > 160 ? "…" : ""}`,
      );
    }
    if (typeof info.fileCount !== "number") throw new Error("Zły format INFO z urządzenia");
    for (const field of SzusownikBle.INFO_NUMBER_FIELDS) {
      if (typeof info[field] !== "number") {
        throw new Error(`Brak pola ${field} w INFO urządzenia`);
      }
    }
    return info;
  }

  private async readStatus(): Promise<string> {
    const v = await this.stat!.readValue();
    return new TextDecoder().decode(dvBytes(v));
  }

  // Firmware konsumuje komendy w poll() w głównej pętli i dopiero wtedy
  // nadpisuje STATUS, więc odczyt zaraz po writeCtrl może zwrócić odpowiedź
  // poprzedniej komendy. Czekamy na status pasujący do wzorca danej komendy.
  private async pollStatus(pattern: RegExp): Promise<string> {
    const deadline = Date.now() + SETTINGS_TIMEOUT_MS;
    let status = "";
    for (;;) {
      status = await this.readStatus();
      if (pattern.test(status) || status.startsWith("err:")) return status;
      if (Date.now() >= deadline) return status;
      await new Promise((resolve) => setTimeout(resolve, SETTINGS_POLL_MS));
    }
  }

  private settingStatus(cmd: string, pattern: RegExp): Promise<string> {
    const run = async () => {
      await this.writeCtrl(cmd);
      return this.pollStatus(pattern);
    };
    const result = this.settingsLock.then(run, run);
    this.settingsLock = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private static parseVolume(status: string): Volume {
    const m = /vol low=(\d+) high=(\d+)/.exec(status);
    if (!m) throw new Error(`Zła odpowiedź głośności: ${status}`);
    return { low: Number(m[1]), high: Number(m[2]) };
  }

  /**
   * Głośność buzzera (firmware 1.1+): kotwice 60 km/h (low) i 120 km/h (high),
   * 0..100, pomiędzy liniowo. Każde SETVOL gra feedback na urządzeniu
   * (low → sygnał 60, high → sygnał 120).
   */
  async setVolume(which: "low" | "high", value: number): Promise<Volume> {
    const v = Math.max(0, Math.min(100, Math.round(value)));
    const status = await this.settingStatus(
      which === "low" ? `SETVOL:LOW:${v}` : `SETVOL:HIGH:${v}`,
      /vol low=\d+ high=\d+/,
    );
    return SzusownikBle.parseVolume(status);
  }

  private static parseFreq(status: string): Freq {
    const m = /freq short=(\d+) long=(\d+)/.exec(status);
    if (!m) throw new Error(`Zła odpowiedź częstotliwości: ${status}`);
    return { short: Number(m[1]), long: Number(m[2]) };
  }

  private static parseTiming(status: string): Timing {
    const m = /timing short=(\d+) long=(\d+) gap=(\d+) interval=(\d+)/.exec(status);
    if (!m) throw new Error(`Zła odpowiedź czasów sygnału: ${status}`);
    return { short: Number(m[1]), long: Number(m[2]), gap: Number(m[3]), interval: Number(m[4]) };
  }

  private static parseMinBeep(status: string): number {
    const m = /beep min=(\d+)/.exec(status);
    if (!m) throw new Error(`Zła odpowiedź minimalnej prędkości pikania: ${status}`);
    return Number(m[1]);
  }

  /**
   * Częstotliwość buzzera (firmware 1.2+): niezależne tony krótki/długi,
   * 600..1500 Hz. Każdy SETFREQ gra podgląd na urządzeniu
   * (1× długi + 2× krótkie nowymi częstotliwościami).
   */
  async setFrequency(which: "short" | "long", value: number): Promise<Freq> {
    const v = Math.max(SZ_FREQ_MIN_HZ, Math.min(SZ_FREQ_MAX_HZ, Math.round(value)));
    const status = await this.settingStatus(
      which === "short" ? `SETFREQ:SHORT:${v}` : `SETFREQ:LONG:${v}`,
      /freq short=\d+ long=\d+/,
    );
    return SzusownikBle.parseFreq(status);
  }

  /**
   * Czasy buzzera (firmware 1.3+): długość krótkiego/długiego tonu, przerwa
   * między tonami jednego wzoru oraz przerwa między pełnymi wzorami 120 km/h.
   * Każde SETTIMING zapisuje wartość w NVS i odtwarza trzy wzory testowe.
   */
  async setTiming(which: keyof Timing, value: number): Promise<Timing> {
    const limits = {
      short: [SZ_TIMING_SHORT_MIN_MS, SZ_TIMING_SHORT_MAX_MS],
      long: [SZ_TIMING_LONG_MIN_MS, SZ_TIMING_LONG_MAX_MS],
      gap: [SZ_TIMING_GAP_MIN_MS, SZ_TIMING_GAP_MAX_MS],
      interval: [SZ_TIMING_INTERVAL_MIN_MS, SZ_TIMING_INTERVAL_MAX_MS],
    } as const;
    const [min, max] = limits[which];
    const v = Math.max(min, Math.min(max, Math.round(value)));
    const command = {
      short: "SETTIMING:SHORT",
      long: "SETTIMING:LONG",
      gap: "SETTIMING:GAP",
      interval: "SETTIMING:INTERVAL",
    }[which];
    const status = await this.settingStatus(
      `${command}:${v}`,
      /timing short=\d+ long=\d+ gap=\d+ interval=\d+/,
    );
    return SzusownikBle.parseTiming(status);
  }

  /** Minimalna prędkość pikania (firmware 1.4+); wzór dla danej prędkości pozostaje bez zmian. */
  async setMinBeepKmh(value: number): Promise<number> {
    const v = Math.max(SZ_MIN_BEEP_KMH, Math.min(SZ_MAX_BEEP_KMH, Math.round(value)));
    const status = await this.settingStatus(`SETMINBEEP:${v}`, /beep min=\d+/);
    return SzusownikBle.parseMinBeep(status);
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

    const handleFrame = async (bytes: Uint8Array) => {
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
      if (expected < 16) {
        console.log(`[ble] frame seq=${seq} len=${bytes.length} head=${Array.from(payload.slice(0, 4), (b) => b.toString(16).padStart(2, "0")).join(" ")}`);
      }
      try {
        await writer.write(payload);
      } catch (err) {
        console.error(`[ble] write fail seq=${seq} len=${payload.length}`, err);
        throw err;
      }
      expected++;
      onFrames(expected);
      if (expected % SZ_BLE_ACK_BLOCK === 0) {
        await this.writeCtrl(`ACK:${expected}`);
      }
    };

    const onNotify = (e: Event) => {
      const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
      if (!v) return;
      // Kopiujemy synchronicznie: bufor DataView może być współdzielony między
      // notyfikacjami, a handleFrame wykonuje się asynchronicznie (kolejka chain).
      const bytes = dvBytes(v);
      chain = chain.then(() => handleFrame(bytes)).catch((err) => {
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
      const status = await this.pollStatus(/crc=[0-9A-Fa-f]{8}/);
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
      if (header !== DEVICE_CSV_V2_HEADER) {
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
      if (!finished) {
        // Transfer nie doszedł do końca — zatrzymaj firmware, żeby nie replayował.
        try {
          await this.writeCtrl("STOP");
        } catch {
          /* połączenie mogło już paść */
        }
      }
    }
  }

  async checkNewFiles(): Promise<FileMeta[]> {
    await this.writeCtrl("ROTATE");
    const info = await this.readInfo();
    const known = new Set(
      ((await db.files.toCollection().primaryKeys()) as string[]).map((name) => name.replace(/^\//, "")),
    );
    const fresh: FileMeta[] = [];
    for (let index = 0; index < info.fileCount; index++) {
      await this.writeCtrl(`FILE:${index}`);
      // Czekamy na status z TYM indeksem — sam wzorzec `file ...` pasowałby też
      // do odpowiedzi na poprzedni FILE:<i>.
      const status = await this.pollStatus(new RegExp(`^file ${index} \\S+ \\d+$`));
      const match = new RegExp(`^file ${index} (\\S+) (\\d+)$`).exec(status);
      if (!match) throw new Error(`Zła odpowiedź listy plików: ${status}`);
      const name = match[1];
      if (!known.has(name.replace(/^\//, ""))) fresh.push({ name, size: Number(match[2]) });
    }
    return fresh;
  }

  async downloadFiles(
    fresh: FileMeta[],
    onProgress: (p: SyncProgress) => void,
  ): Promise<DownloadResult> {
    const done: SyncedFile[] = [];
    const failed: FileMeta[] = [];
    let fileIndex = 0;
    for (const meta of fresh) {
      fileIndex++;
      const name = meta.name.startsWith("/") ? meta.name : `/${meta.name}`;
      try {
        const text = await this.downloadFile(meta, (receivedFrames) =>
          onProgress({
            file: name,
            receivedFrames,
            fileIndex,
            fileCount: fresh.length,
          }),
        );
        await db.files.put({
          name,
          size: text.length,
          receivedAt: new Date().toISOString(),
          userId: "local",
          raw: text,
        });
        done.push({ name, size: text.length, samples: text.split("\n").length - 1 });
      } catch (caught) {
        // Jeden uszkodzony plik nie może blokować pozostałych.
        console.error(`[ble] pobieranie ${name} nieudane`, caught);
        failed.push(meta);
      }
    }
    return { done, failed };
  }

  /**
   * Sync: ROTATE (domknięcie bieżącego pliku) → lista → pobierz tylko nowe
   * (porównanie po nazwie z IndexedDB) → zapis surowego CSV → IndexedDB.
   */
  async syncNewFiles(onProgress: (p: SyncProgress) => void): Promise<SyncedFile[]> {
    try {
      await this.connect();
      const fresh = await this.checkNewFiles();
      return this.downloadFiles(fresh, onProgress);
    } finally {
      this.disconnect();
    }
  }
}
