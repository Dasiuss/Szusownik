// Symulator urządzenia Szusownika dla testów integracyjnych i e2e.
//
// Odwzorowuje protokół z GENEROWANEGO ../src/lib/protocol.ts (to samo źródło co
// firmware): LIST z echem kursora, ROTATE, START_FILE -> ramki (seq LE32 + 240 B
// payloadu, zlib/DEFLATE), ACK/NACK, end marker, STATUS `done <nazwa> raw.. crc..`,
// SET* z feedbackiem. Kompresja idzie przez zlib Node (PWA dekompresuje
// DecompressionStream("deflate")), więc liczy się zgodność semantyki, a nie
// bajtowa równość z miniz. Golden z urządzenia (CRC/raw) pilnuje osobny test.
//
// Umiemy też wstrzykiwać awarie: pominięte/zdublowane ramki (NACK/replay),
// błędne CRC, `err:open`, `err:read` w trakcie, oraz ukryte pliki (bez .meta).

import { deflateSync } from "node:zlib";
import { crc32 } from "../test/crc32.ts";
import { SZ_UUID_ROUTE } from "../src/lib/routeProtocol.ts";
import {
  SZ_BEEP_GAP_DEFAULT_MS,
  SZ_BEEP_INTERVAL_DEFAULT_MS,
  SZ_BEEP_LONG_DEFAULT_MS,
  SZ_BEEP_MIN_KMH_DEFAULT,
  SZ_BEEP_SHORT_DEFAULT_MS,
  SZ_BLE_HEADER_SIZE,
  SZ_BLE_LIST_MAX,
  SZ_BLE_PAYLOAD_SIZE,
  SZ_BLE_WINDOW,
  SZ_CMD_ACK,
  SZ_CMD_LIST,
  SZ_CMD_NACK,
  SZ_CMD_PAIR,
  SZ_CMD_ROTATE,
  SZ_CMD_SETFREQ_LONG,
  SZ_CMD_SETFREQ_SHORT,
  SZ_CMD_SETMINBEEP,
  SZ_CMD_SETTIMING_GAP,
  SZ_CMD_SETTIMING_INTERVAL,
  SZ_CMD_SETTIMING_LONG,
  SZ_CMD_SETTIMING_SHORT,
  SZ_CMD_SETVOL_HIGH,
  SZ_CMD_SETVOL_LOW,
  SZ_CMD_START_FILE,
  SZ_CMD_STOP,
  SZ_ERR_BUSY,
  SZ_ERR_OPEN,
  SZ_ERR_PAIR_MULTI,
  SZ_ERR_PAIR_NONE,
  SZ_ERR_READ,
  SZ_FREQ_LONG_DEFAULT,
  SZ_FREQ_SHORT_DEFAULT,
  SZ_ST_DONE,
  SZ_ST_LIST,
  SZ_ST_OK,
  SZ_ST_PAIRED,
  SZ_ST_PAIR_WAIT,
  SZ_ST_STREAMING,
  SZ_UUID_CTRL,
  SZ_UUID_DATA,
  SZ_UUID_INFO,
  SZ_UUID_STAT,
  SZ_UUID_SVC,
  SZ_VOL_HIGH_DEFAULT,
  SZ_VOL_LOW_DEFAULT,
  SZ_WIRE_PROTO,
} from "../src/lib/protocol.ts";

export interface EmulatorFile {
  name: string; // np. "20260926_181420.csv"
  bytes: Uint8Array; // surowa treść CSV (dokładnie to, co na karcie)
  /** Ukryty = brak pliku .meta: firmware go nie listuje (plik postojowy). */
  hidden?: boolean;
}

export interface EmulatorOptions {
  files: EmulatorFile[];
  listPageSize?: number;
  /** seq pomijane raz przy pierwszej transmisji; NACK je doretransmituje. */
  dropSeqs?: number[];
  /** seq wysyłane podwójnie (duplikat, PWA ignoruje seq < expected). */
  duplicateSeqs?: number[];
  /** seq, którym psujemy pierwszy bajt payloadu (uszkodzony strumień zlib). */
  corruptSeqs?: number[];
  /** STATUS done z przekręconym CRC (PWA -> PermanentDownloadError). */
  corruptCrc?: boolean;
  /** Nazwy, które odpowiadają `err:open <nazwa>` (FileGoneError). */
  failOpen?: string[];
  /** Po ilu ramkach przerwać transfer `err:read <nazwa>` (błąd przejściowy). */
  readErrorAfterFrames?: { name: string; frames: number };
  /** Ile HudRekaw odpowiedziało na PAIR: 0 = brak, 1 = jeden, ≥2 = kilka. */
  pairDevices?: number;
  /** MAC, który emulator przypisze przy udanym parowaniu. */
  peerMac?: string;
  /** Pierwsza odpowiedź na LIST ma zły format (test ponowienia w listSince). */
  malformedListOnce?: boolean;
  /**
   * Pierwsze N zapisów kontrolnych pasujących do prefiksu rzuca
   * `NotSupportedError` (test odporności PWA na pojedynczy hiccup GATT).
   */
  failControlWrites?: { prefix: string; times: number };
}

const textEncoder = new TextEncoder();

function toBytes(text: string): Uint8Array {
  return textEncoder.encode(text);
}

function toDataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function decode(view: DataView): string {
  return new TextDecoder().decode(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
}

function concat(first: Uint8Array, second: Uint8Array): Uint8Array {
  const out = new Uint8Array(first.length + second.length);
  out.set(first, 0);
  out.set(second, first.length);
  return out;
}

function crcHex(value: number): string {
  return value.toString(16).toUpperCase().padStart(8, "0");
}

interface Transfer {
  file: EmulatorFile;
  comp: Uint8Array;
  totalFrames: number;
  endSeq: number;
  crc: number;
  droppedOnce: Set<number>;
  duplicateOnce: Set<number>;
  corruptOnce: Set<number>;
}

type Listener = (event: { target: FakeCharacteristic }) => void;

class FakeCharacteristic {
  value: DataView | null = null;
  private readonly listeners = new Set<Listener>();

  constructor(
    readonly uuid: string,
    private readonly emulator: DeviceEmulator,
  ) {}

  async startNotifications(): Promise<void> {
    /* nic nie robimy — emulator pushuje sam */
  }

  async readValue(): Promise<DataView> {
    return this.emulator.gattOp(`read:${this.uuid}`, () =>
      toDataView(this.emulator.readCharacteristic(this.uuid)),
    );
  }

  async writeValueWithResponse(bytes: Uint8Array): Promise<void> {
    await this.emulator.gattOp(`write:${this.uuid}`, async () => {
      if (!this.emulator.linked) {
        throw new Error("GATT Server is disconnected. Cannot perform GATT operations.");
      }
      if (this.uuid === SZ_UUID_ROUTE) {
        this.emulator.writeRoute(bytes);
        return;
      }
      await this.emulator.writeCtrl(decode(toDataView(bytes)));
    });
  }

  addEventListener(type: string, listener: Listener): void {
    if (type === "characteristicvaluechanged") this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    if (type === "characteristicvaluechanged") this.listeners.delete(listener);
  }

  /** Push urządzenia -> PWA (odpowiednik NimBLE notify). */
  push(bytes: Uint8Array): void {
    this.value = toDataView(bytes);
    for (const listener of [...this.listeners]) listener({ target: this });
  }
}

export class DeviceEmulator {
  readonly device: {
    gatt: { connect: () => Promise<unknown>; disconnect: () => void };
    addEventListener: (type: string, listener: () => void) => void;
    removeEventListener: (type: string, listener: () => void) => void;
  };
  private readonly service: { getCharacteristic: (uuid: string) => Promise<FakeCharacteristic> };
  private readonly server: {
    connected: boolean;
    getPrimaryService: (uuid: string) => Promise<unknown>;
    disconnect: () => void;
  };
  private readonly characteristics = new Map<string, FakeCharacteristic>();
  private readonly dataChar: FakeCharacteristic;
  private readonly disconnectListeners = new Set<() => void>();

  private status = SZ_ST_OK;
  private transfer: Transfer | null = null;
  private acked = 0;
  private nextSent = 0;
  private done = false;
  private pendingReplay: number | null = null;
  private replayScheduled = false;

  private volLow = SZ_VOL_LOW_DEFAULT;
  private volHigh = SZ_VOL_HIGH_DEFAULT;
  private freqShort = SZ_FREQ_SHORT_DEFAULT;
  private freqLong = SZ_FREQ_LONG_DEFAULT;
  private beepShortMs = SZ_BEEP_SHORT_DEFAULT_MS;
  private beepLongMs = SZ_BEEP_LONG_DEFAULT_MS;
  private beepGapMs = SZ_BEEP_GAP_DEFAULT_MS;
  private signalGapMs = SZ_BEEP_INTERVAL_DEFAULT_MS;
  private minBeepKmh = SZ_BEEP_MIN_KMH_DEFAULT;

  // Trasa (RAM): ostatni odebrany blob i jego tożsamość (CRC32).
  private routeBuffer = new Uint8Array(0);
  private routeReceived = 0;
  private routeCrc = 0;
  private routePoints = 0;

  // Sparowany HudRekaw: MAC w INFO (`peerMac`), jak w prawdziwym Szusowniku.
  private peerMac = "";
  private pairDevices: number;
  private malformedListPending: boolean;
  private failCtrlPrefix: string;
  private failCtrlRemaining: number;

  readonly commands: string[] = [];
  /** Diagnostyka: maks. liczba równoległych operacji GATT (poprawnie zawsze 1). */
  maxConcurrentGattOps = 0;
  /** Diagnostyka: etykiety operacji GATT w kolejności wywołań. */
  readonly gattOps: string[] = [];
  /** Liczba ramek danych ostatniego transferu (diagnostyka testów). */
  lastTransferFrames = 0;
  private activeGattOps = 0;

  /**
   * Opakowuje pojedynczą operację GATT. Wstawiona granica async (setImmediate)
   * odpowiada realnemu czasowi operacji i pozwala wykryć nakładanie: bez
   * serializacji dwa równoległe odczyty/zapisy dałyby `maxConcurrentGattOps > 1`.
   */
  async gattOp<T>(label: string, op: () => Promise<T> | T): Promise<T> {
    this.activeGattOps += 1;
    if (this.activeGattOps > this.maxConcurrentGattOps) {
      this.maxConcurrentGattOps = this.activeGattOps;
    }
    this.gattOps.push(label);
    try {
      await new Promise((resolve) => setImmediate(resolve));
      return await op();
    } finally {
      this.activeGattOps -= 1;
    }
  }

  constructor(private readonly options: EmulatorOptions) {
    this.pairDevices = options.pairDevices ?? 1;
    this.malformedListPending = options.malformedListOnce ?? false;
    this.failCtrlPrefix = options.failControlWrites?.prefix ?? "";
    this.failCtrlRemaining = options.failControlWrites?.times ?? 0;
    for (const uuid of [SZ_UUID_INFO, SZ_UUID_CTRL, SZ_UUID_DATA, SZ_UUID_STAT, SZ_UUID_ROUTE]) {
      this.characteristics.set(uuid, new FakeCharacteristic(uuid, this));
    }
    this.dataChar = this.characteristics.get(SZ_UUID_DATA)!;

    this.service = {
      getCharacteristic: async (uuid: string) => {
        const characteristic = this.characteristics.get(uuid);
        if (!characteristic) throw new Error(`Nieznana charakterystyka ${uuid}`);
        return characteristic;
      },
    };
    this.server = {
      connected: true,
      getPrimaryService: async (uuid: string) => {
        if (uuid !== SZ_UUID_SVC) throw new Error(`Nieznana usługa ${uuid}`);
        return this.service;
      },
      disconnect: () => {
        this.server.connected = false;
      },
    };
    this.device = {
      gatt: { connect: async () => this.server, disconnect: () => {} },
      addEventListener: (type: string, listener: () => void) => {
        if (type === "gattserverdisconnected") this.disconnectListeners.add(listener);
      },
      removeEventListener: (type: string, listener: () => void) => {
        if (type === "gattserverdisconnected") this.disconnectListeners.delete(listener);
      },
    };
  }

  /** Czy łącze GATT jest aktywne (odpowiednik `BluetoothRemoteGATTServer.connected`). */
  get linked(): boolean {
    return this.server.connected;
  }

  /**
   * Symuluje ciche zerwanie łącza (urządzenie wyłączone/poza zasięgiem):
   * `connected=false` + zdarzenie `gattserverdisconnected`, dokładnie jak
   * przeglądarka. `disconnect()` z PWA tego zdarzenia nie wysyła.
   */
  disconnectGatt(): void {
    this.server.connected = false;
    for (const listener of [...this.disconnectListeners]) listener();
  }

  /** Wszystkie komendy CTRL odebrane od PWA (diagnostyka/aseracje). */
  private visibleFiles(): EmulatorFile[] {
    return this.options.files
      .filter((file) => !file.hidden)
      .sort((first, second) => (first.name < second.name ? -1 : 1));
  }

  readCharacteristic(uuid: string): Uint8Array {
    if (uuid === SZ_UUID_INFO) return toBytes(this.infoJson());
    if (uuid === SZ_UUID_STAT) return toBytes(this.status);
    const characteristic = this.characteristics.get(uuid);
    return new Uint8Array(characteristic?.value?.buffer ?? new ArrayBuffer(0));
  }

  private infoJson(): string {
    return JSON.stringify({
      proto: SZ_WIRE_PROTO,
      fw: "emulator",
      fileCount: this.visibleFiles().length,
      routeCrc: this.routeCrc,
      routePoints: this.routePoints,
      peerMac: this.peerMac,
      volLow: this.volLow,
      volHigh: this.volHigh,
      freqShort: this.freqShort,
      freqLong: this.freqLong,
      beepShortMs: this.beepShortMs,
      beepLongMs: this.beepLongMs,
      beepGapMs: this.beepGapMs,
      signalGapMs: this.signalGapMs,
      minBeepKmh: this.minBeepKmh,
    });
  }

  private setStatus(status: string): void {
    this.status = status;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.round(value)));
  }

  async writeCtrl(command: string): Promise<void> {
    // Symulacja nieudanego zapisu kontrolnego: komenda nie dociera do urządzenia,
    // a PWA dostaje NotSupportedError (jak realny hiccup GATT).
    if (this.failCtrlRemaining > 0 && command.startsWith(this.failCtrlPrefix)) {
      this.failCtrlRemaining--;
      throw new DOMException("GATT operation failed for unknown reason.", "NotSupportedError");
    }
    this.commands.push(command);
    if (command.startsWith(SZ_CMD_LIST)) {
      this.handleList(command.slice(SZ_CMD_LIST.length));
    } else if (command.startsWith(SZ_CMD_ROTATE)) {
      this.setStatus(SZ_ST_OK);
    } else if (command.startsWith(SZ_CMD_START_FILE)) {
      this.handleStart(command.slice(SZ_CMD_START_FILE.length));
    } else if (command.startsWith(SZ_CMD_STOP)) {
      this.transfer = null;
      this.done = false;
      this.setStatus(SZ_ST_OK);
    } else if (command.startsWith(SZ_CMD_ACK)) {
      this.handleAck(Number(command.slice(SZ_CMD_ACK.length)));
    } else if (command.startsWith(SZ_CMD_NACK)) {
      this.handleNack(Number(command.slice(SZ_CMD_NACK.length)));
    } else if (command.startsWith(SZ_CMD_SETVOL_LOW)) {
      this.volLow = this.clamp(Number(command.slice(SZ_CMD_SETVOL_LOW.length)), 0, 100);
      this.setStatus(`vol low=${this.volLow} high=${this.volHigh}`);
    } else if (command.startsWith(SZ_CMD_SETVOL_HIGH)) {
      this.volHigh = this.clamp(Number(command.slice(SZ_CMD_SETVOL_HIGH.length)), 0, 100);
      this.setStatus(`vol low=${this.volLow} high=${this.volHigh}`);
    } else if (command.startsWith(SZ_CMD_SETFREQ_SHORT)) {
      this.freqShort = this.clamp(Number(command.slice(SZ_CMD_SETFREQ_SHORT.length)), 600, 1500);
      this.setStatus(`freq short=${this.freqShort} long=${this.freqLong}`);
    } else if (command.startsWith(SZ_CMD_SETFREQ_LONG)) {
      this.freqLong = this.clamp(Number(command.slice(SZ_CMD_SETFREQ_LONG.length)), 600, 1500);
      this.setStatus(`freq short=${this.freqShort} long=${this.freqLong}`);
    } else if (command.startsWith(SZ_CMD_SETTIMING_SHORT)) {
      this.beepShortMs = this.clamp(Number(command.slice(SZ_CMD_SETTIMING_SHORT.length)), 20, 200);
      this.reportTiming();
    } else if (command.startsWith(SZ_CMD_SETTIMING_LONG)) {
      this.beepLongMs = this.clamp(Number(command.slice(SZ_CMD_SETTIMING_LONG.length)), 40, 500);
      this.reportTiming();
    } else if (command.startsWith(SZ_CMD_SETTIMING_GAP)) {
      this.beepGapMs = this.clamp(Number(command.slice(SZ_CMD_SETTIMING_GAP.length)), 0, 500);
      this.reportTiming();
    } else if (command.startsWith(SZ_CMD_SETTIMING_INTERVAL)) {
      this.signalGapMs = this.clamp(Number(command.slice(SZ_CMD_SETTIMING_INTERVAL.length)), 100, 5000);
      this.reportTiming();
    } else if (command.startsWith(SZ_CMD_SETMINBEEP)) {
      this.minBeepKmh = this.clamp(Number(command.slice(SZ_CMD_SETMINBEEP.length)), 60, 120);
      this.setStatus(`beep min=${this.minBeepKmh}`);
    } else if (command.startsWith(SZ_CMD_PAIR)) {
      this.startPair();
    }
  }

  /** Ile HudRekaw „odpowie" na kolejne PAIR (0/1/≥2) — do testów wyniku. */
  setPairDevices(count: number): void {
    this.pairDevices = count;
  }

  /**
   * Parowanie jest konsumowane w pętli głównej, nie w callbacku zapisu: wynik
   * pojawia się po faktycznym starcie. Najpierw STATUS `pair wait`, dopiero po
   * chwili rezultat — dzięki temu czytelny jest test na odczyt starego wyniku.
   */
  private startPair(): void {
    setTimeout(() => {
      if (this.transfer) {
        // Radio HUD jest zamknięte na czas transferu — firmware odrzuca.
        this.setStatus(SZ_ERR_BUSY);
        return;
      }
      this.setStatus(SZ_ST_PAIR_WAIT);
      // Jak firmware: PAIR czyści poprzednie przypisanie, zanim zbierze odpowiedzi.
      this.peerMac = "";
      setTimeout(() => {
        if (this.pairDevices === 0) {
          this.peerMac = "";
          this.setStatus(SZ_ERR_PAIR_NONE);
        } else if (this.pairDevices > 1) {
          this.setStatus(SZ_ERR_PAIR_MULTI);
        } else {
          this.peerMac = this.options.peerMac ?? "AA:BB:CC:DD:EE:FF";
          this.setStatus(`${SZ_ST_PAIRED} ${this.peerMac}`);
        }
      }, 5);
    }, 0);
  }

  /** Odbiór binarnego bloba trasy: ramki [offset u16, totalLen u16, payload...]. */
  writeRoute(frame: Uint8Array): void {
    if (frame.length < 4) return;
    const view = toDataView(frame);
    const offset = view.getUint16(0, true);
    const totalLen = view.getUint16(2, true);
    if (offset === 0 || totalLen > this.routeBuffer.length) {
      this.routeBuffer = new Uint8Array(totalLen);
      this.routeReceived = 0;
    }
    const payload = frame.subarray(4);
    if (offset + payload.length <= this.routeBuffer.length) this.routeBuffer.set(payload, offset);
    this.routeReceived = Math.max(this.routeReceived, offset + payload.length);
    if (totalLen >= 20 && this.routeReceived >= totalLen) {
      const blob = this.routeBuffer.subarray(0, totalLen);
      const blobView = toDataView(blob);
      const stored = blobView.getUint32(totalLen - 4, true);
      const computed = crc32(blob.subarray(0, totalLen - 4));
      if (stored === computed) {
        this.routeCrc = stored;
        this.routePoints = blobView.getUint16(10, true);
        this.setStatus(`route ok crc=${crcHex(stored)} points=${this.routePoints}`);
      } else {
        this.setStatus(`route err crc=${crcHex(stored)}`);
      }
    }
  }

  private reportTiming(): void {
    this.setStatus(
      `timing short=${this.beepShortMs} long=${this.beepLongMs} gap=${this.beepGapMs} interval=${this.signalGapMs}`,
    );
  }

  private handleList(since: string): void {
    const echo = since || "0";
    if (this.malformedListPending) {
      this.malformedListPending = false;
      // Nieparzysta liczba pól => parseListStatus rzuca; PWA ma ponowić.
      this.setStatus(`${SZ_ST_LIST}${echo} zle`);
      return;
    }
    const pageSize = this.options.listPageSize ?? SZ_BLE_LIST_MAX;
    const entries = this.visibleFiles().filter((file) => file.name > since).slice(0, pageSize);
    let message = `${SZ_ST_LIST}${echo}`;
    for (const file of entries) message += ` ${file.name} ${file.bytes.length}`;
    this.setStatus(message);
  }

  private handleStart(name: string): void {
    if (this.transfer) {
      this.setStatus(SZ_ERR_BUSY);
      return;
    }
    const file = this.options.files.find((candidate) => candidate.name === name);
    if (!file || this.options.failOpen?.includes(name)) {
      this.setStatus(`${SZ_ERR_OPEN} ${name}`);
      return;
    }
    const comp = new Uint8Array(deflateSync(Buffer.from(file.bytes)));
    const totalFrames = comp.length === 0 ? 0 : Math.ceil(comp.length / SZ_BLE_PAYLOAD_SIZE);
    this.lastTransferFrames = totalFrames;
    this.transfer = {
      file,
      comp,
      totalFrames,
      endSeq: totalFrames,
      crc: crc32(file.bytes),
      droppedOnce: new Set(this.options.dropSeqs ?? []),
      duplicateOnce: new Set(this.options.duplicateSeqs ?? []),
      corruptOnce: new Set(this.options.corruptSeqs ?? []),
    };
    this.acked = 0;
    this.nextSent = 0;
    this.done = false;
    this.pendingReplay = null;
    this.replayScheduled = false;
    this.setStatus(`${SZ_ST_STREAMING}${name}`);
    void this.pump();
  }

  private handleAck(n: number): void {
    if (!this.transfer) return;
    this.acked = Math.max(this.acked, n);
    void this.pump();
  }

  private handleNack(expected: number): void {
    if (!this.transfer) return;
    // Ten sam NACK leci dla każdej odebranej ramki poza kolejnością (PWA odrzuca
    // seq > expected i prosi o brakującą). Scalamy je: cała lawina NACK-ów z
    // jednego zatoru jest przetwarzana w mikro-zadaniach, więc setImmediate
    // wykonuje się raz, z najniższym `expected`.
    if (this.pendingReplay === null || expected < this.pendingReplay) this.pendingReplay = expected;
    if (this.replayScheduled) return;
    this.replayScheduled = true;
    setImmediate(() => {
      this.replayScheduled = false;
      const from = this.pendingReplay;
      this.pendingReplay = null;
      if (from === null || !this.transfer) return;
      const upto = Math.min(this.nextSent, this.transfer.endSeq + 1);
      for (let seq = from; seq < upto; seq++) this.deliver(seq);
      void this.pump();
    });
  }

  private deliver(seq: number): void {
    const transfer = this.transfer;
    if (!transfer) return;
    if (transfer.droppedOnce.has(seq)) {
      transfer.droppedOnce.delete(seq);
      return;
    }
    const header = new Uint8Array([
      seq & 0xff,
      (seq >>> 8) & 0xff,
      (seq >>> 16) & 0xff,
      (seq >>> 24) & 0xff,
    ]);
    const payload =
      seq < transfer.totalFrames
        ? transfer.comp.slice(seq * SZ_BLE_PAYLOAD_SIZE, (seq + 1) * SZ_BLE_PAYLOAD_SIZE)
        : new Uint8Array(0);
    const frame = concat(header, payload);
    if (transfer.corruptOnce.has(seq) && frame.length > SZ_BLE_HEADER_SIZE) {
      transfer.corruptOnce.delete(seq);
      frame[SZ_BLE_HEADER_SIZE] = frame[SZ_BLE_HEADER_SIZE] ^ 0xff; // psuje strumień zlib
    }
    this.dataChar.push(frame);
    if (transfer.duplicateOnce.has(seq)) {
      transfer.duplicateOnce.delete(seq);
      this.dataChar.push(frame);
    }
  }

  private async pump(): Promise<void> {
    const transfer = this.transfer;
    if (!transfer || this.done) return;
    const readErrorFrames = this.options.readErrorAfterFrames?.name === transfer.file.name
      ? this.options.readErrorAfterFrames?.frames ?? 0
      : null;
    while (this.nextSent <= transfer.endSeq && this.nextSent - this.acked < SZ_BLE_WINDOW) {
      this.deliver(this.nextSent);
      this.nextSent++;
      if (readErrorFrames !== null && this.nextSent >= readErrorFrames) {
        this.setStatus(`${SZ_ERR_READ} ${transfer.file.name}`);
        this.transfer = null;
        return;
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    if (this.nextSent > transfer.endSeq && !this.done) {
      this.done = true;
      const crc = this.options.corruptCrc ? (transfer.crc ^ 1) >>> 0 : transfer.crc;
      this.setStatus(
        `${SZ_ST_DONE}${transfer.file.name} raw=${transfer.file.bytes.length} comp=${transfer.comp.length} ` +
          `frames=${transfer.totalFrames} crc=${crcHex(crc)}`,
      );
    }
  }
}

/** Podmienia `navigator.bluetooth` na symulator (Node/Vitest i przeglądarka). */
export function installFakeBluetooth(emulator: DeviceEmulator): void {
  const bluetooth = {
    requestDevice: async () => emulator.device,
    getDevices: async () => [emulator.device],
  };
  Object.defineProperty(globalThis, "navigator", {
    value: { bluetooth },
    configurable: true,
    writable: true,
  });
}

export { crc32 };

