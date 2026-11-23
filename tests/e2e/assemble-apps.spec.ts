import { expect, test, type Page } from "@playwright/test";

interface AppDefinitionPlan {
  name: string;
  datasetId: string;
  tableTitle: string;
  detailsTitle: string;
  statusField: string;
  defaultStatus: string;
  simulatedNotice: string;
  actions: { label: string; actionId: string }[];
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Username").fill("builder");
  await page.getByLabel("Password").fill("demo-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function dropFromPalette(page: Page, label: string, position: { x: number; y: number }) {
  const blocks = page.locator(".builder-grid-item");
  const previousCount = await blocks.count();
  const selectedBlockId = page.locator(".selected-block-title small");
  const previousId = await selectedBlockId.innerText();
  await page.getByRole("button", { name: new RegExp(label) }).dragTo(
    page.locator(".react-grid-layout"),
    { targetPosition: position },
  );
  await expect(selectedBlockId).not.toHaveText(previousId);
  await expect(blocks).toHaveCount(previousCount + 1);
  return selectedBlockId.innerText();
}

async function setGeometry(
  page: Page,
  geometry: { x: number; y: number; width: number; height: number },
) {
  for (const [label, value] of Object.entries({
    X: geometry.x,
    Y: geometry.y,
    Width: geometry.width,
    Height: geometry.height,
  })) {
    await page.getByLabel(label, { exact: true }).fill(String(value));
    await page.getByLabel(label, { exact: true }).press("Tab");
  }
}

async function createAndPublish(page: Page, plan: AppDefinitionPlan) {
  await page.getByRole("button", { name: "New app" }).click();
  await page.getByLabel("App name").fill(plan.name);
  await page.getByLabel("Dataset").selectOption(plan.datasetId);
  await page.getByRole("button", { name: "Create app" }).click();
  await expect(page).toHaveURL(/\/apps\/[^/]+\/edit$/);
  await expect(page.locator(".react-grid-layout")).toBeVisible();
  await expect(page.locator(".builder-grid-item")).toHaveCount(1);

  const tableId = await page.locator(".selected-block-title small").innerText();
  await page.getByLabel("Title", { exact: true }).fill(plan.tableTitle);
  await page.getByRole("combobox", { name: "Default status" }).selectOption(plan.defaultStatus);
  await page.getByLabel(plan.statusField, { exact: true }).check();
  await setGeometry(page, { x: 0, y: 0, width: 12, height: 4 });

  const detailsId = await dropFromPalette(page, "Record details", { x: 30, y: 500 });
  await page.getByLabel("Title", { exact: true }).fill(plan.detailsTitle);
  await page.getByRole("combobox", { name: "Source table" }).selectOption(tableId);
  await page.getByLabel(plan.statusField, { exact: true }).check();
  await setGeometry(page, { x: 0, y: 5, width: 6, height: 5 });

  for (const [index, action] of plan.actions.entries()) {
    const actionId = await dropFromPalette(
      page,
      "Action button",
      index === 0 ? { x: 500, y: 500 } : { x: 30, y: 500 },
    );
    await page.getByLabel("Button label", { exact: true }).fill(action.label);
    await page.getByRole("combobox", { name: "Action" }).selectOption(action.actionId);
    await page.getByRole("combobox", { name: "Source table" }).selectOption(tableId);
    await setGeometry(page, {
      x: 6 + index * 3,
      y: 5,
      width: 3,
      height: 4,
    });
    expect(actionId).toBeTruthy();
  }

  const auditId = await dropFromPalette(page, "Audit history", { x: 30, y: 500 });
  await page.getByLabel("Title", { exact: true }).fill(`${plan.name} audit`);
  await page.getByRole("combobox", { name: "Source table" }).selectOption(tableId);
  await setGeometry(page, { x: 0, y: 10, width: 12, height: 8 });

  await expect(page.locator(".builder-grid-item")).toHaveCount(3 + plan.actions.length);
  await expect(page.getByText("Definition is valid", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page).toHaveURL(/\/apps\/[^/]+$/);
  await expect(page.getByText(plan.simulatedNotice, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: plan.tableTitle })).toBeVisible();
  await expect(page.getByRole("button", { name: plan.actions[0]!.label })).toBeDisabled();
  expect(detailsId).toBeTruthy();
  expect(auditId).toBeTruthy();
}

test("assembles and publishes KYC and staging flags with the builder", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1600 });
  await signIn(page);

  await createAndPublish(page, {
    name: "KYC review",
    datasetId: "kyc",
    tableTitle: "KYC review queue",
    detailsTitle: "KYC case details",
    statusField: "Status",
    defaultStatus: "pending",
    simulatedNotice: "Simulated: no documents, identity verification, or account activation.",
    actions: [
      { label: "Approve case", actionId: "kyc.approve" },
      { label: "Reject case", actionId: "kyc.reject" },
    ],
  });

  await page.goto("/");
  await createAndPublish(page, {
    name: "Staging feature flags",
    datasetId: "flags",
    tableTitle: "Staging flags",
    detailsTitle: "Flag details",
    statusField: "State",
    defaultStatus: "disabled",
    simulatedNotice: "Simulated staging flags: changes demo records only; no live product is controlled.",
    actions: [
      { label: "Enable staging flag", actionId: "flags.enable" },
      { label: "Disable staging flag", actionId: "flags.disable" },
    ],
  });
});
