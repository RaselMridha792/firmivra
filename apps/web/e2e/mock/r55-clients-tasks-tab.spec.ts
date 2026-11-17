import { expect, test } from '@playwright/test';

// R55, Clients Review 2 (N8-36): the client's Tasks tab has New Task. It opens Create Task on this
// client, and Back returns to the client's Tasks tab. Mock mode as the Owner; synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

test('N8-36: New Task on the client Tasks tab opens Create Task on this client, with Back', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/clients/${JAMIE}/tasks`));
  await page.getByRole('link', { name: 'New Task', exact: true }).click({ timeout: 60_000 });
  await expect(page).toHaveURL(new RegExp(`/tasks/new\\?clientId=${JAMIE}&from=`), {
    timeout: 60_000,
  });
  await expect(page.getByRole('combobox', { name: 'Client' })).toHaveValue('Jamie Sample', {
    timeout: 60_000,
  });
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(new RegExp(`/clients/${JAMIE}/tasks$`));
  await expect(page.getByTestId('client-tasks')).toBeVisible();
});
