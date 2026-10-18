import { expect, test, type Page } from '@playwright/test';

// Super Admin Billing Settings (S01, docx §15) on the adminBilling mock: the General tab as drawn,
// Save with its checks and high-impact confirmation, Cancel and Reset to Defaults. The mock config
// runs NEXT_PUBLIC_API_MOCK=all, which also signs the console in as Morgan Admin (an Owner).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;

const noSidewaysScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const breadcrumb = (page: Page) => page.getByRole('navigation', { name: 'Breadcrumb' });
const tab = (page: Page, name: string) =>
  page.getByRole('tablist', { name: 'Billing settings sections' }).getByRole('tab', { name });

test('Billing Settings opens on General with the platform defaults', async ({ page }) => {
  await page.goto(admin('/billing/settings'));
  await expect(page.getByTestId('page-title')).toHaveText('Billing Settings');
  await expect(breadcrumb(page).getByRole('link', { name: 'Billing' })).toHaveAttribute(
    'href',
    '/billing',
  );
  await expect(
    page.getByRole('tablist', { name: 'Billing settings sections' }).getByRole('tab'),
  ).toHaveCount(8);
  await expect(tab(page, 'General')).toHaveAttribute('aria-selected', 'true');

  await expect(page.getByLabel('Default Currency')).toHaveValue('USD');
  await expect(page.getByLabel('Default Currency').locator('option:checked')).toHaveText(
    'USD - US Dollar ($)',
  );
  await expect(page.getByLabel('Default Invoice Terms')).toHaveValue('NET_30');
  await expect(page.getByLabel('Default Estimate Validity')).toHaveValue('30');
  await expect(page.getByLabel('Default Time Zone')).toHaveValue('America/New_York');
  await expect(page.getByLabel('Rounding Method').locator('option:checked')).toHaveText(
    'Standard Rounding (0.01)',
  );
  await expect(page.getByRole('switch', { name: 'Enable Credit Notes' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByRole('switch', { name: 'Require Purchase Order Number' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await expect(page.getByLabel('Default Terms & Conditions')).toHaveValue(
    /^Payment is due within 30 days/,
  );
  await expect(page.getByText('79/1000')).toBeVisible();
  await expect(page.getByTestId('settings-meta')).toContainText('by Morgan Admin');
});

test('Save checks every tab, confirms high-impact changes and keeps the saved values', async ({
  page,
}) => {
  await page.goto(admin('/billing/settings'));
  await page.getByLabel('Default Invoice Terms').selectOption({ label: 'Net 15' });
  await page.getByRole('switch', { name: 'Require Purchase Order Number' }).click();
  await expect(page.getByTestId('settings-unsaved')).toBeVisible();

  await tab(page, 'Numbering').click();
  await page.getByLabel('Invoice Format').fill('INV-');
  await expect(page.getByTestId('settings-invoice-preview')).toHaveText('—');
  await page.getByTestId('settings-save').click();
  await expect(page.getByTestId('billing-notice')).toContainText('Numbering');
  await expect(page.getByText('Include {####} and use 30 characters or fewer')).toBeVisible();

  await page.getByLabel('Invoice Format').fill('INV-{YYYY}-{####}');
  await expect(page.getByTestId('settings-invoice-preview')).toHaveText(/^INV-\d{4}-\d{4}$/);
  await expect(page.getByText('Include {####} and use 30 characters or fewer')).toHaveCount(0);
  await page.getByTestId('settings-save').click();
  const confirm = page.getByRole('dialog', { name: 'Apply these changes to every firm?' });
  await expect(confirm.getByTestId('settings-impact')).toContainText(
    'Every new invoice needs a PO number',
  );
  await expect(confirm.getByTestId('settings-impact')).toContainText(
    'Invoice numbers change from INV-{####} to INV-{YYYY}-{####}.',
  );
  await confirm.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByTestId('billing-notice')).toContainText('Billing settings saved.');
  await expect(page.getByTestId('settings-unsaved')).toHaveCount(0);

  // The saved values come back after leaving the page (same mock session).
  await breadcrumb(page).getByRole('link', { name: 'Billing' }).click();
  await expect(page.getByTestId('page-title')).toHaveText('Billing');
  await page
    .getByRole('navigation', { name: 'Billing sections' })
    .getByRole('link', { name: 'Settings' })
    .click();
  await expect(page.getByTestId('page-title')).toHaveText('Billing Settings');
  await expect(page.getByLabel('Default Invoice Terms')).toHaveValue('NET_15');
  await expect(page.getByRole('switch', { name: 'Require Purchase Order Number' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await tab(page, 'Numbering').click();
  await expect(page.getByLabel('Invoice Format')).toHaveValue('INV-{YYYY}-{####}');
});

test('Reset to Defaults and Cancel put the values back', async ({ page }) => {
  await page.goto(admin('/billing/settings'));
  await tab(page, 'Taxes & Fees').click();
  const rates = page.getByTestId('tax-rate');
  await expect(rates).toHaveCount(3);
  await page.getByRole('button', { name: 'Remove Reduced Rate' }).click();
  await expect(rates).toHaveCount(2);
  await page.getByRole('button', { name: 'Add Tax Rate' }).click();
  await expect(rates).toHaveCount(3);
  await page.getByLabel('Tax rate 3 name').fill('County Tax');

  await page.getByRole('button', { name: /Reset Taxes & Fees to Defaults/ }).click();
  const reset = page.getByRole('dialog', { name: 'Reset Taxes & Fees to defaults?' });
  await reset.getByRole('button', { name: 'Reset to Defaults' }).click();
  await expect(rates).toHaveCount(3);
  await expect(page.getByLabel('Tax rate 3 name')).toHaveValue('Reduced Rate');

  await tab(page, 'General').click();
  await page.getByRole('switch', { name: 'Enable Estimates' }).click();
  await expect(page.getByRole('switch', { name: 'Enable Estimates' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const discard = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
  await discard.getByRole('button', { name: 'Discard Changes' }).click();
  await expect(page.getByRole('switch', { name: 'Enable Estimates' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(page.getByTestId('settings-unsaved')).toHaveCount(0);
});

test('Billing Settings has no sideways scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(admin('/billing/settings'));
  await expect(page.getByLabel('Default Currency')).toHaveValue('USD');
  expect(await noSidewaysScroll(page)).toBe(true);
  for (const name of ['Taxes & Fees', 'Templates', 'Numbering', 'Permissions']) {
    await tab(page, name).click();
    await expect(tab(page, name)).toHaveAttribute('aria-selected', 'true');
    expect(await noSidewaysScroll(page)).toBe(true);
  }
});
