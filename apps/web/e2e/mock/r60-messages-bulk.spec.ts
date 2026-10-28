import { expect, test } from '@playwright/test';

// R60, MSG-F06 (Octavia's Messages review of Oct 27, MSG-059): Send Bulk Message opens the
// Messages bulk builder (Audience, Message, Review, Send) on the Communications engine, with
// Back to Messages, instead of the Communications list. Mock mode as the Owner; the mock sends
// nothing anywhere.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('Send Bulk Message opens the Messages builder; opening it saves nothing', async ({ page }) => {
  await page.goto(app('/messages'));
  await page.getByTestId('messages-bulk').click();
  await expect(page).toHaveURL(/\/messages\/bulk\?from=%2Fmessages/);
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(
    'Send Bulk Message',
  );
  await expect(page.getByRole('list', { name: 'Bulk message steps' })).toContainText('Audience');
  await expect(page.getByTestId('bulk-start')).toContainText('Nothing is saved or sent');
  await expect(page.getByRole('radio', { name: /Email/ })).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(app('/messages'));
});

test('Audience: Clients, Leads and Both, with Total, Can Receive and Cannot Receive', async ({
  page,
}) => {
  await page.goto(app('/messages'));
  await page.getByTestId('messages-bulk').click();
  await page.getByRole('button', { name: 'Start: Build the Audience' }).click();
  await expect(page).toHaveURL(/\/messages\/bulk\?id=[0-9a-f-]+&from=/);
  const list = page.getByTestId('bulk-candidates');
  const counts = page.getByTestId('bulk-counts');
  await expect(list.getByRole('checkbox').first()).toBeVisible();
  await expect(list).not.toContainText('Lead');
  await list.getByRole('checkbox').first().check();
  await expect(counts.getByText('Total Recipients').locator('..')).toContainText('1');
  await page.getByRole('tab', { name: 'Leads' }).click();
  await expect(list).not.toContainText('Client');
  await page.getByRole('tab', { name: 'Both' }).click();
  await page.getByLabel(/^Select all shown/).check();
  // Clients and leads together: more than the one chosen first.
  await expect(counts.getByText('Total Recipients').locator('..').locator('dd')).not.toHaveText(
    /^[01]$/,
  );
  await page.getByRole('button', { name: 'Clear All' }).click();
  await expect(counts.getByText('Total Recipients').locator('..').locator('dd')).toHaveText('0');
  await expect(page.getByRole('button', { name: 'Continue to Message' })).toBeDisabled();
});

test('Message, Review and Send on the Communications composer, then the results', async ({
  page,
}) => {
  await page.goto(app('/messages'));
  await page.getByTestId('messages-bulk').click();
  await page.getByRole('button', { name: 'Start: Build the Audience' }).click();
  await page.getByRole('tab', { name: 'Clients' }).click();
  await page.getByLabel(/^Select all shown/).check();
  await expect(
    page.getByTestId('bulk-counts').getByText('Can Receive').locator('..').locator('dd'),
  ).not.toHaveText('0');
  await page.getByRole('button', { name: 'Continue to Message' }).click();
  await expect(page).toHaveURL(/step=message/);
  await expect(page.getByTestId('composer')).toBeVisible();
  await page.getByLabel('Subject Line').fill('A quick hello (sample)');
  await page
    .getByTestId('composer-form')
    .getByRole('textbox', { name: /Message/ })
    .fill('Hello [Client First Name], a synthetic note.');
  await page
    .getByRole('button', { name: /^Review/ })
    .first()
    .click();
  await expect(page.getByTestId('review-dialog').getByTestId('review-count')).toBeVisible();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Send to/ })
    .click();
  await expect(page.getByTestId('bulk-sent')).toBeVisible();
  await expect(page).toHaveURL(/step=sent/);
  await expect(
    page.getByTestId('bulk-sent').getByRole('link', { name: 'View Results' }),
  ).toHaveAttribute('href', /\/communications\/[0-9a-f-]+\?from=/);
  await page.getByTestId('bulk-sent').getByRole('link', { name: 'Back to Messages' }).click();
  await expect(page).toHaveURL(app('/messages'));
});

test('No sideways scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto(app('/messages/bulk'));
  await expect(page.getByTestId('bulk-start')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
