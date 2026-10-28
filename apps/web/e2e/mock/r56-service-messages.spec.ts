import { expect, test } from '@playwright/test';

// SH5 (Octavia's Oct 25 review: PY-F05, the Bookkeeping Communications contract; TX-F05 for R60):
// Send Message from a service workspace opens that client's conversations, not every message,
// with New Message for that client and service; Messages has a client filter to use by hand.
// Nothing is sent to test the way there. Mock mode, as an Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;

test('Payroll Send Message opens the client’s conversations with New Message for them', async ({
  page,
}) => {
  await page.goto(`${app}/payroll`);
  await page.getByRole('button', { name: /^Actions for Green Leaf/ }).click();
  await page.getByRole('menuitem', { name: 'Send Message' }).click();
  await expect(page).toHaveURL(/\/messages\?clientId=.+&service=Payroll&from=/);
  const filter = page.getByTestId('messages-client');
  await expect(filter.locator('option:checked')).toHaveText('Green Leaf Café LLC');
  await expect(
    page.getByText('No conversations with Green Leaf Café LLC yet.', { exact: false }),
  ).toBeVisible();

  // New Message is its own page (R60, MSG-F09), for that client and service.
  await page.getByRole('link', { name: 'New Message' }).first().click();
  await expect(page).toHaveURL(/\/messages\/new\?clientId=.+&subject=Payroll&from=/);
  await expect(page.getByTestId('compose-selected')).toHaveText('1 selected');
  await expect(page.getByLabel('Subject (optional)')).toHaveValue('Payroll');
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(/\/messages\?clientId=.+&service=Payroll&from=/);
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(`${app}/payroll`);
});

test('Messages: the client filter narrows the list by hand and All clients brings it back', async ({
  page,
}) => {
  await page.goto(`${app}/messages`);
  const filter = page.getByTestId('messages-client');
  await expect(filter.locator('option')).not.toHaveCount(1);
  const rows = page.getByTestId('thread-row');
  await expect(rows.first()).toBeVisible();
  const all = await rows.count();
  const name = (await filter.locator('option').nth(1).textContent()) ?? '';
  await filter.selectOption({ index: 1 });
  await expect(rows.first()).toContainText(name);
  expect(await rows.count()).toBeLessThan(all);
  for (const row of await rows.all()) await expect(row).toContainText(name);
  await filter.selectOption('');
  await expect(rows).toHaveCount(all);
});
