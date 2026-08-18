const { expect, test } = require("@playwright/test");

test("runs a persisted mock draft turn", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/login");
  await expect(page.getByAltText("Security system says ah ah ah")).toBeVisible();
  await expect(page.locator("audio")).toHaveAttribute("src", "/media/magic-word");
  await page.getByLabel("Magic word").fill(process.env.APP_ACCESS_PASSWORD);
  await page.getByRole("button", { name: "Access command center" }).click();
  await expect(page.getByRole("link", { name: "Continue with Yahoo" })).toBeVisible();
  const login = await page.request.post("/api/auth/dev-login", {
    data: { secret: process.env.E2E_LOGIN_SECRET ?? process.env.APP_ACCESS_PASSWORD },
  });
  expect(login.ok()).toBeTruthy();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Conroy's AI Draft Dojo" })).toBeVisible();
  await page.getByRole("button", { name: "New mock", exact: true }).click();
  await page.getByLabel("Draft slot").selectOption("6");
  await page.getByRole("button", { name: "Simulate to my pick" }).click();
  await expect(page.getByText("You’re on the clock")).toBeVisible();
  await page.getByRole("button", { name: /^Confirm / }).click();
  await expect(page.getByText(/Confirmed .* locally/)).toBeVisible();

  await page.reload();
  await expect(page.getByText("1/15")).toBeVisible();

  await page.getByRole("button", { name: "Prepare live" }).click();
  await expect(page.getByText("● Live board", { exact: true })).toBeVisible();
  await expect(page.getByText("0/15")).toBeVisible();
});
