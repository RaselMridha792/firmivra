import { expect, test } from '@playwright/test';

// Q35: Super Admin new areas (Website Management, Platform CRM, Plan Tiers)
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;

test('Q35 Website Management: embed domains list, snippet generator, and add domain modal', async ({
  page,
}) => {
  await page.goto(admin('/website'));
  await expect(page.getByTestId('page-title')).toHaveText('Website Management');

  // Verify existing authorized domains
  const table = page.getByRole('table', { name: 'Authorized embed domains' });
  await expect(table).toBeVisible();
  await expect(table).toContainText('https://lvpaccounting.com');

  // Verify HTML embed snippet generator
  await expect(page.getByText('HTML Embed Snippet')).toBeVisible();
  await expect(page.locator('pre')).toContainText('<iframe');
  await expect(page.locator('pre')).toContainText('https://portal.firmivra.com/lvp/book/');

  // Add a new authorized embed domain
  await page.getByRole('button', { name: 'Add Authorized Domain' }).click();
  const modal = page.getByRole('dialog', { name: 'Add Authorized Embed Domain' });
  await expect(modal).toBeVisible();

  await modal.getByLabel('Website Origin *').fill('https://newclient-portal.test');
  await modal.getByRole('button', { name: 'Authorize Domain' }).click();

  // Verify new domain added to table
  await expect(table).toContainText('https://newclient-portal.test');
});

test('Q35 Platform CRM: prospective accounting firm leads directory, filter, and stage updates', async ({
  page,
}) => {
  await page.goto(admin('/crm'));
  await expect(page.getByTestId('page-title')).toHaveText('Platform CRM: Prospective Firms');

  // Verify KPI stats
  await expect(page.getByText('Total Prospects')).toBeVisible();
  await expect(page.getByText('Active Pipeline')).toBeVisible();

  // Verify prospective firm table
  const table = page.getByRole('table', { name: 'Prospective accounting firms' });
  await expect(table).toBeVisible();
  await expect(table).toContainText('Apex Tax & Advisory Partners');

  // Filter by stage
  const stageSelect = page.getByLabel('Filter by stage');
  await stageSelect.selectOption({ label: 'Demo Scheduled' });
  await expect(table.getByRole('row')).toHaveCount(2); // 1 header + 1 matching row

  // Reset filter
  await stageSelect.selectOption({ label: 'All Stages' });

  // Add new prospective firm lead
  await page.getByRole('button', { name: 'Add Prospective Firm' }).click();
  const addModal = page.getByRole('dialog', { name: 'Add Prospective Accounting Firm' });
  await expect(addModal).toBeVisible();

  await addModal.getByLabel('Firm Name *').fill('Benchmark Accounting Group');
  await addModal.getByLabel('Primary Contact Person *').fill('Jonathan Ray, CPA');
  await addModal.getByLabel('Contact Email *').fill('jray@benchmarkaccounting.test');
  await addModal.getByRole('button', { name: 'Save Prospect' }).click();

  // Verify newly created prospect appears
  await expect(table).toContainText('Benchmark Accounting Group');
});

test('Q35 Plan Tiers: catalog view, pricing limits, and edit tier modal', async ({ page }) => {
  // Navigate from Subscriptions via Plan Tiers button
  await page.goto(admin('/subscriptions'));
  const planTiersBtn = page.getByRole('button', { name: 'Plan Tiers' });
  await expect(planTiersBtn).toBeVisible();
  await planTiersBtn.click();
  await expect(page).toHaveURL(admin('/subscriptions/plans'));

  await expect(page.getByTestId('page-title')).toHaveText('Plan Tiers & Subscriptions');

  // Verify plans catalog
  const table = page.getByRole('table', { name: 'Subscription plan tiers' });
  await expect(table).toBeVisible();
  await expect(table).toContainText('Solo Core');
  await expect(table).toContainText('Team Pro');
  await expect(table).toContainText('Enterprise');

  // Open edit modal for Solo Core
  const editBtn = table
    .getByRole('row', { name: /Solo Core/ })
    .getByRole('button', { name: 'Edit Tier' });
  await editBtn.click();
  const editModal = page.getByRole('dialog', { name: /Edit Plan Tier/ });
  await expect(editModal).toBeVisible();

  await editModal.getByLabel('Monthly Price ($ USD) *').fill('109');
  await editModal.getByRole('button', { name: 'Save Changes' }).click();

  // Verify updated price in table
  await expect(table).toContainText('$109 / mo');
});
