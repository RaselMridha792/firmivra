import { type ChildProcess, spawn } from 'node:child_process';
import { expect, test } from '@playwright/test';

// Settings > Payments (R7) in mock mode. The config's server signs in as the Owner; the mock role
// is fixed when the server starts, so the Admin and Staff checks start their own mock server.
const base = Number(process.env['WEB_PORT'] ?? '3000') + 1;
const payments = (port: number, query = '') =>
  `http://app.localhost:${port}/settings/payments${query}`;

/** A second mock web server with another role, on its own port and build folder. */
async function mockServer(role: 'ADMIN' | 'STAFF', port: number): Promise<ChildProcess> {
  const server = spawn('pnpm', ['--filter', '@firmivra/web', 'dev'], {
    cwd: '../..',
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      WEB_PORT: String(port),
      NEXT_DIST_DIR: `.next/mock-${role.toLowerCase()}`,
      NEXT_PUBLIC_API_MOCK: 'all',
      NEXT_PUBLIC_API_MOCK_ROLE: role,
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
  throw new Error(`mock server (${role}) did not start`);
}

const stop = (server: ChildProcess | undefined) => {
  if (server?.pid) process.kill(-server.pid);
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
      mockServer('ADMIN', base + 1),
      mockServer('STAFF', base + 2),
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

  test('staff see only Availability, and the page says no permission', async ({ page }) => {
    await page.goto(payments(base + 2));
    await expect(page.getByTestId('page-forbidden')).toBeVisible();
    const menu = page.getByRole('navigation', { name: 'Settings' }).getByRole('link');
    await expect(menu).toHaveText(['Availability']);
  });
});
