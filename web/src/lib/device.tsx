import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { materializeAll } from "./data.ts";
import { db } from "./db.ts";
import { emptyRouteBlob } from "./routeTransfer.ts";
import {
  SzusownikBle,
  type DeviceInfo,
  type FileMeta,
  type Freq,
  type SyncProgress,
  type Timing,
  type Volume,
} from "./ble.ts";

export type DeviceState = "disconnected" | "connecting" | "checking" | "connected" | "downloading" | "error";

/** Stan wysyłki trasy na urządzenie (panel trasy w PWA). */
export type RouteSyncState = "idle" | "offline" | "sending" | "sent" | "error";

interface RouteBlob {
  bytes: Uint8Array;
  crc: number;
}

interface DeviceContextValue {
  state: DeviceState;
  info: DeviceInfo | null;
  pendingFiles: FileMeta[];
  progress: SyncProgress | null;
  error: string | null;
  clearError: () => void;
  lastSyncAt: string | null;
  dataRevision: number;
  routeSync: RouteSyncState;
  routeSyncError: string | null;
  connectAndCheck: () => Promise<void>;
  downloadPending: () => Promise<void>;
  disconnect: () => void;
  setVolume: (which: "low" | "high", value: number) => Promise<Volume>;
  setFrequency: (which: "short" | "long", value: number) => Promise<Freq>;
  setTiming: (which: keyof Timing, value: number) => Promise<Timing>;
  setMinBeepKmh: (value: number) => Promise<number>;
  /** Żąda zsynchronizowania trasy na urządzeniu (null = wyślij CLEAR). */
  syncRoute: (encoded: RouteBlob | null) => void;
}

const DeviceContext = createContext<DeviceContextValue | null>(null);

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function DeviceProvider({ children }: { children: ReactNode }) {
  const bleRef = useRef<SzusownikBle | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempted = useRef(false);
  const downloadingRef = useRef(false);
  const infoRef = useRef<DeviceInfo | null>(null);
  const desiredRouteRef = useRef<RouteBlob | null>(null);
  const hasDesiredRouteRef = useRef(false);
  const routeSendingRef = useRef(false);
  const routeDirtyRef = useRef(false);
  const [state, setState] = useState<DeviceState>("disconnected");
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [pendingFiles, setPendingFiles] = useState<FileMeta[]>([]);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [dataRevision, setDataRevision] = useState(0);
  const [routeSync, setRouteSync] = useState<RouteSyncState>("idle");
  const [routeSyncError, setRouteSyncError] = useState<string | null>(null);

  function clearError() {
    setError(null);
  }

  function clearIdleTimer() {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = null;
  }

  function disconnect() {
    clearIdleTimer();
    bleRef.current?.disconnect();
    bleRef.current = null;
    infoRef.current = null;
    setInfo(null);
    setPendingFiles([]);
    setProgress(null);
    setState("disconnected");
  }

  function armIdleTimer() {
    clearIdleTimer();
    idleTimer.current = setTimeout(disconnect, IDLE_TIMEOUT_MS);
  }

  function touch() {
    if (bleRef.current) armIdleTimer();
  }

  async function finishConnection(client: SzusownikBle, connectedInfo: DeviceInfo) {
    bleRef.current = client;
    infoRef.current = connectedInfo;
    setInfo(connectedInfo);
    setState("checking");
    const fresh = await client.collectNewFiles();
    setPendingFiles(fresh);
    setState("connected");
    armIdleTimer();
  }

  // --- Synchronizacja trasy nawigacyjnej (PWA -> Szusownik) ---
  // Trasa jest wysyłana, gdy jej CRC (tożsamość) różni się od trzymanej przez
  // urządzenie. Po reconnect PWA dosyła aktywną trasę raz, więc restart
  // urządzenia (trasa w RAM) nie wymaga ponownego planowania w PWA.
  function syncRoute(encoded: RouteBlob | null) {
    if (encoded) {
      desiredRouteRef.current = encoded;
      hasDesiredRouteRef.current = true;
    } else if (hasDesiredRouteRef.current) {
      desiredRouteRef.current = null;
    } else {
      return; // PWA nigdy nie miała trasy — nie ruszamy trasy na urządzeniu
    }
    void flushRoute();
  }

  async function flushRoute() {
    if (!hasDesiredRouteRef.current) return;
    if (routeSendingRef.current) {
      routeDirtyRef.current = true;
      return;
    }
    const client = bleRef.current;
    if (!client) {
      setRouteSync("offline");
      return;
    }
    const target = desiredRouteRef.current ?? emptyRouteBlob();
    if (infoRef.current && infoRef.current.routeCrc === target.crc) {
      setRouteSyncError(null);
      setRouteSync("sent");
      return;
    }
    routeSendingRef.current = true;
    routeDirtyRef.current = false;
    setRouteSync("sending");
    try {
      const status = await client.sendRoute(target.bytes);
      const fresh = await client.readInfo();
      infoRef.current = fresh;
      setInfo(fresh);
      if (status.startsWith("err:")) {
        setRouteSyncError(`Urządzenie odrzuciło trasę (${status})`);
        setRouteSync("error");
      } else {
        setRouteSyncError(null);
        setRouteSync("sent");
      }
    } catch (caught) {
      setRouteSyncError(errorMessage(caught));
      setRouteSync("error");
    } finally {
      routeSendingRef.current = false;
      if (routeDirtyRef.current) void flushRoute();
    }
  }

  async function connectAndCheck() {
    disconnect();
    setError(null);
    setState("connecting");
    const client = new SzusownikBle();
    try {
      const connectedInfo = await client.connect();
      await finishConnection(client, connectedInfo);
      void flushRoute();
    } catch (caught) {
      disconnect();
      setState("error");
      setError(errorMessage(caught));
    }
  }

  async function tryReconnect() {
    if (reconnectAttempted.current) return;
    reconnectAttempted.current = true;
    const client = new SzusownikBle();
    try {
      const connectedInfo = await client.reconnect();
      if (!connectedInfo) return;
      setState("checking");
      await finishConnection(client, connectedInfo);
      void flushRoute();
    } catch {
      disconnect();
    }
  }

  async function downloadPending() {
    const client = bleRef.current;
    if (!client || pendingFiles.length === 0 || downloadingRef.current) return;
    downloadingRef.current = true;
    setError(null);
    setState("downloading");
    setProgress(null);
    try {
      const { transient, corrupt } = await client.downloadFiles(pendingFiles, setProgress);
      await materializeAll();
      // Trwale uszkodzone pliki zapamiętujemy, żeby nie wracały w każdej synchronizacji.
      for (const { meta, reason } of corrupt) {
        await db.ignoredFiles.put({
          name: meta.name.replace(/^\//, ""),
          reason,
          ignoredAt: new Date().toISOString(),
        });
      }
      setPendingFiles(transient);
      setProgress(null);
      const notices: string[] = [];
      if (corrupt.length > 0) {
        const names = corrupt.map((entry) => entry.meta.name).join(", ");
        notices.push(
          `Pominięto plik z urządzenia: ${names}. ` +
            "Nie da się go pobrać — zostaje na karcie jako backup (możesz spróbować odzyskać na komputerze).",
        );
      }
      if (transient.length > 0) {
        notices.push(`Nie udało się pobrać ${transient.length} plików — spróbuj ponownie.`);
      }
      if (notices.length > 0) setError(notices.join(" "));
      setLastSyncAt(new Date().toISOString());
      setDataRevision((revision) => revision + 1);
      setState("connected");
      armIdleTimer();
    } catch (caught) {
      setState("connected");
      setError(errorMessage(caught));
      armIdleTimer();
    } finally {
      downloadingRef.current = false;
    }
  }

  function requireClient(): SzusownikBle {
    const client = bleRef.current;
    if (!client) throw new Error("Najpierw połącz urządzenie.");
    touch();
    return client;
  }

  async function setVolume(which: "low" | "high", value: number): Promise<Volume> {
    return requireClient().setVolume(which, value);
  }

  async function setFrequency(which: "short" | "long", value: number): Promise<Freq> {
    return requireClient().setFrequency(which, value);
  }

  async function setTiming(which: keyof Timing, value: number): Promise<Timing> {
    return requireClient().setTiming(which, value);
  }

  async function setMinBeepKmh(value: number): Promise<number> {
    return requireClient().setMinBeepKmh(value);
  }

  useEffect(() => {
    void tryReconnect();
    return clearIdleTimer;
  }, []);

  return (
    <DeviceContext.Provider
      value={{
        state,
        info,
        pendingFiles,
        progress,
        error,
        clearError,
        lastSyncAt,
        dataRevision,
        routeSync,
        routeSyncError,
        connectAndCheck,
        downloadPending,
        disconnect,
        setVolume,
        setFrequency,
        setTiming,
        setMinBeepKmh,
        syncRoute,
      }}
    >
      {children}
    </DeviceContext.Provider>
  );
}

export function useDevice(): DeviceContextValue {
  const context = useContext(DeviceContext);
  if (!context) throw new Error("useDevice musi być użyty wewnątrz DeviceProvider");
  return context;
}
