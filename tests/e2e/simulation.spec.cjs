const { expect, test } = require("@playwright/test");

test("runs a persisted mock draft turn", async ({ page }) => {
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/");
  if (page.url().includes("/login")) {
    await expect(page.getByAltText("Security system says ah ah ah")).toBeVisible();
    await expect(page.locator("audio")).toHaveAttribute("src", "/media/magic-word");
    await page.getByLabel("Magic word").fill(process.env.APP_ACCESS_PASSWORD);
    await page.getByRole("button", { name: "Access command center" }).click();
  }
  await expect(page.getByRole("heading", { name: "Draft Room" })).toBeVisible();
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
