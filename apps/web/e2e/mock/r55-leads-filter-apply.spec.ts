import { expect, test } from '@playwright/test';

// R55, Leads Review Two R2 12: More Filters' choices wait for Apply Filters (the list stays as it
// is meanwhile), several apply together, and closing the panel without Apply drops the pending
// ones. Mock mode as the Owner (12 leads: four Hot, one tagged Back Taxes, which is Hot).
// Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('R2 12: choices wait for Apply, apply together, and a closed panel drops them', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/leads`);
  const rows = page.getByRole('table', { name: 'Leads' }).locator('tbody tr');
  const chips = page.getByLabel('Active filters');
  const more = page.getByRole('button', { name: /More Filters/ });
  const panel = page.getByRole('region', { name: 'More filters' });
  const priority = panel.getByRole('combobox', { name: 'All Priorities' });
  const tag = panel.getByRole('combobox', { name: 'All Tags' });
  await expect(rows).toHaveCount(8);

  // Pending: nothing changes until Apply.
  await more.click();
  await priority.selectOption('HOT');
  await tag.selectOption('Back Taxes');
  await expect(chips).toHaveCount(0);
  await expect(rows).toHaveCount(8);
  await expect(page).not.toHaveURL(/priority=|tag=/);

  // Apply: both at once.
  await panel.getByRole('button', { name: 'Apply Filters' }).click();
  await expect(chips.getByText(/^(Priority|Tag): /)).toHaveText([
    'Priority: Hot',
    'Tag: Back Taxes',
  ]);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Avery Lawson');

  // A new choice, then the panel closed without Apply: it is dropped.
  await more.click();
  await priority.selectOption('COLD');
  await more.click();
  await expect(panel).toHaveCount(0);
  await expect(chips.getByText('Priority: Hot')).toBeVisible();
  await expect(rows).toHaveCount(1);
  await more.click();
  await expect(priority).toHaveValue('HOT');
  await expect(tag).toHaveValue('Back Taxes');
});
