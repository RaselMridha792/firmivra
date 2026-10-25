import { expect, type Page, test } from '@playwright/test';

// Octavia's Dashboard review of Oct 24: T4 and T5 (Tasks Due), A2 to A4 (Upcoming Appointments),
// N2 and N3 (the bell). Mock mode (playwright.mock.config.ts) as the Owner; synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

async function openDashboard(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(app('/'));
  await expect(page.getByTestId('kpi-card')).toHaveCount(6, { timeout: 60_000 });
}

test('a task title opens that task; the client is its own link; completing asks first', async ({
  page,
}) => {
  await openDashboard(page);
  const tasks = page.getByRole('region', { name: 'Tasks Due' });
  const title = tasks.getByTestId('task-title').first();
  await expect(title).toHaveAttribute('href', /^\/tasks\/[0-9a-f-]{36}$/);
  await expect(tasks.getByRole('link', { name: /^Open client / }).first()).toHaveAttribute(
    'href',
    /^\/clients\/[0-9a-f-]{36}$/,
  );

  const name = (await title.textContent())!;
  const box = tasks.getByRole('checkbox', { name: `Mark ${name} complete` });
  await box.click();
  const dialog = page.getByRole('dialog', { name: 'Mark this task complete?' });
  await expect(dialog).toContainText(name);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(box).not.toBeChecked();
  await expect(tasks.getByTestId('task-title').filter({ hasText: name })).toHaveCount(1);

  await box.click();
  await page
    .getByRole('dialog', { name: 'Mark this task complete?' })
    .getByRole('button', { name: 'Mark Complete' })
    .click();
  await expect(page.getByRole('dialog', { name: 'Mark this task complete?' })).toBeHidden();
  await expect(tasks.getByRole('alert')).toHaveCount(0);
});

test('an appointment row opens that appointment, with its menu and a scrolling list', async ({
  page,
}) => {
  await openDashboard(page);
  const list = page.getByTestId('upcoming-list');
  const row = list.getByTestId('upcoming-row').first();
  await expect(row.getByRole('link').first()).toHaveAttribute(
    'href',
    /^\/calendar\/[0-9a-f-]{36}$/,
  );
  await expect(list).toHaveAttribute('tabindex', '0');
  await expect(list).toHaveCSS('overflow-y', 'auto');

  await row.getByRole('button', { name: /^Actions for / }).click();
  for (const item of [
    'View Details',
    'Edit',
    'Reschedule',
    'Send Reminder',
    'Mark Complete',
    'Cancel',
    'Open Client',
  ])
    await expect(page.getByRole('menuitem', { name: item, exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Cancel', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Cancel Appointment' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep It' }).click();
  await expect(dialog).toBeHidden();

  await row.getByRole('button', { name: /^Actions for / }).click();
  await page.getByRole('menuitem', { name: 'View Details', exact: true }).click();
  await expect(page).toHaveURL(/\/calendar\/[0-9a-f-]{36}$/);
});

test('opening the bell marks the notifications it shows as read', async ({ page }) => {
  await openDashboard(page);
  const bell = page.getByRole('button', { name: /^Notifications/ });
  const unread = async () =>
    Number(/(\d+) unread/.exec(await bell.evaluate((b) => b.textContent ?? ''))?.[1] ?? 0);
  await expect(bell).toHaveAccessibleName(/unread/, { timeout: 30_000 });
  const before = await unread();
  expect(before).toBeGreaterThan(0);
  await bell.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  // The ones the list showed are read now; the badge counts only the rest.
  await expect.poll(unread, { timeout: 30_000 }).toBeLessThan(before);
});
