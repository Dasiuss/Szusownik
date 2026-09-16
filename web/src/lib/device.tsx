import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { materializeFiles } from "./data.ts";
import {
  SzusownikBle,
  type DeviceInfo,
  type FileMeta,
  type Freq,
  type SyncProgress,
  type Volume,
} from "./ble.ts";

export type DeviceState = "disconnected" | "connecting" | "checking" | "connected" | "downloading" | "error";

interface DeviceContextValue {
  state: DeviceState;
  info: DeviceInfo | null;
  pendingFiles: FileMeta[];
  progress: SyncProgress | null;
  error: string | null;
  lastSyncAt: string | null;
  dataRevision: number;
  connectAndCheck: () => Promise<void>;
  downloadPending: () => Promise<void>;
  disconnect: () => void;
  getVolume: () => Promise<Volume>;
  setVolume: (which: "low" | "high", value: number) => Promise<Volume>;
  getFrequency: () => Promise<Freq>;
  setFrequency: (which: "short" | "long", value: number) => Promise<Freq>;
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
  const [state, setState] = useState<DeviceState>("disconnected");
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  const [pendingFiles, setPendingFiles] = useState<FileMeta[]>([]);
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [dataRevision, setDataRevision] = useState(0);

  function clearIdleTimer() {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = null;
  }

  function disconnect() {
    clearIdleTimer();
    bleRef.current?.disconnect();
    bleRef.current = null;
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
    setInfo(connectedInfo);
    setState("checking");
    const fresh = await client.checkNewFiles();
    setPendingFiles(fresh);
    setState("connected");
    armIdleTimer();
  }

  async function connectAndCheck() {
    disconnect();
    setError(null);
    setState("connecting");
    const client = new SzusownikBle();
    try {
      const connectedInfo = await client.connect();
      await finishConnection(client, connectedInfo);
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
    } catch {
      disconnect();
    }
  }

  async function downloadPending() {
    const client = bleRef.current;
    if (!client || pendingFiles.length === 0) return;
    setError(null);
    setState("downloading");
    setProgress(null);
    try {
      const done = await client.downloadFiles(pendingFiles, setProgress);
      await materializeFiles(done.map((file) => file.name));
      setPendingFiles([]);
      setProgress(null);
      setLastSyncAt(new Date().toISOString());
      setDataRevision((revision) => revision + 1);
      setState("connected");
      armIdleTimer();
    } catch (caught) {
      setState("connected");
      setError(errorMessage(caught));
      armIdleTimer();
    }
  }

  function requireClient(): SzusownikBle {
    const client = bleRef.current;
    if (!client) throw new Error("Najpierw połącz urządzenie.");
    touch();
    return client;
  }

  async function getVolume(): Promise<Volume> {
    return requireClient().getVolume();
  }

  async function setVolume(which: "low" | "high", value: number): Promise<Volume> {
    return requireClient().setVolume(which, value);
  }

  async function getFrequency(): Promise<Freq> {
    return requireClient().getFrequency();
  }

  async function setFrequency(which: "short" | "long", value: number): Promise<Freq> {
    return requireClient().setFrequency(which, value);
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
        lastSyncAt,
        dataRevision,
        connectAndCheck,
        downloadPending,
        disconnect,
        getVolume,
        setVolume,
        getFrequency,
        setFrequency,
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
