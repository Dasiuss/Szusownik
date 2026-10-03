import { expect, test } from "@playwright/test";
import { serializeDeviceCsvV2, type Sample } from "../src/lib/csv.ts";
import { buildDeviceConfig, deviceInitScript } from "./device.ts";

// Symuluje urządzenie z jednym plikiem z dzisiaj i sprawdza pełny przepływ:
// boot -> połączenie -> lista nowych plików -> pobranie -> nowy zjazd w dniu.

function todayCsv(): string {
  const now = Date.now();
  const samples: Sample[] = Array.from({ length: 24 }, (_, index) => ({
    t: new Date(now - (24 - index) * 1000).toISOString(),
    lat: 51.05 + index * 0.0002,
    lon: 17.03,
    speed: 20 + index,
    altGps: 1000 - index * 3,
    hdg: 180,
    altBaro: 1000 - index * 3,
    gnssFixValid: true,
    gnssFixAgeMs: 100,
    gnssSatellites: 9,
    gnssSatellitesAgeMs: 100,
    gnssHdop: 0.8,
    gnssHdopAgeMs: 100,
  }));
  return serializeDeviceCsvV2(samples);
}

test("pobiera plik z symulatora i dodaje zjazd do dnia", async ({ page }) => {
  const name = "20261003_120000.csv";
  await page.addInitScript(deviceInitScript, buildDeviceConfig(name, todayCsv()));
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "Dzisiaj", exact: true })).toBeVisible();

  const runsBefore = await page.locator(".run-card").count();
  expect(runsBefore).toBeGreaterThan(0);

  await page.getByRole("button", { name: /Połącz urządzenie/ }).click();
  await expect(page.getByText(/zjazd czeka|zjazdy czekają/)).toBeVisible();

  await page.getByRole("button", { name: /Pobierz dane/ }).click();
  await expect(page.locator(".sync-card-ready")).toHaveCount(0);
  await expect(page.locator(".run-card")).toHaveCount(runsBefore + 1);
});

test("po połączeniu ustawienia dźwięku są odblokowane", async ({ page }) => {
  const name = "20261003_130000.csv";
  await page.addInitScript(deviceInitScript, buildDeviceConfig(name, todayCsv()));
  await page.goto("./#/urzadzenie");

  await expect(page.getByRole("heading", { name: "Urządzenie", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Połącz$/ }).click();
  await expect(page.getByText("Połączenie aktywne")).toBeVisible();
  await expect(page.getByText("Zapisuje się automatycznie")).toBeVisible();
  await expect(page.getByText("Suwaki pojawią się po połączeniu z urządzeniem.")).toHaveCount(0);
});
