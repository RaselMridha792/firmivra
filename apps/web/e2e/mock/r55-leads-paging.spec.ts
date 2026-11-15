import { expect, test } from '@playwright/test';

// R55, Leads Review Two row 22a: the Leads list moves across pages and takes each page size (8,
// 16, 24). The mock has 12 leads, newest first. Mock mode as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('22a: Next, Previous and a page number move across the pages; each page size shows that many', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/leads`);
  const rows = page.getByRole('table', { name: 'Leads' }).locator('tbody tr');
  const pager = page.getByRole('navigation', { name: 'Pagination' });
  const size = pager.locator('select');
  await expect(rows).toHaveCount(8);
  await expect(pager).toContainText('Showing 1 – 8 of 12 leads');
  await expect(rows.first()).toContainText('Avery Lawson');
  await expect(pager.getByRole('button', { name: 'Previous' })).toBeDisabled();

  await pager.getByRole('button', { name: 'Next' }).click();
  await expect(pager).toContainText('Showing 9 – 12 of 12 leads');
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText('Marco Diaz');
  await expect(pager.getByRole('button', { name: 'Page 2' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(pager.getByRole('button', { name: 'Next' })).toBeDisabled();

  await pager.getByRole('button', { name: 'Previous' }).click();
  await expect(pager).toContainText('Showing 1 – 8 of 12 leads');
  await pager.getByRole('button', { name: 'Page 2' }).click();
  await expect(rows).toHaveCount(4);

  // A new page size starts again on page 1.
  await size.selectOption('16');
  await expect(pager).toContainText('Showing 1 – 12 of 12 leads');
  await expect(rows).toHaveCount(12);
  await expect(pager.getByRole('button', { name: 'Page 2' })).toHaveCount(0);
  await size.selectOption('24');
  await expect(size).toHaveValue('24');
  await expect(rows).toHaveCount(12);
  await size.selectOption('8');
  await expect(rows).toHaveCount(8);
  await expect(pager.getByRole('button', { name: 'Page 1' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});
