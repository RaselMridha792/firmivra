import { expect, test } from '@playwright/test';

// R56: Octavia's Services & Pricing review of Oct 20 (docs/specs/review-2026-10-21/CHANGE-LIST.md,
// section D), P1 items in mock mode: a taken name is named on its field (S1), drafts and
// duplicates are listed (S2), archived packages are listed and restored (S4), and promotion
// errors sit on their fields with the rule (S10). S3 (activation that names the missing field) is
// checked on the local API; the mock has no service missing a short description.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('S1: saving with a name already used says so on the name field and keeps every entry', async ({
  page,
}) => {
  await page.goto(app('/services-pricing/new'));
  await page.getByTestId('service-name').fill('Audit Representation');
  await page.getByTestId('service-category').selectOption({ index: 1 });
  await page.getByLabel('Short Description *').fill('Representation before the IRS.');
  await page.getByTestId('service-price').fill('100');
  await page.getByTestId('save-draft').click();
  const name = page.getByTestId('service-name');
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText(/already uses this name, possibly a draft/).first()).toBeVisible();
  await expect(name).toHaveValue('Audit Representation');
  await expect(page.getByLabel('Short Description *')).toHaveValue(
    'Representation before the IRS.',
  );
  await expect(page.getByTestId('save-error')).not.toContainText('Something went wrong');
});

test('S2: a duplicate is a draft that stays listed under Drafts, with the summary count', async ({
  page,
}) => {
  await page.goto(app('/services-pricing'));
  const views = page.getByTestId('service-views');
  await expect(views.getByRole('button', { name: /^Drafts \(0\)/ })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search services' }).fill('Audit Representation');
  const row = page.locator('tr', { hasText: 'Audit Representation' });
  await row.getByRole('button', { name: 'Duplicate Audit Representation' }).click();
  await expect(page).toHaveURL(/\/services-pricing\/[0-9a-f-]+\/edit$/);

  // Back in the app (a reload would reset the mock).
  await page.getByRole('button', { name: 'Back to Services', exact: true }).click();
  await views.getByRole('button', { name: /^Drafts/ }).click();
  await expect(views.getByRole('button', { name: /^Drafts \(1\)/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  const copy = page.locator('tr', { hasText: 'Audit Representation (Copy)' });
  await expect(copy).toContainText('Draft');
  await expect(copy.getByRole('button', { name: 'Resume' })).toBeVisible();
});

test('S2: ?view=draft opens the Drafts view, with its empty state', async ({ page }) => {
  await page.goto(app('/services-pricing?view=draft'));
  await expect(
    page.getByTestId('service-views').getByRole('button', { name: /^Drafts/ }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('No drafts')).toBeVisible();
});

test('S4: an archived package is listed under Archived and restored to Inactive', async ({
  page,
}) => {
  await page.goto(app('/services-pricing/packages'));
  const views = page.getByTestId('package-views');
  const name = ((await page.getByTestId('package-name').first().textContent()) ?? '').trim();
  await page
    .locator('tr', { hasText: name })
    .getByRole('button', { name: `Archive ${name}` })
    .click();
  await expect(page.getByText(/stays under Archived/)).toBeVisible();

  await views.getByRole('button', { name: /^Archived/ }).click();
  const archived = page.locator('tr', { hasText: name });
  await expect(archived).toContainText('Archived');
  await archived.getByRole('button', { name: `Restore ${name}` }).click();
  await expect(page.getByText(/restored to Inactive/)).toBeVisible();

  await views.getByRole('button', { name: /^Inactive/ }).click();
  await expect(page.locator('tr', { hasText: name })).toContainText('Inactive');
});

test('S10: promotion errors are on their fields, with the rule, and the first is focused', async ({
  page,
}) => {
  await page.goto(app('/services-pricing/promotions'));
  await page.getByRole('button', { name: 'Create Promotion' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Promotion name').fill('Review promo');
  await dialog.getByLabel('Percent off').fill('101');
  await dialog.getByLabel('Starts on (optional)').fill('2026-11-10');
  await dialog.getByLabel('Ends on (optional)').fill('2026-11-01');
  await dialog.getByRole('button', { name: 'Save as Draft' }).click();

  await expect(dialog.getByTestId('promotion-errors')).toContainText(
    'Fix these 2 fields before saving: Discount, Ends on.',
  );
  await expect(dialog.getByLabel('Percent off')).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.getByText('A percentage discount is 1 to 100%.')).toBeVisible();
  await expect(dialog.getByLabel('Ends on (optional)')).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.getByLabel('Percent off')).toBeFocused();

  await dialog.getByLabel('Percent off').fill('-10');
  await dialog.getByLabel('Ends on (optional)').fill('2026-11-20');
  await dialog.getByRole('button', { name: 'Save as Draft' }).click();
  await expect(dialog.getByText(/Negative or zero discounts are not allowed/)).toBeVisible();
  await expect(dialog.getByTestId('promotion-errors')).toContainText('Discount.');

  await dialog.getByLabel('Percent off').fill('15');
  await dialog.getByRole('button', { name: 'Save as Draft' }).click();
  await expect(dialog).toBeHidden();
});

// Section D, P2 and P3: S6 additive pricing, S7 Not Included, S8 View Full Page for a package,
// S9 a quote-required package total. The mock works these out as the API does.
const firstService = '/services-pricing/0199c0e0-0a00-7000-8000-000000000001/edit';
const firstPackage = '/services-pricing/packages/0199c0e0-0f00-7000-8000-000000000001';

test('S6: additive line items add to the base price at once; included ones never twice', async ({
  page,
}) => {
  await page.goto(app('/services-pricing/new'));
  await page.getByTestId('service-price').fill('100.50');
  await page.getByRole('button', { name: 'Add Line Item', exact: true }).click();
  await page.getByLabel('Item Name 1 *').fill('Test line');
  // Key by key: the field keeps the cursor (setting the whole list used to remount the rows).
  const rate = page.getByLabel('Price 1', { exact: true });
  await rate.selectText();
  await rate.pressSequentially('75');
  await expect(rate).toHaveValue('75');
  await expect(rate).toBeFocused();
  const total = page.getByTestId('service-total');
  await expect(total).toHaveText('$100.50');

  await page.getByLabel('Line item pricing').selectOption('ADDITIVE');
  await expect(total).toHaveText('$175.50');
  await expect(page.getByTestId('client-preview')).toContainText('$175.50');
  await page.getByLabel('Line item pricing').selectOption('INCLUDED');
  await expect(total).toHaveText('$100.50');

  // The edit form works it out while editing too, not "on save".
  await page.goto(app(firstService));
  await expect(page.getByTestId('service-name')).toHaveValue('Personal Tax Preparation', {
    timeout: 60_000,
  });
  await page.getByTestId('service-price').fill('100.50');
  await page.getByLabel('Price 1', { exact: true }).fill('75');
  await page.getByLabel('Price 2', { exact: true }).fill('0');
  await page.getByLabel('Line item pricing').selectOption('ADDITIVE');
  await expect(page.getByTestId('service-total')).toHaveText('$175.50');
});

test('S7: Not Included is on the client full page; internal notes never are', async ({ page }) => {
  await page.goto(app('/services-pricing/new'));
  await page.getByRole('button', { name: 'Edit Not Included', exact: true }).click();
  await page.getByRole('button', { name: '+ Add item', exact: true }).click();
  await page.getByLabel('Not Included item 1', { exact: true }).fill('Pens');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByTestId('internal-notes').fill('Staff only: call first');
  await page.getByRole('button', { name: 'View Full Page' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('client-preview-not-included')).toContainText('Pens');
  await expect(dialog).not.toContainText('Staff only: call first');

  await page.goto(app(firstService));
  await expect(page.getByTestId('service-name')).toHaveValue('Personal Tax Preparation', {
    timeout: 60_000,
  });
  await page.getByRole('button', { name: 'View Full Page' }).click();
  await expect(page.getByRole('dialog').getByTestId('client-preview-not-included')).toContainText(
    'Amended returns (additional fee)',
  );
});

test('S8: View Full Page on the package page and in its editor; ticked add-ons add up', async ({
  page,
}) => {
  await page.goto(app(firstPackage));
  await page.getByTestId('detail-preview').getByRole('button', { name: 'View Full Page' }).click();
  const full = page.getByRole('dialog').getByTestId('package-full-preview');
  await expect(full).toContainText('Small Business Tax Bundle');
  await expect(full).not.toContainText('Targeted for new business clients.');
  await expect(full).not.toContainText('Business Entity Formation');
  const total = full.getByTestId('full-preview-total');
  await expect(total).toHaveText('Total with the add-ons ticked: $499.00');
  await full.getByLabel('Audit Representation (+$250.00)').check();
  await expect(total).toHaveText('Total with the add-ons ticked: $749.00');
  await page.getByRole('button', { name: 'Close dialog' }).click();

  await page.goto(app(`${firstPackage}/edit`));
  const preview = page.getByTestId('builder-preview');
  await expect(preview).toContainText('Small Business Tax Bundle', { timeout: 60_000 });
  await preview.getByRole('button', { name: 'View Full Page' }).click();
  await expect(page.getByRole('dialog').getByTestId('package-full-preview')).toContainText(
    'Small Business Tax Bundle',
  );
});

test('S9: a quote-required service leaves the package total unavailable, never $0', async ({
  page,
}) => {
  // A Custom Quote service made here (the seeded one is inactive); in-app links keep the mock's data.
  await page.goto(app('/services-pricing/new'));
  await page.getByTestId('service-name').fill('Quote review example');
  await page.getByTestId('service-category').selectOption({ label: 'Tax Preparation' });
  await page.getByLabel('Short Description *').fill('Priced after a review.');
  await page.getByLabel('Pricing Type *').selectOption('CUSTOM_QUOTE');
  await page.getByTestId('save-activate').click();
  await expect(page).toHaveURL(/\/services-pricing$/);
  await page.getByRole('tab', { name: 'Package Builder' }).click();
  await page.getByRole('link', { name: 'Create Package' }).click();

  await page.getByRole('button', { name: 'Add Service', exact: true }).click();
  await page.getByLabel('Search active services').fill('Quote review');
  await page.getByRole('button', { name: 'Add Quote review example', exact: true }).click();
  await page.getByLabel('Search active services').fill('Bookkeeping');
  await page.getByRole('button', { name: 'Add Bookkeeping Services', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();

  await expect(page.getByTestId('package-total')).toHaveText('Unavailable: quote required');
  await expect(page.getByTestId('quote-required-note')).toBeVisible();
  await expect(page.getByTestId('package-savings')).toHaveText('Client Savings: —');
  await expect(page.getByTestId('package-client-preview')).toContainText('(Quote required)');
});
