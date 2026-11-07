import { expect, test } from '@playwright/test';

// R60, D4 and D5 (Octavia's Oct 25 dashboard review): Settings > Dashboard Cards sets the service
// cards the dashboard shows after its fixed ones; each card's label, number and list agree. Mock
// mode as the Owner (the mock answers as the API, in the browser: its cards last until a reload,
// so the test moves to the dashboard through the app).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const BOOKKEEPING = '0199b6a3-0000-7000-8000-000000000003';

test.describe.configure({ timeout: 180_000 });

test('the defaults are saved, a card is added, switched off and moved, and the dashboard follows', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/settings/dashboard-cards'));
  await expect(page.getByTestId('page-title')).toHaveText('Dashboard cards', { timeout: 60_000 });
  await expect(page.getByTestId('using-defaults')).toContainText('Returns In Progress');
  await page.getByRole('button', { name: 'Start from the defaults' }).click();
  const rows = page.getByTestId('card-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('Returns In Progress');
  await expect(rows.nth(1)).toContainText('Accepted Returns');

  // A clients card: a tax word in its label is refused before anything is sent.
  await page.getByRole('button', { name: 'Add Card' }).click();
  const dialog = page.getByTestId('card-dialog');
  await dialog.getByLabel('Service').selectOption({ label: 'Bookkeeping' });
  await dialog.getByLabel('What it counts').selectOption({ label: 'In a status now' });
  await dialog.getByLabel('Status').selectOption({ label: 'Active' });
  await dialog.getByLabel('Label').fill('Accepted Bookkeeping');
  await expect(dialog).toContainText('a tax return card names returns or tax');
  const add = page.getByRole('dialog').getByRole('button', { name: 'Add Card' });
  await expect(add).toBeDisabled();
  await dialog.getByLabel('Label').fill('Active Bookkeeping');
  await expect(dialog.getByTestId('card-preview')).toContainText(/This month it would show \d+\./);
  await page.screenshot({ path: 'e2e/screenshots/r60-dashboard-cards/add-card.png' });
  await add.click();
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(2)).toContainText('Bookkeeping · In a status now · Active');

  // Accepted Returns off; Active Bookkeeping up one.
  await page.getByRole('switch', { name: 'Show Accepted Returns on the dashboard' }).click();
  await expect(rows.nth(1)).toContainText('(off)');
  await page.getByRole('button', { name: 'Move Active Bookkeeping up' }).click();
  await expect(rows.nth(1)).toContainText('Active Bookkeeping');
  await expect(rows.nth(2)).toContainText('Accepted Returns');
  await page.screenshot({ path: 'e2e/screenshots/r60-dashboard-cards/settings.png' });

  // The dashboard: the fixed cards, then the cards switched on, in their order.
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Dashboard' })
    .click();
  const cards = page.getByTestId('kpi-card');
  await expect(cards.nth(3)).toContainText('Active Bookkeeping', { timeout: 60_000 });
  await expect(cards).toHaveCount(6);
  await expect(cards.nth(2)).toContainText('Returns In Progress');
  await expect(page.getByTestId('kpi-card').filter({ hasText: 'Accepted Returns' })).toHaveCount(0);
  await expect(cards.nth(3)).toHaveAttribute(
    'href',
    `/clients?service=${BOOKKEEPING}&engagement=ACTIVE&back=dashboard`,
  );
  await page.screenshot({ path: 'e2e/screenshots/r60-dashboard-cards/dashboard.png' });
  await cards.nth(3).click();
  await expect(page).toHaveURL(/\/clients\?service=.*engagement=ACTIVE/, { timeout: 60_000 });
  const filter = page.getByTestId('engagement-filter');
  await expect(filter).toContainText('Active engagements');
  await filter.getByRole('button', { name: 'Show every open engagement of this service' }).click();
  await expect(filter).toHaveCount(0);
});

test("a tax service card's list shows its service filter, and Show all clears it", async ({
  page,
}) => {
  await page.goto(
    app(
      `/tax-returns?status=IN_PROGRESS&serviceId=0199b6a3-0000-7000-8000-000000000001&back=dashboard`,
    ),
  );
  const filter = page.getByTestId('service-filter');
  await expect(filter).toContainText('One tax service', { timeout: 60_000 });
  await filter.getByRole('button', { name: "Show every service's returns" }).click();
  await expect(filter).toHaveCount(0);
});
