import { expect, test } from '@playwright/test';

// Business Advisory review of Oct 25, batch 4 (Octavia): B24, the 15 approved goal suggestions
// fill the goal's name and never create a goal; B25, Mark Completed, Archive and Restore ask
// first, and goals have Active, Archived and All views; B26, plans are found by the business's
// name. Mock mode, as an Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/business-advisory`;

test('B24: a suggestion fills the goal’s name, stays editable, and creates nothing by itself', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${base}/goals`);
  const list = page.getByTestId('ba-goals');
  await expect(list.getByTestId('goal-link').first()).toBeVisible({ timeout: 60_000 });
  const before = await list.getByTestId('goal-link').count();
  await page.getByRole('button', { name: 'Add Business Goal' }).click();
  const dialog = page.getByTestId('add-goal');
  const suggestions = dialog.getByTestId('goal-suggestions');
  await suggestions.getByRole('button', { name: /Start from a suggestion \(15\)/ }).click();
  const chips = suggestions.getByRole('list', { name: 'Goal suggestions' }).getByRole('button');
  await expect(chips).toHaveCount(15);
  await suggestions.getByLabel('Search suggestions').fill('cash');
  await expect(chips).toHaveText(['Improve cash flow']);
  await page.screenshot({ path: test.info().outputPath('goal-suggestions.png') });
  await chips.first().click();
  const name = dialog.getByLabel('Goal', { exact: true });
  await expect(name).toHaveValue('Improve cash flow');
  await name.fill('Improve cash flow by spring');
  await expect(name).toHaveValue('Improve cash flow by spring');
  // Nothing was added: Cancel leaves the list as it was.
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(list.getByTestId('goal-link')).toHaveCount(before);
});

test('B25: Mark Completed, Archive and Restore ask first; Active, Archived and All views', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${base}/goals`);
  const list = page.getByTestId('ba-goals');
  const goal = 'Increase annual revenue by 25%';
  await expect(list.getByTestId('goal-link').filter({ hasText: goal })).toBeVisible({
    timeout: 60_000,
  });

  await list.getByRole('button', { name: `Actions for ${goal}` }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  const confirm = page.getByRole('dialog', { name: 'Archive this goal?' });
  await expect(confirm.getByTestId('goal-confirm')).toContainText('Nothing is deleted');
  await page.screenshot({ path: test.info().outputPath('goal-archive-confirm.png') });
  // Cancel changes nothing.
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(list.getByTestId('goal-link').filter({ hasText: goal })).toBeVisible();
  await list.getByRole('button', { name: `Actions for ${goal}` }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Archive Goal' }).click();
  await expect(list.getByTestId('goal-link').filter({ hasText: goal })).toHaveCount(0);

  await list.getByLabel('View').selectOption('archived');
  await expect(list.getByTestId('goal-link').filter({ hasText: goal })).toBeVisible();
  await list.getByRole('button', { name: `Actions for ${goal}` }).click();
  await page.getByRole('menuitem', { name: 'Restore' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Restore Goal' }).click();
  await expect(list.getByTestId('goal-link').filter({ hasText: goal })).toHaveCount(0);
  await list.getByLabel('View').selectOption('all');
  await expect(list.getByTestId('goal-link').filter({ hasText: goal })).toBeVisible();

  await list.getByRole('button', { name: `Actions for ${goal}` }).click();
  await page.getByRole('menuitem', { name: 'Mark Completed' }).click();
  await expect(page.getByRole('dialog', { name: 'Mark this goal completed?' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Mark Completed' }).click();
  await expect(page.getByText(`Goal completed: ${goal}`)).toBeVisible();
});

test('B26: plans are found by the business’s name', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${base}/plans`);
  const list = page.getByTestId('ba-plans');
  await expect(list.getByTestId('plan-link').first()).toBeVisible({ timeout: 60_000 });
  // "Beauty" is only in SL Beauty Studio, the business of the Startup Launch Plan.
  await list.getByPlaceholder('Search plans...').fill('Beauty');
  await expect(list.getByTestId('plan-link')).toHaveText([/Startup Launch Plan/]);
});
