import { expect, test } from '@playwright/test';

// R1, Business Advisory Review 2 batch D (the lead's list: A-X02, A-X10, A-X11), on the schema of
// #1652. Mock mode as the Owner; the mock keeps its data in the page, so a test moves between
// pages by their links. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.describe.configure({ timeout: 240_000 });

test('A-X11: an action item’s Progress Notes show each note’s status, author and time, and a new note can move the item', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/business-advisory/action-plans'));
  await page.getByLabel('Search action items').fill('Prepare funding', { timeout: 60_000 });
  await page
    .getByRole('button', { name: 'Actions for Prepare funding application' })
    .click({ timeout: 60_000 });
  await page.getByRole('menuitem', { name: 'Progress Notes' }).click();
  const dialog = page.getByTestId('progress-notes');
  const history = dialog.getByTestId('progress-history');
  await expect(history.getByRole('listitem')).toHaveCount(1, { timeout: 60_000 });
  await expect(history).toContainText('Gathered the last two years of statements for the lender.');
  await expect(history).toContainText('In Progress');
  await expect(history).toContainText('Sam Staff');

  await dialog.getByLabel(/^Progress note/).fill('Sent the application to the lender.');
  await dialog.getByLabel('Status').selectOption('DONE');
  await page.getByRole('button', { name: 'Add Note' }).click();
  await expect(
    page.getByText('Progress note added; Prepare funding application is now done.'),
  ).toBeVisible({ timeout: 60_000 });
  // The new note is first, with the new status; the earlier one stays.
  await expect(history.getByRole('listitem')).toHaveCount(2);
  await expect(history.getByRole('listitem').first()).toContainText('Done');
  await expect(history.getByRole('listitem').first()).toContainText(
    'Sent the application to the lender.',
  );
  await expect(dialog.getByLabel(/^Progress note/)).toHaveValue('');
});

test('A-X02: Manage Industries changes the firm’s list, and Add Advisory Client offers it with Other and Specify', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/business-advisory/clients'));
  await page.getByRole('button', { name: 'Manage Industries' }).click({ timeout: 60_000 });
  const manage = page.getByTestId('manage-industries');
  await expect(manage.getByLabel('Industry 1', { exact: true })).toHaveValue('Construction', {
    timeout: 60_000,
  });
  // Add one, archive one, move the new one to the top.
  await manage.getByLabel('Add an industry').fill('Landscaping');
  await manage.getByRole('button', { name: 'Add', exact: true }).click();
  await manage.getByRole('button', { name: 'Archive Automotive' }).click();
  const last = await manage.getByRole('list', { name: 'Industries' }).getByRole('listitem').count();
  for (let i = 0; i < last - 1; i += 1)
    await manage.getByRole('button', { name: 'Move Landscaping up' }).click();
  await expect(manage.getByLabel('Industry 1', { exact: true })).toHaveValue('Landscaping');
  await page.getByRole('button', { name: 'Save Industries' }).click();
  await expect(page.getByText('Industries saved.')).toBeVisible({ timeout: 60_000 });

  // The new list in Add Advisory Client: Landscaping first, Automotive gone, Other with Specify.
  await page.getByRole('button', { name: 'Add Advisory Client' }).click();
  const add = page.getByTestId('add-advisory-client');
  const industry = add.getByLabel('Industry', { exact: true });
  await expect(industry.locator('option').nth(1)).toHaveText('Landscaping');
  await expect(industry.locator('option', { hasText: 'Automotive' })).toHaveCount(0);
  await industry.selectOption('Other');
  await add.getByLabel('Specify industry').fill('Aquaculture');
  await expect(add.getByLabel('Specify industry')).toHaveValue('Aquaculture');
});
