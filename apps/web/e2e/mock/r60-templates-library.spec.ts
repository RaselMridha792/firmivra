import { expect, test, type Page } from '@playwright/test';

// R60, Octavia's Oct 28 Templates review: the library (TP-F03, F10, F12 to F15) in mock mode, as an
// Owner. "Private Draft Idea" is a draft, "Referral Thank You" was used 9 times, and "Tax Season
// Reminder (2026)" is used by an automation. A reload resets the mock, so each test starts fresh.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/templates`;
// Octavia's review width.
test.use({ viewport: { width: 1440, height: 1000 } });

const library = async (page: Page, search?: string) => {
  await page.goto(`${base}/library/email`);
  await expect(page.getByTestId('library-page')).toBeVisible();
  if (search) await page.getByPlaceholder('Search templates...').fill(search);
};
const row = (page: Page, name: string) =>
  page
    .getByTestId('library-table')
    .getByRole('row', { name: new RegExp(name.replace(/[()]/g, '\\$&')) });
const shown = (page: Page, text: string | RegExp) => page.getByText(text).filter({ visible: true });

test('the status filter says Non-archived; tags and who updated show; Use is off for a draft, with why (TP-F12, F14, F15)', async ({
  page,
}) => {
  await library(page);
  await expect(page.getByLabel('Status', { exact: true }).locator('option:checked')).toHaveText(
    'Non-archived',
  );
  // Below 2xl (this 1440 px window) the tags sit under the category, the subject under
  // the name and the owner under who updated it, and the actions stay in view.
  await expect(page.getByTestId('row-tags').first()).toBeVisible();
  await expect(page.getByTestId('row-subject').first()).toContainText('Subject:');
  await expect(page.getByTestId('updated-by').first()).toHaveText(/^by \S/);
  await expect(page.getByRole('button', { name: /^Preview / }).first()).toBeInViewport();

  await page.getByPlaceholder('Search templates...').fill('Private Draft Idea');
  const use = row(page, 'Private Draft Idea').getByRole('button', {
    name: 'Use Private Draft Idea',
  });
  await expect(use).toHaveAttribute('aria-disabled', 'true');
  await expect(use).toHaveAccessibleDescription(/A draft cannot be used yet/);
  // Use is aria-disabled, which Playwright waits on; a person can still press it for the reason.
  await use.click({ force: true });
  await expect(shown(page, /A draft cannot be used yet\. Activate it/)).toBeVisible();
  await expect(page).toHaveURL(/\/templates\/library\/email$/);

  await page.getByPlaceholder('Search templates...').fill('Tax Season Reminder (2026)');
  await expect(
    row(page, 'Tax Season Reminder (2026)').getByRole('link', {
      name: 'Use Tax Season Reminder (2026)',
    }),
  ).toHaveAttribute('href', /\/communications\/new\?channel=EMAIL&template=/);
});

test('Archive asks first with the name and its use; Keep keeps it; archived, Use is off (TP-F10, F13)', async ({
  page,
}) => {
  await library(page, 'Referral Thank You');
  const actions = page.getByRole('button', { name: 'Actions for Referral Thank You' });
  await actions.click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  const dialog = page.getByRole('dialog', { name: 'Archive template?' });
  await expect(dialog).toContainText('Referral Thank You');
  await expect(dialog.getByTestId('archive-usage')).toHaveText(/^Used 9 times/);
  await expect(dialog).toContainText('Restore brings it back as a draft');
  await dialog.getByRole('button', { name: 'Keep' }).click();
  await expect(dialog).toBeHidden();
  await expect(row(page, 'Referral Thank You')).toBeVisible();

  await actions.click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await dialog.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(shown(page, 'Referral Thank You archived.')).toBeVisible();
  await expect(row(page, 'Referral Thank You')).toHaveCount(0);

  await page.getByLabel('Status', { exact: true }).selectOption('ARCHIVED');
  const use = row(page, 'Referral Thank You').getByRole('button', {
    name: 'Use Referral Thank You',
  });
  await expect(use).toHaveAttribute('aria-disabled', 'true');
  // Use is aria-disabled, which Playwright waits on; a person can still press it for the reason.
  await use.click({ force: true });
  await expect(shown(page, /An archived template cannot be used/)).toBeVisible();
});

test('an automation’s template warns in the same question (TP-F10)', async ({ page }) => {
  await library(page, 'Tax Season Reminder (2026)');
  await page.getByRole('button', { name: 'Actions for Tax Season Reminder (2026)' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  const dialog = page.getByRole('dialog', { name: 'Archive template?' });
  await expect(dialog.getByTestId('automation-warning')).toHaveText(
    '1 active automation uses it. Archiving it stops them from sending it.',
  );
  await dialog.getByRole('button', { name: 'Archive Anyway' }).click();
  await expect(shown(page, 'Tax Season Reminder (2026) archived.')).toBeVisible();
});

test('bulk Archive names the templates and asks first (TP-F10)', async ({ page }) => {
  await library(page);
  const boxes = page.getByTestId('library-table').getByRole('checkbox', { name: /^Select row / });
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Archive 2 templates?' });
  await expect(dialog.getByRole('listitem')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Keep' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await dialog.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(shown(page, /^2 archived/)).toBeVisible();
});

test('the categories heading counts categories; All Categories adds up with Uncategorized (TP-F03)', async ({
  page,
}) => {
  await library(page, 'Tax Season Reminder (2026)');
  await row(page, 'Tax Season Reminder (2026)').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Category', exact: true }).click();
  const pick = page.getByRole('dialog', { name: 'Set Category' });
  await pick.getByLabel('Category').selectOption({ label: 'No category' });
  await pick.getByRole('button', { name: 'Apply' }).click();
  await expect(shown(page, /^1 updated/)).toBeVisible();

  const sidebar = page.getByTestId('category-sidebar');
  const uncategorized = sidebar.getByRole('button', { name: /^Uncategorized\s*1 templates$/ });
  await expect(uncategorized).toBeVisible();
  // Every row's count, All Categories first and Uncategorized last: the rest add up to the first.
  const counts = (await sidebar.getByRole('button', { name: / templates$/ }).allTextContents()).map(
    (t) => Number(/(\d+) templates$/.exec(t)?.[1]),
  );
  expect(counts.at(-1)).toBe(1);
  expect(counts[0]).toBe(counts.slice(1).reduce((a, b) => a + b, 0));
  await expect(page.getByTestId('category-count')).toHaveText(`${counts.length - 2} categories`);

  await page.getByPlaceholder('Search templates...').fill('');
  await uncategorized.click();
  await expect(page.getByTestId('template-link')).toHaveText(['Tax Season Reminder (2026)']);
});

test('Recent rows name the category and who updated each (TP-F15)', async ({ page }) => {
  await page.goto(base);
  const meta = page.getByTestId('recent-meta');
  await expect(meta.first()).toBeVisible();
  await expect(meta.first()).toHaveText(/^.+ · Updated by \S/);
  // The draft among them keeps Use, switched off.
  await expect(page.getByTestId('recent').getByTestId('use-blocked')).toHaveCount(1);
});
