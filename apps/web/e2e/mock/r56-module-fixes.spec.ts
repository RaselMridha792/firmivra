import { expect, test } from '@playwright/test';

// Octavia's Oct 25 review, module items: BK-D05 (checklist text keeps focus while typed), BK-D06
// (Assign starts on the current assignee and saves the chosen one), PY-F09 (Payroll Runs shows its
// columns and an honest empty state before the first run). Mock mode, as an Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;

test('BK-D05: a new checklist document is typed without losing focus', async ({ page }) => {
  await page.goto(`${app}/bookkeeping/settings`);
  const list = page.getByTestId('doc-checklist');
  await list.getByRole('button', { name: 'Add document' }).click();
  const field = list.getByRole('textbox', { name: 'Document', exact: true }).last();
  await field.click();
  await page.keyboard.type('Fake bank statements', { delay: 20 });
  await expect(field).toHaveValue('Fake bank statements');
  await expect(field).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.type('All ');
  await expect(field).toHaveValue('All Fake bank statements');
});

test('BK-D06: Assign starts on the current assignee and keeps the one chosen', async ({ page }) => {
  await page.goto(`${app}/bookkeeping`);
  await page.getByRole('button', { name: /^Actions for Green Leaf/ }).click();
  await page.getByRole('menuitem', { name: 'Assign/Reassign Staff' }).click();
  const dialog = page.getByRole('dialog');
  const now = (await dialog.getByTestId('assigned-now').textContent()) ?? '';
  expect(now).toMatch(/^Now: /);
  const select = dialog.getByLabel('Assigned to');
  // The team loads before the choice can change.
  await expect(select).toBeEnabled();
  await expect(select.locator('option:checked')).toHaveText(now.replace('Now: ', ''));
  const assign = dialog.getByRole('button', { name: /^(Assign|Unassign)$/ });
  await expect(assign).toBeDisabled();
  const other = select
    .locator('option')
    .filter({ hasNotText: now.replace('Now: ', '') })
    .last();
  const otherName = (await other.textContent()) ?? '';
  await select.selectOption({ label: otherName });
  await dialog.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(page.getByText(`Assigned to ${otherName}.`)).toBeVisible();

  await page.getByRole('button', { name: /^Actions for Green Leaf/ }).click();
  await page.getByRole('menuitem', { name: 'Assign/Reassign Staff' }).click();
  await expect(page.getByRole('dialog').getByTestId('assigned-now')).toHaveText(
    `Now: ${otherName}`,
  );
});

test('PY-F09: Payroll Runs shows its columns and says why there is no run yet', async ({
  page,
}) => {
  await page.goto(`${app}/payroll`);
  await page.getByPlaceholder('Search clients, business name, or EIN...').fill('Roberts');
  const href = await page
    .getByTestId('client-link')
    .filter({ hasText: 'Roberts & Co.' })
    .getAttribute('href');
  await page.goto(`${app}${href}?tab=runs`);
  const runs = page.getByTestId('tab-runs');
  for (const heading of [
    'Run and Pay Period',
    'Pay Date',
    'Frequency',
    'Workers',
    'Gross (confirmed)',
    'Total Cost (confirmed)',
    'Firmivra Status',
    'Provider Status',
  ]) {
    await expect(runs.getByRole('columnheader', { name: heading })).toBeVisible();
  }
  await expect(runs).toContainText('No payroll runs yet');
  await expect(runs).not.toContainText('$0');
});

test('BK-D03: a custom Report Due period filters the list, start no later than end', async ({
  page,
}) => {
  await page.goto(`${app}/bookkeeping`);
  await page.getByLabel('Report Due').selectOption('CUSTOM');
  const custom = page.getByTestId('due-custom');
  await custom.getByLabel('Due from').fill('2026-12-10');
  await custom.getByLabel('Due to').fill('2026-12-01');
  await expect(custom.getByRole('alert')).toHaveText('The start date is after the end date.');
  await custom.getByLabel('Due to').fill('2027-03-31');
  await expect(custom).toContainText('Both dates are included.');
  await expect(page).toHaveURL(/due=CUSTOM&dueFrom=2026-12-10&dueTo=2027-03-31/);
});

test('BK-D04: Missing Documents counts days since the request was sent, no number assumed', async ({
  page,
}) => {
  await page.goto(`${app}/bookkeeping/settings`);
  await expect(
    page.getByLabel('Missing Documents after (days since the request was sent)'),
  ).toBeVisible();
  await expect(page.getByTestId('missing-docs-help')).toContainText(
    'Requests that were received, accepted or cancelled stop counting.',
  );
});
