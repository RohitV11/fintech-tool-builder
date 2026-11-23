import { expect, test } from "@playwright/test";

test("reviewer approves a pending refund from the published runtime", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1600 });
  await page.goto("/login");
  await page.getByLabel("Username").fill("reviewer");
  await page.getByLabel("Password").fill("demo-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("link", { name: /Refund approvals/ }).click();
  await expect(page.getByRole("heading", { name: "Refund approvals" })).toBeVisible();

  await page.getByLabel("Filter Refund requests by status").selectOption("");
  await expect(page.locator(".table-scroll tbody tr")).toHaveCount(10);
  await expect(page.locator(".block-pagination")).toBeVisible();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeVisible();
  const refundRow = page.getByRole("row").filter({ hasText: "pending" }).first();
  await expect(refundRow).toBeVisible();
  await expect(refundRow).toContainText("pending");
  await refundRow.click();
  await expect(refundRow).toHaveClass(/selected-row/);
  await expect(refundRow.locator('th[scope="row"]')).toHaveCSS(
    "background-color",
    "rgb(240, 245, 255)",
  );
  await page.getByRole("button", { name: "Approve", exact: true }).click();

  await page.getByLabel("Reason").fill("Playwright smoke approval");
  await page.getByRole("button", { name: "Confirm" }).click();

  await expect(page.locator("dl").getByText("approved", { exact: true })).toBeVisible();
  await expect(page.locator(".status-pill.approved")).toBeVisible();
  await expect(page.getByText("Playwright smoke approval", { exact: true })).toBeVisible();
});

test("refund table scrolls horizontally on a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 1200 });
  await page.goto("/login");
  await page.getByLabel("Username").fill("reviewer");
  await page.getByLabel("Password").fill("demo-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("link", { name: /Refund approvals/ }).click();
  await expect(page.getByRole("heading", { name: "Refund approvals" })).toBeVisible();

  const tableScroll = page.locator(".table-scroll").first();
  await expect.poll(() =>
    tableScroll.evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(true);
  await tableScroll.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  const statusHeader = page.getByRole("columnheader", { name: "Status", exact: true });
  await expect.poll(() =>
    statusHeader.evaluate((element) => {
      const container = element.closest(".table-scroll");
      if (!container) return false;
      const cellBounds = element.getBoundingClientRect();
      const containerBounds = container.getBoundingClientRect();
      return cellBounds.left >= containerBounds.left && cellBounds.right <= containerBounds.right;
    }),
  ).toBe(true);
});
