import { expect, test } from '@playwright/test';

// Clients Review 2 N8-12: the client's Overview starts with its summaries (balance due, missing
// documents, unread messages, open intake forms, active services, next appointment), each opening
// the place it counts with Back to the client. In mock mode (playwright.mock.config.ts) as the
// Owner; mock client 1 has two missing documents, two unread messages, one open intake form, two
// services, no balance and an appointment in six days. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const clientId = '0199b6a1-0000-7000-8000-000000000001';
const profile = `http://app.localhost:${port}/clients/${clientId}`;

test('N8-12: Overview shows the six summaries, each opening its place with Back to the client', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(profile);
  const cards = page.getByTestId('client-summary');
  await expect(cards.getByTestId('summary-documents')).toContainText('2', { timeout: 60_000 });
  await expect(cards.getByTestId('summary-balance')).toContainText('Balance due');
  await expect(cards.getByTestId('summary-balance')).toContainText('$0.00');
  await expect(cards.getByTestId('summary-documents')).toContainText('Missing documents');
  await expect(cards.getByTestId('summary-messages')).toContainText('2');
  await expect(cards.getByTestId('summary-messages')).toContainText('Unread messages');
  await expect(cards.getByTestId('summary-intake')).toContainText('1');
  await expect(cards.getByTestId('summary-intake')).toContainText('Open intake forms');
  await expect(cards.getByTestId('summary-services')).toContainText('2');
  await expect(cards.getByTestId('summary-services')).toContainText('Active services');
  await expect(cards.getByTestId('summary-appointment')).toContainText('Next appointment');
  await expect(cards.getByTestId('summary-appointment')).toContainText('Consultation');

  // Each opens its place, and Back returns to the client.
  const opens: [string, RegExp][] = [
    ['summary-balance', new RegExp(`/clients/${clientId}/invoices\\?from=`)],
    ['summary-documents', new RegExp(`/clients/${clientId}/documents\\?from=`)],
    ['summary-messages', new RegExp(`/clients/${clientId}/messages\\?unread=1&from=`)],
    ['summary-intake', new RegExp(`/clients/${clientId}/intake-forms\\?from=`)],
    ['summary-services', new RegExp(`/clients/${clientId}/services\\?from=`)],
    ['summary-appointment', /\/calendar\/0199c0b0-0a10-7000-8000-000000000001\?from=/],
  ];
  for (const [card, url] of opens) {
    await cards.getByTestId(card).click();
    await expect(page).toHaveURL(url, { timeout: 60_000 });
    const back = page.getByTestId('back-to-origin');
    await expect(back).toHaveText(/Back to Client/);
    await back.click();
    await expect(page).toHaveURL(new RegExp(`/clients/${clientId}$`), { timeout: 60_000 });
    await expect(cards.getByTestId('summary-documents')).toContainText('2');
  }
});

test('N8-12: the Unread messages card opens the client’s Messages on Unread', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const unread = page.getByRole('button', { name: 'Unread', exact: true });
  const all = page.getByRole('button', { name: 'All Messages', exact: true });
  // Opened plainly, All Messages is the chosen view; with ?unread=1, Unread is (the two swap).
  await page.goto(`${profile}/messages`);
  await expect(unread).toBeVisible({ timeout: 60_000 });
  const chosen = await all.getAttribute('class');
  const other = await unread.getAttribute('class');
  expect(chosen).not.toBe(other);
  await page.goto(`${profile}/messages?unread=1`);
  await expect(unread).toBeVisible({ timeout: 60_000 });
  await expect(unread).toHaveAttribute('class', chosen ?? '');
  await expect(all).toHaveAttribute('class', other ?? '');
});

test('N8-12: a client with a balance shows it, with its open invoice', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/clients/0199b6a1-0000-7000-8000-000000000002`);
  const balance = page.getByTestId('summary-balance');
  await expect(balance).toContainText('$290.00', { timeout: 60_000 });
  await expect(balance).toContainText('1 open invoice');
  await expect(page.getByTestId('summary-documents')).toContainText('4');
});
