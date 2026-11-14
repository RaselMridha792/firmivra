import { expect, test, type Page } from '@playwright/test';

// R60, Clients Review 2 (G7): Bulk Actions for the chosen clients also send a message (New
// Message with them chosen), request a document on a service they have, and send an intake form.
// Each goes client by client through the same endpoint; the toast says who got it and who was
// skipped, and why. Mock mode as the Owner; client 1 Jamie Sample, client 2 Acme Widgets LLC.
// Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const id = (n: number) => `0199b6a1-0000-7000-8000-${String(n).padStart(12, '0')}`;
const shots = 'e2e/screenshots/r60-clients-outreach';

test.describe.configure({ timeout: 180_000 });

async function choose(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/clients'));
  for (const n of [1, 2]) {
    await page.getByRole('checkbox', { name: `Select row ${id(n)}` }).check({ timeout: 60_000 });
  }
  await expect(page.getByText('2 clients selected')).toBeVisible();
}

async function bulk(page: Page, item: string) {
  await page.getByRole('button', { name: 'Bulk Actions' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

test('Send Message opens New Message with the chosen clients', async ({ page }) => {
  await choose(page);
  await bulk(page, 'Send Message');
  await expect(page).toHaveURL(/\/messages\/new\?clientIds=/);
  expect(page.url()).toContain(id(1));
  expect(page.url()).toContain(id(2));
  await expect(page.getByText('Jamie Sample').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Acme Widgets LLC (fake)').first()).toBeVisible();
});

test('Request Document asks each client on the chosen service and names who was skipped', async ({
  page,
}) => {
  await choose(page);
  await bulk(page, 'Request Document');
  const dialog = page.getByRole('dialog', { name: 'Request Document' });
  await expect(dialog).toContainText('2 selected clients');
  // Nothing goes until a service and a title are given.
  await dialog.getByRole('button', { name: 'Request Document' }).click();
  await expect(dialog.getByText('Choose a service and say which document you need.')).toBeVisible();
  const service = dialog.getByLabel('Service');
  await expect(service.locator('option')).not.toHaveCount(1, { timeout: 60_000 });
  await service.selectOption({ index: 1 });
  await dialog.getByLabel('Document title').fill('2025 W-2 (fake)');
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/request-document.png` });
  await dialog.getByRole('button', { name: 'Request Document' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/asked for the document/)).toBeVisible();
});

test('Send Intake Form sends the chosen form to each client', async ({ page }) => {
  await choose(page);
  await bulk(page, 'Send Intake Form');
  const dialog = page.getByRole('dialog', { name: 'Send Intake Form' });
  await expect(dialog).toContainText('2 selected clients');
  const form = dialog.getByLabel('Form');
  await expect(form.locator('option')).not.toHaveCount(1, { timeout: 60_000 });
  await form.selectOption({ index: 1 });
  await expect(dialog.getByLabel('Subject')).toHaveValue(/^Please complete /);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/send-intake.png` });
  await dialog.getByRole('button', { name: 'Send Form' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/got the form/)).toBeVisible();
});
