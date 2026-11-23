import { AdminSettingsOverview } from '@firmivra/types';
import { expect, test, type Page } from '@playwright/test';

const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
const url = `http://admin.localhost:${port}/system-settings`;
const endpoint = '**/api/v1/admin/system-settings';

// Synthetic design-review data, validated against the published API contract.
const overview = AdminSettingsOverview.parse({
  categories: [
    'GENERAL',
    'BRANDING',
    'EMAIL',
    'FEATURES',
    'RETENTION',
    'SECURITY',
    'SYSTEM',
    'MAINTENANCE',
    'DEFAULTS',
  ].map((key) => ({ key, lastChangedAt: null, lastChangedBy: null })),
  system: {
    version: '1.0.0',
    environment: 'Production',
    lastUpdatedAt: '2026-10-14T21:12:00Z',
    totalFirms: 24,
    totalUsers: 312,
  },
  maintenance: null,
  recentChanges: [
    {
      eventId: '00000000-0000-4000-8000-000000000001',
      label: 'Email settings updated',
      by: 'Super Admin',
      at: '2026-10-14T17:24:00Z',
    },
    {
      eventId: '00000000-0000-4000-8000-000000000002',
      label: 'Feature flag enabled: Advanced Reporting',
      by: 'Super Admin',
      at: '2026-10-13T14:17:00Z',
    },
    {
      eventId: '00000000-0000-4000-8000-000000000003',
      label: 'Password policy updated',
      by: 'Super Admin',
      at: '2026-10-12T11:03:00Z',
    },
    {
      eventId: '00000000-0000-4000-8000-000000000004',
      label: 'Branding settings updated',
      by: 'Super Admin',
      at: '2026-10-11T16:36:00Z',
    },
  ],
});

test.use({ timezoneId: 'UTC', viewport: { width: 1440, height: 1024 } });

async function assertFrames(page: Page) {
  await expect(page.getByRole('heading', { name: 'System Settings', exact: true })).toBeVisible();
  await expect(page.getByTestId('settings-category')).toHaveCount(9);
  await expect(page.getByRole('heading', { name: 'System Information' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent Changes' })).toBeVisible();
}

async function screenshot(page: Page, name: string) {
  // Hide only development overlays in review captures.
  await page.addStyleTag({
    content: '[data-testid="mock-badge"], nextjs-portal { display: none !important; }',
  });
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
}

async function mockSettingsHistory(page: Page) {
  await page.route('**/api/v1/admin/system-settings/history**', async (route) => {
    const section = new URL(route.request().url()).searchParams.get('section') ?? 'EMAIL';
    await route.fulfill({ json: { section, version: 1, items: [] } });
  });
}

test('overview matches the design regions and links to existing settings and audit pages', async ({
  page,
}) => {
  await page.route(endpoint, (route) => route.fulfill({ json: overview }));
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto(url);
  await assertFrames(page);
  await expect(page).toHaveTitle('System settings');
  const navigation = page.getByRole('navigation', { name: 'System settings', exact: true });
  await expect(navigation.getByRole('link')).toHaveCount(9);
  await expect(navigation.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const information = page.getByTestId('system-information');
  await expect(information.locator('dt')).toHaveCount(5);
  await expect(information.getByText('1.0.0', { exact: true })).toBeVisible();
  await expect(information.getByText('24', { exact: true })).toBeVisible();
  await expect(information.getByText('312', { exact: true })).toBeVisible();
  await expect(page.getByTestId('settings-preview')).toBeHidden();
  await expect(
    page.getByRole('list', { name: 'Recent settings changes' }).getByRole('listitem'),
  ).toHaveCount(4);
  await expect(page.getByRole('link', { name: 'Security Settings', exact: true })).toHaveAttribute(
    'href',
    '/audit-security',
  );
  await expect(
    page.getByRole('link', { name: 'Maintenance & Tools', exact: true }),
  ).toHaveAttribute('href', '/system-settings/configuration');
  await expect(page.getByRole('link', { name: 'View All', exact: true })).toHaveAttribute(
    'href',
    '/audit-security',
  );
  await expect(
    page.getByRole('link', { name: 'Email settings updated', exact: true }),
  ).toHaveAttribute('href', '/audit-security/events/00000000-0000-4000-8000-000000000001');
  await screenshot(page, 'reference-width');
  await page.setViewportSize({ width: 1440, height: 1024 });
  await screenshot(page, 'desktop');
  await page.getByRole('link', { name: 'General Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/system-settings\/general$/);
});

test('tablet and mobile keep every card readable without horizontal page overflow', async ({
  page,
}) => {
  await page.route(endpoint, (route) => route.fulfill({ json: overview }));
  await page.goto(url);
  await expect(
    page.getByTestId('system-information').getByText('312', { exact: true }),
  ).toBeVisible();
  for (const width of [1024, 820, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 1024 });
    await assertFrames(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const cards = page.getByTestId('settings-category');
    const first = await cards.nth(0).boundingBox();
    const second = await cards.nth(1).boundingBox();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (width === 1024) expect(first?.y).toBe(second?.y);
    if (width <= 375) expect(second?.y).toBeGreaterThan(first?.y ?? 0);
    await screenshot(page, `responsive-${width}`);
  }
  const navigation = page.getByRole('navigation', { name: 'System settings', exact: true });
  await navigation.getByRole('link', { name: 'Maintenance', exact: true }).scrollIntoViewIfNeeded();
  await expect(navigation.getByRole('link', { name: 'Maintenance', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('feature status legend explains default and emergency-off behavior', async ({ page }) => {
  await page.goto(`${url}/features`);
  const legend = page.getByTestId('status-legend');
  await expect(legend).toContainText('Off by default');
  await expect(legend).toContainText('Firms may turn this feature on');
  await expect(legend).toContainText('Emergency off');
  await expect(legend).toContainText('All firms, no override');
});

test('email branding deep link lands on the signature settings section', async ({ page }) => {
  await page.goto(`${url}/email-notifications#branding`);
  await expect(page.locator('#branding')).toBeVisible();
  await expect(page.locator('#branding')).toContainText('Email Signature');
});

test('billing and security alert recipients cannot be set to Nobody', async ({ page }) => {
  await mockSettingsHistory(page);
  await page.route('**/api/v1/admin/system-settings/email/status', (route) =>
    route.fulfill({
      json: {
        sender: 'LOG',
        customSmtp: false,
        lastTest: null,
        deliveryRate24h: null,
        bounced24h: null,
      },
    }),
  );
  await page.route('**/api/v1/admin/system-settings/email', (route) =>
    route.fulfill({
      json: {
        version: 1,
        updatedAt: '2026-10-14T12:00:00.000Z',
        updatedBy: null,
        smtpConfigured: false,
        value: {
          fromName: 'Firmivra',
          fromEmail: null,
          replyTo: null,
          cc: null,
          signature: null,
          includeSignature: true,
          channels: { email: true, inApp: true, sms: false, push: false },
          digest: false,
          recipients: {
            systemAlerts: 'SUPER_ADMINS',
            firmApplications: 'SUPER_ADMINS',
            billing: 'SUPER_ADMINS',
            securityAlerts: 'SUPER_ADMINS',
          },
          maxRetries: 3,
          retryBackoffMinutes: 15,
          dailyCapPerRecipient: 50,
        },
      },
    }),
  );
  await page.goto(`${url}/email-notifications`);
  await expect(
    page.getByLabel('Billing Notifications', { exact: true }).locator('option'),
  ).toHaveText(['Super Admin Only', 'All Admins']);
  await expect(page.getByLabel('Security Alerts', { exact: true }).locator('option')).toHaveText([
    'Super Admin Only',
    'All Admins',
  ]);
  await expect(page.getByLabel('System Alerts', { exact: true }).locator('option')).toHaveText([
    'Super Admin Only',
    'All Admins',
    'Nobody',
  ]);
});

test('maintenance preview shows ET and UTC and rejects an end before the start', async ({
  page,
}) => {
  await page.route('**/api/v1/admin/system-settings/health', (route) =>
    route.fulfill({
      json: {
        checkedAt: '2026-11-23T14:00:00.000Z',
        services: [{ key: 'api', status: 'ONLINE', detail: null }],
      },
    }),
  );
  await page.route('**/api/v1/admin/system-settings/jobs', (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route('**/api/v1/admin/system-settings/maintenance', (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.goto(`${url}/configuration`);
  await page.getByRole('button', { name: 'Schedule Maintenance' }).click();
  const dialog = page.getByRole('dialog', { name: 'Schedule Maintenance' });
  const starts = dialog.getByLabel('Starts (America/New_York)');
  const ends = dialog.getByLabel('Ends (America/New_York)');
  await dialog.getByLabel('Title', { exact: true }).fill('Synthetic maintenance');
  await dialog.getByLabel('Message to users').fill('<b>Scheduled work</b>');
  await starts.fill('2026-11-23T09:00');
  await ends.fill('2026-11-23T10:00');
  const preview = dialog.getByTestId('maintenance-time-preview');
  await expect(preview).toContainText('Starts — ET:');
  await expect(preview).toContainText('UTC: Nov 23, 2026, 2:00 PM');
  await expect(preview).toContainText('Ends — ET:');
  await expect(preview).toContainText('Synthetic maintenance');
  await expect(preview).toContainText('<b>Scheduled work</b>');
  await expect(preview.locator('b')).toHaveCount(0);
  await ends.fill('2026-11-23T08:00');
  await expect(dialog.getByRole('alert')).toHaveText('End after the start.');
  await expect(dialog.getByRole('button', { name: 'Schedule' })).toBeDisabled();
  await starts.fill('2027-03-14T02:30');
  await expect(dialog.getByRole('alert')).toHaveText('Enter a valid Eastern time.');
});

test('loading and empty results preserve the widgets and do not invent platform values', async ({
  page,
}) => {
  let release: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(endpoint, async (route) => {
    await pending;
    await route.fulfill({
      json: {
        ...overview,
        system: { ...overview.system, totalFirms: 0, totalUsers: 0, lastUpdatedAt: null },
        recentChanges: [],
      },
    });
  });
  await page.goto(url);
  await assertFrames(page);
  await expect(page.getByTestId('system-information')).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByText('Loading recent changes')).toBeAttached();
  await screenshot(page, 'loading');
  release();
  await expect(page.getByText('No recent changes yet.')).toBeVisible();
  await expect(page.getByTestId('system-information').getByText('0', { exact: true })).toHaveCount(
    2,
  );
  await expect(page.getByTestId('system-information').getByText('—', { exact: true })).toHaveCount(
    1,
  );
  await assertFrames(page);
  await screenshot(page, 'empty');
});

test('an unreachable API preserves every widget and retry restores the real response', async ({
  page,
}) => {
  await page.route(endpoint, (route) => route.abort());
  await page.goto(url);
  await expect(page.getByTestId('page-error')).toBeVisible();
  await assertFrames(page);
  await expect(page.getByText('Recent changes are unavailable.')).toBeVisible();
  await expect(page.getByTestId('system-information').getByText('—', { exact: true })).toHaveCount(
    5,
  );
  await expect(page.getByRole('link', { name: 'General Settings', exact: true })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await screenshot(page, 'api-unavailable');
  await page.unroute(endpoint);
  await page.route(endpoint, (route) => route.fulfill({ json: overview }));
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(
    page.getByTestId('system-information').getByText('312', { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('page-error')).toBeHidden();
});

test('forbidden data stays hidden and unavailable categories cannot be opened', async ({
  page,
}) => {
  await page.route(endpoint, (route) =>
    route.fulfill({
      status: 403,
      json: {
        error: { code: 'FORBIDDEN', message: 'Access denied', requestId: 'system-settings-test' },
      },
    }),
  );
  await page.goto(url);
  await expect(page.getByTestId('page-forbidden')).toBeVisible();
  await expect(page.getByTestId('settings-preview')).toBeHidden();
  await assertFrames(page);
  await expect(
    page.getByTestId('system-information').getByText('312', { exact: true }),
  ).toBeHidden();
  await expect(
    page.getByTestId('settings-category').getByRole('link', { disabled: true }),
  ).toHaveCount(9);
  await screenshot(page, 'forbidden');
});

test('a missing local settings endpoint shows labelled design data instead of a missing-page error', async ({
  page,
}) => {
  await page.route(endpoint, (route) =>
    route.fulfill({
      status: 404,
      json: {
        error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'settings-preview-test' },
      },
    }),
  );
  await page.goto(url);
  await expect(page.getByTestId('settings-preview')).toHaveText('Preview data');
  await expect(page.getByTestId('page-not-found')).toBeHidden();
  await expect(page.getByTestId('page-error')).toBeHidden();
  await assertFrames(page);
  const information = page.getByTestId('system-information');
  await expect(information.getByText('1.0.0', { exact: true })).toBeVisible();
  await expect(information.getByText('Production', { exact: true })).toBeVisible();
  await expect(information.getByText('24', { exact: true })).toBeVisible();
  await expect(information.getByText('312', { exact: true })).toBeVisible();
  await expect(information.getByText('—', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('list', { name: 'Recent settings changes' }).getByRole('listitem'),
  ).toHaveCount(4);
  await expect(page.getByRole('link', { name: 'General Settings', exact: true })).toHaveAttribute(
    'href',
    '/system-settings/general',
  );
  await screenshot(page, 'local-preview-desktop');
  for (const width of [1440, 375, 320]) {
    await page.setViewportSize({ width, height: 1024 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await screenshot(page, 'local-preview');
});

test('View Audit Logs opens the System Settings event filter', async ({ page }) => {
  await page.goto(`${url}/general`);
  await expect(
    page.getByTestId('quick-links').getByRole('link', { name: 'View Audit Logs' }),
  ).toHaveAttribute('href', '/audit-security?view=settings');
});
