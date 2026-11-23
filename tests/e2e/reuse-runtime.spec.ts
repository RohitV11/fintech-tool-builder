import { expect, test } from "@playwright/test";

const kycAppId = "a64f31e4-39c2-4d49-86a8-e33ca68a71ad";
const flagsAppId = "ba1f9a7a-627e-42b0-a8a0-9af1e2614214";

test("legacy KYC and staging apps render plain status text and allow reviewer actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1600 });
  await page.goto("/login");
  await page.getByLabel("Username").fill("reviewer");
  await page.getByLabel("Password").fill("demo-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto(`/apps/${kycAppId}`);
  await expect(page.getByRole("heading", { name: "KYC review", exact: true })).toBeVisible();
  await expect(
    page.getByText("Simulated: no documents, identity verification, or account activation.", {
      exact: true,
    }),
  ).toBeVisible();
  const kycRow = page.getByRole("row").nth(1);
  expect(await page.locator(".table-scroll tbody tr").count()).toBeGreaterThan(1);
  const kycStatusCell = kycRow.locator("td").nth(4);
  await expect(kycStatusCell).toHaveText("pending");
  await expect(kycStatusCell.locator(".status-pill")).toHaveCount(0);
  await kycRow.click();
  await page.getByRole("button", { name: "Approve case", exact: true }).click();
  await page.getByLabel("Reason").fill("Legacy KYC approval");
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator("dl").getByText("approved", { exact: true })).toBeVisible();
  await expect(page.getByText("Legacy KYC approval", { exact: true })).toBeVisible();

  await page.goto(`/apps/${flagsAppId}`);
  await expect(
    page.getByRole("heading", { name: "Staging feature flags", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Simulated staging flags: changes demo records only; no live product is controlled.",
      { exact: true },
    ),
  ).toBeVisible();
  const flagRow = page.getByRole("row").nth(1);
  const stateCell = flagRow.locator("td").nth(4);
  await expect(stateCell).toHaveText("disabled");
  await expect(stateCell.locator(".status-pill")).toHaveCount(0);
  await flagRow.click();
  const disableButton = page.getByRole("button", {
    name: "Disable staging flag",
    exact: true,
  });
  await expect(disableButton).toBeDisabled();
  await expect(disableButton).toHaveAttribute("title", "Not available for current status");
  await expect(page.getByText("Not available for current status", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Enable staging flag", exact: true }).click();
  await page.getByLabel("Reason").fill("Legacy staging flag enable");
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.locator("dl").getByText("enabled", { exact: true })).toBeVisible();
  await expect(page.getByText("Legacy staging flag enable", { exact: true })).toBeVisible();
});
