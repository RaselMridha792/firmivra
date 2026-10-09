import { expect, test, type Page } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

/** The mock's requests (its fixtures, in the mockup's order). */
const REQUESTS = {
  'Tax Engagement Letter 2026': '0199b6e0-0000-7000-8000-000000000001',
  'Bookkeeping Services Agreement': '0199b6e0-0000-7000-8000-000000000002',
  'New Client Intake Form': '0199b6e0-0000-7000-8000-000000000003',
  'Payroll Authorization': '0199b6e0-0000-7000-8000-000000000004',
};

async function open(page: Page, title: keyof typeof REQUESTS) {
  await page.goto(app(`/firm-sign/requests/${REQUESTS[title]}`));
  await expect(page.getByTestId('page-title')).toHaveText(title);
}

test('a completed request: recipients and timeline', async ({ page }) => {
  await open(page, 'Tax Engagement Letter 2026');
  await expect(page.getByTestId('request-status')).toHaveText('Completed');
  const recipient = page.getByTestId('recipient');
  await expect(recipient).toHaveCount(1);
  await expect(recipient).toContainText('John Smith');
  await expect(recipient).toContainText('Signed');
  const timeline = page.getByTestId('timeline').getByRole('listitem');
  // Newest first: completed, signed, viewed, sent, created.
  await expect(timeline.first()).toContainText('Completed');
  await expect(timeline.last()).toContainText('Created');
  await expect(page.getByTestId('timeline')).toContainText('Verified by an email code');
});

test('a request part-way through says who it waits on', async ({ page }) => {
  await open(page, 'Payroll Authorization');
  await expect(page.getByText('Waiting for Jordan Brown to sign.')).toBeVisible();
  const recipients = page.getByTestId('recipient');
  await expect(recipients).toHaveCount(2);
  await expect(recipients.first()).toContainText('1. Alex Brown');
  await expect(recipients.nth(1)).toContainText('Viewed');
});

test('a mistyped request link is not found', async ({ page }) => {
  await page.goto(app('/firm-sign/requests/not-a-request'));
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('request detail fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await open(page, 'Payroll Authorization');
  await expect(page.getByTestId('timeline')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test('remind one signer, then too soon to remind again', async ({ page }) => {
  await open(page, 'Payroll Authorization');
  await page.getByRole('button', { name: 'Remind Jordan Brown' }).click();
  await expect(page.getByText('Reminder sent to Jordan Brown.')).toBeVisible();
  await expect(page.getByTestId('recipient').nth(1)).toContainText('Reminded 1 time');
  const first = page.getByTestId('timeline').getByRole('listitem').first();
  await expect(first).toContainText('Reminder sent');
  // Signed already: nothing to remind or correct.
  await expect(page.getByRole('button', { name: 'Remind Alex Brown' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Remind now' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'less than an hour ago' })).toBeVisible();
});

test('void needs a reason and is kept on the record', async ({ page }) => {
  await open(page, 'New Client Intake Form');
  await page.getByRole('button', { name: 'Void', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Void this request' });
  await dialog.getByRole('button', { name: 'Void request' }).click();
  await expect(dialog.getByText('Give a reason.')).toBeVisible();
  await dialog.getByLabel('Reason').fill('Sent to the wrong client (test)');
  await dialog.getByRole('button', { name: 'Void request' }).click();
  await expect(page.getByTestId('request-status')).toHaveText('Voided');
  await expect(page.getByTestId('notices')).toContainText(
    'Reason: Sent to the wrong client (test)',
  );
  await expect(page.getByTestId('timeline').getByRole('listitem').first()).toContainText('Voided');
  await expect(page.getByRole('button', { name: 'Void', exact: true })).toHaveCount(0);
});

test('correct a signer’s email', async ({ page }) => {
  await open(page, 'New Client Intake Form');
  await page.getByRole('button', { name: 'Correct Maria Lopez' }).click();
  const dialog = page.getByRole('dialog', { name: 'Correct Maria Lopez' });
  await dialog.getByLabel('Email').fill('maria.fixed@example.test');
  await dialog.getByRole('button', { name: 'Save and resend' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('recipient')).toContainText('maria.fixed@example.test');
  await expect(page.getByTestId('timeline').getByRole('listitem').first()).toContainText(
    'Recipient corrected',
  );
});

test('correct and resend makes a linked draft', async ({ page }) => {
  await open(page, 'Bookkeeping Services Agreement');
  await page.getByRole('button', { name: 'Correct and resend' }).click();
  const dialog = page.getByRole('dialog', { name: 'Correct and resend' });
  await dialog.getByLabel('Reason').fill('Fee changed (test)');
  await dialog.getByRole('button', { name: 'Void and make a new draft' }).click();
  await expect(page).not.toHaveURL(new RegExp(REQUESTS['Bookkeeping Services Agreement']));
  await expect(page.getByTestId('request-status')).toHaveText('Draft');
  await expect(page.getByRole('link', { name: 'Continue preparing' })).toBeVisible();
  await page.getByRole('link', { name: 'an earlier request' }).click();
  await expect(page.getByTestId('request-status')).toHaveText('Voided');
  await expect(page.getByRole('link', { name: 'a new request' })).toBeVisible();
});

test('a completed request: download and resend the copy', async ({ page }) => {
  await open(page, 'Tax Engagement Letter 2026');
  const saved = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Completion certificate' }).click();
  await saved;
  const timeline = page.getByTestId('timeline').getByRole('listitem');
  await expect(timeline.first()).toContainText('Downloaded');
  await page.getByRole('button', { name: 'Resend signed copy' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'signed copy' })).toBeVisible();
  await expect(timeline.first()).toContainText('Completed copy sent');
});
