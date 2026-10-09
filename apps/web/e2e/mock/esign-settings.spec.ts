import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('change the email, expiry and reminders, with a wrong number caught first', async ({
  page,
}) => {
  await page.goto(app('/firm-sign/new'));
  await page.getByLabel('Document name').fill('Synthetic Settings Test');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/prepare$/);
  const steps = page.getByRole('navigation', { name: 'Steps' });
  await steps.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Next: Review and send' })).toBeVisible();

  await page.getByLabel('Subject').fill('Please sign your synthetic letter');
  await page.getByLabel('Expires after (days)').fill('abc');
  await page.getByLabel('Most reminders (0 turns them off)').fill('0');
  await expect(page.getByText('Save your changes to continue.')).toBeVisible();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Enter a whole number')).toBeVisible();

  await page.getByLabel('Expires after (days)').fill('400');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText(/365/)).toBeVisible();

  // Reminders on days 3, 6 and 9 run past an 8-day expiry, which would stop the send.
  await page.getByLabel('Expires after (days)').fill('8');
  await page.getByLabel('Most reminders (0 turns them off)').fill('3');
  await page.getByLabel('First reminder after (days)').fill('3');
  await page.getByLabel('Then remind every (days)').fill('3');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('The last reminder would come on or after the expiry')).toBeVisible();

  await page.getByLabel('Expires after (days)').fill('14');
  await page.getByLabel('Only your team sees this note').fill('Synthetic note');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('link', { name: 'Next: Review and send' })).toBeVisible();

  // What was saved is what the request now holds.
  await steps.getByRole('link', { name: 'Documents' }).click();
  await steps.getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByLabel('Subject')).toHaveValue('Please sign your synthetic letter');
  await expect(page.getByLabel('Expires after (days)')).toHaveValue('14');
  await expect(page.getByLabel('Most reminders (0 turns them off)')).toHaveValue('3');
  await expect(page.getByLabel('First reminder after (days)')).toHaveValue('3');
});
