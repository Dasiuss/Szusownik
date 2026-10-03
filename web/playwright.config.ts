import { defineConfig, devices } from "@playwright/test";

// E2E PWA (przeglądarka). Uruchamia build produkcyjny i `vite preview`, a testy
// jeżdżą po nim w Chromium. Web Bluetooth nie istnieje w Chromium headless —
// testy wstrzykują symulator urządzenia (e2e/ble-stub.ts) przez addInitScript.
// Uruchomienie: npm run test:e2e  (najpierw: npx playwright install chromium)
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4173/Szusownik/",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run build && npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173/Szusownik/",
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
