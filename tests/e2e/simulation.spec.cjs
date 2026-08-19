const { expect, test } = require("@playwright/test");

test("landing, login, and draft board", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Draft Dojo" })).toBeVisible();
  await expect(page.getByText("Recalculates your top five after every pick.")).toBeVisible();

  await page.goto("/login");
  await expect(page.getByRole("link", { name: "Continue with Yahoo" })).toBeVisible();
  await expect(page.getByLabel("Sleeper username")).toBeVisible();

  const login = await page.request.post("/api/auth/dev-login", {
    data: { secret: process.env.E2E_LOGIN_SECRET ?? process.env.APP_ACCESS_PASSWORD },
  });
  expect(login.ok()).toBeTruthy();
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Draft Dojo" })).toBeVisible();
});
