import { expect, test } from '@playwright/test';

// Tax Returns Review 2, the Return Validation lines on a return's Review tab. Mock mode
// (playwright.mock.config.ts) as the Owner, the mock answering as the API does. Synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.describe.configure({ timeout: 180_000 });

// Tax Returns Review 2 (F19): Add Validation Item, then the line's Assign, names who resolves it
// and the draft version it is about, on the line and in Validation Issues.
test('a validation item added and assigned shows its responsible person and its version', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/tax-returns?q=Jamie%20Sample'));
  await page.getByTestId('return-link').first().click({ timeout: 60_000 });
  await page.getByRole('tab', { name: 'Review' }).click({ timeout: 60_000 });
  const validation = page.getByTestId('validation');
  const label = 'Fake: dependent age check';

  await validation.getByRole('button', { name: '+ Add Validation Item' }).click();
  const add = page.getByTestId('add-check-dialog');
  await add.getByLabel('Item').fill(label);
  await add.getByLabel('Result').selectOption('ERROR');
  await page.getByRole('dialog').getByRole('button', { name: 'Add', exact: true }).click();
  const line = validation.getByRole('row').filter({ hasText: label });
  await expect(line).toBeVisible();

  await line.getByRole('button', { name: `Assign ${label}` }).click();
  const fields = page.getByTestId('assign-validation-dialog').getByTestId('issue-fields');
  // The return's preparer is offered first; the version is one of its draft returns.
  const responsible = fields.getByLabel('Responsible person');
  await expect(responsible).not.toHaveValue('');
  const who = ((await responsible.locator('option:checked').textContent()) ?? '').trim();
  const version = fields.getByLabel('Version (draft return)');
  await version.selectOption({ index: 1 });
  const file = ((await version.locator('option:checked').textContent()) ?? '').trim();
  expect(file).toMatch(/Draft\.pdf$/);
  await page.getByRole('dialog').getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(page.getByText('Validation item assigned.')).toBeVisible();

  const owner = line.getByTestId('validation-line-owner');
  await expect(owner).toContainText(who);
  await expect(owner).toContainText(`Version: ${file}`);
  const issue = page
    .getByTestId('validation-issues')
    .getByTestId('issue')
    .filter({ hasText: label });
  await expect(issue).toContainText(`Responsible: ${who} · Version: ${file} · Line: ${label}`);
});
