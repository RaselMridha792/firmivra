import { expect, test } from '@playwright/test';

// R31: the firm dashboard shows every widget of the design (docs/mockups/firm-workspace/dashboard/
// firm-dashboard.webp) from the dashboard summary (mocks/dashboard.ts). Mock mode, as the Owner.
// The empty firm (quiet empty lines, no invented numbers) is in result-empty-*.png.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('every widget of the design, with trends only where the API gives the period before', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(app('/'));
  const cards = page.getByTestId('kpi-card');
  await expect(cards).toHaveCount(6);
  await expect(cards.first()).toContainText('127');
  for (const [i, label, trend] of [
    [0, 'Total Clients', '12%vs last month'],
    [1, 'New Leads', '41%vs last month'],
    [2, 'Returns In Progress', '19%vs last week'],
    [3, 'Completed Returns', '27%vs last month'],
  ] as const) {
    await expect(cards.nth(i)).toContainText(label);
    await expect(cards.nth(i)).toContainText(`Up ${trend}`);
  }
  // No previous value: no trend.
  await expect(cards.nth(4)).toHaveText(/\$18,560Outstanding Invoices$/);
  await expect(cards.nth(5).getByRole('link', { name: 'View Calendar' })).toHaveAttribute(
    'href',
    '/calendar',
  );

  const stages = page.getByTestId('pipeline-stage');
  await expect(stages).toHaveText([
    'Leads24',
    'Consultation—',
    'Intake15',
    'In Progress38',
    'Completed52',
  ]);
  const revenue = page.getByRole('region', { name: 'Revenue Overview' });
  await expect(revenue.getByRole('img', { name: /Revenue by month/ })).toBeVisible();
  const services = page.getByRole('region', { name: 'Service Breakdown' });
  await expect(services.getByRole('listitem')).toHaveCount(6);
  await expect(services).toContainText('Personal Tax Prep42%');
  await expect(page.getByRole('region', { name: 'Tasks Due' }).getByRole('listitem')).toHaveCount(
    5,
  );
  for (const name of ['Recent Messages', 'Upcoming Appointments']) {
    await expect(page.getByRole('region', { name }).getByRole('listitem').first()).toBeVisible();
  }

  const actions = page.getByTestId('quick-action');
  await expect(actions).toHaveCount(5);
  for (const [i, name, href] of [
    [0, 'Add Client', '/clients'],
    [1, 'Send Message', '/messages'],
    [2, 'Go to Communications', '/modules/communications'],
    [3, 'Create Invoice', '/invoices'],
    [4, 'Upload Now', '/modules/documents'],
  ] as const) {
    await expect(actions.nth(i).getByRole('link', { name })).toHaveAttribute('href', href);
  }
});

test('the dashboard has no horizontal scroll at 1440 and 390 px', async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(app('/'));
    await expect(page.getByTestId('quick-action')).toHaveCount(5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
