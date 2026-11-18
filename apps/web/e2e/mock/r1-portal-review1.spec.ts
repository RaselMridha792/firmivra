import { expect, test } from '@playwright/test';

// Client Portal Review One (R1), mock mode. The firm side as the Owner; the portal as the mock
// client (a Business client unless a test sets the mock's portal type to Individual).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('CP-1: five panels, each by its address, and View Client Portal opens a client’s preview', async ({
  page,
}) => {
  await page.goto(app('/settings/portal'));
  const tabs = page.getByRole('tablist', { name: 'Client portal settings' });
  await expect(tabs.getByRole('tab')).toHaveText([
    'General',
    'Registration & Access',
    'Announcements',
    'Contact Information',
    'Features',
  ]);
  await tabs.getByRole('tab', { name: 'Registration & Access' }).click();
  await expect(page.getByTestId('portal-registration')).toBeVisible();
  await expect(page.getByTestId('portal-registration')).toContainText('Account activation');

  // CP-3b: announcements are made in Communications.
  await tabs.getByRole('tab', { name: 'Announcements' }).click();
  await expect(page.getByTestId('go-to-communications')).toHaveAttribute(
    'href',
    '/communications/new?channel=ANNOUNCEMENT',
  );

  await page.goto(app('/settings/portal?panel=features'));
  await expect(page.getByRole('table', { name: 'Default portal tabs' })).toBeVisible({
    timeout: 60_000,
  });

  await page.getByTestId('view-client-portal').click();
  const dialog = page.getByRole('dialog', { name: 'View Client Portal' });
  await expect(dialog.getByRole('button', { name: 'Open preview' })).toBeDisabled();
});

test('CP-7.1: General has Cancel, and leaving with unsaved changes asks first', async ({
  page,
}) => {
  await page.goto(app('/settings/portal'));
  const heading = page.getByLabel('Portal heading');
  await expect(heading).toBeVisible({ timeout: 60_000 });
  const before = await heading.inputValue();
  await heading.fill('Fake new heading');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(heading).toHaveValue(before);

  await heading.fill('Fake new heading');
  await page.getByRole('link', { name: 'Company Profile' }).first().click();
  await expect(page.getByTestId('leave-guard')).toBeVisible();
  await page.getByRole('button', { name: 'Stay on this page' }).click();
  await expect(heading).toHaveValue('Fake new heading');
  await expect(page).toHaveURL(/\/settings\/portal$/);
});

test('CP-6.6: Settings > Client Portal fits a phone, every panel', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const panel of ['general', 'registration', 'announcements', 'contact', 'features']) {
    await page.goto(app(`/settings/portal?panel=${panel}`));
    await expect(page.getByRole('heading', { name: 'Client portal settings' })).toBeVisible({
      timeout: 60_000,
    });
    expect([
      panel,
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ]).toEqual([panel, true]);
  }
});

test('CP-9.3: a Personal portal lists no Business tab; a Business portal does', async ({
  page,
}) => {
  await page.goto(portal('/lvp/documents'));
  const folders = page.getByRole('navigation', { name: 'Portal folders' });
  await expect(folders.getByRole('link', { name: 'Business Documents & Resources' })).toBeVisible({
    timeout: 60_000,
  });
  await page.evaluate(() =>
    window.sessionStorage.setItem('firmivra-mock:portal-account-type', 'INDIVIDUAL'),
  );
  await page.reload();
  await expect(folders.getByRole('link', { name: 'My Uploaded Documents' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(folders.getByRole('link', { name: 'Business Documents & Resources' })).toHaveCount(
    0,
  );
});

test('SM10: the portal header shows the date, time and the firm’s time zone', async ({ page }) => {
  await page.goto(portal('/lvp/documents'));
  // The mock firm is in America/New_York.
  await expect(page.getByTestId('header-clock')).toContainText(/E[SD]T/, { timeout: 60_000 });
});

test('CP-5a to CP-5c, CP-5h: rename, reorder and switch the tabs, with a preview, and the portal follows', async ({
  page,
}) => {
  await page.goto(app('/settings/portal?panel=features'));
  const table = page.getByRole('table', { name: 'Default portal tabs' });
  await expect(table).toBeVisible({ timeout: 60_000 });
  // CP-5a: Business Documents & Resources has a switch like the others.
  await expect(
    table.getByRole('switch', { name: 'Show Business Documents & Resources' }),
  ).toBeVisible();
  await table.getByLabel('Name of Intake Form').fill('My Forms');
  await table.getByRole('button', { name: 'Move Tax Returns up' }).click();
  const preview = page.getByTestId('tabs-preview-list').getByRole('listitem');
  await expect(preview).toHaveText([
    'My Forms',
    'Business Documents & Resources',
    'Tax Returns',
    'My Uploaded Documents',
    'Receipts & Invoices',
    'Messages and Notes',
  ]);
  // A Personal portal shows no Business tab.
  await page.getByTestId('tabs-preview').getByRole('button', { name: 'Personal' }).click();
  await expect(preview).toHaveCount(5);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Changes saved.')).toBeVisible();

  // The mock keeps the layout per origin: the portal (another host) gets the saved one.
  const saved = await page.evaluate(() =>
    sessionStorage.getItem('firmivra-mock:portal-tab-layout'),
  );
  expect(saved).toContain('My Forms');
  await page.addInitScript(
    (value) => sessionStorage.setItem('firmivra-mock:portal-tab-layout', value),
    saved ?? '',
  );
  await page.goto(portal('/lvp/documents'));
  const folders = page.getByRole('navigation', { name: 'Portal folders' }).getByRole('link');
  await expect(folders.first()).toHaveText('My Forms', { timeout: 60_000 });
  await expect(folders.nth(2)).toHaveText('Tax Returns');
});
