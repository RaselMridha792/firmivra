import { expect, type Page, test } from '@playwright/test';

// R56, Client Portal module gaps from R60's cross-check of the developer instructions, in mock
// mode as the Owner: the Documents row menu's Rename, Reclassify and Link to Record (19), and the
// warning before leaving the client with an unsaved edit (13, 27). Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

async function openDocuments(page: Page) {
  await page.setViewportSize({ width: 1536, height: 1200 });
  await page.goto(app(`/client-portal/${JAMIE}/documents`));
  const table = page.getByTestId('portal-documents-table');
  await expect(table.getByTestId('portal-document-name').first()).toBeVisible({
    timeout: 60_000,
  });
  return table;
}

/** The first row's three-dot menu, then one of its items. */
async function menu(page: Page, item: string) {
  const table = page.getByTestId('portal-documents-table');
  await table
    .getByRole('button', { name: /^Actions for / })
    .first()
    .click();
  await page.getByRole('menuitem', { name: item }).click();
}

test('instructions 19 and 13: Rename in place; leaving with the name unsaved asks first', async ({
  page,
}) => {
  const table = await openDocuments(page);
  const first = await table.getByTestId('portal-document-name').first().innerText();
  await menu(page, 'Rename');
  const field = table.getByRole('textbox', { name: `New name for ${first}` });
  await field.fill('Fake renamed W-2.pdf');

  // Back to All Clients with the name unsaved: asked, and Stay keeps the edit.
  await page.getByRole('button', { name: 'Back to All Clients' }).click();
  const ask = page.getByRole('dialog', { name: 'Leave without saving?' });
  await expect(ask).toBeVisible();
  await ask.getByRole('button', { name: 'Stay on This Page' }).click();
  await expect(page).toHaveURL(app(`/client-portal/${JAMIE}/documents`));
  await expect(field).toHaveValue('Fake renamed W-2.pdf');
  await table.getByRole('button', { name: 'Save' }).click();
  await expect(
    table.getByTestId('portal-document-name').filter({ hasText: 'Fake renamed W-2.pdf' }),
  ).toBeVisible();

  // Saved, nothing is pending: a tab opens without asking.
  await page
    .getByRole('navigation', { name: 'Client portal management' })
    .getByRole('link', { name: 'Activity' })
    .click();
  await expect(page).toHaveURL(app(`/client-portal/${JAMIE}/activity`));
  await expect(page.getByRole('dialog', { name: 'Leave without saving?' })).toHaveCount(0);

  // Unsaved again, a tab asks; Leave Without Saving goes and keeps the old name.
  await page.goBack();
  await expect(table.getByTestId('portal-document-name').first()).toBeVisible({
    timeout: 60_000,
  });
  await menu(page, 'Rename');
  await table.getByRole('textbox', { name: /^New name for / }).fill('Fake never saved.pdf');
  await page
    .getByRole('navigation', { name: 'Client portal management' })
    .getByRole('link', { name: 'Activity' })
    .click();
  await ask.getByRole('button', { name: 'Leave Without Saving' }).click();
  await expect(page).toHaveURL(app(`/client-portal/${JAMIE}/activity`));
});

test('instructions 19: Reclassify changes the type; Link to Record links it to a task', async ({
  page,
}) => {
  const table = await openDocuments(page);
  const name = await table.getByTestId('portal-document-name').first().innerText();
  const row = table.getByRole('row').filter({ hasText: name });
  await menu(page, 'Reclassify');
  const reclassify = page.getByRole('dialog', { name: `Reclassify ${name}` });
  const type = reclassify.getByLabel('Document type');
  await expect(type.locator('option').nth(1)).toBeAttached();
  const current = await type.inputValue();
  const options = await type
    .locator('option')
    .evaluateAll((os) =>
      os.map((o) => ({ value: (o as HTMLOptionElement).value, label: o.textContent ?? '' })),
    );
  const choice = options.find((o) => o.value && o.value !== current);
  if (!choice) throw new Error('the mock has no other document type');
  await type.selectOption(choice.value);
  await reclassify.getByRole('button', { name: 'Save Type' }).click();
  await expect(reclassify).toBeHidden();
  await expect(row).toContainText(choice.label);

  await menu(page, 'Link to Record');
  const link = page.getByRole('dialog', { name: /^Link / });
  await link.getByLabel('Record type').selectOption('task');
  const task = link.getByLabel('Task');
  await expect(task.locator('option').nth(1)).toBeAttached();
  await task.selectOption({ index: 1 });
  await link.getByRole('button', { name: 'Link Document' }).click();
  await expect(link).toBeHidden();
});
