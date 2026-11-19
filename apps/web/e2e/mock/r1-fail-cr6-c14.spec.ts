import { expect, test } from '@playwright/test';

// R1, R61's sweep FAIL items. F01b CR-6 (Tax Returns): a Return Validation line tied to a version
// keeps the Review tab within 390 px, its file name wrapping. C14 (Tax Planning): the client
// document picker says it is loading until the documents arrive, never "no documents" before.
// Mock mode as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.describe.configure({ timeout: 240_000 });

test('F01b CR-6: a validation line naming its version wraps, so the Review tab fits 390 px', async ({
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
  await line.getByRole('button', { name: `Assign ${label}` }).click();
  const fields = page.getByTestId('assign-validation-dialog').getByTestId('issue-fields');
  await fields.getByLabel('Version (draft return)').selectOption({ index: 1 });
  await page.getByRole('dialog').getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(page.getByText('Validation item assigned.')).toBeVisible();
  const owner = line.getByTestId('validation-line-owner');
  await expect(owner).toContainText(/Version: .+Draft\.pdf/);

  // The same page at 390 px: nothing scrolls sideways, and the file name is still all there.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth))
    .toBeLessThanOrEqual(0);
  await expect(owner).toContainText(/Version: .+Draft\.pdf/);
  const box = await owner.boundingBox();
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
});

test('C14: the client document picker says it is loading until the documents arrive', async ({
  page,
}) => {
  // Every documents.list answers 1.5 s late (lib/mock.ts `failable`).
  await page.addInitScript(() => sessionStorage.setItem('fv-mock-fail', 'documents.list@slow'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/tax-planning/clients'));
  await page.getByTestId('tp-clients').getByLabel('Search clients or plans').fill('Sarah');
  await page
    .getByRole('link', { name: `${new Date().getFullYear()} Tax Plan` })
    .first()
    .click({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/tax-planning\/plans\/[0-9a-f-]{36}/, { timeout: 60_000 });
  const plan = /\/tax-planning\/plans\/([0-9a-f-]{36})/.exec(page.url())![1];
  await page.goto(app(`/tax-planning/plans/${plan}/edit/implementation`));
  const picker = page.getByTestId('step-docs').getByLabel('Client document');
  const first = picker.locator('option').first();
  await expect(first).toHaveText('Loading documents…', { timeout: 60_000 });
  // Then the answer, only once the request settled: a choice, "no documents", or (the mock's
  // documents don't know the planning mock's clients) that they could not be loaded.
  await expect(first).not.toHaveText('Loading documents…', { timeout: 30_000 });
  await expect(first).toHaveText(
    /^(Choose a document…|This client has no documents|Documents could not be loaded)$/,
  );
  await expect(picker).toBeEnabled();
});
