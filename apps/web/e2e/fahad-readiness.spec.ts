import { expect, test, type Page } from '@playwright/test';
import { clientFixtures } from '../src/mocks/clients';

const port = process.env['WEB_PORT'] ?? '3000';
const app = (path: string) => `http://app.localhost:${port}${path}`;
async function owner(page: Page) {
  await page.goto(app('/sign-in?dev=1'));
  await page.getByRole('button', { name: /owner@lvp\.test/ }).click();
  await expect(page.getByTestId('me-email')).toHaveText('owner@lvp.test');
}
test('activation consumes only the fragment and removes it from browser history', async ({
  page,
}) => {
  const token = 'synthetic-expired-invitation-for-browser-review';
  let posted = '';
  await page.route('**/api/v1/auth/activation/check', async (route) => {
    posted = (route.request().postDataJSON() as { token: string }).token;
    expect(route.request().url()).not.toContain(token);
    await route.fulfill({
      status: 410,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'INVITE_EXPIRED', message: 'Expired' } }),
    });
  });
  await page.goto(app(`/activate#token=${token}`));
  await expect(page.getByRole('alert').filter({ hasText: 'invitation expired' })).toContainText(
    'invitation expired',
  );
  expect(posted).toBe(token);
  await expect(page).toHaveURL(app('/activate'));
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage })),
  ).not.toContain(token);
  await page.goto(app(`/activate?token=${token}`));
  await expect(page.getByRole('alert').filter({ hasText: 'activation link' })).toContainText(
    'activation link',
  );
  await expect(page).toHaveURL(app('/activate'));
});
test('published client contract renders search, record and masked tax identifiers', async ({
  page,
}) => {
  const record = clientFixtures[0];
  if (!record) throw new Error('R10 synthetic fixture missing');
  await owner(page);
  // Contract fixture only: this does not claim that R10's backend implementation is merged.
  await page.route('**/api/v1/business/clients?**', async (route) => {
    const search = new URL(route.request().url()).searchParams.get('search') ?? '';
    const items = record.displayName.toLowerCase().includes(search.toLowerCase()) ? [record] : [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items, nextCursor: null }),
    });
  });
  await page.route(`**/api/v1/business/clients/${record.id}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(record) }),
  );
  await page.route(`**/api/v1/business/clients/${record.id}/tax-years`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"items":[]}' }),
  );
  await page.goto(app('/clients'));
  await page.getByLabel('Search clients').fill('No matching synthetic client');
  await expect(page.getByTestId('page-empty')).toContainText('No clients match');
  await page.getByLabel('Search clients').fill('Jamie');
  await page.getByRole('link', { name: record.displayName, exact: true }).click();
  await expect(page.getByRole('heading', { name: record.displayName, exact: true })).toBeVisible();
  await expect(page.getByText('***-**-0001', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Client', exact: true })).toBeVisible();
});
test('client read denial uses the shared no-permission state without sample rows', async ({
  page,
}) => {
  await owner(page);
  await page.route('**/api/v1/business/clients?**', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: '{"error":{"code":"FORBIDDEN","message":"Denied"}}',
    }),
  );
  await page.goto(app('/clients'));
  await expect(page.getByTestId('page-forbidden')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Clients', exact: true })).toHaveCount(0);
});
test('Radio supports native arrow keys and Stepper announces current progress', async ({
  page,
}) => {
  await page.goto(
    'http://localhost:6006/iframe.html?id=design-system-progress-and-choices--radio-group',
  );
  const email = page.getByRole('radio', { name: 'Email', exact: true });
  await email.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('radio', { name: 'Phone', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Unavailable preference' })).toBeDisabled();
  await page.goto(
    'http://localhost:6006/iframe.html?id=design-system-progress-and-choices--setup-steps',
  );
  await expect(page.locator('[aria-current="step"]')).toHaveText('2Business details');
});
