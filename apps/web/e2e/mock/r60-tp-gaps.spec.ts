// R60, Tax Planning Review 2's screen test gaps (docs/qa/tax-planning.md): C07 Cancel and Back on
// Financial Overview with Discard and Save Draft; C24 a custom entity type; C20 the plan's
// Scenarios list and the kept-result note; C21 Add as Strategy. Mock mode, as an Owner. Synthetic
// data only. Each test moves in the app, so the mock keeps what it did.
import { expect, test, type Page } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const base = `${app}/tax-planning`;
const year = new Date().getFullYear();

/** Opens a plan from the Clients tab by its client and name, on one of its steps. */
async function openPlanStep(page: Page, client: string, plan: string, step: string) {
  await page
    .getByRole('tablist', { name: 'Tax planning views' })
    .getByRole('tab', { name: 'Clients', exact: true })
    .click();
  await page.getByTestId('tp-clients').getByLabel('Search clients or plans').fill(client);
  await page.getByRole('link', { name: plan }).first().click();
  await page
    .getByRole('navigation', { name: 'Plan steps' })
    .getByRole('link', { name: step })
    .click();
}

test('C24 and C07: a custom entity type is kept; Cancel and Back on Financial Overview ask first, Discard drops the change and Save Draft keeps it', async ({
  page,
}) => {
  await page.goto(`${base}/plans/new`);
  await page
    .getByTestId('step-client')
    .getByLabel('Client')
    .selectOption({ label: 'Marcus Johnson' });
  await page.getByLabel('Plan Name').fill('Fake C24 plan');
  await page.getByRole('combobox', { name: 'Filing Status *' }).selectOption({ index: 1 });
  // C24: an entity type of the firm's own words.
  await page.getByRole('combobox', { name: 'Entity Type *' }).selectOption('OTHER');
  await page.getByLabel('Custom entity type *').fill('Family trust (fake)');
  await page.getByRole('combobox', { name: 'Assigned To *' }).selectOption({ index: 1 });
  await page.getByLabel('Target Completion Date *').fill(`${year}-12-15`);
  await page.getByTestId('step-goals-box').getByLabel('Reduce taxable income').check();
  await page.getByRole('button', { name: 'Next', exact: true }).first().click();
  await page.waitForURL(/\/edit\/financials$/, { timeout: 60_000 });

  // C07: Cancel after a change asks; Discard leaves without saving it.
  const wages = () => page.getByLabel(`Wages & Salary ${year}`);
  await wages().fill('95000');
  await page.getByTestId('plan-cancel').click();
  await expect(page.getByTestId('leave-prompt')).toBeVisible();
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page).toHaveURL(`${base}`);
  await openPlanStep(page, 'Marcus', 'Fake C24 plan', 'Financial Overview');
  await expect(wages()).toHaveValue('');

  // Back after a change asks too; Save Draft keeps it, then goes back.
  await wages().fill('95000');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByTestId('leave-prompt')).toBeVisible();
  await page.getByRole('button', { name: 'Save Draft' }).click();
  await expect(page.getByTestId('step-client')).toBeVisible();
  // C24: the custom entity type came back as typed.
  await expect(page.getByLabel('Custom entity type *')).toHaveValue('Family trust (fake)');
  await page.getByRole('button', { name: 'Next', exact: true }).first().click();
  await page.waitForURL(/\/edit\/financials$/);
  await expect(wages()).toHaveValue('95000');
});

test('C21 and C20: Add as Strategy puts a named strategy on the plan; the plan lists the client’s scenarios, and one reopens with its kept result', async ({
  page,
}) => {
  await page.goto(`${base}/calculator`);
  await page.getByLabel('Client (optional)').selectOption({ label: 'Sarah Mitchell' });
  await page.getByLabel('Wages & salary').fill('120000');
  await page.getByLabel('Retirement contribution').fill('10000');
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByTestId('saving')).toBeVisible();

  // C21: Add as Strategy, to the client's open plan.
  const box = page.getByTestId('save-to-plan');
  await box.getByLabel('Plan').selectOption({ label: `${year} Tax Plan (${year})` });
  await box.getByRole('button', { name: 'Add as Strategy' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add as Strategy' });
  await expect(dialog).toContainText(`To ${year} Tax Plan`);
  await dialog.getByLabel('Strategy name').fill('Fake C21 strategy');
  await dialog.getByRole('button', { name: 'Add Strategy' }).click();
  await expect(page.getByText('Fake C21 strategy added to the plan.')).toBeVisible();

  // C20: a saved scenario for the client.
  await page.getByLabel('Scenario name (optional)').fill('Fake C20 scenario');
  await page.getByRole('button', { name: 'Save Scenario' }).click();
  await expect(page.getByText('Scenario saved.')).toBeVisible();

  // The plan has the strategy, and lists the client's scenario where the plan is worked on.
  await openPlanStep(page, 'Sarah', `${year} Tax Plan`, 'Goals & Strategies');
  await expect(
    page.getByTestId('plan-strategy').filter({ hasText: 'Fake C21 strategy' }),
  ).toHaveCount(1);
  const scenarios = page.getByTestId('plan-scenarios');
  const link = scenarios.getByTestId('scenario-link').filter({ hasText: 'Fake C20 scenario' });
  await expect(link).toHaveCount(1);
  await link.click();
  await expect(page).toHaveURL(/\/tax-planning\/calculator\?scenario=[0-9a-f-]{36}$/);
  await expect(page.getByTestId('kept-result')).toContainText(
    'This is the result kept then; Calculate again to work it out with today',
  );
});
