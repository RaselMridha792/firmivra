import { expect, type Page, test } from '@playwright/test';

// R60, TX-F07 (Octavia's Oct 26 review): the return row's menu opens each module with the
// client and the return, and Back returns to the list as it was; Send Message is written on the
// list (TR-4, Review 2). Mock mode as the Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.describe.configure({ timeout: 180_000 });

async function menuItem(page: Page, name: string) {
  await page.goto(app('/tax-returns?status=IN_PREPARATION'));
  const first = page.getByRole('row').nth(1);
  await first.getByRole('button', { name: /^Actions for/ }).click({ timeout: 60_000 });
  await page.getByRole('menuitem', { name, exact: true }).click();
}

test('TR-4: Send Message is written on the list and on Full Review; closing it stays there', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await menuItem(page, 'Send Message');
  const dialog = page.getByRole('dialog', { name: 'New Message' });
  await expect(dialog.getByLabel('Subject')).toHaveValue(/^\d{4} .*Return$/, { timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/tax-returns\?status=IN_PREPARATION$/);
  // Sending stays on the list too.
  await page
    .getByRole('row')
    .nth(1)
    .getByRole('button', { name: /^Actions for/ })
    .click();
  await page.getByRole('menuitem', { name: 'Send Message', exact: true }).click();
  await dialog.getByLabel('Message', { exact: true }).fill('Your organizer is ready (synthetic).');
  await dialog.getByRole('button', { name: 'Send Message' }).click();
  await expect(page.getByText('Message sent to the client.')).toBeVisible();
  await expect(page).toHaveURL(/\/tax-returns\?status=IN_PREPARATION$/);

  // Full Review: the same dialog, on this return; closing it stays on Full Review.
  await page.getByTestId('return-link').first().click();
  await expect(page).toHaveURL(/\/tax-returns\/[0-9a-f-]+/, { timeout: 60_000 });
  await page.goto(`${page.url().split('?')[0]}/review`);
  const actions = page.getByTestId('review-actions');
  await actions.getByRole('button', { name: 'Send Message' }).click({ timeout: 60_000 });
  await expect(dialog.getByLabel('Subject')).toHaveValue(/^\d{4} .*Return$/);
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/tax-returns\/[0-9a-f-]+\/review$/);
});

test('Request Client Information, Schedule Appointment and Edit Client Details keep the client and Back', async ({
  page,
}) => {
  for (const [name, path] of [
    ['Request Client Information', /\/documents\/requests\/new\?clientId=[0-9a-f-]+&from=/],
    ['Schedule Appointment', /\/calendar\/new\?clientId=[0-9a-f-]+&taxReturnId=[0-9a-f-]+&from=/],
    ['Edit Client Details', /\/clients\/[0-9a-f-]+\?edit=1&from=/],
  ] as const) {
    await menuItem(page, name);
    await expect(page, name).toHaveURL(path, { timeout: 60_000 });
  }
});
