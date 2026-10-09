import { describe, expect, it } from "vitest";
import {
  CHART_MODE_KEY,
  DEFAULT_CHART_MODE,
  parseChartMode,
  readChartMode,
  writeChartMode,
} from "./chartMode.ts";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

describe("chartMode", () => {
  it("domyślnie połączony", () => {
    expect(DEFAULT_CHART_MODE).toBe("combined");
    expect(parseChartMode(null)).toBe("combined");
    expect(parseChartMode("cokolwiek")).toBe("combined");
    expect(parseChartMode("combined")).toBe("combined");
    expect(parseChartMode("separate")).toBe("separate");
  });

  it("zapisuje i odczytuje tryb", () => {
    const storage = memoryStorage();
    expect(readChartMode(storage)).toBe("combined");
    writeChartMode("separate", storage);
    expect(storage.getItem(CHART_MODE_KEY)).toBe("separate");
    expect(readChartMode(storage)).toBe("separate");
    writeChartMode("combined", storage);
    expect(readChartMode(storage)).toBe("combined");
  });

  it("nie wywala się bez dostępu do localStorage", () => {
    const throwing: Storage = {
      length: 0,
      clear: () => undefined,
      getItem: () => {
        throw new Error("brak dostępu");
      },
      key: () => null,
      removeItem: () => undefined,
      setItem: () => {
        throw new Error("brak dostępu");
      },
    };
    expect(readChartMode(throwing)).toBe("combined");
    expect(() => writeChartMode("separate", throwing)).not.toThrow();
  });
});
