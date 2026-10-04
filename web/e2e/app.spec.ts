import { expect, test, type Page } from "@playwright/test";

// Boot PWA z danymi demo (seed z public/fixtures/ride.csv) i przejście po
// wszystkich zakładkach. Mapa ma osobny test (potrzebuje mocka Overpass).
// Router jest hash-owy, więc ścieżki idą po "#/...".

function bottomNav(page: Page) {
  return page.getByRole("navigation", { name: "Główna nawigacja" });
}

test("boot z danymi demo i nawigacja po zakładkach", async ({ page }) => {
  await page.goto("./");

  await expect(page.getByRole("heading", { name: "Dzisiaj", exact: true })).toBeVisible();
  await expect(page.getByText("Cały dzień")).toBeVisible();
  await expect(page.locator(".run-card").first()).toBeVisible();

  await bottomNav(page).getByRole("link", { name: "Historia" }).click();
  await expect(page.getByRole("heading", { name: "Historia", exact: true })).toBeVisible();
  await expect(page.locator(".history-list")).toBeVisible();

  await bottomNav(page).getByRole("link", { name: "Urządzenie" }).click();
  await expect(page.getByRole("heading", { name: "Urządzenie", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Połącz urządzenie" })).toBeVisible();
  await expect(page.getByText("Wersja PWA")).toBeVisible();
});

test("mapa renderuje się z zamockowanym Overpass", async ({ page }) => {
  await page.route("**/overpass-api.de/**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ elements: [] }) }),
  );

  await page.goto("./#/mapa");
  await expect(page.locator('[aria-label="Mapa tras narciarskich Sölden"]')).toBeVisible({ timeout: 30_000 });
});

test("szczegóły zjazdu: zmiana nazwy i usunięcie", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator(".run-card").first()).toBeVisible();
  await page.locator(".run-card").first().click();

  await page.getByRole("heading", { level: 1 }).click();
  await page.getByPlaceholder("Np. Najlepszy stok").fill("Testowa nazwa");
  await page.getByRole("button", { name: "Zapisz nazwę" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Testowa nazwa" })).toBeVisible();

  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Usuń zjazd" }).click();
  await expect(page).toHaveURL(/#\/dzien\//);
});

test("wskaźniki jakości pokazują objaśnienie po najechaniu i kliknięciu", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator(".run-card").first()).toBeVisible();
  await page.locator(".run-card").first().click();

  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toHaveCount(0);

  await page.getByRole("img", { name: /^Przyspieszenie:/ }).first().hover();
  await expect(tooltip).toBeVisible();
  const title = tooltip.locator(".quality-tooltip-title");
  await expect(title).toHaveText("Przyspieszenie");
  await expect(title).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(tooltip.locator(".quality-tooltip-text")).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(tooltip).toContainText("1 g");

  await page.getByRole("img", { name: /^Jakość fixa GNSS:/ }).first().click();
  await expect(tooltip).toBeVisible();
  await expect(tooltip.locator(".quality-tooltip-title")).toHaveText("Jakość fixa GNSS");
  await expect(tooltip).toContainText("HDOP");

  await page.getByRole("heading", { level: 1 }).click();
  await expect(tooltip).toHaveCount(0);
});

test("ikony jakości mają odrębne symbole, a status widać po wypełnieniu", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator(".run-card").first()).toBeVisible();
  await page.locator(".run-card").first().click();

  await expect(page.locator(".quality-glyph-g").first()).toBeVisible();
  await expect(page.locator(".quality-glyph-g").first()).toHaveCSS("font-weight", "400");
  await expect(page.locator(".quality-glyph-curve").first()).toBeVisible();
  await expect(page.locator(".quality-glyph-satellite").first()).toBeVisible();

  const passed = page.locator(".quality-indicator-passed").first();
  await expect(passed).toHaveCSS("background-color", "rgb(47, 134, 93)");
  await expect(passed).toHaveCSS("color", "rgb(255, 255, 255)");
});

// Zoom/pan wykresów (Ctrl+kółko, przeciąganie, dwuklik = reset). Gesty nie mają
// widocznych kontrolek, więc e2e jest głównym nośnikiem weryfikacji.
async function readDistanceTicks(page: Page, chartIndex: number): Promise<string[]> {
  return page
    .locator(".chart-wrap")
    .nth(chartIndex)
    .locator(".recharts-xAxis .recharts-cartesian-axis-tick-value")
    .allTextContents();
}

async function ctrlWheel(page: Page, chartIndex: number, deltaY: number): Promise<void> {
  await page.locator(".chart-wrap").nth(chartIndex).evaluate((element, dy) => {
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(
      new WheelEvent("wheel", {
        deltaY: dy,
        ctrlKey: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, deltaY);
}

test("szczegóły zjazdu: Ctrl+kółko przybliża, przeciąganie przesuwa, dwuklik resetuje", async ({ page }) => {
  await page.goto("./");
  await expect(page.locator(".run-card").first()).toBeVisible();
  await page.locator(".run-card").first().click();
  await expect(page.locator(".recharts-surface").first()).toBeVisible();

  const initial = await readDistanceTicks(page, 0);
  expect(initial.length).toBeGreaterThan(2);

  await ctrlWheel(page, 0, -600);
  await expect.poll(() => readDistanceTicks(page, 0)).not.toEqual(initial);

  const zoomed = await readDistanceTicks(page, 0);

  const chart = page.locator(".chart-wrap").first();
  await chart.scrollIntoViewIfNeeded();
  const box = await chart.boundingBox();
  if (!box) throw new Error("brak wykresu");
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => readDistanceTicks(page, 0)).not.toEqual(zoomed);

  await page.locator(".chart-wrap").first().dblclick({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect.poll(() => readDistanceTicks(page, 0)).toEqual(initial);
});

test("cały dzień: Ctrl+kółko przybliża i dwuklik resetuje", async ({ page }) => {
  await page.goto("./");
  await page.getByText("Cały dzień").click();
  await expect(page.locator(".recharts-surface").first()).toBeVisible();

  const initial = await readDistanceTicks(page, 0);
  await ctrlWheel(page, 0, -600);
  await expect.poll(() => readDistanceTicks(page, 0)).not.toEqual(initial);

  await page.locator(".chart-wrap").first().dblclick({ position: { x: 100, y: 80 } });
  await expect.poll(() => readDistanceTicks(page, 0)).toEqual(initial);
});
