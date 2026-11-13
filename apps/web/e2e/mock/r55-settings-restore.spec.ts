import {
  AdminGeneralSection,
  AdminRestorePreview,
  AdminRestoreResult,
  AdminSettingsHistory,
} from '@firmivra/types';
import { expect, test } from '@playwright/test';

// R55, SA-SYS-A2: System Settings > General's Change History and Compare & Restore, with the API's
// answers routed in the page (the admin console reads the API, not the mock). A save is compared
// with now; the text it changed is named but not restored; Restore needs the password, and a
// wrong one is said on the password field. Synthetic data only, checked against the contract.
const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
const S = /\/api\/v1\/admin\/system-settings/;
const route = (path: string) => new RegExp(`${S.source}${path}$`);
const eventId = '0199c0e0-5a00-7000-8000-000000000001';

const general = AdminGeneralSection.parse({
  version: 4,
  updatedAt: '2026-11-09T15:00:00Z',
  updatedBy: 'Fake Super Admin',
  value: {
    platformName: 'Firmivra',
    tagline: 'A fake tagline for the review',
    supportEmail: null,
    supportPhone: null,
    defaultTimeZone: 'America/New_York',
    defaultLocale: 'en-US',
    defaultCurrency: 'USD',
    dateFormat: 'MM/DD/YYYY',
    timeFormat: '24H',
    numberFormat: '1,234.56',
    preferences: {
      darkModeOption: true,
      productUpdates: true,
      helpCenter: true,
      userFeedback: true,
      maintenanceBanner: true,
      betaFeatures: true,
    },
  },
});
const history = AdminSettingsHistory.parse({
  section: 'general',
  version: 4,
  items: [
    {
      eventId,
      at: '2026-11-09T15:00:00Z',
      by: 'Fake Super Admin',
      kind: 'SAVED',
      fromVersion: 3,
      changes: [
        { field: 'preferences.betaFeatures', kept: true, from: false, to: true },
        { field: 'tagline', kept: false, from: null, to: null },
        { field: 'timeFormat', kept: true, from: '12H', to: '24H' },
      ],
    },
  ],
});
const preview = AdminRestorePreview.parse({
  section: 'general',
  eventId,
  version: 4,
  fields: [
    { field: 'preferences.betaFeatures', current: true, restoreTo: false },
    { field: 'timeFormat', current: '24H', restoreTo: '12H' },
  ],
  unchanged: [],
  notKept: ['tagline'],
});

test('compares a save with now and restores its kept values with the password', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route(route('/general'), (r) => r.fulfill({ json: general }));
  await page.route(route('/branding'), (r) => r.abort());
  await page.route(route('/history\\?section=general'), (r) => r.fulfill({ json: history }));
  await page.route(route('/restore/preview'), (r) => r.fulfill({ json: preview }));
  const sent: { password?: string; version?: number }[] = [];
  await page.route(route('/restore'), (r) => {
    const body = r.request().postDataJSON() as { password: string; version: number };
    sent.push(body);
    return body.password === 'right-password'
      ? r.fulfill({
          json: AdminRestoreResult.parse({
            section: 'general',
            version: 5,
            restored: ['preferences.betaFeatures', 'timeFormat'],
          }),
        })
      : r.fulfill({
          status: 400,
          json: {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Your password is not right',
              details: [{ path: 'password', message: 'Your password is not right' }],
            },
          },
        });
  });

  await page.goto(`http://admin.localhost:${port}/system-settings/general`);
  const card = page.getByTestId('settings-history');
  await expect(card).toContainText('Saved');
  await expect(card).toContainText('Preferences › Beta features, Tagline, Time format');
  await card.getByRole('button', { name: /Compare & Restore/ }).click();

  const dialog = page.getByTestId('restore-dialog');
  const rows = dialog.getByRole('row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toHaveText(/Preferences › Beta features\s*On\s*Off/);
  await expect(rows.nth(2)).toHaveText(/Time format\s*24H\s*12H/);
  await expect(dialog).toContainText('Not restored (text and long values are not kept');
  await expect(dialog).toContainText('Tagline');
  const restore = page.getByRole('button', { name: 'Restore', exact: true });
  await expect(restore).toBeDisabled();
  await page.screenshot({ path: 'test-results/r55-settings-restore-1440.png' });

  await dialog.getByLabel('Your password').fill('wrong-password');
  await restore.click();
  await expect(dialog.getByText('Your password is not right')).toBeVisible();
  await dialog.getByLabel('Your password').fill('right-password');
  await restore.click();
  await expect(dialog).toHaveCount(0);
  await expect(card.getByRole('status')).toHaveText('2 values restored.');
  expect(sent.map((b) => b.version)).toEqual([4, 4]);
});
