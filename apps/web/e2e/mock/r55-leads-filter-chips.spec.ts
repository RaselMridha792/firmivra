import { expect, test } from '@playwright/test';

// R55, Leads Review Two R2 10: the More Filters in force show as chips while the panel is closed;
// removing one keeps the others, the panel reopens on what is in force, and Reset clears them all.
// Mock mode as the Owner (12 leads: five Warm, two with an overdue follow-up, one of them Warm).
// Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('R2 10: removing one of two active filters keeps the other; reopening shows them; Reset clears all', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/leads`);
  const rows = page.getByRole('table', { name: 'Leads' }).locator('tbody tr');
  const chips = page.getByLabel('Active filters');
  const more = page.getByRole('button', { name: /More Filters/ });
  const panel = page.getByRole('region', { name: 'More filters' });
  const priority = panel.getByRole('combobox', { name: 'All Priorities' });
  const overdue = panel.getByLabel('Overdue only');
  await expect(rows).toHaveCount(8);

  await more.click();
  await priority.selectOption('WARM');
  await overdue.check();
  await panel.getByRole('button', { name: 'Apply Filters' }).click();
  await expect(panel).toHaveCount(0);
  await expect(chips.getByText(/^Priority: Warm|^Overdue Follow-Ups/)).toHaveText([
    'Priority: Warm',
    'Overdue Follow-Ups',
  ]);
  await expect(more).toContainText('2 in force');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Marco Diaz');

  // One chip off: the other stays in force.
  await page.getByRole('button', { name: 'Remove Overdue Follow-Ups' }).click();
  await expect(chips.getByText('Overdue Follow-Ups')).toHaveCount(0);
  await expect(chips.getByText('Priority: Warm')).toBeVisible();
  await expect(more).toContainText('1 in force');
  await expect(rows).toHaveCount(5);

  // The panel reopens on what is in force.
  await more.click();
  await expect(priority).toHaveValue('WARM');
  await expect(overdue).not.toBeChecked();
  await more.click();
  await expect(panel).toHaveCount(0);

  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(chips).toHaveCount(0);
  await expect(more).not.toContainText('in force');
  await expect(rows).toHaveCount(8);
  await more.click();
  await expect(priority).toHaveValue('');
});
