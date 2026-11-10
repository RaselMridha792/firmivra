import { expect, test, type Page } from '@playwright/test';

// R60, Tax Returns validation issues (Octavia's Oct 26 review): TX-F19 Return to Preparer raises
// a validation issue (note, severity, responsible person, version, checklist line) or names the
// open ones; TX-F20 an open Error blocks Ready to File and filing until it is resolved, while a
// Manual Warning or Info does not. Mock mode as the Owner; synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const shots = 'e2e/screenshots/r60-tax-returns-issues';

test.describe.configure({ timeout: 180_000 });

async function openForReview(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/tax-returns'));
  await page
    .getByTestId('tr-filters')
    .getByLabel('Status', { exact: true })
    .selectOption('READY_FOR_REVIEW');
  await page.getByTestId('return-link').first().click();
  await expect(page.getByTestId('return-workspace')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('tab', { name: 'Review' }).click();
  await expect(page.getByTestId('validation-issues')).toBeVisible();
}

async function returnToPreparer(page: Page) {
  const approvals = page.getByTestId('approvals');
  await approvals.getByRole('button', { name: 'Return to Preparer' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Return to Preparer' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('Return to Preparer raises an Error issue, which blocks filing until it is resolved', async ({
  page,
}) => {
  await openForReview(page);
  const issues = page.getByTestId('validation-issues');
  await expect(issues).toContainText('No validation issues.');
  await expect(issues).toContainText("not a provider's or the IRS's validation");

  const dialog = await returnToPreparer(page);
  await dialog.getByLabel('Review note for the preparer').fill('Two schedules to fix (fake)');
  await dialog.getByLabel('Raise a validation issue').check();
  const fields = dialog.getByTestId('issue-fields');
  await expect(fields.getByLabel('Severity')).toHaveValue('ERROR');
  await expect(fields).toContainText('Blocks Ready to File and filing until resolved');
  // The preparer is the person responsible unless the reviewer picks someone else.
  await expect(fields.getByLabel('Responsible person')).not.toHaveValue('');
  const confirm = page.getByRole('button', { name: 'Return to Preparer', exact: true }).last();
  await expect(confirm).toBeDisabled();
  await fields
    .getByLabel('Issue', { exact: true })
    .fill('W-2 box 1 does not match the draft (fake)');
  const version = fields.getByLabel('Version (draft return)');
  await version.selectOption({ index: 1 });
  const draftName = (await version.locator('option:checked').textContent()) ?? '';
  expect(draftName).toMatch(/Draft\.pdf$/);
  await fields.getByLabel('Checklist line').selectOption({ index: 1 });
  await expect(confirm).toBeEnabled();
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/return-with-issue.png` });
  await confirm.click();
  await expect(dialog).toBeHidden();

  const row = issues.getByTestId('issue').first();
  await expect(row).toContainText('Error');
  await expect(row).toContainText('W-2 box 1 does not match the draft (fake)');
  await expect(row).toContainText(`Version: ${draftName}`);
  await expect(issues.getByTestId('issues-blocking')).toHaveText(
    '1 open error blocks Ready to File and filing.',
  );
  await page.screenshot({ path: `${shots}/review-tab.png`, fullPage: true });

  // Frame 3: Next Steps says what blocks it (in-app, so the mock keeps the issue).
  await page.getByRole('link', { name: 'Open Review, E-File & Filing Status' }).click();
  const next = page.getByTestId('next-steps');
  await expect(next).toContainText('Resolve the open validation errors', { timeout: 60_000 });
  await expect(page.getByTestId('validation-issues').getByTestId('issue')).toHaveCount(1);
  await expect(page.getByText('Loading…')).toHaveCount(0, { timeout: 30_000 });
  await page.screenshot({ path: `${shots}/review-screen.png`, fullPage: true });

  // Resolved: the blocker goes, the issue stays, marked with who resolved it.
  const panel = page.getByTestId('validation-issues');
  await panel.getByRole('button', { name: 'Resolve' }).click();
  await expect(panel.getByTestId('issue').first()).toContainText('Resolved by');
  await expect(panel.getByTestId('issues-blocking')).toHaveCount(0);
  await expect(next).not.toContainText('Resolve the open validation errors');
  await expect(panel.getByRole('button', { name: 'Reopen' })).toBeVisible();
});

test('a Manual Warning does not block; Return to Preparer names it, and it is reassigned', async ({
  page,
}) => {
  await openForReview(page);
  const issues = page.getByTestId('validation-issues');
  await issues.getByRole('button', { name: '+ Raise Issue' }).click();
  const raise = page.getByRole('dialog', { name: 'Raise Validation Issue' });
  await raise.getByLabel('Severity').selectOption('MANUAL_WARNING');
  await expect(raise).toContainText('Needs review; does not block filing');
  await raise.getByLabel('Issue', { exact: true }).fill('Mileage looks high (fake)');
  await expect(page.getByRole('button', { name: 'Raise Issue', exact: true })).toBeEnabled();
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/raise-dialog.png` });
  await page.getByRole('button', { name: 'Raise Issue', exact: true }).click();
  await expect(raise).toBeHidden();
  await expect(issues.getByTestId('issue')).toHaveCount(1);
  await expect(issues.getByTestId('issue').first()).toContainText('Manual Warning');
  await expect(issues.getByTestId('issues-blocking')).toHaveCount(0);

  // Hand it to someone else.
  await issues.getByRole('button', { name: 'Reassign' }).click();
  const hand = page.getByRole('dialog', { name: 'Reassign Issue' });
  const who = hand.getByLabel('Responsible person');
  const before = await who.inputValue();
  const options = await who
    .locator('option')
    .evaluateAll((o) => o.map((x) => [(x as HTMLOptionElement).value, x.textContent ?? '']));
  const [value, name] = options.find(([v]) => v && v !== before)!;
  await who.selectOption(value!);
  await hand.getByRole('button', { name: 'Reassign' }).click();
  await expect(hand).toBeHidden();
  await expect(issues.getByTestId('issue').first()).toContainText(`Responsible: ${name}`);

  // Return to Preparer lists the open issue to name with the decision.
  const dialog = await returnToPreparer(page);
  const open = dialog.getByTestId('return-open-issues');
  await expect(open).toContainText('Manual Warning: Mileage looks high (fake)');
  await open.getByRole('checkbox').check();
  await dialog.getByLabel('Review note for the preparer').fill('See the open warning (fake)');
  const send = page.getByRole('button', { name: 'Return to Preparer', exact: true }).last();
  await expect(send).toBeEnabled();
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/return-names-open.png` });
  await send.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('approvals')).toContainText('Returned to preparer');
  await expect(issues.getByTestId('issue')).toHaveCount(1);

  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page.getByText('Validation issue raised')).toBeVisible();
  await expect(page.getByText('Validation issue reassigned')).toBeVisible();
});
