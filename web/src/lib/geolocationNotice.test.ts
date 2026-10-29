import { describe, expect, it } from "vitest";
import { gpsNotice } from "./geolocationNotice.ts";

describe("komunikat GPS na mapie", () => {
  it("milczy, gdy użytkownik zablokował lokalizację", () => {
    expect(gpsNotice(1)).toBeNull();
  });

  it("pokazuje błąd, gdy pozycja jest chwilowo niedostępna", () => {
    expect(gpsNotice(2)).toBe("Nie udało się odczytać pozycji GPS.");
  });

  it("pokazuje błąd po timeoucie", () => {
    expect(gpsNotice(3)).toBe("Nie udało się odczytać pozycji GPS.");
  });

  it("milczy bez błędu", () => {
    expect(gpsNotice(null)).toBeNull();
  });
});
