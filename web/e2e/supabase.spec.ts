import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "block" });

test("logowanie pokazuje profil, zapisuje nazwę i usuwa lokalizację po wyłączeniu", async ({ page }) => {
  const userId = "2f1d8d88-6ce3-4d7f-b03b-9c9b3c49f630";
  let profile = { user_id: userId, display_name: "ale", share_enabled: true };
  let liveLocationDeleted = false;

  await page.route("**/auth/v1/token?grant_type=password", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: "test-access-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: "test-refresh-token",
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: "alex@example.com",
          email_confirmed_at: new Date().toISOString(),
          app_metadata: { provider: "email", providers: ["email"] },
          user_metadata: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      }),
    });
  });

  await page.route("**/rest/v1/profiles**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(profile) });
      return;
    }
    if (route.request().method() === "PATCH") {
      profile = { ...profile, ...JSON.parse(route.request().postData() ?? "{}") };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(profile) });
      return;
    }
    await route.continue();
  });

  await page.route("**/rest/v1/live_locations**", async (route) => {
    if (route.request().method() === "DELETE") {
      liveLocationDeleted = true;
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    await route.continue();
  });

  await page.goto("./#/urzadzenie");
  await page.getByRole("textbox", { name: "E-mail" }).fill("alex@example.com");
  await page.getByLabel("Hasło").fill("test-password");
  await page.getByRole("button", { name: "Zaloguj", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Zalogowano" })).toBeVisible();
  await expect(page.getByLabel("Nazwa na mapie")).toHaveValue("ale");
  const sharingToggle = page.getByRole("checkbox", { name: /Udostępniaj moją pozycję/ });
  await expect(sharingToggle).toBeChecked();

  await page.getByLabel("Nazwa na mapie").fill("Alex");
  await page.getByRole("button", { name: "Zapisz nazwę" }).click();
  await expect(page.getByRole("status")).toContainText("Zapisano nazwę profilu.");
  await expect(page.getByLabel("Nazwa na mapie")).toHaveValue("Alex");

  await sharingToggle.uncheck();
  await expect(page.getByRole("status")).toContainText("Udostępnianie wyłączone.");
  await expect(sharingToggle).not.toBeChecked();
  expect(profile.share_enabled).toBe(false);
  expect(liveLocationDeleted).toBe(true);
});
