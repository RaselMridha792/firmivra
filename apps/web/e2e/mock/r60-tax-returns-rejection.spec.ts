import { expect, test } from '@playwright/test';

// Octavia's Tax Returns review of Oct 25, TX-F22: Move to Rejected no longer just changes the
// status. It records the agency's answer to a waiting transmission first (agency, time, code or
// description, corrective action), names a rejection already recorded, or says to record the
// transmission when there is none. In mock mode (playwright.mock.config.ts) as the Owner, with the
// mock answering as the API does (409 REJECTION_NOT_RECORDED). Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('Change Status to Rejected records the rejection of the waiting transmission first', async ({
  page,
}) => {
  await page.goto(app('/tax-returns'));
  await page
    .getByTestId('tr-filters')
    .getByLabel('Status', { exact: true })
    .selectOption('TRANSMITTED');
  const first = page.getByRole('row').nth(1);
  await expect(first).toContainText('Transmitted');
  await first.getByRole('button', { name: /^Actions for/ }).click();
  await page.getByRole('menuitem', { name: 'Change Status' }).click();
  await page.getByTestId('status-dialog').getByLabel('New status').selectOption('REJECTED');
  await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).click();

  // The test id marks the dialog's body; its title and buttons belong to the dialog around it.
  const dialog = page.getByTestId('reject-dialog');
  const modal = page.getByRole('dialog');
  await expect(modal.getByRole('heading', { name: 'Record Rejection' })).toBeVisible();
  await expect(dialog.getByLabel('Rejecting agency')).toHaveValue('IRS');
  const record = modal.getByRole('button', { name: 'Record Rejection' });
  await dialog.getByLabel('Reject code').fill('IND-031-04');
  await expect(record).toBeDisabled();
  await dialog.getByLabel('Corrective action').fill('Fix the prior-year AGI and transmit again');
  await dialog.getByLabel('Rejecting agency').fill('');
  await expect(record).toBeDisabled();
  await dialog.getByLabel('Rejecting agency').fill('IRS');
  await record.click();
  await expect(page.getByText('Rejection recorded. Moved to Rejected.')).toBeVisible();
  await expect(dialog).toHaveCount(0);
});

test('a return with no transmission cannot be moved to Rejected', async ({ page }) => {
  await page.goto(app('/tax-returns'));
  await page
    .getByTestId('tr-filters')
    .getByLabel('Status', { exact: true })
    .selectOption('IN_PREPARATION');
  await page.getByTestId('return-link').first().click();
  await expect(page.getByTestId('action-bar')).toBeVisible();
  await page.getByRole('button', { name: 'Other status changes' }).click();
  await page.getByRole('menuitem', { name: 'Move to Rejected' }).click();

  const dialog = page.getByTestId('reject-dialog');
  await expect(dialog.getByTestId('no-transmission')).toContainText(
    'No transmission is waiting for an answer',
  );
  await expect(dialog.getByRole('link', { name: /E-File page/ })).toHaveAttribute(
    'href',
    /\/review#efile$/,
  );
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Move to Rejected' }),
  ).toBeDisabled();
});
