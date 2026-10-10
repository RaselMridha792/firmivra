import { expect, test } from '@playwright/test';
import { clientFixtures } from '../../src/mocks/clients';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/clients/0199b6a1-0000-7000-8000-000000000001/documents`;
test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/business/clients/0199b6a1-0000-7000-8000-000000000001', (route) =>
    route.fulfill({ json: clientFixtures()[0] }),
  );
});

test('manual documents preview', async ({ page }) => {
  test.skip(process.env['FAHAD_MANUAL'] !== '1', 'Opt-in manual preview');
  test.setTimeout(0);
  await page.setViewportSize({ width: Number(process.env['FAHAD_WIDTH'] ?? 1440), height: 1000 });
  await page.goto(url);
  await expect(page.getByTestId('client-documents-screen')).toBeVisible();
  await page.pause();
});

for (const width of [375, 768, 1024, 1440]) {
  test(`documents fit ${width}px and filters return an empty state`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(url);
    const list = page.getByTestId(
      width < 768 ? 'documents-mobile-cards' : 'client-documents-table',
    );
    await expect(list).toContainText('W-2_2025.pdf');
    await expect(
      list.getByRole('button', { name: 'Download W-2_2025.pdf', exact: true }),
    ).toBeEnabled();
    await expect(
      list.getByRole('button', { name: 'Download 1099-NEC_2025.pdf', exact: true }),
    ).toBeDisabled();
    await expect(page.getByTestId('documents-previous')).toBeVisible();
    await expect(page.getByTestId('documents-next')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (width >= 768) {
      expect(
        await list.evaluate((el) =>
          [...el.querySelectorAll('div')].every((d) => d.scrollWidth <= d.clientWidth),
        ),
      ).toBe(true);
    }
    await page.screenshot({ path: info.outputPath(`documents-${width}.png`), fullPage: true });
    await page.getByTestId('document-year-filter').selectOption('2024');
    await expect(list).toContainText('Tax_Return_2024.pdf');
    await page.getByTestId('document-category-filter').selectOption({ label: 'Identification' });
    await expect(page.getByText('No documents match these filters.')).toBeVisible();
  });
}

for (const [status, code, state] of [
  [403, 'FORBIDDEN', 'page-forbidden'],
  [500, 'INTERNAL_ERROR', 'page-error'],
] as const) {
  test(`documents shows ${state} when client access fails`, async ({ page }) => {
    await page.route('**/api/v1/business/clients/0199b6a1-0000-7000-8000-000000000001', (route) =>
      route.fulfill({ status, json: { error: { code, message: 'Unable to open this client.' } } }),
    );
    await page.goto(url);
    await expect(page.getByTestId(state)).toBeVisible();
  });
}

test('request validation, creation, accept and missing reason', async ({ page }) => {
  await page.goto(url);
  const requests = page.getByTestId('requests-desktop-table');
  await expect(requests).toContainText('We had no childcare costs this year.');
  await page.getByTestId('request-document-open').click();
  await page.getByTestId('request-submit').click();
  await expect(page.getByTestId('request-service')).toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('request-service').selectOption({ index: 1 });
  await page.getByRole('dialog').getByTestId('request-title').fill('Quarterly expense receipts');
  await page.getByTestId('request-submit').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(requests).toContainText('Quarterly expense receipts');
  await requests
    .getByRole('button', { name: 'Accept W-2 from your employer', exact: true })
    .click();
  await expect(
    requests.getByRole('row').filter({ hasText: 'W-2 from your employer' }),
  ).toContainText('Accepted');
  await requests
    .getByRole('button', { name: 'Mark 1099-NEC for your contract work missing', exact: true })
    .click();
  await page.getByTestId('missing-submit').click();
  await expect(page.getByTestId('missing-reason')).toHaveAttribute('aria-invalid', 'true');
  await page.getByTestId('missing-reason').fill('Please include all pages.');
  await page.getByTestId('missing-submit').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(requests).toContainText('Please include all pages.');
});
