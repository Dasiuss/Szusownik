export function defaultDisplayNameFromEmail(email: string): string {
  const localPart = email.trim().split("@", 1)[0]?.trim() ?? "";
  return Array.from(localPart).slice(0, 3).join("") || "Narciarz";
}

export function normalizeDisplayName(value: string): string {
  return value.trim().slice(0, 32);
}
