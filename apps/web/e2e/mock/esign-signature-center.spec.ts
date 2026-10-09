import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('the Signature center lists what to sign and what is done', async ({ page }) => {
  await page.goto(portal('/lvp/signatures'));
  await expect(page.getByTestId('page-title')).toHaveText('Signatures');

  const rows = page.getByTestId('my-signature');
  await expect(rows).toHaveCount(3);
  const bookkeeping = rows.filter({ hasText: 'Bookkeeping Services Agreement' });
  await expect(bookkeeping).toContainText('Ready for you to sign');
  await expect(bookkeeping).toContainText('Sign by');
  await expect(rows.filter({ hasText: 'Joint Return Consent' })).toContainText('Waiting on others');

  await page.getByRole('tab', { name: 'Done' }).click();
  const done = page.getByRole('tabpanel', { name: 'Done' }).getByTestId('my-signature');
  await expect(done).toHaveCount(3);
  const letter = done.filter({ hasText: 'Tax Engagement Letter 2026' });
  await expect(letter).toContainText('Completed');
  await expect(letter.getByRole('button', { name: 'Download signed copy' })).toBeVisible();
  await expect(done.filter({ hasText: 'Terms of Service Update' })).toContainText('Expired');
});

test('Review and sign opens the signer pages', async ({ page }) => {
  await page.goto(portal('/lvp/signatures'));
  await page
    .getByTestId('my-signature')
    .filter({ hasText: 'Bookkeeping Services Agreement' })
    .getByRole('button', { name: 'Review and sign' })
    .click();
  await expect(page).toHaveURL(/\/lvp\/sign$/);
});

test('a completed request downloads its signed copy', async ({ page }) => {
  await page.goto(portal('/lvp/signatures'));
  await page.getByRole('tab', { name: 'Done' }).click();
  const letter = page.getByTestId('my-signature').filter({ hasText: 'Tax Engagement Letter 2026' });
  const download = page.waitForEvent('download');
  await letter.getByRole('button', { name: 'Download signed copy' }).click();
  await download;
});
