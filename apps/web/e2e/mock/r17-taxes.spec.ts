import { expect, type Page, test } from '@playwright/test';

// N06 Tax Returns in mock mode. api.ts has no mock line for myTaxReturns or myProfile yet, so
// those routes are answered here with synthetic data; the payment card uses mocks/invoices.ts.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

const ret = (n: number, taxYear: number, extra: Record<string, unknown> = {}) => ({
  id: `0199b6d1-0000-7000-8000-00000000000${n}`,
  taxYear,
  filingType: 'INDIVIDUAL',
  quarter: null,
  formType: '1040',
  status: 'COMPLETED',
  filedOn: `${taxYear + 1}-04-12`,
  document: { id: `0199b6d2-0000-7000-8000-00000000000${n}`, fileName: `Return_${taxYear}.pdf` },
  ...extra,
});
const RETURNS = [
  ret(1, 2025, { status: 'IN_PROGRESS', filedOn: null, document: null }),
  ret(2, 2025, { quarter: 3, formType: '1040-ES', status: 'FILED', document: null }),
  ret(3, 2024),
  ret(4, 2023, { filingType: 'BUSINESS', formType: '1120-S' }),
];

async function stub(page: Page) {
  const asked: string[] = [];
  await page.route('**/api/v1/portal/lvp/me/tax-returns**', (route) => {
    const url = new URL(route.request().url());
    asked.push(url.search);
    const year = url.searchParams.get('taxYear');
    const kind = url.searchParams.get('kind');
    const type = url.searchParams.get('filingType');
    const items = RETURNS.filter(
      (r) =>
        (!year || r.taxYear === Number(year)) &&
        (!kind || (kind === 'quarterly') === (r.quarter !== null)) &&
        (!type || r.filingType === type),
    );
    return route.fulfill({ json: { items } });
  });
  await page.route('**/api/v1/portal/lvp/me/tax-years', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            taxYear: 2025,
            status: 'Waiting on documents',
            clientNote: 'Please upload your W-2.',
            updatedAt: '2026-10-01T12:00:00.000Z',
          },
          {
            taxYear: 2024,
            status: 'Filed',
            clientNote: null,
            updatedAt: '2026-04-12T12:00:00.000Z',
          },
        ],
      },
    }),
  );
  return asked;
}

test('tax returns by year and kind, the firm status per year, and the payment card', async ({
  page,
}, testInfo) => {
  const asked = await stub(page);
  await page.goto(portal('/lvp/taxes'));
  await expect(page).toHaveTitle('Tax Returns');
  const table = page.getByRole('table', { name: 'Your tax returns' });
  await expect(table).toContainText('2025 Q3');
  await expect(table).toContainText('In Progress');
  await expect(table.getByRole('button', { name: 'Download Return_2024.pdf' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Tax year status' })).toContainText(
    'Please upload your W-2.',
  );
  await expect(page.getByText('Payment Due')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('taxes-1440.png'), fullPage: true });

  await page.getByRole('button', { name: /Annual Business Taxes/ }).click();
  await expect(table).toContainText('1120-S');
  await expect(table).not.toContainText('1040');
  expect(asked.at(-1)).toContain('filingType=BUSINESS');

  await page.getByRole('button', { name: /Annual Business Taxes/ }).click();
  await page.getByLabel('Tax Year', { exact: true }).selectOption('2024');
  await expect(table).not.toContainText('2025 Q3');
  await expect(table).toContainText('2024');

  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('taxes-375.png'), fullPage: true });
});
