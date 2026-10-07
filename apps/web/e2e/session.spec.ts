import { expect, type Page, test } from '@playwright/test';

// The kit's session rules (lib/session.ts, components/signed-in.tsx): on a 401 the browser
// refreshes the session once and carries on; if it's still 401, the visitor goes to sign-in.
// Local sign-in has no refresh cookie, so the API answers are played by the test.
const port = process.env['WEB_PORT'] ?? '3000';
const app = (path: string) => `http://app.localhost:${port}${path}`;
const unauthenticated = {
  status: 401,
  contentType: 'application/json',
  body: JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } }),
};

async function signInAsOwner(page: Page) {
  await page.goto(app('/sign-in'));
  await page.getByRole('button', { name: /owner@lvp\.test/ }).click();
  await expect(page.getByTestId('firm-name')).toBeVisible();
}

/** Counts refresh calls and answers them as the API does when the refresh token is valid. */
async function refreshSucceeds(page: Page) {
  const calls = { count: 0 };
  await page.route('**/api/v1/auth/refresh', async (route) => {
    calls.count += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  return calls;
}

test('a 401 refreshes the session once, then the page carries on', async ({ page }) => {
  await signInAsOwner(page);
  const refreshes = await refreshSucceeds(page);
  let first = true;
  await page.route('**/api/v1/me', async (route) => {
    if (first) {
      first = false;
      await route.fulfill(unauthenticated);
    } else await route.continue();
  });

  await page.goto(app('/clients'));
  await expect(page.getByTestId('page-title')).toHaveText('Clients');
  expect(refreshes.count).toBe(1);
});

test('a 401 that a refresh does not cure goes to sign-in', async ({ page }) => {
  await signInAsOwner(page);
  const refreshes = await refreshSucceeds(page);
  await page.route('**/api/v1/me', (route) => route.fulfill(unauthenticated));

  await page.goto(app('/clients'));
  await expect(page).toHaveURL(app('/sign-in'));
  expect(refreshes.count).toBe(1);
});
