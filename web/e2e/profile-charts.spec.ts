import { expect, test, type Page } from "@playwright/test";

// Wykresy profilu (połączony / osobny), klikalna legenda i punkt na mapie.
// Wstrzykujemy do IndexedDB jeden zjazd z kilkupunktowym śladem i zmienną
// prędkością, żeby seria przyspieszenia była niezerowa.

test.use({ serviceWorkers: "block" });

const DAY_KEY = "2026-01-15";

function track(startT: string): Array<Record<string, unknown>> {
  const base = Date.parse(startT);
  return Array.from({ length: 24 }, (_, index) => ({
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
    rawMaxSpeed: 90,
    rawMaxSampleIndex: 0,
    rawMaxQuality: { accelerationOk: true, gnssOk: true, shapeOk: true },
    confirmedMaxSpeed: 90,
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

async function openRun(page: Page): Promise<void> {
  await page.goto("./");
  await expect(page.locator(".run-card").first()).toBeVisible();
  await injectRuns(page, [record("run-charts", `${DAY_KEY}T14:32:00.000Z`, `${DAY_KEY}T14:45:00.000Z`)]);
  await page.goto(`./#/zjazd/${encodeURIComponent("run-charts")}`);
  await expect(page.locator(".chart-card")).toBeVisible();
}

test("tryb połączony domyślnie, przełączanie zapisuje się i przetrwa przeładowanie", async ({ page }) => {
  await openRun(page);

  // Domyślnie połączony: jedna scena (brak stosu osobnych wykresów).
  await expect(page.getByRole("button", { name: "Tryb połączony" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".chart-stack")).toHaveCount(0);

  // Trzy klikalne pozycje legendy.
  await expect(page.locator(".chart-legend-item")).toHaveCount(3);

  // Przełączenie na tryb osobny: trzy wykresy jeden pod drugim.
  await page.getByRole("button", { name: "Tryb osobny" }).click();
  await expect(page.locator(".chart-subwrap")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Tryb osobny" })).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => localStorage.getItem("szusownik.chartMode"))).toBe("separate");

  // Przeładowanie zachowuje wybór.
  await page.reload();
  await expect(page.locator(".chart-card")).toBeVisible();
  await expect(page.locator(".chart-subwrap")).toHaveCount(3);
});

test("legenda chowa serię i jej wiersz, najechanie pokazuje punkt na mapie", async ({ page }) => {
  await openRun(page);

  // Mapa musi być gotowa, zanim pojawi się znacznik.
  await expect(page.locator(".trace-map canvas").first()).toBeVisible();

  // Najechanie na wykres ustawia punkt na mapie.
  await page.locator(".chart-wrap").hover();
  await expect(page.locator(".trace-highlight-marker")).toBeVisible();

  // Klikalna legenda: wyłączenie prędkości zdejmuje jej oś/wiersz.
  await page.getByRole("button", { name: "Tryb osobny" }).click();
  await expect(page.locator(".chart-subwrap")).toHaveCount(3);
  await page.getByRole("button", { name: "prędkość" }).click();
  await expect(page.getByRole("button", { name: "prędkość" })).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator(".chart-subwrap")).toHaveCount(2);
});
