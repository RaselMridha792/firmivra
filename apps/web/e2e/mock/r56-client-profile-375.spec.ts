import { expect, type Locator, type Page, test } from '@playwright/test';

// R56, Clients Review Two §23 (mobile-friendly Clients, the profile screens): at 375 px each
// screen of a client's profile, and Add and Edit, has no sideways scroll and its actions are on
// the screen. Mock mode. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';
const WIDTH = 375;

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}
/** Fully on the screen's width, so it can be tapped without scrolling sideways. */
async function onScreen(l: Locator) {
  await expect(l).toBeVisible({ timeout: 60_000 });
  const b = await l.boundingBox();
  expect(b).not.toBeNull();
  expect(b!.x).toBeGreaterThanOrEqual(0);
  expect(b!.x + b!.width).toBeLessThanOrEqual(WIDTH + 0.5);
}
async function phone(page: Page, path: string) {
  await page.setViewportSize({ width: WIDTH, height: 812 });
  await page.goto(app(path));
}

test('§23 at 375 px: Overview fits, with its tabs reachable', async ({ page }) => {
  await phone(page, `/clients/${JAMIE}`);
  await expect(page.getByTestId('client-overview')).toBeVisible({ timeout: 60_000 });
  await noSidewaysScroll(page);
  const tabs = page.getByRole('navigation', { name: 'Client' });
  await expect(tabs).toBeVisible();
  // The tab bar scrolls on its own; the Activity tab can be brought into view and opened.
  const activity = tabs.getByRole('link', { name: 'Activity', exact: true });
  await activity.scrollIntoViewIfNeeded();
  await onScreen(activity);
  await activity.click();
  await expect(page.getByTestId('client-activity')).toBeVisible({ timeout: 60_000 });
  await noSidewaysScroll(page);
});

test('§23 at 375 px: Documents, Messages and Notes fit, with their actions on screen', async ({
  page,
}) => {
  await phone(page, `/clients/${JAMIE}/documents`);
  // P4-7: Request a document is the tab's primary; Upload Document is in its More Actions menu.
  await onScreen(page.getByTestId('request-document-open'));
  const more = page.getByTestId('client-tab-header').getByRole('button', { name: 'More Actions' });
  await onScreen(more);
  await noSidewaysScroll(page);
  await more.click();
  await onScreen(page.getByRole('menuitem', { name: 'Upload Document' }));
  await page.keyboard.press('Escape');

  await phone(page, `/clients/${JAMIE}/messages`);
  const compose = page.getByRole('button', { name: 'New Message' });
  await onScreen(compose);
  await noSidewaysScroll(page);
  await compose.click();
  const dialog = page.getByRole('dialog', { name: 'New Message' });
  await onScreen(dialog.getByRole('button', { name: 'Send Message' }));
  await noSidewaysScroll(page);

  await phone(page, `/clients/${JAMIE}/notes`);
  await expect(page.getByRole('main')).toBeVisible({ timeout: 60_000 });
  await noSidewaysScroll(page);
});

test('§23 at 375 px: Add New Client and Edit fit, with Save on screen', async ({ page }) => {
  await phone(page, '/clients');
  const add = page.getByRole('button', { name: 'Add New Client' });
  await onScreen(add);
  await add.click();
  const adding = page.getByRole('dialog').first();
  await expect(adding).toBeVisible();
  await noSidewaysScroll(page);
  const addBox = await adding.boundingBox();
  expect(addBox!.x + addBox!.width).toBeLessThanOrEqual(WIDTH + 0.5);

  await phone(page, `/clients/${JAMIE}?edit=1`);
  const editing = page.getByRole('dialog', { name: /^Edit / });
  await expect(editing).toBeVisible({ timeout: 60_000 });
  await noSidewaysScroll(page);
  const save = editing.getByRole('button', { name: /^Save/ });
  await save.scrollIntoViewIfNeeded();
  await onScreen(save);
});

test('§23 at 375 px: Tasks, Invoices, Signatures and Intake Forms fit', async ({ page }) => {
  for (const tab of ['tasks', 'invoices', 'signatures', 'intake-forms']) {
    await phone(page, `/clients/${JAMIE}/${tab}`);
    await expect(page.getByRole('navigation', { name: 'Client' })).toBeVisible({
      timeout: 60_000,
    });
    await page.waitForLoadState('networkidle');
    await noSidewaysScroll(page);
  }
});
