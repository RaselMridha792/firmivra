import { expect, test } from '@playwright/test';

// R1 firm audit: the dashboard against dashboard/source/firm-dashboard.jpg in mock mode.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('KPI tiles are the design size and each due task has a done checkbox', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/`);
  const card = page.getByTestId('kpi-card').first();
  await expect(card).toBeVisible();
  const tile = await card.locator('span.rounded-full').first().boundingBox();
  expect(tile?.width).toBe(56);
  const tasks = page.getByRole('region', { name: 'Tasks Due' });
  // Each task's checkbox asks before completing it (Octavia's T5); its title opens the task (T4).
  const boxes = tasks.getByRole('checkbox', { name: /^Mark .+ complete$/ });
  await expect(boxes.first()).toBeVisible();
  expect(await boxes.count()).toBe(await tasks.getByTestId('task-title').count());
});
