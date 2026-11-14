import { expect, test } from '@playwright/test';

// SH10 and Octavia's Review 2 (cross-service; PY-F13): billing pauses on its own, beside the
// service, in one Service & Billing dialog: each state first, the date billing pauses from (the
// next billing date by default), what will happen, a confirmation, then Resume. Pausing the
// service leaves billing alone. Mock mode, as an Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;

test('Payroll: pause billing from the next billing date, then resume it', async ({ page }) => {
  await page.goto(`${app}/payroll`);
  await page.getByRole('button', { name: /^Actions for Green Leaf/ }).click();
  await page.getByRole('menuitem', { name: 'Pause or Resume Billing' }).click();
  const dialog = page.getByRole('dialog', { name: 'Service & Billing' });
  await expect(dialog.getByTestId('service-billing-state')).toContainText('next billing date');
  await expect(dialog.getByLabel('Billing only')).toBeChecked();
  await expect(dialog.getByLabel('Billing pauses from')).not.toHaveValue('');
  const effects = dialog.getByTestId('service-billing-effects');
  await expect(effects).toContainText('nothing is charged or refunded');
  await expect(effects).toContainText('The service is not changed.');
  const apply = dialog.getByRole('button', { name: 'Apply' });
  await expect(apply).toBeDisabled();
  await dialog.getByLabel('I confirm these changes.').check();
  await apply.click();
  await expect(
    page.getByText(/^Payroll for Green Leaf Café LLC: Billing pauses from /),
  ).toBeVisible();

  await page.getByRole('button', { name: /^Actions for Green Leaf/ }).click();
  await page.getByRole('menuitem', { name: 'Pause or Resume Billing' }).click();
  await expect(dialog.getByTestId('service-billing-state')).toContainText('Paused from');
  await expect(dialog.getByTestId('service-billing-effects')).toContainText(
    'Billing resumes today',
  );
  await dialog.getByLabel('I confirm these changes.').check();
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(
    page.getByText(/^Payroll for Green Leaf Café LLC: Billing resumes today/),
  ).toBeVisible();
});

test('Pausing the service says billing is not changed; Bookkeeping has the same dialog', async ({
  page,
}) => {
  await page.goto(`${app}/payroll`);
  await page.getByRole('button', { name: /^Actions for Green Leaf/ }).click();
  await page.getByRole('menuitem', { name: 'Pause Payroll Service' }).click();
  const dialog = page.getByRole('dialog', { name: 'Service & Billing' });
  await expect(dialog.getByLabel('Service only')).toBeChecked();
  await dialog.getByLabel('Reason for pausing the service').fill('Fake: seasonal');
  await expect(dialog.getByTestId('service-billing-effects')).toContainText(
    'Billing is not changed.',
  );
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);

  await page.goto(`${app}/bookkeeping`);
  await page.getByRole('button', { name: /^Actions for Green Leaf/ }).click();
  await page.getByRole('menuitem', { name: 'Pause or Resume Billing' }).click();
  await expect(dialog.getByLabel('Billing only')).toBeChecked();
  await expect(dialog.getByTestId('service-billing-effects')).toContainText(
    'nothing is charged or refunded',
  );
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});
