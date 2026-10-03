import { configDefaults, defineConfig } from "vitest/config";

// Testy jednostkowe i integracyjne PWA (bez DOM). E2E (Playwright) ma własny
// runner i katalog `e2e/`, więc jest wykluczony z Vitest.
// Uruchomienie: npm test | npm run test:coverage | npm run test:watch
export default defineConfig({
  define: {
    // version.ts czyta czas builda wstrzykiwany przez vite.config.ts.
    __BUILD_TIME__: JSON.stringify("2026-01-01T00:00:00.000Z"),
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**/*.ts"],
      // protocol.ts jest generowany (scripts/gen-protocol.mjs) — mierzenie go
      // nic nie mówi, pilnuje go test zgodności.
      exclude: ["src/lib/**/*.test.ts", "src/lib/protocol.ts"],
    },
  },
});
