import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('Q07: a custom grant removes dashboard actions during loading and after resolution', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('fv-mock-role', 'STAFF');
    // This member's custom grants remove appointment edits but retain client view.
    window.sessionStorage.setItem('fv-mock-no-edit', 'APPOINTMENTS');
    window.sessionStorage.setItem('fv-mock-fail', 'dashboard.permissions@slow');
  });

  await page.goto(app('/'));
  const row = page.getByTestId('upcoming-row').first();
  await expect(row).toBeVisible({ timeout: 60_000 });
  await row.getByRole('button', { name: /Actions for/ }).click();
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'View Details' })).toBeVisible();
  for (const action of ['Edit', 'Reschedule', 'Send Reminder', 'Mark Complete', 'Cancel'])
    await expect(menu.getByRole('menuitem', { name: action, exact: true })).toHaveCount(0);

  // The member still has Clients: VIEW, while the server-resolved custom grant denies EDIT.
  await expect(menu.getByRole('menuitem', { name: 'Open Client' })).toBeVisible({
    timeout: 10_000,
  });
  for (const action of ['Edit', 'Reschedule', 'Send Reminder', 'Mark Complete', 'Cancel'])
    await expect(menu.getByRole('menuitem', { name: action, exact: true })).toHaveCount(0);
  await menu.screenshot({ path: 'test-results/q07-dashboard-permissions.png' });
});
