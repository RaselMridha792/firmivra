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

test('CP-3c, CP-3d, CP-3h, CP-3i: the announcement switches and channel policy, with a preview', async ({
  page,
}) => {
  await page.goto(app('/settings/portal?panel=announcements'));
  const panel = page.getByTestId('portal-announcements');
  const preview = page.getByTestId('announcements-preview');
  await expect(panel.getByRole('switch', { name: 'Enable announcements' })).toBeChecked({
    timeout: 60_000,
  });
  await expect(preview).toContainText('Extended Office Hours');
  await panel.getByLabel('General announcements by email').selectOption('REQUIRED');
  await expect(page.getByTestId('announcements-preview-options')).toContainText(
    'Always on (required)',
  );
  // Texts can never be required: the choice isn't offered.
  await expect(
    panel.getByLabel('General announcements by text').locator('option[value="REQUIRED"]'),
  ).toHaveCount(0);
  await panel.getByRole('switch', { name: 'Show announcements on client dashboard' }).click();
  await expect(preview).toContainText('Not shown on the dashboard.');
  await panel.getByRole('switch', { name: 'Enable announcements' }).click();
  await expect(preview).toContainText('Announcements are off');
  await panel.getByRole('button', { name: 'Save changes' }).click();
  await expect(panel.getByText('Changes saved.')).toBeVisible();
});

test('CP-1g: the button text and device sizes in General, and Portal Appearance goes to Branding', async ({
  page,
}) => {
  await page.goto(app('/settings/portal'));
  await expect(page.getByLabel('Sign in button text')).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Sign in button text').fill('Log In');
  const preview = page.getByTestId('brand-preview');
  await expect(preview).toContainText('Log In');
  await page.getByRole('button', { name: 'Phone preview' }).click();
  await expect(preview).toHaveAttribute('data-device', 'phone');
  await expect(page.getByRole('link', { name: 'Go to Branding' })).toHaveAttribute(
    'href',
    '/settings/branding',
  );
});

test('CP-5d, CP-5e: custom tabs: add, choose who sees them, switch and archive; the portal lists and opens them', async ({
  page,
}) => {
  await page.goto(app('/settings/portal?panel=features'));
  const card = page.getByTestId('portal-custom-tabs');
  await expect(card.getByText('No custom tabs yet.')).toBeVisible({ timeout: 60_000 });
  const add = async (name: string, then?: () => Promise<void>) => {
    await card.getByRole('button', { name: 'Add Custom Tab' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add Custom Tab' });
    await dialog.getByLabel('Tab name (client view)').fill(name);
    await then?.();
    await dialog.getByRole('button', { name: 'Add tab' }).click();
    return dialog;
  };
  // A built-in tab's name is taken.
  const taken = await add('Messages and Notes');
  await expect(taken.getByRole('alert')).toHaveText(
    'Another tab already has this name. Give this tab its own.',
  );
  await taken.getByLabel('Tab name (client view)').fill('Payroll Files');
  await taken.getByRole('button', { name: 'Add tab' }).click();
  await expect(taken).toBeHidden();
  await expect(card.getByTestId('custom-tab-Payroll Files')).toContainText('All business clients');

  // For one chosen client (the mock portal's client), reusing business resources.
  await add('Partner Resources', async () => {
    const dialog = page.getByRole('dialog', { name: 'Add Custom Tab' });
    await dialog.getByLabel('Function').selectOption('BUSINESS_RESOURCES');
    await dialog.getByLabel('Chosen business clients').check();
    await dialog.getByRole('button', { name: 'Add tab' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Choose at least one client.');
    await dialog.getByRole('button', { name: /Add a client/ }).click();
    const picker = page.getByRole('dialog', { name: 'Choose a client' });
    await picker.getByPlaceholder('Search by name, email or phone…').fill('Jamie');
    await picker.getByRole('button', { name: /Jamie Sample/ }).click();
    await expect(dialog.getByRole('list', { name: 'Chosen clients' })).toHaveText(/Jamie Sample/);
  });
  await expect(card.getByTestId('custom-tab-Partner Resources')).toContainText('Jamie Sample');

  // Switched off, and archived: neither shows in the portal.
  await add('Paused Tab');
  await card.getByRole('switch', { name: 'Show Paused Tab' }).click();
  await expect(card.getByRole('switch', { name: 'Show Paused Tab' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await add('Old Tab');
  await card.getByRole('button', { name: 'Archive Old Tab' }).click();
  await page
    .getByRole('dialog', { name: 'Archive Old Tab?' })
    .getByRole('button', { name: 'Archive' })
    .click();
  await expect(card.getByTestId('custom-tab-Old Tab')).toHaveCount(0);

  // The mock keeps the tabs per origin: the portal (another host) gets the saved ones.
  const saved = await page.evaluate(() =>
    sessionStorage.getItem('firmivra-mock:portal-custom-tabs'),
  );
  await page.addInitScript(
    (value) => sessionStorage.setItem('firmivra-mock:portal-custom-tabs', value),
    saved ?? '[]',
  );
  await page.goto(portal('/lvp/documents'));
  const folders = page.getByRole('navigation', { name: 'Portal folders' }).getByRole('link');
  await expect(folders).toHaveCount(8, { timeout: 60_000 });
  await expect(folders.nth(6)).toHaveText('Payroll Files');
  await expect(folders.nth(7)).toHaveText('Partner Resources');

  // A document tab: the upload keeps the tab, and its list shows only its files.
  await folders.nth(6).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Payroll Files' })).toBeVisible();
  await expect(page.getByText('No documents yet')).toBeVisible();
  await page.getByRole('button', { name: 'Upload Documents' }).click();
  const dialog = page.getByRole('dialog', { name: 'Upload Documents' });
  await dialog.getByRole('button', { name: /Upload more tax documents/ }).click();
  await dialog.getByLabel('File').setInputFiles({
    name: 'Synthetic_Payroll.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 synthetic'),
  });
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('row').filter({ hasText: 'Synthetic_Payroll.pdf' })).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(2);

  // A resources tab shows the business resources under its own name.
  await folders.nth(7).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Partner Resources' })).toBeVisible();

  // A Personal portal lists no custom tab, and a tab's address says it isn't available.
  await page.evaluate(() =>
    window.sessionStorage.setItem('firmivra-mock:portal-account-type', 'INDIVIDUAL'),
  );
  await page.reload();
  await expect(page.getByText("This tab isn't available")).toBeVisible({ timeout: 60_000 });
  await expect(folders).toHaveCount(5);
});
