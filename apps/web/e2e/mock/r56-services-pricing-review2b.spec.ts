import { expect, test } from '@playwright/test';

// R56, Services & Pricing Review Two batch B, in mock mode (playwright.mock.config.ts) as the
// Owner; a reload resets the mock. R9/R13 (decided Nov 19): Check a Code says whether a code
// applies, or the one reason it does not, and Promotions says codes are not yet redeemed at
// payment. R8/R11: the package and service editors show what is still needed to publish, and what
// Draft, Active and Live mean. R12: deactivating a package asks first. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const firstPackage = '/services-pricing/packages/0199c0e0-0f00-7000-8000-000000000001';
test.use({ viewport: { width: 1440, height: 1000 } });

test('R9/R13: Check a Code answers in plain words; Promotions says codes are not yet redeemed', async ({
  page,
}) => {
  await page.goto(app('/services-pricing/promotions'));
  await expect(page.getByTestId('promotions-redeem-note')).toContainText(
    'Promo codes are not yet redeemed at payment.',
  );
  await page.getByRole('button', { name: 'Check a Code' }).click();
  const dialog = page.getByRole('dialog', { name: 'Check a Code' });
  // Nothing chosen: each field says what it needs.
  await dialog.getByTestId('check-code-run').click();
  await expect(dialog.getByText('Enter the code.')).toBeVisible();
  await expect(dialog.getByLabel('Promo code')).toBeFocused();

  await dialog.getByLabel('Promo code').fill('nope-0000');
  await dialog.getByLabel('Service').selectOption({ label: 'Bookkeeping Services' });
  await dialog.getByTestId('check-code-run').click();
  await expect(dialog.getByTestId('check-code-answer')).toHaveText(
    'No promotion uses this code. Check the spelling.',
  );

  await dialog.getByLabel('Promo code').fill('EARLY10');
  await dialog.getByTestId('check-code-run').click();
  await expect(dialog.getByTestId('check-code-answer')).not.toBeEmpty();
});

test('R8/R11: Edit Package shows what it needs to publish and what clients see now', async ({
  page,
}) => {
  await page.goto(app(`${firstPackage}/edit`));
  const ready = page.getByTestId('package-readiness');
  await expect(ready).toContainText('Ready to Publish?', { timeout: 60_000 });
  await expect(ready).toContainText('Visible to Clients');
  await expect(ready).toContainText('Display on Website/Portal');
  await expect(page.getByTestId('package-state')).not.toBeEmpty();
  await expect(ready.getByRole('link', { name: 'Settings > Client Portal' })).toHaveAttribute(
    'href',
    '/settings/portal',
  );
});

test('R11: the service editor lists what Save & Activate still needs', async ({ page }) => {
  await page.goto(app('/services-pricing/new'));
  const ready = page.getByTestId('service-readiness');
  await expect(ready).toContainText('Ready to Activate?');
  await expect(ready).toContainText('Name, category and short description');
  await expect(ready).toContainText('Draft: only your team sees it.');
});

test('R12: deactivating a package asks first; Cancel changes nothing', async ({ page }) => {
  await page.goto(app(firstPackage));
  await page.getByRole('button', { name: 'Deactivate' }).click();
  const dialog = page.getByRole('dialog', { name: /^Deactivate Small Business Tax Bundle\?/ });
  await expect(dialog.getByTestId('package-change-impact')).toContainText(
    'Invoices, client services and history from it keep exactly what was sold.',
  );
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Deactivate' })).toBeVisible();
});
