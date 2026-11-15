import { expect, test, type Page } from '@playwright/test';

// Tax Planning Review 2 (R1): the rows that had no screen test, and the three closed gaps. C13
// strategy fields and C23 View Details; C18 Tax Planning in central Reports; C19 Save to Plan into
// a new plan; C20 a saved scenario reopens; C25 a version's own send and approval history; C26 a
// result marked out of date. Mock mode, as an Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const base = `${app}/tax-planning`;
const year = new Date().getUTCFullYear();

const calculate = async (page: Page) => {
  await page.getByLabel('Wages & salary').fill('120000');
  await page.getByLabel('Retirement contribution').fill('10000');
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByTestId('saving')).toBeVisible();
};

test('C13 and C23: a strategy keeps its inputs, documents and checklist, and View Details shows them', async ({
  page,
}) => {
  await page.goto(`${base}/strategies`);
  await page.getByRole('button', { name: 'New Strategy' }).click();
  const dialog = page.getByTestId('strategy-dialog');
  await dialog.getByLabel('Name').fill('Fake Charitable Remainder Trust');
  await dialog.getByRole('checkbox').first().check();
  await dialog.getByLabel('Required Documents (one per line)').fill('Trust deed (fake)');
  await dialog
    .getByLabel('Implementation Checklist (one step per line)')
    .fill('Draft the trust (fake)\nFund the trust (fake)');
  await page.getByRole('dialog').getByRole('button', { name: 'Save Strategy' }).click();
  const library = page.getByTestId('tp-library');
  await expect(library).toContainText('Fake Charitable Remainder Trust');
  await library
    .getByRole('row', { name: /Fake Charitable Remainder Trust/ })
    .getByRole('button', { name: /^Actions for / })
    .click();
  await page.getByRole('menuitem', { name: 'View Details' }).click();
  const view = page.getByTestId('strategy-view');
  await expect(view).toContainText('Trust deed (fake)');
  await expect(view).toContainText('Fund the trust (fake)');
  await expect(view.getByText('No required inputs.')).toHaveCount(0);
});

test('C26: a result is out of date once an input changes, and cannot be saved until calculated again', async ({
  page,
}) => {
  await page.goto(`${base}/calculator`);
  await calculate(page);
  await page.getByLabel('Wages & salary').fill('130000');
  await expect(page.getByTestId('calc-stale')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save Scenario' })).toBeDisabled();
  await page.getByRole('button', { name: 'Calculate' }).click();
  await expect(page.getByTestId('calc-stale')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save Scenario' })).toBeEnabled();
});

test('C20: a saved scenario is listed and reopens with what it kept', async ({ page }) => {
  await page.goto(`${base}/calculator`);
  await calculate(page);
  await page.getByLabel('Scenario name (optional)').fill('Fake reopen scenario');
  await page.getByRole('button', { name: 'Save Scenario' }).click();
  await expect(page.getByText('Scenario saved.')).toBeVisible();
  const list = page.getByTestId('scenarios');
  await expect(list).toContainText('Fake reopen scenario');
  await list.getByTestId('open-scenario').first().click();
  await expect(page).toHaveURL(/\?scenario=[0-9a-f-]{36}$/);
  await expect(page.getByLabel('Wages & salary')).toHaveValue('120000');
});

test('C19: Save to Plan can start a new plan for the client', async ({ page }) => {
  await page.goto(`${base}/calculator`);
  await page.getByLabel('Client (optional)').selectOption({ index: 1 });
  await calculate(page);
  const box = page.getByTestId('save-to-plan');
  await box.getByLabel('Plan').selectOption('__new__');
  await box.getByLabel('New plan name').fill('Fake calculator plan');
  await box.getByRole('button', { name: 'Save to Plan' }).click();
  await expect(page.getByText('New plan made, and the scenario saved to it.')).toBeVisible();
});

test('C18: the Tax Planning reports open in central Reports, filtered to Tax Planning, with the way back', async ({
  page,
}) => {
  await page.goto(`${base}/reports`);
  await page.getByTestId('open-in-reports').click();
  await expect(page).toHaveURL(/\/reports\/library\?.*source=tax_plans/);
  await expect(page.getByLabel('Category', { exact: true })).toHaveValue('TAX:tax_plans');
  await expect(page.getByTestId('back-to-origin')).toContainText('Back to');

  await page.goto(`${base}/reports`);
  await page.getByTestId('open-report-in-reports').click();
  await expect(page).toHaveURL(/\/reports\/tax_plan_savings/);
  await expect(page.getByText('Projected Savings by Plan').first()).toBeVisible();
});

test('C25: a version shows its own send history and the client approval of exactly that version', async ({
  page,
}) => {
  await page.goto(`${base}/clients`);
  await page.getByTestId('tp-clients').getByLabel('Search clients').fill('Thompson');
  await page.getByRole('link', { name: `${year} Corporate Plan` }).click();
  await page
    .getByRole('navigation', { name: 'Plan steps' })
    .getByRole('link', { name: /Review & Save/ })
    .click();
  await page.getByTestId('view-version').first().click();
  const history = page.getByTestId('version-history');
  await expect(history).toContainText('Sent for the client’s review');
  await expect(history.getByTestId('version-approval')).toContainText('Approved by the client on');
});
