import { expect, test } from '@playwright/test';

// R60, Octavia's Oct 28 Templates review, TP-F09 (playwright.mock.config.ts, as an Owner): the
// editor's merge fields have Tax and Staff groups of their own, searchable, and a field goes where
// the cursor is (the subject line or the content). A new template opens without the console's
// "Query data cannot be undefined".
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/templates`;

test('Tax and Staff groups insert at the focused field, and search narrows them (TP-F09)', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(`${base}/new?kind=EMAIL`);
  const panel = page.getByTestId('merge-panel');
  const groups = panel.getByRole('tablist', { name: 'Merge field groups' });
  await expect(groups.getByRole('tab')).toHaveText([
    'All Fields',
    'Client',
    'Company',
    'Staff',
    'Appointment',
    'Invoice',
    'Tax',
    'Custom',
  ]);

  await groups.getByRole('tab', { name: 'Tax' }).click();
  await expect(panel.getByRole('button', { name: 'Insert [Tax Year]' })).toBeVisible();
  await expect(panel.getByRole('button', { name: /^Insert \[Client First Name\]/ })).toHaveCount(0);
  await page.getByLabel('Subject Line').fill('Your return for ');
  await panel.getByRole('button', { name: 'Insert [Tax Year]' }).click();
  await expect(page.getByLabel('Subject Line')).toHaveValue('Your return for [Tax Year]');

  await groups.getByRole('tab', { name: 'Staff' }).click();
  await panel.getByLabel('Search merge fields').fill('Preparer');
  await expect(panel.getByRole('button', { name: /^Insert / })).toHaveText([/\[Preparer Name\]/]);
  await page.getByRole('textbox', { name: 'Email Content' }).click();
  await page.keyboard.type('Your preparer is ');
  await panel.getByRole('button', { name: 'Insert [Preparer Name]' }).click();
  await expect(page.getByRole('textbox', { name: 'Email Content' })).toContainText(
    'Your preparer is [Preparer Name]',
  );

  expect(errors.filter((e) => e.includes('Query data cannot be undefined'))).toEqual([]);
});
