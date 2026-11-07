import { expect, test, type Page } from '@playwright/test';

// R60, Octavia's Oct 28 Templates review, TP-F01 (playwright.mock.config.ts, as an Owner; the mock
// answers as the API): the overview's and a library's view stay in the address, and the editor's
// Cancel, its breadcrumb, browser Back and Use's Back return to that exact list, in the same tab.
// A reload resets the mock, so each test starts fresh.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const base = `${app}/templates`;
// Octavia's review width.
test.use({ viewport: { width: 1440, height: 1000 } });

const filters = (page: Page) => page.getByRole('form', { name: 'Template filters' });
const firstRow = (page: Page) =>
  page.getByTestId('library-table').getByTestId('template-link').first();

test('Create from a filtered overview: Cancel returns to the overview as it was, not a library', async ({
  page,
}) => {
  await page.goto(base);
  await page.getByRole('tab', { name: /^My Templates/ }).click();
  await page.getByPlaceholder('Search templates...').fill('Reminder');
  await expect(page).toHaveURL(`${base}?view=mine&q=Reminder`);
  const overview = page.url();

  await page.getByRole('link', { name: 'Create Email Template', exact: true }).click();
  await expect(page).toHaveURL(/\/templates\/new\?from=%2Ftemplates%3Fview%3Dmine%26q%3DReminder$/);
  await expect(page.getByTestId('back-to-origin')).toHaveText('Back to Templates');
  await page.getByLabel('Template Name *').fill('Dummy text');
  await page.getByRole('link', { name: 'Cancel' }).click();
  await page
    .getByRole('dialog', { name: 'Leave without saving?' })
    .getByRole('button', { name: 'Discard' })
    .click();

  await expect(page).toHaveURL(overview);
  await expect(page.getByRole('tab', { name: /^My Templates/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByPlaceholder('Search templates...')).toHaveValue('Reminder');
});

test('A filtered library: browser Back, Cancel and the breadcrumb open the same list, page and place', async ({
  page,
}) => {
  await page.goto(`${base}/library/email`);
  await filters(page).getByLabel('Status', { exact: true }).selectOption('ACTIVE');
  await filters(page).getByLabel('Sort').selectOption('name');
  await page.getByRole('navigation', { name: 'Pagination' }).getByLabel('Page 2').click();
  await expect(page).toHaveURL(/\/library\/email\?status=ACTIVE&sort=name&page=2$/);
  const list = page.url();
  const first = await firstRow(page).textContent();
  const check = async () => {
    await expect(page).toHaveURL(list);
    await expect(filters(page).getByLabel('Status', { exact: true })).toHaveValue('ACTIVE');
    await expect(filters(page).getByLabel('Sort')).toHaveValue('name');
    await expect(page.getByLabel('Page 2')).toHaveAttribute('aria-current', 'page');
    await expect(firstRow(page)).toHaveText(first ?? '');
  };

  // Edit, then the browser's Back.
  await firstRow(page).click();
  await expect(page.getByTestId('template-editor')).toBeVisible();
  await expect(page.getByTestId('back-to-origin')).toHaveText('Back to Template Library');
  await page.goBack();
  await check();

  // Edit, then Cancel: the list comes back where it was scrolled to.
  await page.evaluate(() => window.scrollTo(0, 300));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(250);
  await firstRow(page).click();
  await expect(page.getByTestId('template-editor')).toBeVisible();
  await page.getByRole('link', { name: 'Cancel' }).click();
  await check();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(250);

  // Edit, then the breadcrumb's Email Templates.
  await firstRow(page).click();
  await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Email Templates' })
    .click();
  await check();
});

test('A tag and a search survive Edit and Back; Use keeps its Back to the list', async ({
  page,
}) => {
  await page.goto(`${base}/library/email`);
  await filters(page).getByLabel('Tag').selectOption('Reminder');
  await page.getByPlaceholder('Search templates...').fill('Tax Season');
  await expect(page).toHaveURL(/\/library\/email\?tag=Reminder&q=Tax\+Season$/);
  const list = page.url();
  await firstRow(page).click();
  await expect(page.getByTestId('template-editor')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(list);
  await expect(filters(page).getByLabel('Tag')).toHaveValue('Reminder');
  await expect(page.getByPlaceholder('Search templates...')).toHaveValue('Tax Season');

  // Use opens a Communications draft; its Back returns to this list.
  await page.getByRole('link', { name: 'Use Tax Season Reminder (2026)' }).click();
  await expect(page).toHaveURL(
    /\/communications\/[0-9a-f-]{36}\/edit\?from=%2Ftemplates%2Flibrary%2Femail%3F/,
  );
  await expect(page.getByTestId('back-to-origin')).toHaveText('Back to Template Library');
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(list);
  await expect(page.getByPlaceholder('Search templates...')).toHaveValue('Tax Season');
  await expect(filters(page).getByLabel('Tag')).toHaveValue('Reminder');
});
