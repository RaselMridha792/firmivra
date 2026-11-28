import { expect, test } from '@playwright/test';

// R56, Services & Pricing Review Two batch A, in mock mode (playwright.mock.config.ts) as the
// Owner; a reload resets the mock. R1-R3: a discount that cannot work is named on its field, with a
// summary, and nothing is saved. Q1 (decided Nov 19): a typed price turns the discount off. R10:
// the price breakdown, a $0 package shown as free. R4: "/ month" everywhere. R5: Archive asks
// first, with what it affects. R6: the list's search and view survive a refresh. Y3: a taken promo
// code is named on its field. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const firstPackage = '/services-pricing/packages/0199c0e0-0f00-7000-8000-000000000001';
test.use({ viewport: { width: 1440, height: 1000 } });

test('Q1 and R1-R2: a typed price turns the discount off; a discount that cannot work is named and nothing is saved', async ({
  page,
}) => {
  await page.goto(app(`${firstPackage}/edit`));
  await expect(page.getByTestId('builder-preview')).toContainText('Small Business Tax Bundle', {
    timeout: 60_000,
  });
  // The seeded package has a typed $499 and a 20% discount that never applied: it is shown off.
  await expect(page.getByLabel('Package price')).toHaveValue('499');
  await expect(page.getByLabel('Discount type')).toBeDisabled();
  await expect(page.getByTestId('discount-off-note')).toHaveText(
    'The price you entered already includes any discount.',
  );
  await expect(page.getByTestId('discount-unused')).toContainText('20%');

  // Without a typed price the discount works the price out.
  await page.getByLabel('Package price').fill('');
  await page.getByLabel('Discount type').selectOption('PERCENTAGE');
  await page.getByLabel('Discount value').fill('10');
  await expect(page.getByTestId('builder-price-worked')).not.toHaveText('—');
  await expect(page.getByTestId('price-breakdown')).toContainText('Discount (10%)');

  // A fixed amount above the services' total is named on the field; Save stops with a summary.
  await page.getByLabel('Discount type').selectOption('FIXED');
  await page.getByLabel('Discount value').fill('99999');
  await expect(page.getByTestId('discount-error')).toContainText(
    'The discount is more than the included services cost',
  );
  await page.getByTestId('package-save').click();
  await expect(page.getByTestId('package-errors')).toContainText('Everything else you entered');
  await expect(page.getByLabel('Discount value')).toBeFocused();
  await expect(page.getByLabel('Discount value')).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(/\/edit$/);
});

test('R2, R3, R10: Create Package refuses 101%; the whole total makes a $0 package, shown as free', async ({
  page,
}) => {
  await page.goto(app('/services-pricing/packages/new'));
  await page.getByRole('button', { name: 'Add Service', exact: true }).click();
  await page.getByRole('button', { name: 'Add Bookkeeping Services', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByLabel('Discount (Optional)').selectOption('PERCENTAGE');
  await expect(page.getByTestId('package-price-worked')).toBeVisible();
  await page.getByLabel('Discount percentage').fill('101');
  await expect(page.getByText('Use a percentage of 100% or less.')).toBeVisible();

  await page.getByLabel('Discount (Optional)').selectOption('FIXED');
  await page.getByLabel('Discount amount').fill('199');
  const breakdown = page.getByTestId('price-breakdown');
  await expect(breakdown).toContainText('$0.00 (free)');
  await expect(breakdown).toContainText('Added on the invoice, from your tax rates');
  await expect(page.getByText('Use a percentage of 100% or less.')).toHaveCount(0);
});

test('Q21 R2: an empty Create Package names every required field in plain words, beside it and in the summary', async ({
  page,
}) => {
  await page.goto(app('/services-pricing/packages/new'));
  await page.getByRole('button', { name: 'Save as Draft', exact: true }).click();
  const summary = page.getByRole('alert').filter({ hasText: 'Fix these 3 fields' });
  await expect(summary).toContainText('Enter the package name.');
  await expect(summary).toContainText('Choose a category.');
  await expect(summary).toContainText('Enter a short description.');
  await expect(page.locator('#package-category-field-error')).toHaveText('Choose a category.');
  await expect(page.locator('#package-description-field-error')).toHaveText(
    'Enter a short description.',
  );
  await expect(page.getByText('Invalid UUID')).toHaveCount(0);
  await expect(page.getByText('Enter a value')).toHaveCount(0);
  await expect(page.locator('#package-name-field')).toBeFocused();
});

test('Q21 R2: Edit Package with the short description cleared names it and saves nothing', async ({
  page,
}) => {
  await page.goto(app(`${firstPackage}/edit`));
  await expect(page.getByTestId('builder-preview')).toContainText('Small Business Tax Bundle', {
    timeout: 60_000,
  });
  await page.getByLabel('Short Description *').fill('   ');
  await page.getByTestId('package-save').click();
  await expect(page.getByTestId('package-errors')).toContainText('Enter a short description.');
  await expect(page.locator('#package-description-field-error')).toHaveText(
    'Enter a short description.',
  );
  await expect(page.getByLabel('Short Description *')).toBeFocused();
  await expect(page).toHaveURL(/\/edit$/);
});

test('R4: a recurring price reads "/ month" in the list and in the editor', async ({ page }) => {
  await page.goto(app('/services-pricing'));
  await page.getByRole('textbox', { name: 'Search services' }).fill('Bookkeeping Services');
  const row = page.locator('tr', { hasText: 'Bookkeeping Services' });
  await expect(row).toContainText('/ month');
  await row.getByRole('link', { name: 'Bookkeeping Services' }).click();
  await expect(page.getByTestId('service-preview-page')).toContainText('/ month', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('service-preview-page')).not.toContainText('/ monthly');
});

test('R5: Archive asks first with what it affects; Cancel changes nothing; Confirm archives', async ({
  page,
}) => {
  await page.goto(app('/services-pricing'));
  await page.getByRole('textbox', { name: 'Search services' }).fill('Bookkeeping Services');
  const row = page.locator('tr', { hasText: 'Bookkeeping Services' });
  const archive = async () => {
    await row.getByRole('button', { name: 'Actions for Bookkeeping Services' }).click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
  };
  await archive();
  const dialog = page.getByRole('dialog', { name: 'Archive Bookkeeping Services?' });
  await expect(dialog.getByTestId('service-change-impact')).toContainText('What this affects');
  await expect(dialog).toContainText('It moves to Archived, where you can restore it.');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toContainText('Active');

  await archive();
  await page.getByTestId('service-change-confirm').click();
  await expect(
    page.getByText(/Bookkeeping Services archived\. It stays under Archived/),
  ).toBeVisible();
});

test('R6: the list’s search and view survive a refresh, and a service opened from it keeps the way back', async ({
  page,
}) => {
  await page.goto(app('/services-pricing'));
  await page.getByTestId('service-views').getByRole('button', { name: /^All/ }).click();
  await page.getByRole('textbox', { name: 'Search services' }).fill('Bookkeeping');
  await expect(page).toHaveURL(/[?&]q=Bookkeeping/);
  await expect(page).toHaveURL(/[?&]view=all/);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Search services' })).toHaveValue('Bookkeeping');
  await page
    .locator('tr', { hasText: 'Bookkeeping Services' })
    .getByRole('link', { name: 'Bookkeeping Services' })
    .click();
  await expect(page).toHaveURL(/[?&]from=/);
});

test('Y3: a taken promo code is named on the code field, not called an overlap', async ({
  page,
}) => {
  await page.goto(app('/services-pricing/promotions'));
  await page.getByRole('button', { name: 'Create Promotion' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Promotion name').fill('Code clash (fake)');
  await dialog.getByLabel('Percent off').fill('10');
  await dialog.getByLabel(/Promo code/).fill('EARLY10');
  await dialog.getByRole('button', { name: 'Save as Draft' }).click();
  await expect(dialog.getByLabel(/Promo code/)).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.getByText(/Another promotion already uses this code/).first()).toBeVisible();
  await expect(dialog.getByText(/does not stack/)).toHaveCount(0);
});
