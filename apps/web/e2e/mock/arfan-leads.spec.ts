import { expect, test, type Page } from '@playwright/test';

// F08 part 1; all fixtures are synthetic. Updated (R1, Oct 21) to the redesigned list, which reads
// api.leadPipeline's mock (12 leads, newest first, a page at a time): the Leads table, the
// "All Lead Statuses" stage filter and the kit pager.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const origin = `http://app.localhost:${port}`;
const url = `${origin}/leads`;

const table = (page: Page) => page.getByRole('table', { name: 'Leads' });
/** Each row's link to its lead (the Name cell). */
const leadLinks = (page: Page) => table(page).locator('tbody tr a[href^="/leads/"]');
const stageFilter = (page: Page) => page.getByRole('combobox', { name: 'All Lead Statuses' });

test('lists submissions newest first and each complete row opens its lead', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await expect(page).toHaveTitle(/^Leads/);
  await expect(page.getByTestId('mock-badge')).toBeVisible();
  await expect(page.getByTestId('page-title')).toHaveText('Leads');
  await expect(leadLinks(page).first()).toBeVisible();
  // Date Added is the one <time> with a title (Last Contact and Next Action have none).
  const dates = await table(page)
    .locator('tbody tr time[title]')
    .evaluateAll((elements) =>
      elements.map((element) => Date.parse(element.getAttribute('datetime')!)),
    );
  expect(dates).toEqual([...dates].sort((a, b) => b - a));
  for (const link of await leadLinks(page).all()) {
    await expect(link).toHaveAttribute('href', /^\/leads\/[0-9a-f-]{36}$/);
  }
  await expect(page.getByRole('button', { name: 'Previous', exact: true })).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath('leads-desktop.png'), fullPage: true });
  const target = await leadLinks(page).first().getAttribute('href');
  await leadLinks(page).first().click();
  await expect(page).toHaveURL(`${origin}${target}`);
});

test('the stage filter uses API stages and an empty filter can be cleared', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url);
  await expect(leadLinks(page).first()).toBeVisible();
  const all = await leadLinks(page).count();
  const cases = [
    { label: 'Not Qualified', name: 'Jonah Yates' },
    { label: 'Qualified', name: 'Ravi Greenwood' },
    { label: 'Converted', name: 'Lena Brooks' },
  ];
  for (const item of cases) {
    await stageFilter(page).selectOption({ label: item.label });
    await expect(leadLinks(page)).toHaveText([new RegExp(item.name)]);
    await expect(table(page).locator('tbody tr')).toContainText(item.label);
  }
  await stageFilter(page).selectOption({ label: 'In Review' });
  await expect(page.getByText('No leads match these filters')).toBeVisible();
  await expect(leadLinks(page)).toHaveCount(0);
  await stageFilter(page).selectOption({ label: 'All Lead Statuses' });
  await expect(leadLinks(page)).toHaveCount(all);
});

test('the leads list and its stage filter fit a 375 px screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(url);
  await expect(leadLinks(page).first()).toBeVisible();
  await expect(stageFilter(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.screenshot({ path: test.info().outputPath('leads-mobile.png'), fullPage: true });
  await stageFilter(page).selectOption({ label: 'Not Qualified' });
  await expect(leadLinks(page)).toHaveText([/Jonah Yates/]);
});
