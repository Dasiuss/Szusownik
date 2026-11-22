import { expect, test, type Page } from "@playwright/test";

// Skalowanie tekstu razem z systemowym rozmiarem czcionki Androida.
//
// Chromium realizuje to przez `<meta name="text-scale" content="scale">`:
// bazowy rozmiar dokumentu to 16 px × systemowa skala, a rozmiary w rem rosną
// razem z nim. W teście symulujemy skalę nadpisaniem `font-size` na <html>
// (16 px = 100%, 24 px = 150%, 32 px = 200%), bo przeglądarka nie wystawia
// sposobu na ustawienie systemowej skali.
//
// Ustalenia: docs/wymagania-PWA.md → „Zasady UI”.

/** Ustawia bazowy rozmiar dokumentu, czyli symuluje systemową skalę tekstu. */
async function textScale(page: Page, rootPx: number) {
  await page.evaluate((size) => {
    document.documentElement.style.fontSize = `${size}px`;
  }, rootPx);
}

async function fontSize(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
}

async function noHorizontalOverflow(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((element) => element.scrollWidth - element.clientWidth);
}

async function openToday(page: Page) {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Dzisiaj", exact: true })).toBeVisible();
  await expect(page.locator(".run-card").first()).toBeVisible();
}

test("przy 100% rozmiary czcionek są dokładnie takie jak dotąd", async ({ page }) => {
  await openToday(page);
  await textScale(page, 16);

  expect(await fontSize(page, ".nav-item")).toBe(10);
  expect(await fontSize(page, ".eyebrow")).toBe(10);
  expect(await fontSize(page, ".card-kicker")).toBe(10);
  expect(await fontSize(page, ".speed-caption")).toBe(11);
  expect(await fontSize(page, ".run-time")).toBe(11);
  expect(await fontSize(page, ".run-title-wrap strong")).toBe(14);
  expect(await fontSize(page, ".section-heading h2")).toBe(20);
});

test("małe napisy rosną ze skalą, duże zostają w miejscu", async ({ page }) => {
  await openToday(page);
  await textScale(page, 16);
  const headingAt100 = await fontSize(page, "h1");
  const speedAt100 = await fontSize(page, ".speed-value");

  // 200%: drobny tekst rośnie pełnie, średni i nagłówki dochodzą do sufitu.
  await textScale(page, 32);
  expect(await fontSize(page, ".run-time")).toBe(22);
  expect(await fontSize(page, ".run-title-wrap strong")).toBe(24);
  expect(await fontSize(page, ".section-heading h2")).toBe(26);

  // Tytuł ekranu i licznik prędkości są już duże — ani drgną.
  expect(await fontSize(page, "h1")).toBe(headingAt100);
  expect(await fontSize(page, ".speed-value")).toBe(speedAt100);

  // 150%: wszystko poniżej sufitu rośnie wprost proporcjonalnie.
  await textScale(page, 24);
  expect(await fontSize(page, ".nav-item")).toBe(15);
  expect(await fontSize(page, ".run-time")).toBe(16.5);
  expect(await fontSize(page, ".run-title-wrap strong")).toBe(21);
});

test("przy 200% i 320 px nic nie wychodzi poza ekran", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });

  for (const path of ["./", "./#/historia", "./#/urzadzenie"]) {
    await page.goto(path);
    await textScale(page, 32);
    await expect(page.locator(".bottom-nav")).toBeVisible();

    const documentOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(documentOverflow, `poziome przewijanie na ${path}`).toBeLessThanOrEqual(1);
    expect(await noHorizontalOverflow(page, ".bottom-nav"), `nawigacja na ${path}`).toBeLessThanOrEqual(1);
  }
});

test("przy 200% metryki zjazdu mieszczą się na ekranie", async ({ page }) => {
  await openToday(page);
  await page.locator(".run-card").first().click();
  await expect(page.locator(".detail-metrics")).toBeVisible();
  await textScale(page, 32);

  expect(await fontSize(page, ".detail-metrics span")).toBe(18);
  expect(await fontSize(page, ".detail-metrics strong")).toBe(26);
  expect(await noHorizontalOverflow(page, ".detail-metrics")).toBeLessThanOrEqual(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
  ).toBeLessThanOrEqual(1);
});
