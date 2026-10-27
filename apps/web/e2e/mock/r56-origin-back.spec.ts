import { expect, test } from '@playwright/test';

// SH1 (Octavia's Oct 25 review: PY-F10, the Bookkeeping navigation contract; TX-F03 for R60): a
// page opened from a service workspace shows Back to that exact place: the list with its period,
// view, search and page, or the client and tab, and the scroll position it was at. A `from` that is
// not a path on this site shows nothing. Payroll and Bookkeeping in mock mode, as an Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const GREEN = '0199c0f0-9c00-7000-8000-000000000001';

test('Payroll list: Back from Send Message restores the period, search and list', async ({
  page,
}) => {
  await page.goto(`${app}/payroll?period=LAST_MONTH&q=Green`);
  await expect(page.getByPlaceholder('Search clients, business name, or EIN...')).toHaveValue(
    'Green',
  );
  await page.getByRole('button', { name: /^Actions for Green Leaf/ }).click();
  await page.getByRole('menuitem', { name: 'Send Message' }).click();
  await expect(page).toHaveURL(/\/messages\?from=/);
  const back = page.getByTestId('back-to-origin');
  await expect(back).toHaveText('Back to Payroll');
  await back.click();
  await expect(page).toHaveURL(`${app}/payroll?period=LAST_MONTH&q=Green`);
  await expect(page.getByPlaceholder('Search clients, business name, or EIN...')).toHaveValue(
    'Green',
  );
  await expect(page.getByRole('button', { name: /^Actions for Green Leaf/ })).toBeVisible();
  await expect(page.getByTestId('back-to-origin')).toHaveCount(0);
});

test('Payroll list: a filter typed on the page is in the address, and Back keeps the scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto(`${app}/payroll`);
  await page.getByPlaceholder('Search clients, business name, or EIN...').fill('Green');
  await expect(page).toHaveURL(/[?&]q=Green/);
  await expect(page.getByRole('button', { name: /^Actions for / })).toHaveCount(1);
  await page.getByRole('button', { name: /^Actions for Green Leaf/ }).scrollIntoViewIfNeeded();
  const y = await page.evaluate(() => window.scrollY);
  expect(y).toBeGreaterThan(0);
  await page.getByRole('button', { name: /^Actions for Green Leaf/ }).click();
  await page.getByRole('menuitem', { name: 'Create Task' }).click();
  await expect(page).toHaveURL(/\/tasks\/new\?clientId=.*&from=/);
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(/\/payroll\?q=Green$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(y - 40);
});

test('Bookkeeping client: the Tasks tab opens Tasks with Back to the same client', async ({
  page,
}) => {
  await page.goto(`${app}/bookkeeping`);
  await page
    .getByRole('link', { name: /Green Leaf/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/bookkeeping\/clients\//);
  const workspace = new URL(page.url());
  await page.getByRole('tab', { name: 'Tasks' }).click();
  await expect(page).toHaveURL(/\/tasks\?clientId=.*&from=/);
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(`${workspace.pathname}${workspace.search}`.replace(/^/, app));
});

test('a from= that is not a path on this site shows no Back', async ({ page }) => {
  for (const from of ['https://evil.example/payroll', '//evil.example/x', 'payroll']) {
    await page.goto(`${app}/tasks?from=${encodeURIComponent(from)}`);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.getByTestId('back-to-origin')).toHaveCount(0);
  }
  await page.goto(`${app}/payroll/clients/${GREEN}`);
  await expect(page.getByTestId('back-to-origin')).toHaveCount(0);
});
