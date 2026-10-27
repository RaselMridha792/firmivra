import { expect, test } from '@playwright/test';

// BK-R01, the structure (Octavia's Oct 25 review): the Reconciliation tab lists each account's
// reconciliation for the period; a reconciliation clears ledger lines, works out its difference
// and is approved only at zero. Mock mode, as an Owner (mocks/bookkeeping.ts: Green Leaf's
// checking account has ledger lines, its card none).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const GREEN = '0199c0f0-b100-7000-8000-000000000001';

const start = async (page: import('@playwright/test').Page, account: string) => {
  await page.goto(`${app}/bookkeeping/clients/${GREEN}?tab=reconciliation`);
  const panel = page.getByTestId('reconciliation-panel');
  await panel.getByRole('button', { name: `Start reconciling ${account}` }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Beginning balance ($)').fill('1000');
  await dialog.getByLabel('Ending balance ($)').fill('2000');
  await dialog.getByRole('button', { name: 'Start Reconciling' }).click();
  await expect(page).toHaveURL(/\/bookkeeping\/reconciliations\//);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(account);
};

test('a reconciliation clears its lines and is approved only at a zero difference', async ({
  page,
}) => {
  await start(page, 'Business Checking');
  const items = page.getByTestId('recon-items');
  const difference = page.getByTestId('recon-difference');
  await expect(items.getByRole('checkbox').first()).toBeVisible();
  await expect(difference).toContainText('$1,000.00');

  // In review with a difference: approval waits, and a manager reopens it.
  await page.getByRole('button', { name: 'Ready for Review' }).click();
  await expect(page.getByText('Ready for review.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled();
  await expect(page.getByTestId('recon-blocked')).toHaveText(
    'The difference must be zero to approve.',
  );
  await expect(items.getByRole('checkbox').first()).toBeDisabled();
  await page.getByRole('button', { name: 'Reopen' }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Fake: lines still to clear');
  await page.getByRole('dialog').getByRole('button', { name: 'Reopen' }).click();
  await expect(page.getByText('Reconciliation reopened.')).toBeVisible();

  // Clearing every line works out the cleared balance; the statement's ending balance matches it.
  await items.getByRole('button', { name: 'Clear All', exact: true }).click();
  await expect(page.getByText('Marked cleared.')).toBeVisible();
  const boxes = items.getByRole('checkbox');
  for (const box of await boxes.all()) await expect(box).toBeChecked();
  const cleared = page.getByTestId('recon-cleared');
  await expect(cleared).toContainText(/lines\)/);
  const clearedValue = (await cleared.locator('p').nth(1).textContent()) ?? '';
  await page.getByLabel('Ending balance ($)').fill(clearedValue);
  await page.getByRole('button', { name: 'Save Progress' }).click();
  await expect(page.getByText('Progress saved.')).toBeVisible();
  await expect(difference).toContainText('$0.00');

  // One line unticked brings a difference back; ticked again, it is zero.
  await boxes.first().uncheck();
  await expect(page.getByText('Marked not cleared.')).toBeVisible();
  await expect(difference).not.toContainText('$0.00');
  await boxes.first().check();
  await expect(difference).toContainText('$0.00');

  await page.getByRole('button', { name: 'Ready for Review' }).click();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('Approved.')).toBeVisible();
  await expect(page.getByTestId('recon-page')).toContainText('Approved');

  // The tab shows it approved with no difference.
  await page.getByRole('link', { name: 'Green Leaf Café LLC' }).click();
  const panel = page.getByTestId('reconciliation-panel');
  await expect(panel.getByRole('row', { name: /Business Checking/ })).toContainText('Approved');
});

test('an account without ledger lines takes its cleared balance from the statement', async ({
  page,
}) => {
  await start(page, 'Business Credit Card');
  await expect(page.getByTestId('recon-items')).toContainText('This account has no ledger lines');
  await page.getByLabel('Cleared balance ($)').fill('2000');
  await page.getByRole('button', { name: 'Save Progress' }).click();
  await expect(page.getByText('Progress saved.')).toBeVisible();
  await expect(page.getByTestId('recon-difference')).toContainText('$0.00');
  await expect(page.getByTestId('recon-statement-file')).toHaveText('No statement attached yet.');
});

test('no sideways scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await start(page, 'Business Checking');
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(375);
});
