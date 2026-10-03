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

  await page.getByRole("button", { name: /Nadaj nazwę|Zmień nazwę/ }).click();
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
