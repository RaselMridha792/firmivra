import { expect, test } from '@playwright/test';

// F08 part 1 uses api.leads' existing mock; all fixtures are synthetic.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const origin = `http://app.localhost:${port}`;
const url = `${origin}/leads`;

test('lists submissions newest first and each complete row opens its lead', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await expect(page).toHaveTitle(/^Leads/);
  await expect(page.getByTestId('mock-badge')).toBeVisible();
  await expect(page.getByTestId('page-title')).toHaveText('Leads');
  await expect(page.getByTestId('lead-name')).toHaveText([
    'Casey Demo',
    'Blake Example',
    'Avery Sample',
  ]);
  const rows = page.getByTestId('lead-row');
  const dates = await rows
    .locator('time')
    .evaluateAll((elements) =>
      elements.map((element) => Date.parse(element.getAttribute('datetime')!)),
    );
  expect(dates).toEqual([...dates].sort((a, b) => b - a));
  for (const row of await rows.all()) {
    await expect(row.getByRole('link')).toHaveAttribute('href', /^\/leads\/[0-9a-f-]{36}$/);
  }
  await expect(page.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath('leads-desktop.png'), fullPage: true });
  const target = await rows.first().getByRole('link').getAttribute('href');
  await rows.first().getByRole('link').click();
  await expect(page).toHaveURL(`${origin}${target}`);
});

test('all four status filters use API statuses and an empty filter can be cleared', async ({
  page,
}) => {
  await page.goto(url);
  const filter = page.getByRole('combobox', { name: 'Filter by status' });
  const cases = [
    { label: 'New', status: 'SUBMITTED', name: 'Avery Sample' },
    { label: 'Reviewed', status: 'IN_REVIEW', name: 'Blake Example' },
    { label: 'Declined', status: 'DECLINED', name: 'Casey Demo' },
  ];
  for (const item of cases) {
    await filter.selectOption({ label: item.label });
    await expect(page.getByTestId('lead-name')).toHaveText([item.name]);
    await expect(page.getByTestId('lead-row')).toHaveAttribute('data-status', item.status);
    await expect(page.getByTestId('lead-row')).toContainText(item.label);
  }
  await filter.selectOption({ label: 'Converted' });
  await expect(page.getByTestId('page-empty')).toHaveText('No converted leads.');
  await expect(page.getByTestId('lead-row')).toHaveCount(0);
  await filter.selectOption({ label: 'All statuses' });
  await expect(page.getByTestId('lead-row')).toHaveCount(3);
});

test('the leads list and its status filter fit a 375 px screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(url);
  await expect(page.getByTestId('lead-row')).toHaveCount(3);
  await expect(page.getByRole('combobox', { name: 'Filter by status' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.screenshot({ path: test.info().outputPath('leads-mobile.png'), fullPage: true });
  await page.getByRole('combobox', { name: 'Filter by status' }).selectOption({ label: 'New' });
  await expect(page.getByTestId('lead-name')).toHaveText(['Avery Sample']);
});
