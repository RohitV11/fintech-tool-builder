import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, username: "builder" | "reviewer") {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("demo-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function dropFromPalette(
  page: Page,
  label: string,
  position: { x: number; y: number },
) {
  const blocks = page.locator(".builder-grid-item");
  const previousCount = await blocks.count();
  await page.getByRole("button", { name: new RegExp(label) }).dragTo(
    page.locator(".react-grid-layout"),
    { targetPosition: position },
  );
  await expect(blocks).toHaveCount(previousCount + 1);
  return page.locator(".selected-block-title small").innerText();
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

test("builder edits, saves, previews, publishes, and runs a refunds app", async ({ page, browser }) => {
  await page.setViewportSize({ width: 1440, height: 1600 });
  await signIn(page, "builder");
  await page.getByRole("button", { name: "New app" }).click();
  await page.getByLabel("App name").fill("Builder canvas regression");
  await page.getByLabel("Dataset").selectOption("refunds");
  await page.getByRole("button", { name: "Create app" }).click();
  await expect(page).toHaveURL(/\/apps\/[^/]+\/edit$/);

  const appId = page.url().match(/\/apps\/([^/]+)\/edit$/)?.[1];
  expect(appId).toBeTruthy();
  await expect(page.locator(".react-grid-layout")).toBeVisible();
  await expect(page.locator(".builder-grid-item")).toHaveCount(1);

  await page.getByLabel("App name").fill("Unsaved name");
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Apps", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "Leave without saving?" })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing" }).click();
  await expect(page).toHaveURL(/\/edit$/);

  const beforeUnload = page.waitForEvent("dialog");
  const reload = page.reload();
  const dialog = await beforeUnload;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.accept();
  await reload;
  await expect(page.locator(".react-grid-layout")).toBeVisible();

  await page.getByRole("button", { name: "Remove block" }).click();
  await expect(page.locator(".builder-grid-item")).toHaveCount(0);

  const tableId = await dropFromPalette(page, "Record table", { x: 30, y: 30 });
  await page.getByLabel("Title", { exact: true }).fill("Refund queue");
  await expect(page.getByLabel("Show status badge")).not.toBeChecked();
  await page.getByLabel("Show status badge").check();
  await setGeometry(page, { x: 0, y: 0, width: 12, height: 3 });

  const detailsId = await dropFromPalette(page, "Record details", { x: 30, y: 500 });
  await page.getByLabel("Title", { exact: true }).fill("Refund detail panel");
  await page.getByLabel("Status", { exact: true }).check();
  await setGeometry(page, { x: 0, y: 4, width: 6, height: 8 });
  const detailsBefore = await page.locator(`#editor-block-${detailsId}`).boundingBox();
  await setGeometry(page, { x: 1, y: 4, width: 5, height: 7 });
  const detailsAfter = await page.locator(`#editor-block-${detailsId}`).boundingBox();
  expect(detailsBefore).not.toBeNull();
  expect(detailsAfter).not.toBeNull();
  expect(detailsAfter!.x).toBeGreaterThan(detailsBefore!.x);

  const actionId = await dropFromPalette(page, "Action button", { x: 500, y: 500 });
  await page.getByLabel("Button label", { exact: true }).fill("Approve refund now");
  await setGeometry(page, { x: 6, y: 4, width: 4, height: 4 });
  const actionItem = page.locator(`#editor-block-${actionId}`);
  const resizeHandle = actionItem.locator(".react-resizable-handle");
  await expect(resizeHandle).toBeVisible();
  await resizeHandle.hover();
  const handleBox = await resizeHandle.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.down();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2 + 65, handleBox!.y + handleBox!.height / 2 + 40, {
    steps: 5,
  });
  await page.mouse.up();
  await expect(page.getByLabel("Width", { exact: true })).toHaveValue("5");
  await expect(page.getByLabel("Height", { exact: true })).toHaveValue("5");

  const auditId = await dropFromPalette(page, "Audit history", { x: 30, y: 500 });
  await page.getByLabel("Title", { exact: true }).fill("Decision audit");
  await setGeometry(page, { x: 0, y: 12, width: 12, height: 8 });
  await expect(page.locator(".builder-grid-item")).toHaveCount(4);
  await expect(page.getByText("Unsaved changes", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.locator(".builder-grid-item")).toHaveCount(4);
  await page.locator(`#editor-block-${detailsId}`).click();
  await expect(page.getByLabel("X", { exact: true })).toHaveValue("1");
  await expect(page.getByLabel("Width", { exact: true })).toHaveValue("5");
  await expect(page.getByLabel("Height", { exact: true })).toHaveValue("7");
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Refund detail panel");
  await expect(page.getByLabel("Status", { exact: true })).toBeChecked();
  await page.locator(`#editor-block-${actionId}`).click();
  await expect(page.getByLabel("Button label", { exact: true })).toHaveValue("Approve refund now");
  await expect(page.getByLabel("Width", { exact: true })).toHaveValue("5");
  await expect(page.getByLabel("Height", { exact: true })).toHaveValue("5");
  await page.locator(`#editor-block-${auditId}`).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Decision audit");
  await page.locator(`#editor-block-${tableId}`).click();
  await expect(page.getByLabel("Show status badge")).toBeChecked();

  await page.getByRole("link", { name: "Preview", exact: true }).click();
  await page.getByRole("row").nth(1).click();
  await expect(page.getByRole("button", { name: "Approve refund now" })).toBeDisabled();
  await page.getByRole("link", { name: "Edit draft", exact: true }).click();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/apps/${appId}$`));
  await expect(page.getByRole("heading", { name: "Refund queue" })).toBeVisible();

  await page.goto(`/apps/${appId}/edit`);
  await page.locator(`#editor-block-${tableId}`).click();
  await page.getByLabel("Title", { exact: true }).fill("Unpublished queue title");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("All changes saved", { exact: true })).toBeVisible();
  await page.goto(`/apps/${appId}`);
  await expect(page.getByRole("heading", { name: "Refund queue" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Unpublished queue title" })).toHaveCount(0);

  await page.goto(`/apps/${appId}/edit`);
  await page.locator(`#editor-block-${tableId}`).click();
  await page.getByLabel("Title", { exact: true }).fill("Republished refund queue");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Republished refund queue" })).toBeVisible();

  const reviewerContext = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
  try {
    const reviewerPage = await reviewerContext.newPage();
    await signIn(reviewerPage, "reviewer");
    await reviewerPage.goto(`/apps/${appId}`);
    await reviewerPage.getByRole("row").nth(1).click();
    const approveButton = reviewerPage.getByRole("button", { name: "Approve refund now" });
    await expect(approveButton).toBeEnabled();
    await approveButton.click();
    await reviewerPage.getByLabel("Reason").fill("Builder regression approval");
    await reviewerPage.getByRole("button", { name: "Confirm" }).click();
    await expect(reviewerPage.locator("dl").getByText("approved", { exact: true })).toBeVisible();
    await expect(reviewerPage.getByText("Builder regression approval", { exact: true })).toBeVisible();
  } finally {
    await reviewerContext.close();
  }
});
