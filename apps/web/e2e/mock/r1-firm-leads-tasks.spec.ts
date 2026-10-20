import { expect, test } from '@playwright/test';

// R1 firm audit: at 1440 px the Leads table shows every column (leads/source/leads.jpg) and the
// Tasks table keeps each task on one line (task/source/task.jpg).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('the leads table fits at 1440 px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/leads`);
  const table = page.getByRole('table', { name: 'Leads' });
  await expect(table.getByRole('row').nth(1)).toBeVisible();
  const fits = await table.evaluate((el) => {
    const box = el.parentElement as HTMLElement;
    return box.scrollWidth <= box.clientWidth + 1;
  });
  expect(fits).toBe(true);
});

test('each task row is one line at 1440 px', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/tasks`);
  const first = page.getByTestId('task-link').first();
  await expect(first).toBeVisible();
  const heights = await page
    .getByTestId('task-table')
    .locator('tbody tr')
    .evaluateAll((rows) => rows.map((r) => (r as HTMLElement).offsetHeight));
  expect(Math.max(...heights)).toBeLessThan(60);
});
