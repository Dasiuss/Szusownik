import type { DeviceState, RouteSyncState } from "./device.tsx";

export type SyncNoticeTone = "pending" | "sending" | "error" | "offline";

export interface SyncNotice {
  tone: SyncNoticeTone;
  text: string;
  /** Pokaż przycisk „Połącz" — użytkownik może ponowić próbę. */
  retry: boolean;
}

/**
 * Wiersz stanu wysyłki trasy w panelu trasy na mapie.
 *
 * Łączenie z urządzeniem (picker, GATT, LIST) jest osobnym krokiem przed
 * wysyłką, więc `deviceState` ma priorytet nad `routeSync`: w trakcie próby
 * łączenia wiersz pokazuje postęp i chowa przycisk „Połącz" (koniec klikanie
 * w kółko bez reakcji).
 *
 * Sukces nie renderuje nic — wiersz znika (`:empty` w CSS). Dosyłki w tle
 * (np. `trimRoute` w nawigacji) nie migają komunikatem.
 */
export function routeSyncNotice(input: {
  deviceState: DeviceState;
  routeSync: RouteSyncState;
  routeSyncError: string | null;
  deviceError: string | null;
}): SyncNotice | null {
  const { deviceState, routeSync, routeSyncError, deviceError } = input;
  if (deviceState === "connecting") return { tone: "pending", text: "Łączę z urządzeniem…", retry: false };
  if (deviceState === "checking") {
    return { tone: "pending", text: "Połączono, sprawdzam urządzenie…", retry: false };
  }
  if (routeSync === "sending") return { tone: "sending", text: "Wysyłam trasę na urządzenie…", retry: false };
  if (routeSync === "error") {
    return { tone: "error", text: routeSyncError ?? "Nie udało się wysłać trasy", retry: false };
  }
  if (deviceState === "error") {
    return { tone: "error", text: deviceError ?? "Nie udało się połączyć z urządzeniem", retry: true };
  }
  if (routeSync === "offline") {
    return { tone: "offline", text: "Połącz, aby wysłać trasę na urządzenie", retry: true };
  }
  return null;
}
