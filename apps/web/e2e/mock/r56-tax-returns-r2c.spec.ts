import { expect, test } from '@playwright/test';

// R56, Tax Returns Review Two F03 (Nov 20), in mock mode (playwright.mock.config.ts) as the Owner;
// a reload resets the mock. Create Task from a return opens Tasks on that client and that exact
// return (tasks.tax_return_id), which the form shows and the task keeps. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
test.describe.configure({ timeout: 180_000 });

test('F03: Create Task from a return names that exact return, and the task keeps it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/tax-returns?q=Morgan%20Testwell'));
  await page.getByTestId('return-link').first().click({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/tax-returns\/[0-9a-f-]{36}/, { timeout: 60_000 });
  const returnId = /\/tax-returns\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  expect(returnId).toBeTruthy();
  const tasks = page.getByTestId('upcoming-tasks');
  await tasks.getByRole('link', { name: 'Create Task' }).click({ timeout: 60_000 });
  await expect(page).toHaveURL(new RegExp(`[?&]taxReturnId=${returnId}`), { timeout: 60_000 });
  await expect(page.getByTestId('task-tax-return')).toContainText('Tax return, Tax year');

  await page.locator('#tf-title').fill('Fix the return (fake)');
  await page.getByLabel('Task type').click();
  await page.getByRole('listbox', { name: 'Task types' }).getByRole('option').nth(1).click();
  await page.getByLabel('Assigned to').selectOption({ index: 1 });
  await page.locator('#tf-due').fill('2027-03-02');
  await page.getByRole('button', { name: 'Save Task' }).click();
  // Saved, the task opens with that return among what it is related to, linking to it.
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}/, { timeout: 60_000 });
  const link = page.getByRole('link', { name: /^Tax return \d{4}/ });
  await expect(link).toBeVisible({ timeout: 60_000 });
  await expect(link).toHaveAttribute('href', new RegExp(`^/tax-returns/${returnId}([?]|$)`));
});
