import { expect, test } from '@playwright/test';

// R55, Octavia's Leads review (Oct 20) item L6: Add New Tag beside Add New Lead adds to the firm's
// one tag list, which Leads and Clients both pick from; a name the firm has (any case) is refused.
// In mock mode (playwright.mock.config.ts) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/leads`;

test('Add New Tag sits beside Add New Lead and adds to the one list', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url);
  // Beside Add New Lead: the same row of buttons.
  const actions = page.getByTestId('add-lead').locator('..');
  await expect(actions.getByTestId('add-tag')).toHaveText('Add New Tag');
  await page.getByTestId('add-tag').click();
  const dialog = page.getByRole('dialog', { name: 'Add New Tag' });
  const list = dialog.getByRole('region', { name: "The firm's tags" });
  await expect(list).toContainText('Back Taxes');
  await expect(list).toContainText('Not used yet');

  await dialog.getByRole('button', { name: 'Add Tag' }).click();
  await expect(dialog).toContainText('Enter a tag name');
  await dialog.getByLabel('Tag name').fill('Estate Planning');
  await dialog.getByRole('button', { name: 'Add Tag' }).click();
  await expect(dialog.getByTestId('tag-added')).toHaveText(
    '“Estate Planning” was added. It is in the tag list for Leads and Clients.',
  );
  await expect(list).toContainText('Estate Planning');
  await dialog.getByLabel('Tag name').fill('estate planning');
  await dialog.getByRole('button', { name: 'Add Tag' }).click();
  await expect(dialog).toContainText('The firm already has a tag with this name.');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();

  // The Leads picker offers it.
  await page.getByRole('button', { name: 'More actions for Bruno Sandoval' }).click();
  await page.getByRole('menuitem', { name: 'Tags' }).click();
  const picker = page.getByRole('dialog').getByTestId('tag-picker');
  await picker.getByRole('combobox').fill('estate');
  await expect(picker.getByRole('option')).toHaveText([
    'Estate Planning',
    'Add “estate” as a new tag',
  ]);
});
