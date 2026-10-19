import {
  AdminBrandingSection,
  AdminGeneralSection,
  AdminGeneralSettings,
  AdminSettingsOverview,
  SaveAdminGeneralRequest,
} from '@firmivra/types';
import { expect, test, type Page } from '@playwright/test';

const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
const url = `http://admin.localhost:${port}/system-settings/general`;
const generalUrl = '**/api/v1/admin/system-settings/general';
const overviewUrl = '**/api/v1/admin/system-settings';
const brandingUrl = '**/api/v1/admin/system-settings/branding';

const general = AdminGeneralSection.parse({
  version: 1,
  updatedAt: '2026-10-14T21:12:00Z',
  updatedBy: 'Octavia Holder',
  value: {
    platformName: 'Firmivra',
    tagline: 'All-in-One Business Management Platform',
    supportEmail: 'support@firmivra.com',
    supportPhone: '+1 (404) 555-0187',
    defaultTimeZone: 'America/New_York',
    defaultLocale: 'en-US',
    defaultCurrency: 'USD',
    dateFormat: 'MM/DD/YYYY',
    timeFormat: '12H',
    numberFormat: '1,234.56',
    preferences: {
      darkModeOption: true,
      productUpdates: true,
      helpCenter: true,
      userFeedback: true,
      maintenanceBanner: false,
      betaFeatures: false,
    },
  },
});

const overview = AdminSettingsOverview.parse({
  categories: [],
  system: {
    version: '1.0.0',
    environment: 'Production',
    totalFirms: 24,
    totalUsers: 312,
    lastUpdatedAt: '2026-10-14T21:12:00Z',
  },
  maintenance: null,
  recentChanges: [],
});

const branding = AdminBrandingSection.parse({
  version: 1,
  updatedAt: '2026-10-14T21:12:00Z',
  updatedBy: 'Octavia Holder',
  value: {
    tagline: 'All-in-One Business Management Platform',
    description: null,
    colors: {
      primary: null,
      secondary: null,
      accent: null,
      background: null,
      text: null,
      sidebar: null,
    },
    appearance: 'LIGHT',
    allowUserAppearance: true,
    sidebarStyle: 'EXPANDED',
    borderRadius: 'MEDIUM',
    login: { showLogo: true, showTagline: true },
    portal: { usePlatformBranding: true, allowFirmBranding: true },
  },
  assets: { LOGO: null, LOGO_DARK: null, FAVICON: null, APP_ICON: null, LOGIN_BACKGROUND: null },
});

test.use({ timezoneId: 'UTC', viewport: { width: 1440, height: 1024 } });

async function mockSettings(page: Page, value = general) {
  await page.route(generalUrl, (route) => route.fulfill({ json: value }));
  await page.route(overviewUrl, (route) => route.fulfill({ json: overview }));
  await page.route(brandingUrl, (route) => route.fulfill({ json: branding }));
}

async function assertFrames(page: Page) {
  for (const section of [
    'platform-information',
    'localization',
    'system-preferences',
    'settings-important',
    'current-configuration',
    'quick-links',
  ]) {
    await expect(page.getByTestId(section)).toBeVisible();
  }
}

async function capture(page: Page, name: string) {
  await page.addStyleTag({
    content: '[data-testid="mock-badge"], nextjs-portal { display: none !important; }',
  });
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
}

test('matches the General Settings design and saves through the typed API', async ({ page }) => {
  await mockSettings(page);
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'General Settings', exact: true })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'General settings sections' }).getByRole('link'),
  ).toHaveCount(5);
  await expect(page.getByRole('button', { name: 'Legal & Compliance' })).toBeDisabled();
  await expect(page.getByLabel('Platform Name')).toHaveValue('Firmivra');
  await expect(page.getByLabel('Default Timezone')).toHaveValue('America/New_York');
  await expect(page.getByRole('switch')).toHaveCount(6);
  await expect(
    page.getByTestId('current-configuration').getByText('24', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'View Audit Logs' })).toHaveAttribute(
    'href',
    '/audit-security',
  );
  await expect(page.getByTestId('settings-preview')).toBeHidden();
  await assertFrames(page);
  const pageLogo = page.locator('#platform-information img[alt="Firmivra"]');
  await expect(pageLogo).toBeVisible();
  await expect
    .poll(() => pageLogo.evaluate((image) => (image as HTMLImageElement).naturalWidth > 0))
    .toBe(true);
  await capture(page, 'data-1440');
  await page.setViewportSize({ width: 1536, height: 1024 });
  await capture(page, 'data-1536');
  await page.setViewportSize({ width: 1440, height: 1024 });

  await page.getByLabel('Support Phone (Optional)').fill('+1 (404) 555-0100');
  let saved: SaveAdminGeneralRequest | undefined;
  await page.route(generalUrl, async (route) => {
    if (route.request().method() === 'PUT') {
      saved = SaveAdminGeneralRequest.parse(route.request().postDataJSON());
      await route.fulfill({
        json: { ...general, version: 2, value: AdminGeneralSettings.parse(saved.value) },
      });
      return;
    }
    await route.fulfill({ json: general });
  });
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'General settings saved.' }),
  ).toBeVisible();
  expect(saved?.version).toBe(1);
  expect(saved?.value.supportPhone).toBe('+1 (404) 555-0100');
  await expect(page.getByLabel('Support Phone (Optional)')).toHaveValue('+1 (404) 555-0100');
});

test('stacks sections and controls at tablet and mobile widths without page overflow', async ({
  page,
}) => {
  await mockSettings(page);
  await page.goto(url);
  await expect(page.getByLabel('Platform Name')).toHaveValue('Firmivra');
  for (const width of [1280, 1024, 820, 768, 375, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await assertFrames(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    const tabs = page.getByRole('navigation', { name: 'General settings sections' });
    await expect(tabs).toBeVisible();
    if (width === 375) await capture(page, 'data-375');
  }
});

test('empty settings keep every panel and do not invent configuration values', async ({ page }) => {
  await page.route(generalUrl, (route) =>
    route.fulfill({
      status: 404,
      json: {
        error: { code: 'NOT_FOUND', message: 'Not found', requestId: 'general-settings-empty' },
      },
    }),
  );
  await page.goto(url);
  await expect(page.getByTestId('settings-preview')).toHaveText('Preview data');
  await expect(
    page.getByRole('status').filter({ hasText: 'No general settings are available.' }),
  ).toBeVisible();
  await expect(page.getByLabel('Platform Name')).toHaveValue('');
  await expect(page.getByLabel('Default Timezone')).toHaveValue('');
  await expect(
    page.getByTestId('current-configuration').getByText('24', { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByTestId('current-configuration').getByText('—', { exact: true }),
  ).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  await assertFrames(page);
  await capture(page, 'empty-1440');
});

test('an unreachable general settings API preserves all sections and allows retry', async ({
  page,
}) => {
  await page.route(generalUrl, (route) => route.abort());
  await page.goto(url);
  await expect(page.getByTestId('page-error')).toBeVisible();
  await expect(
    page.getByText("We can't reach Firmivra. Check your connection and try again."),
  ).toBeVisible();
  await expect(page.getByTestId('settings-preview')).toBeHidden();
  await expect(page.getByLabel('Platform Name')).toBeDisabled();
  await expect(
    page.getByTestId('current-configuration').getByText('—', { exact: true }),
  ).toHaveCount(6);
  await assertFrames(page);
  await capture(page, 'api-unavailable-1440');

  await page.unroute(generalUrl);
  await mockSettings(page);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByLabel('Platform Name')).toHaveValue('Firmivra');
  await expect(page.getByTestId('page-error')).toBeHidden();
});

test('forbidden settings stay hidden and editing is disabled', async ({ page }) => {
  await page.route(generalUrl, (route) =>
    route.fulfill({
      status: 403,
      json: {
        error: {
          code: 'FORBIDDEN',
          message: 'Access denied',
          requestId: 'general-settings-forbidden',
        },
      },
    }),
  );
  await page.goto(url);
  await expect(page.getByTestId('page-forbidden')).toBeVisible();
  await expect(page.getByLabel('Platform Name')).toHaveValue('');
  await expect(page.getByLabel('Platform Name')).toBeDisabled();
  await expect(page.getByTestId('settings-preview')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Save Changes' })).toBeDisabled();
  await assertFrames(page);
});

test('high-impact preferences require confirmation before saving', async ({ page }) => {
  await mockSettings(page);
  await page.route(generalUrl, async (route) => {
    if (route.request().method() === 'PUT') {
      const body = SaveAdminGeneralRequest.parse(route.request().postDataJSON());
      await route.fulfill({ json: { ...general, version: 2, value: body.value } });
    } else await route.fulfill({ json: general });
  });
  await page.goto(url);
  await expect(page.getByRole('switch', { name: 'Enable Beta Features' })).toBeVisible();
  await page.getByRole('switch', { name: 'Enable Beta Features' }).click();
  await page.getByRole('button', { name: 'Save Changes' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Save platform preferences?' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Confirm changes' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'General settings saved.' }),
  ).toBeVisible();
});
