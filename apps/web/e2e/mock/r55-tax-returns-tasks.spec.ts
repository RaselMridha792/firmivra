import { expect, type Page, test } from '@playwright/test';

// Tax Returns Review 2, a return's Upcoming Tasks: the shared task list with its inline status and
// task menu, in place on the return. Each test makes its own task on the return with Create Task
// first. Mock mode (playwright.mock.config.ts) as the Owner, the mocks answering as the API does.
// Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.describe.configure({ timeout: 180_000 });

/** Opens a return, makes a task on it with Create Task and comes Back to the return. */
async function taskOnReturn(page: Page, title: string) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/tax-returns?q=Morgan%20Testwell'));
  await page.getByTestId('return-link').first().click({ timeout: 60_000 });
  const tasks = page.getByTestId('upcoming-tasks');
  await expect(tasks).toBeVisible({ timeout: 60_000 });
  const returnUrl = page.url();
  await tasks.getByRole('link', { name: 'Create Task' }).click();
  await expect(page).toHaveURL(/\/tasks\/new\?clientId=[0-9a-f-]+&engagementId=[0-9a-f-]+/, {
    timeout: 60_000,
  });
  await page.locator('#tf-title').fill(title);
  await page.getByLabel('Task type').selectOption({ index: 1 });
  await page.getByLabel('Assigned to').selectOption({ index: 1 });
  await page.locator('#tf-due').fill('2027-03-02');
  await page.getByRole('button', { name: 'Save Task' }).click();
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}\?from=/, { timeout: 60_000 });
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(returnUrl);
  await expect(tasks.getByRole('link', { name: title })).toBeVisible({ timeout: 60_000 });
  return { tasks, returnUrl };
}

// Tax Returns Review 2 (F13): Blocked on the return's task list saves only with a reason, typed
// into a real field.
test('Blocked from the return’s task list asks why in a field you can type in, and saves with it', async ({
  page,
}) => {
  const title = 'Fake: get the K-1 from the partnership';
  const { tasks } = await taskOnReturn(page, title);
  await tasks.getByLabel(`Status of ${title}`).selectOption('BLOCKED');
  const dialog = page.getByRole('dialog', { name: 'Why is this task blocked?' });
  await expect(dialog).toBeVisible();
  const reason = dialog.getByLabel('Reason *');
  const mark = dialog.getByRole('button', { name: 'Mark Blocked' });
  await expect(mark).toBeDisabled();
  await reason.click();
  await page.keyboard.type('Fake: waiting on the partnership K-1');
  await expect(reason).toHaveValue('Fake: waiting on the partnership K-1');
  await expect(mark).toBeEnabled();
  await mark.click();
  await expect(page.getByText(`${title}: Blocked.`)).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(tasks.getByLabel(`Status of ${title}`)).toHaveValue('BLOCKED');
  // The reason is saved on the task, for the next person.
  await tasks.getByRole('link', { name: title }).click();
  await expect(page.getByText('Blocked: Fake: waiting on the partnership K-1')).toBeVisible({
    timeout: 60_000,
  });
});
