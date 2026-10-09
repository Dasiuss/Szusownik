// Tryb prezentacji wykresów (połączony / osobny) i jego trwały zapis.
// Czysta logika bez React — komponent wykresów trzyma hook lokalnie.

export type ChartMode = "combined" | "separate";

export const CHART_MODE_KEY = "szusownik.chartMode";
export const DEFAULT_CHART_MODE: ChartMode = "combined";

export function parseChartMode(value: string | null): ChartMode {
  return value === "separate" ? "separate" : "combined";
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readChartMode(storage: Storage | null = defaultStorage()): ChartMode {
  if (!storage) return DEFAULT_CHART_MODE;
  try {
    return parseChartMode(storage.getItem(CHART_MODE_KEY));
  } catch {
    return DEFAULT_CHART_MODE;
  }
}

export function writeChartMode(mode: ChartMode, storage: Storage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(CHART_MODE_KEY, mode);
  } catch {
    // Brak dostępu do localStorage (tryb prywatny) nie może psuć UI.
  }
}
