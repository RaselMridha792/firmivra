// Octavia's Bookkeeping Review 2, R01 review (G12): the Close Checklist's Approve follows the
// same rule as the Reconciliation screen: off, with its reason, while there is a difference.
// Mock mode, as an Owner (Green Leaf's checking account has ledger lines).
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const GREEN = '0199c0f0-b100-7000-8000-000000000001';

test('R01 (G12): the Close Checklist keeps Approve off, with its reason, while a reconciliation has a difference', async ({
  page,
}) => {
  await page.goto(`${app}/bookkeeping/clients/${GREEN}?tab=reconciliation`);
  await page
    .getByTestId('reconciliation-panel')
    .getByRole('button', { name: 'Start reconciling Business Checking' })
    .click();
  const start = page.getByRole('dialog');
  await start.getByLabel('Beginning balance ($)').fill('1000');
  await start.getByLabel('Ending balance ($)').fill('2000');
  await start.getByRole('button', { name: 'Start Reconciling' }).click();
  await expect(page).toHaveURL(/\/bookkeeping\/reconciliations\//);
  await expect(page.getByTestId('recon-difference')).not.toContainText('$0.00');

  // The statement is attached, so the difference is what stops the approval.
  await page.getByRole('button', { name: 'Attach Statement' }).click();
  await page
    .getByRole('dialog', { name: 'Attach Statement' })
    .getByLabel('Statement')
    .setInputFiles({
      name: 'Synthetic statement.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 synthetic'),
    });
  await page.getByRole('dialog').getByRole('button', { name: 'Attach' }).click();
  await expect(page.getByText('Statement attached.')).toBeVisible();
  await page.getByRole('button', { name: 'Ready for Review' }).click();
  await expect(page.getByText('Ready for review.')).toBeVisible();
  const reason = 'The difference must be zero to approve.';
  await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled();
  await expect(page.getByTestId('recon-blocked')).toHaveText(reason);

  // The Close Checklist says the same, and its Approve is off too.
  await page.getByRole('link', { name: 'Close Checklist' }).click();
  await expect(page).toHaveURL(/\/bookkeeping\/periods\//);
  const blocked = page.getByTestId('close-recon-blocked');
  await expect(blocked).toHaveText(reason);
  const approve = blocked.locator('xpath=..').getByRole('button', { name: 'Approve' });
  await expect(approve).toBeDisabled();
  await expect(approve).toHaveAttribute('title', reason);
});
