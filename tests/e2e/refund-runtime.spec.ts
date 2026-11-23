import { expect, test } from "@playwright/test";

test("reviewer approves a pending refund from the published runtime", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill("reviewer");
  await page.getByLabel("Password").fill("demo-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("link", { name: /Refund approvals/ }).click();
  await expect(page.getByRole("heading", { name: "Refund approvals" })).toBeVisible();

  const refundRow = page.getByRole("row").nth(1);
  await expect(refundRow).toBeVisible();
  await expect(refundRow).toContainText("pending");
  await refundRow.click();
  await page.getByRole("button", { name: "Approve", exact: true }).click();

  await page.getByLabel("Reason").fill("Playwright smoke approval");
  await page.getByRole("button", { name: "Confirm" }).click();

  await expect(page.locator("dl").getByText("approved", { exact: true })).toBeVisible();
  await expect(page.getByText("Playwright smoke approval", { exact: true })).toBeVisible();
});
