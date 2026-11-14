import { expect, test } from '@playwright/test';

// Tax Returns Review 2 (R60, Nov 15): Start Correction after a rejection, Record Extension (the
// event only), Settings > Tax statuses' "Maps to" and the firm's amount rounding. Mock mode
// (playwright.mock.config.ts) as the Owner, the mocks answering as the API does. Synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.describe.configure({ timeout: 180_000 });

test('Start Correction moves a rejected return to In Correction with what needs correcting', async ({
  page,
}) => {
  await page.goto(app('/tax-returns?status=REJECTED'));
  const first = page.getByRole('row').nth(1);
  await first.getByRole('button', { name: /^Actions for/ }).click({ timeout: 60_000 });
  await page.getByRole('menuitem', { name: 'Start Correction', exact: true }).click();
  const modal = page.getByRole('dialog');
  await expect(modal.getByRole('heading', { name: 'Start Correction' })).toBeVisible();
  const confirm = modal.getByRole('button', { name: 'Start Correction' });
  await expect(confirm).toBeDisabled();
  await modal.getByLabel('What needs correcting').fill('The prior-year AGI (fake).');
  await confirm.click();
  await expect(page.getByText('Moved to In Correction.')).toBeVisible();
});

test('Record Extension records the filing day and the new deadline, shown on the return', async ({
  page,
}) => {
  await page.goto(app('/tax-returns?status=IN_PREPARATION'));
  const first = page.getByRole('row').nth(1);
  await first.getByRole('button', { name: /^Actions for/ }).click({ timeout: 60_000 });
  await page.getByRole('menuitem', { name: 'Record Extension', exact: true }).click();
  const dialog = page.getByTestId('extension-dialog');
  await dialog.getByLabel('New due date').fill('2099-10-15');
  await page.getByRole('dialog').getByRole('button', { name: 'Record Extension' }).click();
  await expect(page.getByText(/^Extension recorded: due /)).toBeVisible();
  // In-app, so the mock keeps the change.
  await first.getByRole('button', { name: /^Actions for/ }).click();
  await page.getByRole('menuitem', { name: 'Open / View Return' }).click();
  await expect(page.getByTestId('extension-state')).toHaveText(/^Filed /, { timeout: 60_000 });
  await expect(page.getByRole('button', { name: 'Edit Extension' })).toBeVisible();
});

test('Tax statuses: Maps to per label with a help note, and the amount rounding', async ({
  page,
}) => {
  await page.goto(app('/settings/tax-statuses'));
  await expect(page.getByTestId('maps-to-help')).toBeVisible({ timeout: 60_000 });
  const filed = page.getByLabel('Maps to for Filed');
  await expect(filed).toHaveValue('TRANSMITTED');
  await filed.selectOption({ label: 'Accepted' });
  await expect(filed).toHaveValue('ACCEPTED');
  await filed.selectOption({ label: 'None (your own label)' });
  await expect(filed).toHaveValue('');

  // A new label, mapped as it is added.
  await page.getByTestId('new-status-name').fill('Back with the preparer');
  await page.getByTestId('new-status-maps-to').selectOption({ label: 'In Correction' });
  await page.getByRole('button', { name: 'Add status' }).click();
  await expect(page.getByLabel('Maps to for Back with the preparer')).toHaveValue('IN_CORRECTION');

  const rounding = page.getByTestId('amount-rounding').getByLabel('Refunds and amounts due');
  await expect(rounding).toHaveValue('EXACT');
  await rounding.selectOption({ label: 'Round to the dollar' });
  await expect(page.getByTestId('amount-rounding').getByText('Saved.')).toBeVisible();
  await expect(rounding).toHaveValue('ROUND_TO_DOLLAR');
});
