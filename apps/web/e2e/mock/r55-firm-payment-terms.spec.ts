import { expect, test } from '@playwright/test';

// R55, R1's #1220 with IP-F02 and IP-F13: a firm keeps its own payment terms (Net 1 to Net 365, up
// to 12) in Settings > Payments; Create Invoice's Payment Terms offers them after the four
// standard ones, and choosing one sets the due date. Mock mode, as the Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test("the firm's own terms are kept in Settings and offered on Create Invoice", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/payments`);
  const own = page.getByRole('region', { name: 'Your payment terms' });
  await expect(own).toContainText('No terms of your own yet.');

  const days = own.getByLabel('Days');
  const add = own.getByRole('button', { name: 'Add Terms' });
  await days.fill('30');
  await expect(own.getByRole('alert')).toHaveText('Net 30 is already a standard term.');
  await expect(add).toBeDisabled();
  await days.fill('400');
  await expect(own.getByRole('alert')).toHaveText('Use a whole number of days, 1 to 365.');
  await days.fill('60');
  await add.click();
  await days.fill('45');
  await days.press('Enter');
  await expect(own.getByRole('listitem')).toHaveText(['Net 45', 'Net 60']);
  await own.getByRole('button', { name: 'Remove Net 60' }).click();
  await expect(own.getByRole('listitem')).toHaveText(['Net 45']);

  const terms = page.getByLabel('Default payment terms');
  await expect(terms.locator('option')).toHaveText([
    'Due on Receipt',
    'Net 7',
    'Net 14',
    'Net 30',
    'Net 45',
  ]);
  await terms.selectOption('net_45');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Changes saved.' })).toBeVisible();
  await expect(own.getByRole('listitem')).toHaveText(['Net 45']);
  await own.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/invoices/firm-payment-terms.png' });

  // Create Invoice offers them, starting from the firm's default.
  await page.getByRole('link', { name: 'Invoices & Payments' }).first().click();
  await page.getByRole('link', { name: 'Create Invoice' }).first().click();
  const select = page.getByLabel('Payment Terms');
  await expect(select.locator('option')).toHaveText([
    'Due on Receipt',
    'Net 7',
    'Net 14',
    'Net 30',
    'Net 45',
  ]);
  await expect(select).toHaveValue('net_45');
  await select.selectOption('net_7');
  await select.selectOption('net_45');
  await expect(page.getByLabel('Due Date *')).toHaveValue(inDays(45));
});
