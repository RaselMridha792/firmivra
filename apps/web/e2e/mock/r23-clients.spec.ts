import { expect, test } from '@playwright/test';
import { CLIENTS, json, routeClientList } from './r23-fixtures';

// The firm's Clients list (R23) in mock mode, as the Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('the list searches, pages and opens a client', async ({ page }) => {
  await routeClientList(page);
  await page.goto(app('/clients'));
  await expect(page.getByTestId('page-title')).toHaveText('Clients');
  const links = page.getByTestId('client-link');
  await expect(links).toHaveCount(3);
  await expect(page.getByRole('row', { name: /Brightline Bakery/ })).toContainText(
    'No portal login',
  );
  await expect(page.getByRole('row', { name: /James Carter/ })).toContainText('Unassigned');

  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(links).toHaveText(['Priya Natarajan']);
  await page.getByRole('button', { name: 'Previous', exact: true }).click();
  await expect(links).toHaveCount(3);

  await page.getByLabel('Search clients').fill('carter');
  await expect(links).toHaveText(['James Carter']);
  await page.getByLabel('Search clients').fill('nobody');
  await expect(page.getByText('No matching clients')).toBeVisible();

  await page.getByLabel('Search clients').fill('');
  await expect(links.first()).toHaveAttribute('href', `/clients/${CLIENTS[0]!.id}`);
});

test('an error shows Try again', async ({ page }) => {
  await page.route('**/api/v1/business/clients?**', (route) =>
    json(route, { error: { code: 'INTERNAL_ERROR', message: 'x' } }, 500),
  );
  await page.goto(app('/clients'));
  await expect(page.getByTestId('page-error')).toBeVisible();
});

test('the list fits a 375 px screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await routeClientList(page);
  await page.goto(app('/clients'));
  await expect(page.getByTestId('client-card')).toHaveCount(3);
  await expect(page.getByTestId('client-card').nth(2)).toContainText('Unassigned');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
