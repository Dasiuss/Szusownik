import { describe, expect, it } from "vitest";
import { routeSyncNotice } from "./routeSyncNotice.ts";

const base = {
  deviceState: "connected" as const,
  routeSync: "sent" as const,
  routeSyncError: null,
  deviceError: null,
};

describe("wiersz stanu wysyłki trasy", () => {
  it("pokazuje postęp łączenia i chowa przycisk ponowienia", () => {
    expect(routeSyncNotice({ ...base, deviceState: "connecting", routeSync: "offline" })).toEqual({
      tone: "pending",
      text: "Łączę z urządzeniem…",
      retry: false,
    });
  });

  it("łączenie ma priorytet nad błędem wysyłki z poprzedniej próby", () => {
    const notice = routeSyncNotice({
      ...base,
      deviceState: "connecting",
      routeSync: "error",
      routeSyncError: "stary błąd",
    });
    expect(notice?.tone).toBe("pending");
  });

  it("po połączeniu pokazuje sprawdzanie urządzenia", () => {
    expect(routeSyncNotice({ ...base, deviceState: "checking" })?.text).toBe("Połączono, sprawdzam urządzenie…");
  });

  it("pokazuje wysyłkę trasy", () => {
    expect(routeSyncNotice({ ...base, routeSync: "sending" })).toEqual({
      tone: "sending",
      text: "Wysyłam trasę na urządzenie…",
      retry: false,
    });
  });

  it("pokazuje błąd wysyłki trasy bez przycisku ponowienia", () => {
    expect(routeSyncNotice({ ...base, routeSync: "error", routeSyncError: "Urządzenie odrzuciło trasę (err:crc)" })).toEqual({
      tone: "error",
      text: "Urządzenie odrzuciło trasę (err:crc)",
      retry: false,
    });
  });

  it("pokazuje błąd łączenia z przyciskiem ponowienia", () => {
    expect(routeSyncNotice({ ...base, deviceState: "error", routeSync: "offline", deviceError: "Brak Web Bluetooth" })).toEqual({
      tone: "error",
      text: "Brak Web Bluetooth",
      retry: true,
    });
  });

  it("bez połączenia pokazuje podpowiedź offline z przyciskiem Połącz", () => {
    expect(routeSyncNotice({ ...base, deviceState: "disconnected", routeSync: "offline" })).toEqual({
      tone: "offline",
      text: "Połącz, aby wysłać trasę na urządzenie",
      retry: true,
    });
  });

  it("sukces i stan spoczynkowy nie renderują nic", () => {
    expect(routeSyncNotice(base)).toBeNull();
    expect(routeSyncNotice({ ...base, routeSync: "idle" })).toBeNull();
  });

  it("błąd pobierania plików nie wycieka do wiersza trasy", () => {
    // `state: connected` + `error` ustawione przez pobieranie: nie pokazujemy tego tutaj.
    expect(routeSyncNotice({ ...base, deviceState: "connected", deviceError: "Pominięto plik" })).toBeNull();
  });
});
