// R55, Client Portal BK-CP3: the bookkeeping terms the firm sent, in the client's portal. My
// Services' Bookkeeping card opens the version waiting for an answer, in the portal version (no
// internal notes, no discount reasons); Accept puts it in force and the version before is
// replaced; Decline sends it back to the firm and it leaves the portal. A version that isn't the
// client's shows the not-found state. Mock mode, as client Jamie (Primary). Synthetic data only.
import { expect, test, type Page } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;
const WAITING = '0199d6a0-0000-7000-8000-000000000002';

/** My Services' Bookkeeping card (a recurring service). */
async function bookkeepingCard(page: Page) {
  await page.goto(portal('/lvp/services'));
  await page.getByRole('tab', { name: /^Recurring/ }).click();
  return page.getByTestId('service-card').filter({ hasText: 'Bookkeeping (Growth)' });
}

async function openWaiting(page: Page) {
  const card = await bookkeepingCard(page);
  await card.getByRole('link', { name: 'New terms are waiting for your answer' }).click();
  await expect(page).toHaveURL(portal(`/lvp/services/bookkeeping-terms/${WAITING}`), {
    timeout: 60_000,
  });
  await expect(page.getByTestId('page-title')).toHaveText('Bookkeeping (Growth): version 2', {
    timeout: 60_000,
  });
}

test('BK-CP3: the Bookkeeping card opens the terms waiting for an answer, in the portal version', async ({
  page,
}) => {
  await openWaiting(page);
  await expect(page.getByTestId('terms-header')).toContainText('Waiting for your answer');
  await expect(page.getByTestId('terms-fees')).toContainText('$525.00');
  await expect(page.getByTestId('terms-fees')).toContainText('Monthly, billed in advance');
  await expect(page.getByTestId('terms-fees')).toContainText('Due 15 days after the invoice');
  await expect(page.getByTestId('terms-discounts')).toHaveText('Loyalty credit: 5%');
  await expect(page.getByTestId('terms-included')).toContainText('Monthly financial statements');
  await expect(page.getByTestId('terms-excluded')).toContainText('Payroll');
  await expect(page.getByTestId('terms-client-duties')).toContainText('Upload bank statements');
  // Nothing on the page edits the terms; the answer is the only action.
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Accept Terms' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Decline' })).toBeVisible();
});

test('BK-CP3: Accept puts the terms in force and the version before is replaced', async ({
  page,
}) => {
  await openWaiting(page);
  await page.getByRole('button', { name: 'Accept Terms' }).click();
  const dialog = page.getByRole('dialog', { name: 'Accept Terms' });
  await expect(dialog).toContainText('You accept version 2 exactly as the firm sent it');
  await dialog.getByRole('button', { name: 'Accept', exact: true }).click();
  await expect(page.getByTestId('terms-notice')).toHaveText(
    'You accepted version 2. The firm has been told.',
  );
  await expect(page.getByTestId('terms-header')).toContainText('In force');
  await expect(page.getByTestId('terms-answer')).toContainText('You accepted these terms on');
  await expect(page.getByRole('button', { name: 'Accept Terms' })).toHaveCount(0);

  await page.getByRole('link', { name: '← All Engagement Terms' }).click();
  const rows = page.getByTestId('terms-row');
  await expect(rows).toHaveCount(2, { timeout: 60_000 });
  await expect(rows.nth(0)).toContainText('version 2');
  await expect(rows.nth(0)).toContainText('In force');
  await expect(rows.nth(1)).toContainText('version 1');
  await expect(rows.nth(1)).toContainText('Replaced by a newer version');
});

test('BK-CP3: Decline sends the terms back to the firm; they leave the portal', async ({
  page,
}) => {
  await openWaiting(page);
  await page.getByRole('button', { name: 'Decline' }).click();
  const dialog = page.getByRole('dialog', { name: 'Decline Terms' });
  await dialog.getByLabel('Reason (optional)').fill('Synthetic: the fee is higher than agreed.');
  await dialog.getByRole('button', { name: 'Decline', exact: true }).click();
  await expect(page.getByTestId('terms-notice')).toHaveText(
    'You declined version 2. The firm has been told and will follow up with you.',
  );
  await page.getByRole('link', { name: 'Back to My Services' }).click();
  await page.getByRole('tab', { name: /^Recurring/ }).click();
  const card = page.getByTestId('service-card').filter({ hasText: 'Bookkeeping (Growth)' });
  await card.getByRole('link', { name: 'Your engagement terms' }).click();
  const rows = page.getByTestId('terms-row');
  await expect(rows).toHaveCount(1, { timeout: 60_000 });
  await expect(rows.first()).toContainText('version 1');
  await expect(rows.first()).toContainText('In force');
});

test("BK-CP3: a version that isn't the client's shows the not-found state", async ({ page }) => {
  await page.goto(portal('/lvp/services/bookkeeping-terms/0199d6a0-0000-7000-8000-0000000000ff'));
  await expect(page.getByTestId('page-not-found')).toBeVisible({ timeout: 60_000 });
});
