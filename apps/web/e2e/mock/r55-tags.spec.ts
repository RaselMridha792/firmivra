import { expect, type Locator, type Page, test } from '@playwright/test';

// R55, Octavia's Leads review (Oct 20) item L5: tags are picked from the firm's one list, shared
// by Leads and Clients; typing searches it, a name in another case is the same tag (never a
// second one), and the Owner may add a new one. In mock mode (playwright.mock.config.ts) as the
// Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const CLIENT = '0199b6a1-0000-7000-8000-000000000001';

const choose = async (page: Page, picker: Locator, text: string, option?: string | RegExp) => {
  const box = picker.getByRole('combobox');
  await box.fill(text);
  if (option) await picker.getByRole('option', { name: option }).click();
  else await box.press('Enter');
};
const chosen = (scope: Locator) => scope.getByRole('list', { name: /: chosen$/ });

test('Leads: the row’s Tags searches the firm’s tags, no duplicates, the Owner adds one', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${app}/leads`);
  await page.getByRole('button', { name: 'More actions for Bruno Sandoval' }).click();
  await page.getByRole('menuitem', { name: 'Tags' }).click();
  const dialog = page.getByRole('dialog');
  const picker = dialog.getByTestId('tag-picker');
  await picker.getByRole('combobox').fill('high');
  // The firm's tag first; the Owner may also add the typed name as a new one.
  await expect(picker.getByRole('option')).toHaveText(['High Value', 'Add “high” as a new tag']);
  await picker.getByRole('combobox').press('Enter');
  // Another case of a tag the firm has is that tag.
  await choose(page, picker, 'BACK TAXES');
  await choose(page, picker, 'back taxes');
  await expect(chosen(dialog).getByRole('listitem')).toHaveText(['High Value', 'Back Taxes']);
  await choose(page, picker, 'Estate Planning', 'Add “Estate Planning” as a new tag');
  await expect(chosen(dialog).getByRole('listitem')).toHaveCount(3);
  await dialog.getByRole('button', { name: 'Remove Back Taxes' }).click();
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(dialog).toBeHidden();

  // Edit Lead shows them, and the new tag is now one of the firm's.
  await page.getByRole('button', { name: 'More actions for Bruno Sandoval' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog');
  await expect(chosen(edit).getByRole('listitem')).toHaveText(['High Value', 'Estate Planning']);
  // A chosen tag is not offered again.
  await edit.getByTestId('tag-picker').getByRole('combobox').fill('estate planning');
  await expect(edit.getByTestId('tag-picker').getByRole('option')).toHaveCount(0);
  await expect(edit).toContainText('“estate planning” is already chosen.');
});

test('Edit Lead changes the lead’s tags, and the lead page shows them', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const lead = `${app}/leads/0199c0c0-0a00-7000-8000-000000000003`;
  await page.goto(lead);
  await page.getByRole('button', { name: /^Edit/ }).first().click();
  const edit = page.getByRole('dialog');
  await choose(page, edit.getByTestId('tag-picker'), 'spanish', 'Spanish Speaking');
  await edit.getByRole('button', { name: 'Save Changes' }).click();
  await expect(edit).toBeHidden();
  await page.getByRole('link', { name: 'Campaigns', exact: true }).click();
  await expect(page.getByTestId('card-tags')).toContainText('Spanish Speaking');
});

test('Clients: the Tags card picks from the same list, once each', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${app}/clients/${CLIENT}`);
  const card = page.getByTestId('client-tags');
  await expect(card).toContainText('This client has no tags yet.');
  await card.getByRole('button', { name: 'Add tags' }).click();
  const picker = card.getByTestId('tag-picker');
  await choose(page, picker, 'referral');
  await choose(page, picker, 'REFERRAL PARTNER');
  await expect(chosen(card).getByRole('listitem')).toHaveText(['Referral Partner']);
  await choose(page, picker, 'VIP', 'Add “VIP” as a new tag');
  await card.getByRole('button', { name: 'Save tags' }).click();
  await expect(card.getByRole('list', { name: 'Client tags' }).getByRole('listitem')).toHaveText([
    'Referral Partner',
    'VIP',
  ]);
});

test('no sideways scroll at 375 px with the client’s tags open', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`${app}/clients/${CLIENT}`);
  const card = page.getByTestId('client-tags');
  await card.getByRole('button', { name: /tags$/ }).click();
  await card.getByTestId('tag-picker').getByRole('combobox').focus();
  const scroll = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(scroll).toBeLessThanOrEqual(0);
});
