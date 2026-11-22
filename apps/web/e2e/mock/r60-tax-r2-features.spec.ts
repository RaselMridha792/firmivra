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
  // Review 2 (TR-1): the filing day starts empty and is required.
  const record = page.getByRole('dialog').getByRole('button', { name: 'Record Extension' });
  await expect(dialog.getByLabel('Extension filed on *')).toHaveValue('');
  await dialog.getByLabel('New due date').fill('2099-10-15');
  await expect(record).toBeDisabled();
  await dialog.getByLabel('Extension filed on *').fill('2026-04-10');
  await record.click();
  await expect(
    page.getByText(/^Extension recorded, due .*nothing was sent to an agency\.$/),
  ).toBeVisible();
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
  // Tax Returns Review 2 (Rounding): her words for the two choices, and how precise they are.
  await expect(rounding.locator('option')).toHaveText([
    'Keep exactly as entered',
    'Round up figures',
  ]);
  await expect(page.getByTestId('amount-rounding')).toContainText(
    'Round up figures takes any cents up to the next whole dollar',
  );
  await rounding.selectOption({ label: 'Round up figures' });
  await expect(page.getByTestId('amount-rounding').getByText('Saved.')).toBeVisible();
  await expect(rounding).toHaveValue('ROUND_TO_DOLLAR');
});

test('Tax statuses: Where returns appear names each tab and preset, its statuses and the labels', async ({
  page,
}) => {
  await page.goto(app('/settings/tax-statuses'));
  const where = page.getByTestId('where-returns-appear');
  await expect(where).toBeVisible({ timeout: 60_000 });
  await expect(where.getByTestId('tab-explained')).toHaveCount(6);
  await expect(
    where.getByTestId('tab-explained').filter({ hasText: 'Quarterly Taxes' }),
  ).toContainText('Lists returns in: every workflow status');
  const presets = where.getByTestId('preset-explained');
  await expect(
    presets.filter({ hasText: 'In Progress (filter and dashboard card)' }),
  ).toContainText(
    'In Preparation, Waiting on Client, Ready for Review, Ready for Signature, Ready to File, In Correction',
  );
  await expect(presets.filter({ hasText: 'In Preparation card' })).toContainText(
    'Your labels: Documents received, In preparation',
  );
  await expect(presets.filter({ hasText: 'Ready for Review/File card' })).toContainText(
    'Lists returns in: Ready for Review, Ready for Signature, Ready to File',
  );
});

test('Full Review: File Extension records it there; Return Details corrects the tax year (TR-1, TR-8)', async ({
  page,
}) => {
  await page.goto(app('/tax-returns?status=IN_PREPARATION'));
  const first = page.getByRole('row').nth(1);
  await first.getByRole('button', { name: /^Actions for/ }).click({ timeout: 60_000 });
  await page.getByRole('menuitem', { name: 'Open / View Return' }).click();
  await page.getByRole('tab', { name: 'Review' }).click({ timeout: 60_000 });
  await page.getByRole('link', { name: 'Open Review, E-File & Filing Status' }).click({
    timeout: 60_000,
  });
  const extension = page.getByTestId('review-extension');
  await expect(extension).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'File Extension' }).click();
  const dialog = page.getByTestId('extension-dialog');
  await dialog.getByLabel('Extension filed on *').fill('2026-04-10');
  await dialog.getByLabel('New due date').fill('2099-10-15');
  await page.getByRole('dialog').getByRole('button', { name: 'Record Extension' }).click();
  await expect(extension).toHaveText(/^Filed /, { timeout: 30_000 });
  await expect(page.getByTestId('review-deadline')).toContainText('2099');
  // TR-8: the Return Details editor has Correct Tax Year.
  await page
    .getByTestId('return-details')
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  const details = page.getByTestId('details-dialog');
  await expect(details.getByTestId('details-tax-year')).toBeVisible();
  await details.getByRole('button', { name: 'Correct Tax Year' }).click();
  await expect(page.getByTestId('correct-year-dialog')).toBeVisible();
});

test('Print / Export List downloads the list as a file, with no pop-up to block (Review 2)', async ({
  page,
}) => {
  await page.goto(app('/tax-returns'));
  const action = page
    .getByTestId('quick-actions')
    .getByRole('button', { name: 'Print / Export List' });
  await expect(action).toBeVisible({ timeout: 60_000 });
  const [file] = await Promise.all([page.waitForEvent('download'), action.click()]);
  expect(file.suggestedFilename()).toBe('tax-returns.csv');
  await expect(page.getByText('Export ready.')).toBeVisible();
});
