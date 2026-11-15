import { expect, test, type Page } from '@playwright/test';

// Tax Planning Review 2, in mock mode as an Owner. C27: from Finalized on, the plan's content is
// not edited in place (Revise makes the new version) while its implementation is still tracked.
// C17: the staff screening reference is never made client-facing.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/tax-planning`;
const year = new Date().getUTCFullYear();

const openPlan = async (page: Page, client: string, plan: string) => {
  await page.goto(`${base}/clients`);
  await page.getByTestId('tp-clients').getByLabel('Search clients').fill(client);
  await page.getByRole('link', { name: plan }).click();
  await expect(page.getByTestId('plan-workflow')).toBeVisible({ timeout: 60_000 });
};
const action = (page: Page, name: string) =>
  page.getByTestId('workflow-actions').getByRole('button', { name, exact: true });
const step = (page: Page, name: string) =>
  page.getByTestId('stepper').getByRole('link', { name: new RegExp(name) });

test('C27: a finalized plan keeps its content until Revise, and its implementation goes on', async ({
  page,
}) => {
  await openPlan(page, 'Mitchell', `${year} Tax Plan`);
  await step(page, 'Goals & Strategies').click();
  const include = page.getByRole('checkbox', { name: /^Include / }).first();
  await expect(include).toBeEnabled();

  await action(page, 'Finalize Plan').click();
  await expect(page.getByText('Plan finalized.')).toBeVisible();
  const frozen = page.getByTestId('plan-frozen');
  await expect(frozen).toContainText('change only through Revise');
  await expect(include).toBeDisabled();
  await page.screenshot({ path: test.info().outputPath('finalized.png'), fullPage: true });

  // The implementation is still tracked; declining a strategy is a change of content.
  await step(page, 'Implementation Plan').click();
  const status = page.getByRole('combobox', { name: /^Status of / }).first();
  await expect(status).toBeEnabled();
  await expect(status.locator('option')).not.toContainText(['Declined']);

  // Revise takes it back to work, as a new version to finalize.
  await action(page, 'Revise Plan').click();
  await page
    .getByRole('dialog')
    .getByLabel('Reason *')
    .fill('The client asked for a change (fake)');
  await page.getByRole('dialog').getByRole('button', { name: 'Revise Plan' }).click();
  await expect(frozen).toHaveCount(0);
  await expect(page.getByTestId('plan-editor')).toContainText('In Progress');
  await step(page, 'Goals & Strategies').click();
  await expect(include).toBeEnabled();
});

test('C17: the staff screening reference has no client-facing switch and is never sent', async ({
  page,
}) => {
  await page.goto(`${base}/resources`);
  const list = page.getByTestId('tp-resources');
  const row = list.getByRole('listitem').filter({ hasText: 'How Opportunity Screening Works' });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await expect(row.getByRole('button', { name: /Send to Client/ })).toBeDisabled();
  await row.getByRole('button', { name: 'View' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Edit' }).click();
  const editor = page.getByRole('dialog');
  await expect(editor.getByTestId('resource-staff-only')).toContainText(
    'a staff reference is never sent to a client',
  );
  await expect(editor.getByRole('checkbox', { name: /Client-facing/ })).toHaveCount(0);

  // Any other resource keeps its switch.
  await page.keyboard.press('Escape');
  const other = list
    .getByRole('listitem')
    .filter({ hasNotText: /staff only|How Opportunity Screening Works/i })
    .first();
  await other.getByRole('button', { name: 'View' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Edit' }).click();
  await expect(
    page.getByRole('dialog').getByRole('checkbox', { name: /Client-facing/ }),
  ).toBeVisible();
});
