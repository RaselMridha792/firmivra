import { expect, test } from '@playwright/test';

// Intake Forms > Create New Intake Form, the Logic & Rules tab, in mock mode (as an owner). The
// mock's Personal Tax Intake Form has only Short Answer and File Upload questions, so no rule can
// be made until a Yes / No question is added in Form Builder. The tabs are links: the unsaved
// draft follows them (client navigation), so the new question is there on Logic & Rules.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const FORM = '0199c0d0-0f00-7000-8000-000000000001';
const NO_TRIGGER = 'Multiple Choice, Checkboxes, Dropdown or Yes / No';

test('a rule shows a question only after a Yes / No answer', async ({ page }) => {
  await page.goto(app(`/intake-forms/builder/${FORM}/logic`));
  const logic = page.getByTestId('logic-rules');
  const addRule = logic.getByRole('button', { name: 'Add Rule' });
  await expect(logic.getByTestId('logic-quiet')).toContainText(NO_TRIGGER);
  await expect(addRule).toBeDisabled();
  await expect(logic.getByTestId('logic-rule')).toHaveCount(0);

  // Form Builder: choose Personal Information, then add a Yes / No question to it.
  const tabs = page.getByRole('navigation', { name: 'Build Your Form' });
  await tabs.getByRole('link', { name: 'Form Builder' }).click();
  const personal = page.getByTestId('form-section').filter({ hasText: 'Personal Information' });
  await personal.getByRole('button', { name: /^Personal Information/ }).click();
  await expect(page.getByText('Adds to Personal Information.')).toBeVisible();
  await page.getByRole('button', { name: 'Add Yes / No' }).click();
  await expect(personal).toContainText('6 questions');
  await expect(page.getByTestId('builder-status')).toHaveText('Unsaved changes');

  // Back on Logic & Rules: add a rule and see it listed.
  await tabs.getByRole('link', { name: 'Logic & Rules' }).click();
  await expect(logic.getByTestId('logic-quiet')).toHaveText(
    'No rules yet. Every question is shown to every client.',
  );
  await addRule.click();
  const dialog = page.getByRole('dialog', { name: 'Add Rule' });
  await dialog
    .getByLabel('Show this question')
    .selectOption({ label: 'Street (Address Information)' });
  await dialog
    .getByLabel('When the answer to')
    .selectOption({ label: 'Yes or no? (Personal Information)' });
  await dialog.getByLabel('Is', { exact: true }).selectOption({ label: 'Yes' });
  await dialog.getByRole('button', { name: 'Save Rule' }).click();
  await expect(dialog).toBeHidden();
  const rule = logic.getByTestId('logic-rule');
  await expect(rule).toHaveCount(1);
  await expect(rule).toContainText('Street');
  await expect(rule).toContainText('when Yes or no? is Yes');
  await expect(rule).not.toHaveAttribute('data-broken', 'true');
  await expect(logic.getByTestId('logic-quiet')).toHaveCount(0);

  // Deleting the trigger question keeps the rule, with a warning, until it is removed.
  await tabs.getByRole('link', { name: 'Form Builder' }).click();
  await page.getByRole('button', { name: 'Open Personal Information' }).click();
  await page.getByRole('button', { name: 'Delete Yes or no?' }).click();
  await tabs.getByRole('link', { name: 'Logic & Rules' }).click();
  await expect(rule).toHaveAttribute('data-broken', 'true');
  await expect(rule).toContainText('The trigger question changed; edit or remove this rule.');

  // No sideways scroll at 375 px.
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(rule).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  await rule.getByRole('button', { name: 'Remove rule for Street' }).click();
  await expect(rule).toHaveCount(0);
  await expect(logic.getByTestId('logic-quiet')).toContainText(NO_TRIGGER);
});
