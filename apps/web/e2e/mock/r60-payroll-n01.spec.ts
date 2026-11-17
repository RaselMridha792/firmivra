// Octavia's Payroll Review 2, N01: the demo run names its sample rates, and its figures follow
// them. Mock mode, as an Owner, from Green Leaf Café's payroll.
import { expect, test, type Locator } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const GREEN = '0199c0f0-9c00-7000-8000-000000000001';

/** A summary amount in cents ("-$1,234.56" is 123456). */
async function amount(summary: Locator, label: string): Promise<number> {
  const text = await summary
    .getByText(label, { exact: true })
    .locator('xpath=following-sibling::dd[1]')
    .innerText();
  return Math.round(Number(text.replace(/[^0-9.]/g, '')) * 100);
}

/** The demo's taxes and benefits are the sample rates of gross pay, to the cent. */
async function expectSampleRates(summary: Locator) {
  const gross = await amount(summary, 'Gross Payroll');
  expect(gross).toBeGreaterThan(0);
  expect(await amount(summary, 'Employee Taxes')).toBe(Math.round(gross * 0.12));
  expect(await amount(summary, 'Employer Taxes')).toBe(Math.round(gross * 0.0765));
  expect(await amount(summary, 'Employer Benefits')).toBe(Math.round(gross * 0.038));
  return gross;
}

test('N01: the demo names its sample rates, and its taxes and benefits follow them as earnings change', async ({
  page,
}) => {
  await page.goto(`${app}/payroll/clients/${GREEN}`);
  await page.getByTestId('demo-run-link').click();
  await page.waitForURL(/\/payroll\/runs\/demo$/);
  const rates = 'employee taxes 12%, employer taxes 7.65%, benefits 3.8%';
  await expect(page.getByTestId('demo-sample')).toContainText(rates);
  const summary = page.getByTestId('run-summary');
  await expect(summary).toContainText(rates);
  await expect(summary).toContainText('That is an illustration, not a tax calculation');
  const before = await expectSampleRates(summary);

  // More earnings for one employee: more gross pay, and the sample taxes and benefits follow.
  await page
    .getByTestId('run-employees')
    .getByRole('button', { name: /^Edit (?!Selected$)/ })
    .first()
    .click();
  const other = page.getByRole('dialog').getByLabel('Other earnings ($)');
  await other.fill(String(Number((await other.inputValue()) || '0') + 250));
  await page.getByRole('button', { name: 'Save Line' }).click();
  await expect.poll(() => amount(summary, 'Gross Payroll')).toBeGreaterThan(before);
  await expectSampleRates(summary);
});
