import { expect, test, type Page } from "@playwright/test";

// Service worker potrafi podać stary build; e2e ma iść zawsze po świeżym.
test.use({ serviceWorkers: "block" });

// E2E dopasowania tras: wstrzykujemy do IndexedDB syntetyczne zjazdy z gotowym
// przypisaniem tras (map-matching liczy się poza przeglądarką, w testach
// jednostkowych). Sprawdzamy tytuł-sekwencję i sekcję „Poprzednie przejazdy”.

interface InjectedRun {
  id: string;
  startT: string;
  routeName: string | null;
  routeSequence: Array<{ key: string; label: string; difficulty: string }>;
  routeSpans: Array<Record<string, unknown>>;
}

function enrichedSample(t: string, speed: number, cum: number): Record<string, unknown> {
  return {
    t,
    lat: 46.97,
    lon: 10.98,
    speed,
    altGps: 1000 - cum,
    hdg: 180,
    altBaro: 1000 - cum,
    gnssFixValid: true,
    gnssFixAgeMs: 100,
    gnssSatellites: 8,
    gnssSatellitesAgeMs: 100,
    gnssHdop: 0.9,
    gnssHdopAgeMs: 100,
    distM: 10,
    cumDistM: cum,
    speedSm: speed,
    altSm: 1000 - cum,
    gradeSm: -10,
  };
}

function span(routeKey: string, label: string, difficulty: string, startT: string, endT: string, distanceM: number, maxSpeed: number, durationS: number): Record<string, unknown> {
  return { routeKey, label, difficulty, startT, endT, distanceM, durationS, maxSpeed };
}

const R15 = { key: "Sölden::15", label: "15", difficulty: "intermediate" };
const R8 = { key: "Sölden::8", label: "8", difficulty: "advanced" };

function record(id: string, startT: string, endT: string, sequence: Array<{ key: string; label: string; difficulty: string }>, spans: Array<Record<string, unknown>>, routeName: string | null): Record<string, unknown> {
  return {
    id,
    dayKey: "2026-01-15",
    startT,
    endT,
    distanceM: 1200,
    analysisVersion: 2,
    rawMaxSpeed: 90,
    rawMaxSampleIndex: 0,
    rawMaxQuality: { accelerationOk: true, gnssOk: true, shapeOk: true },
    confirmedMaxSpeed: 90,
    confirmedSampleIndex: 0,
    confirmedQuality: { accelerationOk: true, gnssOk: true, shapeOk: true },
    maxGradeDown: 20,
    samples: [enrichedSample(startT, 40, 0), enrichedSample(endT, 90, 1200)],
    routeSpans: spans,
    routeSequence: sequence,
    routeName,
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

const CURRENT: InjectedRun = {
  id: "run-current",
  startT: "2026-01-15T14:32:00.000Z",
  routeName: "15 → 8",
  routeSequence: [R15, R8],
  routeSpans: [
    span("Sölden::15", "15", "intermediate", "2026-01-15T14:32:10.000Z", "2026-01-15T14:32:51.000Z", 800, 78, 41),
    span("Sölden::8", "8", "advanced", "2026-01-15T14:33:00.000Z", "2026-01-15T14:33:33.000Z", 600, 88, 33),
  ],
};

test("szczegóły zjazdu: sekwencja tras w tytule i poprzednie przejazdy", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator(".run-card").first()).toBeVisible();

  await injectRuns(page, [
    record(CURRENT.id, CURRENT.startT, "2026-01-15T14:38:18.000Z", CURRENT.routeSequence, CURRENT.routeSpans, CURRENT.routeName),
    record("run-prev-earlier", "2026-01-14T11:05:00.000Z", "2026-01-14T11:11:00.000Z", [R15, R8], [
      span("Sölden::15", "15", "intermediate", "2026-01-14T11:05:00.000Z", "2026-01-14T11:05:45.000Z", 750, 79, 45),
      span("Sölden::8", "8", "advanced", "2026-01-14T11:05:50.000Z", "2026-01-14T11:06:25.000Z", 580, 71, 35),
    ], "15 → 8"),
    record("run-prev-latest", "2026-01-15T12:10:00.000Z", "2026-01-15T12:16:00.000Z", [R15, R8], [
      span("Sölden::15", "15", "intermediate", "2026-01-15T12:10:00.000Z", "2026-01-15T12:10:41.000Z", 810, 87, 41),
      span("Sölden::8", "8", "advanced", "2026-01-15T12:10:50.000Z", "2026-01-15T12:11:24.000Z", 620, 84, 34),
    ], "15 → 8"),
    record("run-only-15", "2026-01-13T10:00:00.000Z", "2026-01-13T10:05:00.000Z", [R15], [
      span("Sölden::15", "15", "intermediate", "2026-01-13T10:00:00.000Z", "2026-01-13T10:00:44.000Z", 700, 74, 44),
    ], "15"),
  ]);

  await page.goto(`./#/zjazd/${encodeURIComponent(CURRENT.id)}`);

  // Tytuł to sekwencja tras (kolory trudności), bo brak własnej nazwy.
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toContainText("15");
  await expect(heading).toContainText("8");
  await expect(heading).toHaveClass(/route-title/);

  await expect(page.getByRole("heading", { name: "Poprzednie przejazdy" })).toBeVisible();

  // Trzy grupy: cała sekwencja + trasa 15 + trasa 8.
  await expect(page.locator(".route-group")).toHaveCount(3);

  const sequenceGroup = page.locator(".route-group").first();
  await expect(sequenceGroup).toContainText("Cała sekwencja");
  await expect(sequenceGroup).toContainText("najlepszy 1:24");

  // Trasa 15: przejazdy z różnych dni, od najnowszego.
  const route15 = page.locator(".route-group").nth(1);
  await expect(route15).toContainText("Trasa");
  await expect(route15.locator(".ride-row")).toHaveCount(3);

  // Klik w wiersz przenosi do szczegółów tamtego zjazdu.
  await route15.locator(".ride-row").first().click();
  await expect(page).toHaveURL(/#\/zjazd\/run-prev-latest/);
});

test("szczegóły zjazdu: własna nazwa wygrywa, sekwencja ląduje niżej", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator(".run-card").first()).toBeVisible();

  await injectRuns(page, [
    { ...record(CURRENT.id, CURRENT.startT, "2026-01-15T14:38:18.000Z", CURRENT.routeSequence, CURRENT.routeSpans, CURRENT.routeName), label: "Szybki przejazd" },
    record("run-prev-latest", "2026-01-15T12:10:00.000Z", "2026-01-15T12:16:00.000Z", [R15, R8], [
      span("Sölden::15", "15", "intermediate", "2026-01-15T12:10:00.000Z", "2026-01-15T12:10:41.000Z", 810, 87, 41),
    ], "15 → 8"),
  ]);

  await page.goto(`./#/zjazd/${encodeURIComponent(CURRENT.id)}`);

  await expect(page.getByRole("heading", { level: 1, name: "Szybki przejazd" })).toBeVisible();
  const chips = page.locator(".route-line .route-chip");
  await expect(chips).toHaveCount(2);
  await expect(chips.first()).toHaveText("15");
});
