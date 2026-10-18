import { expect, type Page, test } from '@playwright/test';

// Intake Forms > Create New Intake Form, the Logic & Rules tab, in mock mode (as an owner). The
// mock's Personal Tax Intake Form has only Short Answer and File Upload questions, so no rule can
// be made until a Yes / No question is added in Form Builder. The tabs are links: the unsaved
// draft follows them (client navigation), so the new question is there on Logic & Rules.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const FORM = '0199c0d0-0f00-7000-8000-000000000001';
const builder = (tab = '') => `http://app.localhost:${port}/intake-forms/builder/${FORM}${tab}`;
const NO_TRIGGER = 'Multiple Choice, Checkboxes, Dropdown or Yes / No';
const NO_RULES = 'No rules yet. Every question is shown to every client.';
const BROKEN = 'The trigger question changed; edit or remove this rule.';

const section = (page: Page, title: string) =>
  page.getByTestId('form-section').filter({ hasText: title });

/** Opens a tab of Build Your Form and waits until it is the current page. */
async function openTab(page: Page, name: 'Form Builder' | 'Logic & Rules') {
  const tab = page
    .getByRole('navigation', { name: 'Build Your Form' })
    .getByRole('link', { name, exact: true });
  await tab.click();
  await expect(tab).toHaveAttribute('aria-current', 'page');
}

/** Form Builder: choose Personal Information, then add a Yes / No question ("Yes or no?") to it. */
async function addYesNo(page: Page) {
  const personal = section(page, 'Personal Information');
  const choose = personal.getByRole('button', { name: /^Personal Information/ });
  await choose.click();
  await expect(choose).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('add-target')).toHaveText('Adds to Personal Information.');
  await page.getByRole('button', { name: 'Add Yes / No', exact: true }).click();
  await expect(personal.getByTestId('section-count')).toHaveText('6 questions');
  await expect(page.getByTestId('builder-status')).toHaveText('Unsaved changes');
}

/** Logic & Rules: show Street only when "Yes or no?" is answered Yes. */
async function addStreetRule(page: Page) {
  await page
    .getByTestId('logic-rules')
    .getByRole('button', { name: 'Add Rule', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Add Rule' });
  await dialog
    .getByLabel('Show this question', { exact: true })
    .selectOption({ label: 'Street (Address Information)' });
  await dialog
    .getByLabel('When the answer to', { exact: true })
    .selectOption({ label: 'Yes or no? (Personal Information)' });
  await dialog.getByLabel('Is', { exact: true }).selectOption({ label: 'Yes' });
  await dialog.getByRole('button', { name: 'Save Rule', exact: true }).click();
  await expect(dialog).toBeHidden();
}

test('a rule shows a question only after a Yes / No answer', async ({ page }) => {
  await page.goto(builder('/logic'));
  const logic = page.getByTestId('logic-rules');
  const addRule = logic.getByRole('button', { name: 'Add Rule', exact: true });
  const rule = logic.getByTestId('logic-rule');
  await expect(logic.getByTestId('logic-quiet')).toContainText(NO_TRIGGER);
  await expect(addRule).toBeDisabled();
  await expect(rule).toHaveCount(0);

  await openTab(page, 'Form Builder');
  await addYesNo(page);

  // Back on Logic & Rules: add a rule and see it listed.
  await openTab(page, 'Logic & Rules');
  await expect(logic.getByTestId('logic-quiet')).toHaveText(NO_RULES);
  await expect(addRule).toBeEnabled();
  await addStreetRule(page);
  await expect(rule).toHaveCount(1);
  await expect(rule).toContainText('Street');
  await expect(rule).toContainText('when Yes or no? is Yes');
  await expect(rule).not.toHaveAttribute('data-broken', 'true');
  await expect(logic.getByTestId('logic-quiet')).toHaveCount(0);

  // Moving the trigger's section below the question keeps the rule, with a warning.
  await openTab(page, 'Form Builder');
  await page.getByRole('button', { name: 'More for Personal Information', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Move down', exact: true }).click();
  await expect(page.getByTestId('form-section').first()).toContainText('Address Information');
  await openTab(page, 'Logic & Rules');
  await expect(rule).toHaveAttribute('data-broken', 'true');
  await expect(rule).toContainText(BROKEN);

  // No sideways scroll at 375 px.
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(rule).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  await rule.getByRole('button', { name: 'Remove rule for Street', exact: true }).click();
  await expect(rule).toHaveCount(0);
  await expect(logic.getByTestId('logic-quiet')).toHaveText(NO_RULES);
});

test('deleting the trigger question in Form Builder removes its rule', async ({ page }) => {
  await page.goto(builder());
  await addYesNo(page);
  await openTab(page, 'Logic & Rules');
  const logic = page.getByTestId('logic-rules');
  await addStreetRule(page);
  await expect(logic.getByTestId('logic-rule')).toHaveCount(1);

  // The builder drops a rule whose trigger is deleted (the API could not resolve it).
  await openTab(page, 'Form Builder');
  const personal = section(page, 'Personal Information');
  await personal.getByRole('button', { name: 'Open Personal Information', exact: true }).click();
  await personal.getByRole('button', { name: 'Delete Yes or no?', exact: true }).click();
  await expect(personal.getByTestId('section-count')).toHaveText('5 questions');

  await openTab(page, 'Logic & Rules');
  await expect(logic.getByTestId('logic-rule')).toHaveCount(0);
  await expect(logic.getByTestId('logic-quiet')).toContainText(NO_TRIGGER);
  await expect(logic.getByRole('button', { name: 'Add Rule', exact: true })).toBeDisabled();
});
