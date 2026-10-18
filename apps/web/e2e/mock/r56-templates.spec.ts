import { expect, test, type Page } from '@playwright/test';

// R56: the Templates module in mock mode (playwright.mock.config.ts runs every module on mock
// data, as an Owner). 48 starter templates are installed; "Tax Season Reminder (2026)" is used by
// an automation, and "Private Draft Idea" holds an unknown merge field.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/templates`;

const openFirst = async (page: Page, name: string) => {
  await page.goto(`${base}/library/email`);
  await page.getByRole('link', { name, exact: true }).first().click();
  await page.waitForURL(/\/edit$/);
  await expect(page.getByTestId('template-editor')).toBeVisible();
};

test('Home: sixteen kinds with counts, recent templates, tools and tips', async ({ page }) => {
  await page.goto(base);
  await expect(page.getByRole('heading', { name: 'Templates', level: 1 })).toBeVisible();
  await expect(page.getByRole('tablist', { name: 'Template views' }).getByRole('tab')).toHaveCount(
    4,
  );
  await expect(page.getByTestId('kind-cards').getByRole('listitem')).toHaveCount(16);
  await expect(page.getByTestId('kind-email')).toContainText('templates');
  await expect(page.getByTestId('recent').getByRole('link', { name: /^Use / })).toHaveCount(5);
  await expect(page.getByTestId('recent')).toContainText('Recent Templates');
  await expect(page.getByTestId('tools').getByRole('button')).toHaveCount(4);
  await expect(page.getByTestId('tips')).toContainText('merge fields');
});

test('Home: tabs, search and the all-templates list', async ({ page }) => {
  await page.goto(base);
  await page.getByRole('tab', { name: 'Favorites' }).click();
  await expect(page.getByTestId('home-results')).toBeVisible();
  await expect(page.getByTestId('home-results').getByTestId('template-link').first()).toBeVisible();
  await page.getByRole('tab', { name: 'All Templates' }).click();
  await page.getByLabel('Search templates').fill('invoice issued');
  await expect(page.getByTestId('home-results').getByTestId('template-link')).toHaveCount(1);
  await page.getByLabel('Search templates').fill('');
  await expect(page.getByTestId('kind-cards')).toBeVisible();
  await page.getByRole('button', { name: /View All/ }).click();
  await expect(page.getByTestId('home-results')).toBeVisible();
  await page.getByRole('button', { name: 'Back to all kinds' }).click();
  await expect(page.getByTestId('kind-cards')).toBeVisible();
});

test('Tools: a custom merge field, branding, a category and an import', async ({ page }) => {
  await page.goto(base);
  await page
    .getByTestId('tools')
    .getByRole('button', { name: /Merge Fields/ })
    .click();
  await expect(page.getByTestId('merge-fields-dialog')).toContainText('[Client First Name]');
  await page.getByRole('button', { name: '+ Add a custom field' }).click();
  await page.getByLabel('Field name (letters, digits, single spaces)').fill('Referral Code');
  await page.getByLabel('Label', { exact: true }).fill('Referral code');
  await page.getByRole('button', { name: 'Save Field' }).click();
  await expect(page.getByTestId('merge-fields-dialog')).toContainText('[Referral Code]');
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await page
    .getByTestId('tools')
    .getByRole('button', { name: /Branding/ })
    .click();
  await page.getByLabel('Footer text').fill('Our footer');
  await page.getByRole('button', { name: 'Save Branding' }).click();
  await expect(page.getByText('Branding saved.')).toBeVisible();

  await page
    .getByTestId('tools')
    .getByRole('button', { name: /Template Categories/ })
    .click();
  await page.getByLabel('New category').fill('Referrals');
  await page.getByRole('button', { name: 'Add Category' }).click();
  await expect(page.getByTestId('categories-dialog')).toContainText('Referrals');
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await page
    .getByTestId('tools')
    .getByRole('button', { name: /Import Template/ })
    .click();
  await page.getByLabel('Template name').fill('Imported letter');
  await page.getByLabel('Content').fill('<p>Hello</p><script>alert(1)</script>');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText(/imported as a draft; 1 unsafe part/)).toBeVisible();
});

test('Library: categories, filters, favorite, preview and bulk tag', async ({ page }) => {
  await page.goto(`${base}/library/email`);
  await expect(page.getByRole('heading', { name: 'Email Templates', level: 1 })).toBeVisible();
  await expect(
    page.getByTestId('library-table').getByTestId('template-link').first(),
  ).toBeVisible();
  const side = page.getByTestId('category-sidebar');
  await side.getByRole('button', { name: /Tax Season/ }).click();
  await expect(page.getByTestId('library-table')).toContainText('Tax Organizer Ready');
  await expect(page.getByTestId('library-table')).not.toContainText('New Client Welcome Email');
  await side.getByRole('button', { name: /All Categories/ }).click();
  await page.getByRole('searchbox', { name: 'Search templates' }).fill('welcome back');
  await expect(page.getByTestId('library-table').getByTestId('template-link')).toHaveCount(1);
  await page.getByRole('button', { name: /Add .* to favorites/ }).click();
  await expect(page.getByRole('button', { name: /Remove .* from favorites/ })).toBeVisible();

  await page.getByRole('button', { name: /^Preview Existing Client/ }).click();
  await expect(page.getByTestId('preview-body')).toContainText('Jamie');
  await page.getByLabel('Send a test to').fill('me@example.test');
  await page.getByRole('button', { name: 'Test Send' }).click();
  await expect(page.getByText('Test sent. The template was not changed.')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('searchbox', { name: 'Search templates' }).fill('');
  const boxes = page.getByTestId('library-table').getByRole('checkbox');
  await boxes.nth(1).click();
  await boxes.nth(2).click();
  await page
    .getByRole('toolbar', { name: 'Bulk actions' })
    .getByRole('button', { name: 'Add Tag' })
    .click();
  await page.getByRole('dialog').getByLabel('Tag').fill('Priority');
  await page.getByRole('dialog').getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText(/2 tagged/)).toBeVisible();
});

test('Create: checks the fields, inserts a merge field, saves and opens the template', async ({
  page,
}) => {
  await page.goto(`${base}/new?kind=EMAIL`);
  await expect(page.getByTestId('editor-title')).toHaveText('Create Email Template');
  await page.getByTestId('save-template').click();
  await expect(page.getByText('Enter the template name')).toBeVisible();
  await page.getByLabel('Template Name *').fill('Referral Reminder');
  await page.getByLabel('Subject Line').fill('A quick favor, [Client First Name]');
  await page.getByRole('textbox', { name: 'Email Content' }).click();
  await page.keyboard.type('Thanks for being a client. ');
  await page.getByRole('button', { name: 'Insert [Business Name]' }).click();
  await page.getByLabel('Tags (Optional)').fill('Referral');
  await page.keyboard.press('Enter');
  await page.getByTestId('save-template').click();
  await expect(page).toHaveURL(/\/templates\/[0-9a-f-]{36}\/edit$/);
  await expect(page.getByLabel('Template Name *')).toHaveValue('Referral Reminder');
  await expect(page.getByTestId('versions')).toContainText('Version 1');
});

test('Edit: an automation warning, then the version history', async ({ page }) => {
  await openFirst(page, 'Tax Season Reminder (2026)');
  await page.getByLabel('Subject Line').fill('Tax season is near, let us get ready');
  await page.getByTestId('save-template').click();
  await expect(page.getByTestId('automation-warning')).toBeVisible();
  await page.getByRole('button', { name: 'Save Anyway' }).click();
  await expect(page.getByText('Template saved.')).toBeVisible();
  await expect(page.getByTestId('versions')).toContainText('Version 2');
  await page.getByRole('button', { name: /Restore version 1/ }).click();
  await expect(page.getByText(/Version 1 restored/)).toBeVisible();
  await expect(page.getByLabel('Subject Line')).toHaveValue(
    'It’s almost tax season – let’s get prepared!',
  );
});

test('Archiving a template an automation uses asks first', async ({ page }) => {
  await page.goto(`${base}/library/email`);
  await page.getByRole('button', { name: 'Actions for Tax Season Reminder (2026)' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(page.getByTestId('automation-warning')).toBeVisible();
  await page.getByRole('button', { name: 'Archive Anyway' }).click();
  await expect(page.getByText('Tax Season Reminder (2026) archived.')).toBeVisible();
});

test('An unknown merge field is flagged in the editor and the preview', async ({ page }) => {
  await openFirst(page, 'Private Draft Idea');
  await expect(page.getByTestId('unknown-fields')).toContainText('[Unknown Field]');
  await page.getByRole('button', { name: 'Preview Template' }).click();
  await expect(page.getByTestId('unresolved')).toContainText('[Unknown Field]');
});

test('Duplicate from the menu opens the copy as a draft', async ({ page }) => {
  await page.goto(`${base}/library/sms`);
  await page.getByRole('button', { name: 'Actions for Missing Documents Text' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(page).toHaveURL(/\/templates\/[0-9a-f-]{36}\/edit$/);
  await expect(page.getByLabel('Template Name *')).toHaveValue('Missing Documents Text (Copy)');
  await expect(page.getByLabel('Message *')).toBeVisible();
});

test('No sideways scroll at 375 px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  for (const path of ['', '/library/email', '/new?kind=EMAIL']) {
    await page.goto(`${base}${path}`);
    await expect(page.locator('h1').first()).toBeVisible();
    await page.waitForTimeout(800);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over, path || 'home').toBeLessThanOrEqual(1);
  }
});
