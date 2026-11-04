import { expect, test } from '@playwright/test';

// R60, Octavia's Oct 28 review, CM-F12 (playwright.mock.config.ts, as an Owner; the mock answers as
// the API): a draft template is activated from Template Actions (an email needs its subject first),
// and Communications' Save as Template can save it Active so Use Template offers it.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;

test('CM-F12: Template Actions activate a draft; an email needs its subject first', async ({
  page,
}) => {
  await page.goto(`${app}/templates/library/email`);
  const search = page.getByRole('searchbox', { name: 'Search templates' });
  await search.fill('Private Draft Idea');
  const actions = page.getByRole('button', { name: 'Actions for Private Draft Idea' });
  await actions.click();
  await page.getByRole('menuitem', { name: 'Activate' }).click();
  await expect(page.getByText('Add a subject line before activating this template.')).toBeVisible();

  await page
    .getByTestId('library-table')
    .getByRole('link', { name: 'Private Draft Idea', exact: true })
    .click();
  await page.waitForURL(/\/edit$/);
  await page.getByLabel(/Subject Line/).fill('An idea worth sharing');
  await page.getByTestId('save-draft').click();
  await expect(page.getByText('Draft saved.')).toBeVisible();

  // Back through the breadcrumb (the mock keeps its data in the tab; a reload would reset it).
  await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Email Templates' })
    .click();
  await search.fill('Private Draft Idea');
  await actions.click();
  await page.getByRole('menuitem', { name: 'Activate' }).click();
  await expect(page.getByText('Private Draft Idea is active and can be used now.')).toBeVisible();
  await expect(page.getByTestId('library-table')).toContainText('Active');
});

test('CM-F12: Save as Template in Communications saves it Active for an Owner', async ({
  page,
}) => {
  await page.goto(`${app}/communications/new?channel=EMAIL`);
  await page.getByRole('button', { name: /^Start / }).click();
  await page.waitForURL(/\/edit$/);
  await page.getByLabel('Subject Line').fill('A reusable reminder');
  await page.getByTestId('template-card').getByRole('button', { name: 'Save as Template' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save as Template' });
  await expect(dialog.getByLabel('Activate it now, so Use Template offers it')).toBeChecked();
  await dialog.getByRole('button', { name: 'Save Template' }).click();
  await expect(
    page.getByText('Saved to Templates as Active. Use Template offers it now.'),
  ).toBeVisible();
});
