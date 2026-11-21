import { describe, expect, it } from "vitest";
import { defaultDisplayNameFromEmail } from "./profilePolicy.ts";

describe("defaultDisplayNameFromEmail", () => {
  it("uses the first three characters before the @ sign", () => {
    expect(defaultDisplayNameFromEmail("alex.ski@example.com")).toBe("ale");
  });

  it("keeps shorter local parts intact", () => {
    expect(defaultDisplayNameFromEmail("xy@example.com")).toBe("xy");
  });

  it("uses a safe fallback for an empty address", () => {
    expect(defaultDisplayNameFromEmail("")).toBe("Narciarz");
  });
});
