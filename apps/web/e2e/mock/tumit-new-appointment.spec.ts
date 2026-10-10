import { expect, test } from '@playwright/test';

// Booking in mock mode, as an owner. lib/api.ts has no mock switch for `api.clients` yet, so this
// test answers the client search itself with the clients mock's synthetic Jamie Sample.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

const jamie = {
  id: '0199b6a1-0000-7000-8000-000000000001',
  accountType: 'INDIVIDUAL',
  displayName: 'Jamie Sample',
  email: 'jamie@example.test',
  phone: null,
  assignedTo: null,
  portalStatus: null,
  archivedAt: null,
  createdAt: '2026-06-01T12:00:00.000Z',
};

// The mock puts its week after today and treats New York as a fixed UTC-4, while the screens
// use the real zone. Run on a summer Wednesday: EDT is UTC-4, and next week is past the cutoffs.
test.beforeEach(({ page }) => page.clock.setFixedTime(new Date('2026-07-08T12:00:00-04:00')));

/** A day of the mock's week ('YYYY-MM-DD'): 0 is next Monday, July 13. */
const nextWeek = (offset: number) =>
  new Date(Date.UTC(2026, 6, 13 + offset)).toISOString().slice(0, 10);

test('a new appointment leaves out the client busy times, then books a free one', async ({
  page,
}) => {
  await page.route('**/api/v1/business/clients**', (route) =>
    route.fulfill({ json: { items: [jamie], nextCursor: null } }),
  );
  await page.goto(app('/calendar'));
  await page.getByRole('button', { name: 'New appointment' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Client', { exact: true }).selectOption({ label: 'Jamie Sample' });
  // A new search clears the chosen client, then it is chosen again.
  await dialog.getByLabel('Find a client').fill('Jamie');
  await expect(dialog.getByRole('button', { name: 'Choose a client' })).toBeDisabled();
  await dialog.getByLabel('Client', { exact: true }).selectOption({ label: 'Jamie Sample' });
  await dialog.getByLabel('Staff').selectOption({ label: 'Mock User' });
  await dialog.getByLabel('Date').fill(nextWeek(0));

  // Jamie is already with Sam Staff at 10:00 AM, so the free times for Jamie (clientId) leave
  // that half hour out, as the API does since #214 and the mock since #229.
  const times = dialog.getByRole('group', { name: 'Free times' });
  await expect(times.getByRole('button', { name: '9:30 AM', exact: true })).toBeVisible();
  await expect(times.getByRole('button', { name: '10:00 AM', exact: true })).toHaveCount(0);
  await times.getByRole('button', { name: '11:00 AM', exact: true }).click();
  await dialog.getByRole('button', { name: 'Book 11:00 AM' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(page.getByTestId('appointment')).toHaveCount(6);
});
