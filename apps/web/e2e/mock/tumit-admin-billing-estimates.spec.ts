import { expect, test, type Page } from '@playwright/test';

// Super Admin Billing estimates (S01) on the adminBilling mock: Estimates with its details
// panel, Create Estimate and Edit Estimate. The mock config runs NEXT_PUBLIC_API_MOCK=all, which
// also signs the console in as Morgan Admin. Dates in the mock are relative to today, so the
// statuses are stable; each page load starts from the seeded data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;
/** EST-0012: Johnson Family (LVP Accounting & Taxes), pending, $3,500.00, with a note. */
const JOHNSON = '0199d1a0-0b05-7000-8000-000000000012';
/** EST-0007: Taylor Corporate, converted to an invoice. */
const CONVERTED = '0199d1a0-0b05-7000-8000-000000000007';

const noSidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('Estimates lists estimates with totals, tabs, filters and the details panel', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(admin('/billing/estimates'));
  await expect(page.getByTestId('page-title')).toHaveText('Estimates');
  await expect(page.getByTestId('kpi-total')).toContainText('14 estimates');
  await expect(page.getByTestId('kpi-approved')).toContainText('5 estimates');
  await expect(page.getByTestId('kpi-declined-value')).toHaveText('$5,600.00');

  const tabs = page.getByRole('navigation', { name: 'Billing sections' });
  await expect(tabs.getByRole('link', { name: 'Estimates' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByRole('link', { name: 'Create Estimate' })).toHaveAttribute(
    'href',
    '/billing/estimates/new',
  );

  const rows = page.getByTestId('estimate-table').locator('tbody tr');
  await expect(rows).toHaveCount(10);
  await expect(page.getByText('Showing 1–10 of 14 estimates')).toBeVisible();

  // The panel opens on the newest estimate; a number opens another one.
  const panel = page.getByTestId('estimate-panel');
  await expect(panel).toContainText('Estimate # EST-0014');
  await page.getByRole('button', { name: 'EST-0012, show details' }).click();
  await expect(panel.getByTestId('estimate-details-amount')).toHaveText('$3,500.00');
  await expect(panel).toContainText('Johnson Family');
  await expect(panel).toContainText('Tentative tax planning estimate for the family.');
  await expect(panel.getByTestId('convert-estimate')).toHaveAttribute(
    'href',
    `/billing/invoices/new?estimate=${JOHNSON}`,
  );
  await expect(panel.getByRole('link', { name: 'Edit Estimate' })).toHaveAttribute(
    'href',
    `/billing/estimates/${JOHNSON}/edit`,
  );

  await panel.getByTestId('view-estimate').click();
  const viewer = page.getByRole('dialog', { name: 'Estimate EST-0012' });
  await expect(viewer.getByTestId('estimate-document')).toContainText('LVP Accounting & Taxes');
  await expect(viewer.getByTestId('estimate-document-total')).toHaveText('$3,500.00');
  await viewer.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByTestId('estimate-status-filter').selectOption({ label: 'Declined' });
  await expect(rows).toHaveCount(3);
  for (const badge of await rows.getByTestId('status-badge').all()) {
    await expect(badge).toHaveText('Declined');
  }
  await expect(page.getByTestId('kpi-total')).toContainText('3 estimates');

  await page.getByTestId('estimate-status-filter').selectOption({ label: 'All Statuses' });
  await page.getByRole('searchbox', { name: 'Search estimates' }).fill('Johnson');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('EST-0012');
});

test('the row menu approves an estimate; the panel duplicates and deletes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(admin('/billing/estimates'));
  await page.getByRole('button', { name: 'Actions for EST-0012' }).click();
  await page.getByRole('menuitem', { name: 'Mark as Approved' }).click();
  await expect(page.getByTestId('billing-notice')).toContainText('EST-0012 marked as approved.');
  await expect(page.getByTestId('kpi-approved')).toContainText('6 estimates');

  await page.getByRole('button', { name: 'EST-0012, show details' }).click();
  const panel = page.getByTestId('estimate-panel');
  await expect(panel.getByTestId('status-badge')).toHaveText('Approved');
  await panel.getByRole('button', { name: 'Duplicate Estimate' }).click();
  await expect(page.getByTestId('billing-notice')).toContainText(
    'EST-0015 created as a draft copy of EST-0012.',
  );
  await expect(panel).toContainText('Estimate # EST-0015');
  await expect(page.getByText('Showing 1–10 of 15 estimates')).toBeVisible();

  await panel.getByRole('button', { name: 'Delete Estimate' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete Estimate' });
  await dialog.getByRole('button', { name: 'Delete Estimate' }).click();
  await expect(page.getByTestId('billing-notice')).toContainText('EST-0015 deleted.');
  await expect(page.getByText('Showing 1–10 of 14 estimates')).toBeVisible();
});

test('Create Estimate checks the form, totals live and saves a draft', async ({ page }) => {
  await page.goto(admin('/billing/estimates/new'));
  await expect(page.getByTestId('page-title')).toHaveText('Create Estimate');
  await expect(page.locator('#estimate-number')).toHaveValue('EST-0015');

  await page.getByRole('button', { name: 'Save as Draft' }).click();
  await expect(page.getByText('Select a client', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Description, line 1')).toHaveAttribute('aria-invalid', 'true');

  await page.locator('#estimate-client').selectOption({ label: 'Johnson Family' });
  await expect(page.locator('#estimate-email')).toHaveValue('alex.johnson@example.test');
  await expect(page.locator('#estimate-terms')).toHaveValue(/LVP Accounting & Taxes/);
  await page.getByLabel('Description, line 1').fill('Tax Preparation - Individual');
  await page.getByLabel('Rate, line 1').fill('250');
  await page.getByRole('button', { name: 'Add Line Item' }).click();
  await page.getByLabel('Description, line 2').fill('Bookkeeping Setup');
  await page.getByLabel('Rate, line 2').fill('300');
  await expect(page.getByTestId('estimate-subtotal')).toHaveText('$550.00');
  await page.locator('#estimate-tax').selectOption({ label: 'Sales Tax (7%)' });
  await expect(page.getByTestId('estimate-total')).toHaveText('$588.50');

  await page.getByRole('button', { name: 'Preview Estimate' }).click();
  const viewer = page.getByRole('dialog', { name: 'Estimate EST-0015' });
  await expect(viewer.getByTestId('estimate-document')).toContainText('Johnson Family');
  await expect(viewer.getByTestId('estimate-document-total')).toHaveText('$588.50');
  await viewer.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('button', { name: 'Save as Draft' }).click();
  await expect(page).toHaveURL(/\/billing\/estimates\?estimate=0199d1a0-0b05-[\d-]+&saved=draft$/);
  await expect(page.getByTestId('billing-notice')).toContainText('Estimate saved as a draft.');
  const details = page.getByRole('dialog', { name: 'Estimate Details' });
  await expect(details).toContainText('Estimate # EST-0015');
  await expect(details.getByTestId('status-badge')).toHaveText('Draft');
});

test('Edit Estimate loads the estimate and saves a change', async ({ page }) => {
  await page.goto(admin(`/billing/estimates/${JOHNSON}/edit`));
  await expect(page.getByTestId('page-title')).toHaveText('Edit Estimate');
  await expect(page.locator('#estimate-number')).toHaveValue('EST-0012');
  await expect(page.getByLabel('Description, line 1')).toHaveValue('Tax Planning Session');
  await expect(page.getByTestId('estimate-total')).toHaveText('$3,500.00');

  await page.locator('#estimate-reference').fill('Spring planning');
  await page.locator('#estimate-status').selectOption({ label: 'Approved' });
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/billing/estimates\\?estimate=${JOHNSON}&saved=updated$`),
  );
  await expect(page.getByTestId('billing-notice')).toContainText('Estimate changes saved.');
  await expect(
    page.getByRole('dialog', { name: 'Estimate Details' }).getByTestId('status-badge'),
  ).toHaveText('Approved');
});

test('a converted estimate opens read-only with its invoice', async ({ page }) => {
  await page.goto(admin(`/billing/estimates/${CONVERTED}/edit`));
  await expect(page.getByText('This estimate was converted to')).toBeVisible();
  await expect(page.getByRole('link', { name: /^INV-\d{4}$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save & Resend' })).toBeDisabled();
});

for (const [name, path, ready] of [
  ['estimates', '/billing/estimates', 'kpi-total-value'],
  ['create estimate', '/billing/estimates/new', 'summary-card'],
  ['edit estimate', `/billing/estimates/${JOHNSON}/edit`, 'summary-card'],
] as const) {
  test(`Billing ${name} fits a phone without sideways scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(admin(path));
    await expect(page.getByTestId(ready)).toBeVisible();
    expect(await noSidewaysScroll(page)).toBe(true);
  });
}
