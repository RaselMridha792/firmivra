import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// Settings > Payments (R7) in mock mode. The config's server signs in as the Owner; the mock role
// is fixed when the server starts, so the Admin and Staff checks start their own mock server.
// A fourth server mocks every module but `paymentsSetup`, so a test answers that API itself.
const base = Number(process.env['WEB_PORT'] ?? '3000') + 1;
const payments = (port: number, query = '') =>
  `http://app.localhost:${port}/settings/payments${query}`;
const SETUP_API = '**/api/v1/business/payments/setup';

/** Every module lib/api.ts and lib/auth.ts can mock, except Payments. */
function everyMockButPayments(): string {
  const names = ['api.ts', 'auth.ts'].flatMap((file) =>
    [
      ...readFileSync(new URL(`../../src/lib/${file}`, import.meta.url), 'utf8').matchAll(
        /mocked\('(\w+)'\)/g,
      ),
    ].map((m) => m[1]),
  );
  return [...new Set(names)].filter((name) => name !== 'paymentsSetup').join(',');
}

/** A second mock web server with another role or mock list, on its own port and build folder. */
async function mockServer(
  name: 'admin' | 'staff' | 'routed',
  port: number,
  env: Record<string, string>,
): Promise<ChildProcess> {
  const server = spawn('pnpm', ['--filter', '@firmivra/web', 'dev'], {
    cwd: '../..',
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      WEB_PORT: String(port),
      NEXT_DIST_DIR: `.next/mock-${name}`,
      NEXT_PUBLIC_API_MOCK: 'all',
      NEXT_PUBLIC_API_MOCK_ROLE: 'OWNER',
      ...env,
    },
  });
  for (let i = 0; i < 180; i += 1) {
    const up = await fetch(`http://localhost:${port}/healthz`).then(
      (r) => r.ok,
      () => false,
    );
    if (up) return server;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`mock server (${name}) did not start`);
}

/** Stops the server and its children (its process group); Windows has no process groups. */
const stop = (server: ChildProcess | undefined) => {
  if (!server?.pid) return;
  try {
    process.kill(process.platform === 'win32' ? server.pid : -server.pid);
  } catch {
    // Already gone.
  }
};

test('the owner connects Stripe, and a mock link opens nothing', async ({ page }) => {
  await page.goto(payments(base));
  await expect(page.getByTestId('page-title')).toHaveText('Payments');
  await expect(page.getByRole('navigation', { name: 'Settings' })).toContainText('Payments');
  await expect(page.getByTestId('payments-stage')).toHaveText('Not connected');
  await expect(page.getByTestId('charges-status')).toHaveText(
    'Clients cannot pay invoices online yet.',
  );

  await page.getByRole('button', { name: 'Connect Stripe' }).click();
  await expect(page.getByTestId('stripe-mock-link')).toBeVisible();
  await expect(page.getByTestId('payments-stage')).toHaveText('Setup not finished');
  await expect(page.getByRole('button', { name: 'Continue setup' })).toBeEnabled();
  await expect(page).toHaveURL(payments(base));
});

test('back from Stripe and an expired link', async ({ page }) => {
  await page.goto(payments(base, '?stripe=return'));
  await expect(page.getByTestId('stripe-return')).toBeVisible();

  // An expired link with no account yet: the button starts onboarding (refresh would be a 409).
  await page.goto(payments(base, '?stripe=refresh'));
  await expect(page.getByTestId('payments-stage')).toHaveText('Not connected');
  await expect(page.getByTestId('stripe-expired')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect Stripe' })).toBeVisible();
});

test.describe('other roles', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });
  let admin: ChildProcess | undefined;
  let staff: ChildProcess | undefined;
  test.beforeAll(async () => {
    test.setTimeout(400_000);
    [admin, staff] = await Promise.all([
      mockServer('admin', base + 1, { NEXT_PUBLIC_API_MOCK_ROLE: 'ADMIN' }),
      mockServer('staff', base + 2, { NEXT_PUBLIC_API_MOCK_ROLE: 'STAFF' }),
    ]);
  });
  test.afterAll(() => {
    stop(admin);
    stop(staff);
  });

  test('an admin reads the setup and has no button', async ({ page }) => {
    await page.goto(payments(base + 1));
    await expect(page.getByTestId('payments-stage')).toHaveText('Not connected');
    await expect(page.getByTestId('owner-only')).toHaveText('Only the Owner can connect Stripe.');
    await expect(page.getByTestId('stripe-connect')).toHaveCount(0);
  });

  test('staff see only Availability and Tax statuses, and the page says no permission', async ({
    page,
  }) => {
    await page.goto(payments(base + 2));
    await expect(page.getByTestId('page-forbidden')).toBeVisible();
    const menu = page.getByRole('navigation', { name: 'Settings' }).getByRole('link');
    await expect(menu).toHaveText(['Availability', 'Tax statuses']);
  });
});

test.describe('answers from the API', () => {
  test.describe.configure({ mode: 'serial', timeout: 240_000 });
  const port = base + 3;
  let routed: ChildProcess | undefined;
  test.beforeAll(async () => {
    test.setTimeout(400_000);
    routed = await mockServer('routed', port, { NEXT_PUBLIC_API_MOCK: everyMockButPayments() });
  });
  test.afterAll(() => stop(routed));

  test('an expired link while connected asks Stripe for a new link', async ({ page }) => {
    await page.route(SETUP_API, (route) =>
      route.fulfill({
        json: {
          connected: true,
          onboardingStatus: 'PENDING',
          chargesEnabled: false,
          payoutsEnabled: false,
          detailsSubmitted: false,
          requirementsDue: true,
          updatedAt: '2026-10-09T09:00:00.000Z',
        },
      }),
    );
    let started = 0;
    await page.route(`${SETUP_API}/onboarding`, (route) => {
      started += 1;
      return route.fulfill({ status: 500, json: { error: { code: 'X', message: 'x' } } });
    });
    await page.route(`${SETUP_API}/onboarding/refresh`, (route) =>
      route.fulfill({
        json: { url: 'mock:stripe-onboarding/2', expiresAt: '2026-10-09T09:05:00.000Z' },
      }),
    );

    await page.goto(payments(port, '?stripe=refresh'));
    await expect(page.getByTestId('payments-stage')).toHaveText('Setup not finished');
    await expect(page.getByTestId('stripe-expired')).toBeVisible();
    const refreshed = page.waitForRequest(`${SETUP_API}/onboarding/refresh`);
    await page.getByRole('button', { name: 'Continue setup' }).click();
    await refreshed;
    await expect(page.getByTestId('stripe-mock-link')).toBeVisible();
    expect(started).toBe(0);
  });

  test('a 503 from the setup API says payments are not available yet', async ({ page }) => {
    await page.route(SETUP_API, (route) =>
      route.fulfill({
        status: 503,
        json: {
          error: { code: 'PAYMENT_PROVIDER_UNAVAILABLE', message: 'Payments are not available' },
        },
      }),
    );
    await page.goto(payments(port));
    await expect(page.getByTestId('payments-unavailable')).toHaveText(
      'Online payments are not available yet.',
    );
    await expect(page.getByTestId('stripe-connect')).toHaveCount(0);
  });
});
