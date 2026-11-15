import { expect, test, type Page } from '@playwright/test';

// R1, Intake Forms Review Two 17c: every form and template belongs to a service, so each create
// button on Intake Forms (the top bar's Create Intake Form, the list's Create New Form, the quick
// action Create Form Template) asks for the service first and then opens the builder. The mock
// refuses a create with no service (400), as the API does. Mock mode as the Owner; synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const list = `http://app.localhost:${port}/intake-forms`;

test.describe.configure({ timeout: 180_000 });

async function createThrough(page: Page, button: string, dialogTitle: string) {
  await page.goto(list);
  await page.getByRole('button', { name: button, exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: dialogTitle });
  await expect(dialog).toContainText('Choose the service this');
  // Nothing is created before a service is chosen.
  await expect(dialog.getByRole('button', { name: dialogTitle, exact: true })).toBeDisabled();
  const service = dialog.getByLabel('Service');
  const first = await service.locator('option').nth(1).getAttribute('value');
  await service.selectOption(first ?? '');
  await dialog.getByRole('button', { name: dialogTitle, exact: true }).click();
  await expect(page).toHaveURL(/\/intake-forms\/builder\/[0-9a-f-]{36}$/, { timeout: 60_000 });
}

test('Create Intake Form (top bar) asks for the service, then opens the builder', async ({
  page,
}) => {
  await createThrough(page, 'Create Intake Form', 'Create Intake Form');
});

test('Create New Form (the list) asks for the service, then opens the builder', async ({
  page,
}) => {
  await createThrough(page, 'Create New Form', 'Create Intake Form');
});

test('Create Form Template (quick action) asks for the service, then opens the builder', async ({
  page,
}) => {
  await createThrough(page, 'Create Form Template', 'Create Template');
});
