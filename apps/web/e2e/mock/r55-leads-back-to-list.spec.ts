import { expect, test } from '@playwright/test';

// R55, Leads Review Two R2 1a: Back to Leads on a lead returns to the list as it was left: its
// search, filters, page size and page. Mock mode as the Owner (12 leads, newest first). Synthetic
// data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('R2 1a: Back to Leads keeps the search, a filter, the page size and the page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/leads`);
  const table = page.getByRole('table', { name: 'Leads' });
  const rows = table.locator('tbody tr');
  const pager = page.getByRole('navigation', { name: 'Pagination' });
  const search = page.getByRole('searchbox', { name: 'Search leads' });
  const source = page.getByRole('combobox', { name: 'All Lead Sources' });
  await expect(rows).toHaveCount(8);

  // Search, a filter and a page size, then a lead and back.
  await pager.locator('select').selectOption('16');
  await source.selectOption('INSTAGRAM');
  await search.fill('Bruno');
  await expect(rows).toHaveCount(1);
  await table.getByRole('link', { name: /Bruno Sandoval/ }).click();
  await expect(page.getByTestId('lead-name')).toHaveText('Bruno Sandoval');
  await page.getByRole('link', { name: 'Back to Leads' }).click();
  await expect(search).toHaveValue('Bruno');
  await expect(source).toHaveValue('INSTAGRAM');
  await expect(pager.locator('select')).toHaveValue('16');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Bruno Sandoval');

  // The page: a lead opened from page 2 returns to page 2.
  await page.getByRole('button', { name: 'Reset' }).click();
  await pager.locator('select').selectOption('8');
  await pager.getByRole('button', { name: 'Page 2' }).click();
  await expect(rows.first()).toContainText('Marco Diaz');
  await table.getByRole('link', { name: /Clara Voss/ }).click();
  await expect(page.getByTestId('lead-name')).toHaveText('Clara Voss');
  await page.getByRole('link', { name: 'Back to Leads' }).click();
  await expect(pager.getByRole('button', { name: 'Page 2' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(pager).toContainText('Showing 9 – 12 of 12 leads');
  await expect(rows.first()).toContainText('Marco Diaz');
});
