import { expect, test } from '@playwright/test';

// Client sign-ups (R23) on the clientSignUps mock, as the Owner. The mock pages 2 at a time.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('the owner approves, links and declines sign-ups', async ({ page }) => {
  await page.goto(app('/sign-ups'));
  await expect(page.getByTestId('page-title')).toHaveText('Sign-ups');
  const rows = page.getByTestId('sign-up-row');
  await expect(rows).toHaveCount(2);

  const jane = rows.filter({ hasText: 'Jane Roe' });
  await expect(jane).toContainText('Matches your client');
  await jane.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByTestId('sign-ups-feedback')).toContainText('Jane Roe is approved');
  await expect(page.getByRole('link', { name: 'Open client record' })).toBeVisible();

  const john = rows.filter({ hasText: 'John Doe' });
  await john.getByRole('button', { name: 'Decline' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason (optional)').fill('Not a client of ours');
  await dialog.getByRole('button', { name: 'Decline' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('sign-ups-feedback')).toContainText(
    "John Doe's sign-up was declined.",
  );
  await expect(rows).toHaveText([/Sam Poe/]);

  await page.getByRole('button', { name: 'Declined' }).click();
  await expect(rows.filter({ hasText: 'John Doe' })).toContainText('Not a client of ours');
});

test('sign-ups fit a 375 px screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(app('/sign-ups'));
  await expect(page.getByTestId('sign-up-row')).toHaveCount(2);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(overflow).toBe(false);
});
