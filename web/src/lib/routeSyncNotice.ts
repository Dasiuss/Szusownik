import type { DeviceState, RouteSyncState } from "./device.tsx";

export type SyncNoticeTone = "pending" | "sending" | "error";

export interface SyncNotice {
  tone: SyncNoticeTone;
  text: string;
}

/**
 * Wiersz stanu wysyłki trasy w panelu trasy na mapie.
 *
 * Łączenie z urządzeniem (picker, GATT, LIST) jest osobnym krokiem przed
 * wysyłką, więc `deviceState` ma priorytet nad `routeSync`: w trakcie próby
 * łączenia wiersz pokazuje postęp.
 *
 * Brak połączenia nie renderuje nic — zamiast stałej podpowiedzi offline
 * z przyciskiem „Połącz” trasa dosyła się automatycznie po połączeniu
 * urządzenia. Sukces też nie renderuje nic (`:empty` w CSS). Dzięki temu
 * wiersz zajmuje miejsce tylko wtedy, gdy dzieje się coś istotnego.
 */
export function routeSyncNotice(input: {
  deviceState: DeviceState;
  routeSync: RouteSyncState;
  routeSyncError: string | null;
  deviceError: string | null;
}): SyncNotice | null {
  const { deviceState, routeSync, routeSyncError, deviceError } = input;
  if (deviceState === "connecting") return { tone: "pending", text: "Łączę z urządzeniem…" };
  if (deviceState === "checking") {
    return { tone: "pending", text: "Połączono, sprawdzam urządzenie…" };
  }
  if (routeSync === "sending") return { tone: "sending", text: "Wysyłam trasę na urządzenie…" };
  if (routeSync === "error") {
    return { tone: "error", text: routeSyncError ?? "Nie udało się wysłać trasy" };
  }
  if (deviceState === "error") {
    return { tone: "error", text: deviceError ?? "Nie udało się połączyć z urządzeniem" };
  }
  return null;
}
