import { expect, test, type Page } from '@playwright/test';

// Client Portal Review One T16: the tasks a firm shows a client sit in the portal's Requests area
// (Your Next Steps on Documents), each opening its own page with only the approved fields, the
// checklist and the approved files. The tasks API is served by route; synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;
const OPEN = '0199d000-0000-7000-8000-000000000001';
const DONE = '0199d000-0000-7000-8000-000000000002';
const GONE = '0199d000-0000-7000-8000-000000000003';

const rows = [
  {
    id: OPEN,
    title: 'Sign your engagement letter (fake)',
    status: 'WAITING_ON_YOU',
    dueOn: '2026-12-01',
    dueTime: '14:30',
    checklist: { done: 1, total: 2 },
  },
  {
    id: DONE,
    title: 'Confirm your mailing address (fake)',
    status: 'COMPLETED',
    dueOn: null,
    dueTime: null,
    checklist: { done: 0, total: 0 },
  },
];

async function serveTasks(page: Page) {
  await page.route('**/api/v1/portal/lvp/me/tasks**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/tasks')) return route.fulfill({ json: { items: rows } });
    if (path.endsWith(OPEN))
      return route.fulfill({
        json: {
          ...rows[0],
          details: 'Read the letter, sign it and return it through the portal.',
          checklistItems: [
            { id: '0199d000-0000-7000-8000-0000000000a1', label: 'Read the letter', done: true },
            { id: '0199d000-0000-7000-8000-0000000000a2', label: 'Sign it', done: false },
          ],
          attachments: [
            {
              documentId: '0199d000-0000-7000-8000-0000000000d1',
              fileName: 'Engagement letter (fake).pdf',
            },
          ],
        },
      });
    return route.fulfill({
      status: 404,
      json: { error: { code: 'NOT_FOUND', message: 'Not found' } },
    });
  });
}

test('T16: the firm’s visible tasks join Your Next Steps, each opening its own page', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await serveTasks(page);
  await page.goto(portal('/lvp/documents'));
  const tasks = page.getByTestId('task-row');
  await expect(tasks).toHaveCount(2, { timeout: 60_000 });
  await expect(tasks.first()).toContainText('Sign your engagement letter (fake)');
  await expect(tasks.first()).toContainText(
    'Task from your firm · 1 of 2 steps done · due Dec 1, 2026 at 2:30 PM',
  );
  await expect(tasks.first()).toContainText('Waiting on you');
  await expect(tasks.nth(1)).toContainText('Completed');
  await expect(tasks.first().getByRole('link', { name: 'View task' })).toHaveAttribute(
    'href',
    `/lvp/requests/tasks/${OPEN}`,
  );

  await tasks.first().getByRole('link', { name: 'View task' }).click();
  const task = page.getByTestId('client-task');
  await expect(
    task.getByRole('heading', { name: 'Sign your engagement letter (fake)' }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(task).toContainText('Waiting on you');
  await expect(task).toContainText('Due Dec 1, 2026 at 2:30 PM');
  await expect(page.getByTestId('task-details')).toContainText(
    'Read the letter, sign it and return it through the portal.',
  );
  const checklist = page.getByTestId('task-checklist').getByRole('listitem');
  await expect(checklist).toHaveText(['Read the letter(done)', 'Sign it(not done yet)']);
  await expect(page.getByTestId('task-files')).toContainText('Engagement letter (fake).pdf');
  await expect(
    page.getByRole('button', { name: 'Download Engagement letter (fake).pdf' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to Requests' })).toHaveAttribute(
    'href',
    '/lvp/documents',
  );
});

test('T16: a task that is no longer shown says so, with the way back', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await serveTasks(page);
  await page.goto(portal(`/lvp/requests/tasks/${GONE}`));
  const missing = page.getByTestId('task-missing');
  await expect(missing).toContainText("This task isn't available", { timeout: 60_000 });
  await expect(missing.getByRole('link', { name: 'Back to Requests' })).toHaveAttribute(
    'href',
    '/lvp/documents',
  );
});
