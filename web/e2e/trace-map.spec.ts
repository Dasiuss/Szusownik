import { expect, test, type Page } from "@playwright/test";

// Mini-mapa śladu (MapLibre 2D) w szczegółach zjazdu i w widoku „Cały dzień".
// Wstrzykujemy do IndexedDB jeden zjazd z realnym, kilkupunktowym śladem.

test.use({ serviceWorkers: "block" });

const DAY_KEY = "2026-01-15";

function track(startT: string): Array<Record<string, unknown>> {
  const base = Date.parse(startT);
  return Array.from({ length: 20 }, (_, index) => ({
    t: new Date(base + index * 1000).toISOString(),
    lat: 46.97 + index * 0.0004,
    lon: 10.98 + index * 0.0006,
    speed: 20 + index * 3,
    altGps: 2500 - index * 8,
    hdg: 135,
    altBaro: 2500 - index * 8,
    gnssFixValid: true,
    gnssFixAgeMs: 100,
    gnssSatellites: 9,
    gnssSatellitesAgeMs: 100,
    gnssHdop: 0.8,
    gnssHdopAgeMs: 100,
    distM: 50,
    cumDistM: index * 50,
    speedSm: 20 + index * 3,
    altSm: 2500 - index * 8,
    gradeSm: -10,
  }));
}

function record(id: string, startT: string, endT: string): Record<string, unknown> {
  return {
    id,
    dayKey: DAY_KEY,
    startT,
    endT,
    distanceM: 1000,
    analysisVersion: 2,
    rawMaxSpeed: 80,
    rawMaxSampleIndex: 0,
    rawMaxQuality: { accelerationOk: true, gnssOk: true, shapeOk: true },
    confirmedMaxSpeed: 80,
    confirmedSampleIndex: 0,
    confirmedQuality: { accelerationOk: true, gnssOk: true, shapeOk: true },
    maxGradeDown: 18,
    samples: track(startT),
    routeSpans: [],
    routeSequence: [],
    routeName: null,
    receivedAt: "2026-01-15T12:00:00.000Z",
  };
}

async function injectRuns(page: Page, runs: Array<Record<string, unknown>>): Promise<void> {
  await page.evaluate(async (records) => {
    const open = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("szusownik");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = open.transaction("runs", "readwrite");
      const store = transaction.objectStore("runs");
      for (const record of records) store.put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    open.close();
  }, runs);
}

test("mini-mapa śladu w szczegółach zjazdu i w widoku dnia", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator(".run-card").first()).toBeVisible();

  await injectRuns(page, [record("run-trace", `${DAY_KEY}T14:32:00.000Z`, `${DAY_KEY}T14:45:00.000Z`)]);

  // Szczegóły zjazdu.
  await page.goto(`./#/zjazd/${encodeURIComponent("run-trace")}`);
  const runMap = page.locator(".trace-map");
  await expect(runMap).toBeVisible();
  await expect(runMap.locator("canvas").first()).toBeVisible();

  // Przycisk powiększa kafelek (i zwija z powrotem).
  const card = page.locator(".trace-map-card");
  const normalHeight = (await runMap.boundingBox())?.height ?? 0;
  await page.getByRole("button", { name: "Powiększ mapę" }).click();
  await expect(card).toHaveClass(/trace-map-card-expanded/);
  await expect.poll(async () => (await runMap.boundingBox())?.height ?? 0).toBeGreaterThan(normalHeight);
  await page.getByRole("button", { name: "Zwiń mapę" }).click();
  await expect(card).not.toHaveClass(/trace-map-card-expanded/);

  // Widok „Cały dzień".
  await page.goto(`./#/dzien/${DAY_KEY}/calosc`);
  const dayMap = page.locator(".trace-map");
  await expect(dayMap).toBeVisible();
  await expect(dayMap.locator("canvas").first()).toBeVisible();
});
