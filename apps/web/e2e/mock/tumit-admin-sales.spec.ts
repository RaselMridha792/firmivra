import { expect, test } from '@playwright/test';

// Super Admin Sales & Pipeline (S04) in mock mode (playwright.mock.config.ts): the adminSales mock
// in mocks/admin-sales.ts, signed in as the mock Super Admin. Synthetic records only; each test
// opens a fresh page, so the mock starts from its seed.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;
/** The first seeded record: "Sample Brightpath Tax", a new lead. */
const FIRST = '0199d1a0-5a00-7000-8000-000000000001';

test('the Sales Center shows its numbers, plans and activity, and starts a trial', async ({
  page,
}) => {
  await page.goto(admin('/sales'));
  await expect(page.getByRole('heading', { level: 1, name: 'Sales Center' })).toBeVisible();
  await expect(page.getByTestId('center-kpi-totalLeads-value')).toHaveText(/^\d[\d,]*$/);
  await expect(page.getByTestId('center-kpi-projectedMrrCents-value')).toHaveText(/^\$/);
  await expect(page.getByTestId('plan-SOLO_CORE')).toContainText('$69');
  await expect(page.getByTestId('plan-ENTERPRISE')).toContainText('From');
  await expect(page.getByTestId('recent-sales-activity').getByRole('row')).toHaveCount(6);
  await expect(page.getByTestId('upcoming-follow-ups').getByRole('row')).toHaveCount(6);
  await expect(page.getByTestId('center-pipeline').getByRole('listitem')).toHaveCount(10);
  await expect(page.getByTestId('frame-error')).toHaveCount(0);

  await page
    .getByTestId('plan-TEAM_PRO')
    .getByRole('button', { name: /Start 14-Day Trial/ })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Start 14-Day Trial' });
  await expect(dialog.getByLabel('Plan', { exact: true })).toHaveValue('TEAM_PRO');
  await dialog.getByLabel('Firm', { exact: true }).selectOption({ index: 1 });
  await dialog.getByRole('button', { name: 'Start Trial' }).click();
  await expect(page.getByText(/A 14-day trial started for/)).toBeVisible();
});

test('the pipeline filters the board, switches to the list and adds a lead', async ({ page }) => {
  await page.goto(admin('/sales/pipeline'));
  await expect(page.getByRole('heading', { level: 1, name: 'Sales Pipeline' })).toBeVisible();
  await expect(page.getByTestId('pipeline-column')).toHaveCount(10);
  await expect(page.getByTestId('kpi-total-value')).toHaveText(/^\d+$/);
  await expect(page.getByTestId('frame-error')).toHaveCount(0);

  // The same filters drive both views.
  await page.getByRole('searchbox', { name: 'Search opportunities' }).fill('Brightpath');
  await expect(page.getByTestId('pipeline-card')).toHaveCount(4);
  await page.getByRole('button', { name: 'List View' }).click();
  const table = page.getByRole('table', { name: 'Opportunities in this pipeline' });
  await expect(table.getByRole('row')).toHaveCount(5);
  await page.getByRole('button', { name: 'Card View' }).click();
  await expect(page.getByTestId('pipeline-card')).toHaveCount(4);
  await page.getByRole('button', { name: 'Clear Filters' }).click();

  await page.getByRole('button', { name: 'Add Lead / Opportunity' }).click();
  const panel = page.getByRole('dialog', { name: 'Add Lead' });
  await panel.getByLabel(/Firm \/ company name/).fill('Sample Northwind Test Tax');
  await panel.getByLabel(/Primary contact/).fill('Riley Test');
  await panel.getByLabel('Email', { exact: true }).fill('riley@northwind-test.example.test');
  await panel.getByLabel(/Lead source/).selectOption('WEBSITE');
  await panel.getByRole('button', { name: 'Save Lead' }).click();
  await expect(page.getByText('Sample Northwind Test Tax was added to New Lead.')).toBeVisible();
  await expect(
    page.getByTestId('pipeline-column').first().getByText('Sample Northwind Test Tax'),
  ).toBeVisible();
});

test('marking a record lost asks for the reason first', async ({ page }) => {
  await page.goto(admin(`/sales/opportunities/${FIRST}`));
  await page.getByRole('button', { name: 'Mark Unqualified / Lost' }).click();
  const dialog = page.getByRole('dialog', { name: 'Move to Unqualified / Lost' });
  await dialog.getByRole('button', { name: 'Move to Unqualified / Lost' }).click();
  await expect(dialog.getByText('Choose why this record was lost.')).toBeVisible();
  await dialog.getByLabel('Lost reason').selectOption('BUDGET');
  await dialog.getByRole('button', { name: 'Move to Unqualified / Lost' }).click();
  await expect(page.getByText('Moved to Unqualified / Lost.')).toBeVisible();
  await expect(page.getByTestId('opportunity-badges')).toContainText('Unqualified / Lost');
  await expect(page.getByTestId('stage-history')).toContainText('Budget');
});

test('an administrator renames a stage in the builder and the board follows', async ({ page }) => {
  await page.goto(admin('/sales/pipeline/builder'));
  await expect(page.getByRole('heading', { level: 1, name: 'Build Pipeline' })).toBeVisible();
  const stages = page.getByTestId('builder-stage');
  await expect(stages).toHaveCount(10);
  await stages.nth(5).getByLabel('Stage name').fill('Nurture');
  await page.getByRole('button', { name: 'Save Pipeline' }).click();
  await expect(page.getByText('Firmivra Sales Pipeline was saved.')).toBeVisible();

  // A stage that holds records asks where they go before it can be removed.
  await stages.nth(3).getByRole('button', { name: 'Remove Qualified' }).click();
  const remove = page.getByRole('dialog', { name: 'Remove Qualified' });
  await expect(remove.getByLabel('Move its records to')).toBeVisible();
  await remove.getByRole('button', { name: 'Cancel' }).click();

  await page.getByRole('link', { name: 'Back to Pipeline' }).click();
  await expect(page.getByTestId('pipeline-column').filter({ hasText: 'Nurture' })).toHaveCount(1);
});

test('a record opens from its card, takes a note and shows its history', async ({ page }) => {
  await page.goto(admin('/sales/pipeline'));
  await page
    .getByTestId('pipeline-card')
    .getByRole('link', { name: 'Sample Brightpath Tax' })
    .click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Sample Brightpath Tax' }),
  ).toBeVisible();
  await expect(page.getByTestId('stage-history')).toContainText('New lead added');
  await page.getByLabel('Add a note').fill('Asked for the Team Pro pricing sheet.');
  await page.getByRole('button', { name: 'Add Note' }).click();
  await expect(page.getByTestId('notes')).toContainText('Asked for the Team Pro pricing sheet.');
});

test('an unknown record says it cannot be found', async ({ page }) => {
  await page.goto(admin('/sales/opportunities/0199d1a0-5a00-7000-8000-999999999999'));
  await expect(page.getByTestId('page-not-found')).toBeVisible();
});

const PHONE_PAGES = [
  { path: '/sales', title: 'Sales Center', ready: 'center-kpi-totalLeads-value' },
  { path: '/sales/pipeline', title: 'Sales Pipeline', ready: 'pipeline-card' },
  { path: '/sales/pipeline/builder', title: 'Build Pipeline', ready: 'builder-stage' },
  { path: `/sales/opportunities/${FIRST}`, title: 'Sample Brightpath Tax', ready: 'notes' },
];
for (const { path, title, ready } of PHONE_PAGES) {
  test(`${title} fits a phone without sideways scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(admin(path));
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByTestId(ready).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
