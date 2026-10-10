import { expect, test } from '@playwright/test';

// The Tax Bracket Calculator in mock mode (Octavia's Calculator_Tax_Bracket_Guide.pdf). The numbers
// are synthetic; the golden case is the guide's own example: Single, $75,000, standard deduction.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('the hub opens the calculator, which shows the filing status brackets and one golden case', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal('/lvp/calculator'));
  await page.getByRole('link', { name: /Tax Bracket/ }).click();
  await expect(page).toHaveURL(portal('/lvp/calculator/tax-bracket'));

  // The bracket table follows the filing status, before any calculation.
  await expect(page.getByText('$0 – $12,400')).toBeVisible();
  await page.getByLabel('Filing Status').selectOption('HEAD_OF_HOUSEHOLD');
  await expect(page.getByText('$0 – $17,700')).toBeVisible();
  await page.getByLabel('Filing Status').selectOption('SINGLE');
  await expect(page.getByText('2026 Standard Deduction Applied: $16,100')).toBeVisible();

  await page.getByLabel('Annual Income').fill('75000');
  await page.getByRole('button', { name: 'Calculate My 2026 Federal Tax' }).click();
  const result = page.getByTestId('tax-bracket-result');
  await expect(result.getByText('$58,900')).toBeVisible();
  await expect(result.getByText('22%')).toBeVisible();
  await expect(result.getByText('$7,670')).toBeVisible();
  await expect(result.getByText('13.0%')).toBeVisible();
  await expect(page.getByText(/estimate of 2026 federal individual income tax/)).toBeVisible();

  // Refused input shows a message and no result; Start Over clears the form.
  await page.getByLabel('Annual Income').fill('abc');
  await page.getByRole('button', { name: 'Calculate My 2026 Federal Tax' }).click();
  await expect(page.getByText(/positive numbers/)).toBeVisible();
  await expect(result).toHaveCount(0);
  await page.getByRole('button', { name: 'Start Over' }).click();
  await expect(page.getByLabel('Annual Income')).toHaveValue('');
});

test('the public pages open without signing in and give the same estimate', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal('/lvp/calculators'));
  await page.getByRole('link', { name: /Tax Bracket/ }).click();
  await expect(page).toHaveURL(portal('/lvp/calculators/tax-bracket'));
  await page.getByLabel('Annual Income').fill('75000');
  await page.getByRole('button', { name: 'Calculate My 2026 Federal Tax' }).click();
  await expect(page.getByTestId('tax-bracket-result').getByText('$7,670')).toBeVisible();
});

test('the quarterly calculator gives the hand-worked self-employed case', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal('/lvp/calculators/quarterly-estimate'));
  await expect(
    page.getByRole('button', { name: 'My Income Varies During the Year' }),
  ).toBeDisabled();
  await page.getByLabel('Gross Business Income (if self-employed)').fill('100000');
  await page.getByLabel('Business Expenses').fill('20000');
  await page.getByRole('button', { name: 'Calculate My Estimated Tax Payment' }).click();
  const result = page.getByTestId('quarterly-result');
  // Total tax $18,831; 90% = $16,948; a quarter of it = $4,237; a quarter of the total = $4,708.
  await expect(result.getByText('$4,237')).toBeVisible();
  await expect(result.getByText('$4,708')).toBeVisible();
  await expect(result.getByText('$18,831')).toBeVisible();
});

test('the tax return estimator gives a refund for the $75,000 wage case', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal('/lvp/calculators/tax-return'));
  await page.getByLabel('W-2 Wages').fill('75000');
  await page.getByLabel('Federal Income Tax Withheld').fill('9000');
  await page.getByRole('button', { name: 'Get My Tax Estimate' }).click();
  const result = page.getByTestId('tax-return-result');
  await expect(result.getByText('Estimated Federal Refund')).toBeVisible();
  await expect(result.getByText('$1,330')).toBeVisible();
  await expect(result.getByText('$7,670').first()).toBeVisible();
  await page.getByLabel('W-2 Wages').fill('75000');
  await page.getByLabel('Federal Income Tax Withheld').fill('5000');
  await page.getByRole('button', { name: 'Get My Tax Estimate' }).click();
  await expect(result.getByText('Estimated Federal Amount Due')).toBeVisible();
  await expect(result.getByText('$2,670')).toBeVisible();
});
