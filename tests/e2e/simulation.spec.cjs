const { expect, test } = require("@playwright/test");

test("runs a persisted mock draft turn", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Draft Room" })).toBeVisible();
  await page.getByLabel("Draft slot").selectOption("6");
  await page.getByRole("button", { name: "Simulate to my pick" }).click();
  await expect(page.getByText("You’re on the clock")).toBeVisible();
  await page.getByRole("button", { name: /^Confirm / }).click();
  await expect(page.getByText(/Confirmed .* locally/)).toBeVisible();

  await page.reload();
  await expect(page.getByText("1/15")).toBeVisible();
});
