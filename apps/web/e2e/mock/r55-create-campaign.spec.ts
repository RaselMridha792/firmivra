import { expect, test } from '@playwright/test';

// R55, Octavia's Leads review (Oct 20) item L7: Create Campaign beside Add New Lead and Add New
// Tag opens the Communications builder in a panel; starting makes a draft only (no lead added,
// nothing sent), and closing it leaves the Leads page with its filters and selection. In mock
// mode (playwright.mock.config.ts) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/leads`;

test('Create Campaign: the builder in a panel, a draft only, the page kept', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  const actions = page.getByTestId('add-lead').locator('..');
  await expect(actions.getByRole('button')).toHaveText([
    'Add New Tag',
    'Create Campaign',
    'Add New Lead',
  ]);
  // A filter and a selection to keep.
  await page.getByLabel('All Lead Sources').selectOption('WEBSITE_FORM');
  const table = page.getByRole('table', { name: 'Leads' });
  const firstRow = table.getByRole('row').nth(1);
  await firstRow.getByRole('checkbox').check();
  await expect(page.getByText('1 leads selected').first()).toBeVisible();

  await page.getByTestId('create-campaign').click();
  const panel = page.getByRole('dialog', { name: 'Create Campaign' });
  await expect(panel).toContainText('no lead is added by creating it');
  await panel.getByRole('button', { name: 'Email campaign' }).click();
  const composer = panel.getByTestId('composer');
  await expect(composer).toBeVisible();
  // The builder without its page: no breadcrumb or page title, a draft.
  await expect(composer.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(0);
  await expect(composer.getByRole('heading', { name: 'Create New Communication' })).toHaveCount(0);
  await expect(composer).toContainText('Draft');
  await composer.getByLabel('Campaign Name').fill('Spring Tax Reminders');
  await composer
    .getByRole('group', { name: 'Top actions' })
    .getByRole('button', {
      name: 'Save Draft',
    })
    .click();
  await composer.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(panel).toBeHidden();

  // The page as it was.
  await expect(page.getByLabel('All Lead Sources')).toHaveValue('WEBSITE_FORM');
  await expect(page.getByText('1 leads selected').first()).toBeVisible();
  await expect(firstRow.getByRole('checkbox')).toBeChecked();
});

test('no sideways scroll at 375 px with the panel open', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(url);
  await page.getByTestId('create-campaign').click();
  await page
    .getByRole('dialog', { name: 'Create Campaign' })
    .getByRole('button', { name: 'Email campaign' })
    .click();
  await expect(page.getByTestId('composer')).toBeVisible();
  const scroll = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(scroll).toBeLessThanOrEqual(0);
});
