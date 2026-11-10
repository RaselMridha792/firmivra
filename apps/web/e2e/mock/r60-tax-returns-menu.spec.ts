import { expect, type Page, test } from '@playwright/test';

// R60, TX-F07 (Octavia's Oct 26 review): the return row's menu opens each module with the
// client and the return, and Back returns to the list as it was. Mock mode as the Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.describe.configure({ timeout: 180_000 });

async function menuItem(page: Page, name: string) {
  await page.goto(app('/tax-returns?status=IN_PREPARATION'));
  const first = page.getByRole('row').nth(1);
  await first.getByRole('button', { name: /^Actions for/ }).click({ timeout: 60_000 });
  await page.getByRole('menuitem', { name, exact: true }).click();
}

test('Send Message opens New Message on the client, about this return, with Back to Tax Returns', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await menuItem(page, 'Send Message');
  await expect(page).toHaveURL(
    /\/messages\/new\?clientId=[0-9a-f-]+&subject=\d{4}.*Return&related=tax_return%3A[0-9a-f-]+&from=%2Ftax-returns/,
    { timeout: 60_000 },
  );
  await expect(page.getByTestId('back-to-origin')).toHaveText(/Back to Tax Returns/);
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(/\/tax-returns\?status=IN_PREPARATION$/);
});

test('Request Client Information, Schedule Appointment and Edit Client Details keep the client and Back', async ({
  page,
}) => {
  for (const [name, path] of [
    ['Request Client Information', /\/documents\/requests\/new\?clientId=[0-9a-f-]+&from=/],
    ['Schedule Appointment', /\/calendar\/new\?clientId=[0-9a-f-]+&from=/],
    ['Edit Client Details', /\/clients\/[0-9a-f-]+\?edit=1&from=/],
  ] as const) {
    await menuItem(page, name);
    await expect(page, name).toHaveURL(path, { timeout: 60_000 });
  }
});
