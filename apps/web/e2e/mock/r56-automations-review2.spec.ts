import { expect, test } from '@playwright/test';

// R56, Automations Review Two batch A, in mock mode (playwright.mock.config.ts) as the Owner; a
// reload resets the mock. R10: arrow keys move between the Automations tabs. R08: conditions move
// up and down, each keeping its field, operator and value. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/automations`;
test.use({ viewport: { width: 1440, height: 1000 } });

test('R10: arrow keys move between Overview and Manage Rules', async ({ page }) => {
  await page.goto(base);
  const tabs = page.getByRole('tablist', { name: 'Automation views' });
  const overview = tabs.getByRole('tab', { name: 'Overview' });
  await overview.focus();
  await page.keyboard.press('ArrowRight');
  const rules = tabs.getByRole('tab', { name: 'Manage Rules' });
  await expect(rules).toBeFocused();
  await expect(rules).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(overview).toBeFocused();
});

test('R08: conditions move up and down, each keeping its values', async ({ page }) => {
  await page.goto(`${base}/new`);
  await page.getByLabel('Trigger Event *').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Add Condition' }).click();
  await page.getByRole('button', { name: 'Add Condition' }).click();
  const first = page.getByLabel('Condition 1 field');
  const second = page.getByLabel('Condition 2 field');
  await second.selectOption({ index: 1 });
  const [a, b] = [await first.inputValue(), await second.inputValue()];
  expect(a).not.toBe(b);
  await expect(page.getByRole('button', { name: 'Move condition 1 up' })).toBeDisabled();
  await page.getByRole('button', { name: 'Move condition 2 up' }).click();
  await expect(first).toHaveValue(b);
  await expect(second).toHaveValue(a);
  await expect(page.getByRole('button', { name: 'Move condition 2 down' })).toBeDisabled();
});
