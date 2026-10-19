import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://admin.localhost:${port}/communications/templates`;

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', (route) => route.abort());
  await page.setViewportSize({ width: 1440, height: 1024 });
});

test('templates search, filters, pagination and selection update the library', async ({ page }) => {
  await page.goto(url);
  await expect(page).toHaveTitle('Communication templates');
  const library = page.getByTestId('templates-library');
  await expect(library.locator('tbody tr')).toHaveCount(10);
  await expect(page.getByRole('tab', { name: 'All Templates (24)', exact: true })).toBeVisible();
  await library.getByRole('button', { name: 'Page 3', exact: true }).click();
  await expect(library.locator('tbody tr')).toHaveCount(4);
  await page.getByRole('tab', { name: 'Sales (6)', exact: true }).click();
  await expect(library.locator('tbody tr')).toHaveCount(6);
  await page.getByLabel('Search templates').fill('Meeting');
  await expect(library.locator('tbody tr')).toHaveCount(1);
  await library.getByRole('button', { name: /^Meeting Confirmation/ }).click();
  const details = page.getByRole('complementary', { name: 'Selected template' });
  await expect(details.getByRole('heading', { name: 'Meeting Confirmation' })).toBeVisible();
  await expect(details.getByText('Subject:', { exact: true })).toHaveCount(0);
  await details.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Your meeting is confirmed');
  await page.keyboard.press('Escape');
  await details.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(details.getByRole('heading', { name: 'Meeting Confirmation (Copy)' })).toBeVisible();
  await details.getByRole('button', { name: 'Archive', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive in preview' }).click();
  await page.getByLabel('Status', { exact: true }).selectOption('Archived');
  await expect(library.locator('tbody tr')).toHaveCount(1);
  await expect(details.getByRole('button', { name: 'Archive', exact: true })).toBeDisabled();
});

test('templates preserve the panels in empty, API-unavailable and forbidden states', async ({
  page,
}) => {
  for (const [state, notice] of [
    ['empty', 'page-empty'],
    ['api-unavailable', 'page-error'],
    ['forbidden', 'page-forbidden'],
  ]) {
    await page.goto(`${url}?mockState=${state}`);
    await expect(page.getByTestId(notice!)).toBeVisible();
    await expect(page.getByTestId('templates-library')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Template Details' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Message Preview' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeDisabled();
    if (state !== 'forbidden') {
      await page.screenshot({
        path: test.info().outputPath(`templates-${state}-1440.png`),
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
});

test('templates remain usable at tablet and mobile widths', async ({ page }) => {
  await page.goto(url);
  await expect(page.getByRole('tab', { name: 'All Templates (24)', exact: true })).toBeVisible();
  for (const width of [1440, 1024, 768, 375]) {
    await page.setViewportSize({ width, height: 1024 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(page.getByRole('heading', { name: 'Template Details' })).toBeVisible();
    const tabs = page.getByRole('tablist', { name: 'Template categories' });
    expect(await tabs.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(
      true,
    );
    expect(
      await tabs.evaluate((element) => {
        const selected = element.querySelector('[aria-selected="true"]');
        return (
          !!selected &&
          selected.getBoundingClientRect().bottom <= element.getBoundingClientRect().bottom
        );
      }),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`templates-data-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    });
  }
});
