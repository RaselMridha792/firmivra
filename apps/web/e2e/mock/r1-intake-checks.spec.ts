import { expect, test } from '@playwright/test';

// R1, Intake Forms Review Two check (Nov 17): the rows whose behaviour was built but untested.
// Mock mode as the Owner; synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const list = `http://app.localhost:${port}/intake-forms`;

test.describe.configure({ timeout: 180_000 });

test('17c: a form made from scratch opens blank in the builder', async ({ page }) => {
  await page.goto(list);
  await page.getByRole('button', { name: 'Create Intake Form', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Create Intake Form' });
  const service = dialog.getByLabel('Service');
  const first = await service.locator('option').nth(1).getAttribute('value');
  await service.selectOption(first ?? '');
  await dialog.getByRole('button', { name: 'Create Intake Form', exact: true }).click();
  await expect(page).toHaveURL(/\/intake-forms\/builder\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(
    page.getByText('No sections yet. Add a section, then add questions from Add Questions.'),
  ).toBeVisible({ timeout: 60_000 });
});
