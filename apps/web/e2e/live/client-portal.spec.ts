import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  app,
  apiAs,
  as,
  expectNoSideScroll,
  portal,
  portalApi,
  runTag,
  settled,
  shot,
} from './helpers';

/**
 * Client Portal, live on dev (Test Firm B). Rows: docs/qa/client-portal.md (firm side, ids CP-F1,
 * CP-F2, CP-F3, CP-IF, CP-R) plus the portal rows of the Appointments, Tax Returns, Payroll and
 * Bookkeeping reviews (CP-PT). qa-client-b is QA Fixture Client 1's portal login and is also
 * Octavia's: nothing here changes its settings, and every write is on Fixture Client 2 (no login)
 * or is a LIVE-CHECK internal note deleted in the same test.
 */
const TAB = 'client-portal';
const C1 = '00000000-0000-4a28-8001-000000000002'; // QA Fixture Client 1, CL-10001, has the login
const C2 = '00000000-0000-4a28-8001-000000000003'; // QA Fixture Client 2, CL-10002, no login
const manage = (id: string, sub = '') => app(`/client-portal/${id}${sub ? `/${sub}` : ''}`);

/** Records 5xx answers from the API during a test, for the report. */
function watch5xx(page: Page, info: TestInfo) {
  page.on('response', (r) => {
    if (r.url().includes('/api/v1/') && r.status() >= 500) {
      info.annotations.push({
        type: '5xx',
        description: `${r.status()} ${new URL(r.url()).pathname}`,
      });
    }
  });
}

async function open(page: Page, url: string, info: TestInfo) {
  watch5xx(page, info);
  await page.goto(url);
  await settled(page);
}

/** The visible, non-empty text of an error alert on the page, if any. */
const errorAlerts = (page: Page) => page.locator('[role="alert"]').filter({ hasText: /\S/ });

test.describe('firm side as Owner', () => {
  test.use(as('owner'));

  test('CP-F1-01 sidebar Client Portal opens the module', async ({ page }, info) => {
    await open(page, app('/'), info);
    await page.getByRole('link', { name: 'Client Portal', exact: true }).click();
    await expect(page).toHaveURL(/\/client-portal$/);
    await expect(page.getByTestId('client-portal')).toBeVisible();
    await shot(page, TAB, 'CP-F1-01', info);
  });

  test('@narrow CP-F1-02 page title and subtitle; no sideways scroll', async ({ page }, info) => {
    await open(page, app('/client-portal'), info);
    await expect(page.getByTestId('page-title')).toHaveText(/Client Portal/);
    await expect(page.getByText(/View a client.s portal, switch between clients/)).toBeVisible();
    await expect(page).toHaveTitle(/Client Portal/);
    await expectNoSideScroll(page);
    await shot(page, TAB, 'CP-F1-02', info);
  });

  test('CP-F1-03 Switch Client searches by name, email and Client ID', async ({ page }, info) => {
    await open(page, app('/client-portal'), info);
    const switcher = page.getByTestId('client-switcher');
    for (const term of ['Fixture Client 2', 'qa-fixture-2@example.test', 'CL-10002']) {
      await switcher.locator('button').first().click();
      // The Clients list below has a field with the same label: use the switcher's placeholder.
      await page.getByPlaceholder('Name, email, phone, company or Client ID').fill(term);
      const list = page.getByRole('listbox', { name: 'Clients' });
      await expect(list.getByText('QA Fixture Client 2')).toBeVisible();
      await expect(list.getByText('QA Fixture Client 3')).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
    await switcher.locator('button').first().click();
    await page.getByPlaceholder('Name, email, phone, company or Client ID').fill('CL-10002');
    await page.getByRole('listbox', { name: 'Clients' }).getByText('QA Fixture Client 2').click();
    await expect(page).toHaveURL(new RegExp(`client=${C2}`));
    await expect(page.getByTestId('client-portal-name')).toHaveText('QA Fixture Client 2');
    await shot(page, TAB, 'CP-F1-03', info);
  });

  test('CP-F1-04 Recent Clients: newest first, one click switches', async ({ page }, info) => {
    await open(page, app(`/client-portal?client=${C2}`), info);
    await expect(page.getByTestId('client-portal-name')).toHaveText('QA Fixture Client 2');
    await page.goto(app(`/client-portal?client=${C1}`));
    await settled(page);
    await expect(page.getByTestId('client-portal-name')).toHaveText('QA Fixture Client 1');
    await page.reload();
    await settled(page);
    const recent = page.getByTestId('recent-clients');
    await expect(recent).toBeVisible();
    const names = await recent.getByRole('button').allInnerTexts();
    const i1 = names.findIndex((n) => n.includes('QA Fixture Client 1'));
    const i2 = names.findIndex((n) => n.includes('QA Fixture Client 2'));
    expect(i1, 'client 1 in Recent').toBeGreaterThanOrEqual(0);
    expect(i2, 'client 2 in Recent').toBeGreaterThan(i1);
    await recent.getByRole('button').nth(i2).click();
    await expect(page.getByTestId('client-portal-name')).toHaveText('QA Fixture Client 2');
    await shot(page, TAB, 'CP-F1-04', info);
  });

  test('CP-F1-05 Clients list: search, status, service, rows, pages', async ({ page }, info) => {
    await open(page, app('/client-portal'), info);
    const list = page.getByTestId('portal-client-list');
    await expect(list.getByTestId('portal-client-row').first()).toBeVisible();
    await expect(list.getByText(/Showing 1 – \d+ of \d+ clients/)).toBeVisible();
    const rows = list.getByTestId('portal-client-row');
    await expect(rows.filter({ hasText: 'QA Fixture Client 1' })).toContainText('Individual');
    await expect(rows.filter({ hasText: 'QA Fixture Client 1' })).toContainText('New Client');
    await list.getByLabel('Search clients').fill('Fixture Client 3');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('QA Fixture Client 3');
    await list.getByLabel('Search clients').fill('');
    await list.getByLabel('Status').selectOption({ label: 'On Hold' });
    await expect(rows).toHaveCount(0);
    await expect(list).toContainText(/No clients|no clients|Nothing/i);
    await list.getByLabel('Status').selectOption({ label: 'New Client' });
    await expect(rows.first()).toBeVisible();
    await expect(list.getByLabel('Service')).toBeVisible();
    await expect(list.getByRole('button', { name: 'Next' })).toBeVisible();
    await shot(page, TAB, 'CP-F1-05', info);
  });

  test('CP-F1-06 active client kept in the address; last client reopened', async ({
    page,
  }, info) => {
    await open(page, app(`/client-portal?client=${C1}`), info);
    await expect(page.getByTestId('client-portal-name')).toHaveText('QA Fixture Client 1');
    await page.reload();
    await settled(page);
    await expect(page.getByTestId('client-portal-name')).toHaveText('QA Fixture Client 1');
    await page.goto(app('/client-portal'));
    await settled(page);
    await expect(page.getByTestId('client-portal-name')).toHaveText('QA Fixture Client 1');
    await shot(page, TAB, 'CP-F1-06', info);
  });

  test('CP-F1-07 safe switch clears the previous client', async ({ page }, info) => {
    await open(page, app(`/client-portal?client=${C1}`), info);
    await expect(page.getByTestId('client-portal-header')).toContainText('CL-10001');
    await page
      .getByTestId('portal-client-list')
      .getByTestId('portal-client-row')
      .filter({ hasText: 'QA Fixture Client 3' })
      .click();
    await expect(page.getByTestId('client-portal-header')).toContainText('CL-10003');
    await expect(page.getByTestId('client-panel')).not.toContainText('CL-10001');
    await expect(page.getByTestId('client-panel')).not.toContainText('qa-fixture-1@');
    await shot(page, TAB, 'CP-F1-07', info);
  });

  test('CP-F1-08 client header: name, status, type, Client Since, Client ID', async ({
    page,
  }, info) => {
    await open(page, app(`/client-portal?client=${C1}`), info);
    const header = page.getByTestId('client-portal-header');
    await expect(header).toContainText('QA Fixture Client 1');
    await expect(header).toContainText('New Client');
    await expect(header).toContainText('Individual');
    await expect(header).toContainText('CL-10001');
    // Client Since shows only when the client has one; no Test Firm B client has (annotated).
    info.annotations.push({
      type: 'note',
      description: 'Client Since not set on any Test Firm B client',
    });
    await shot(page, TAB, 'CP-F1-08', info);
  });

  test('CP-F1-09 Open Client Portal is a read-only staff preview', async ({ page }, info) => {
    await open(page, app(`/client-portal?client=${C1}`), info);
    await page.getByTestId('open-client-portal').click();
    await expect(page).toHaveURL(new RegExp(`/client-portal/${C1}/preview`));
    await expect(page.getByTestId('portal-preview')).toBeVisible();
    await expect(page.getByText(/Staff preview, read only/)).toBeVisible();
    await expect(page.getByTestId('preview-menu')).toContainText('Documents');
    // Never a client session: the portal host still has no session for this browser.
    const res = await page.request.get(`https://portal.dev.firmivra.com/api/v1/${portalApi('me')}`);
    expect(res.status()).toBe(401);
    await shot(page, TAB, 'CP-F1-09', info);
  });

  test('CP-F1-10 Send Message (client prefilled) and View Profile', async ({ page }, info) => {
    await open(page, app(`/client-portal?client=${C1}`), info);
    await page
      .getByTestId('client-portal-actions')
      .getByRole('button', { name: 'Send Message' })
      .click();
    // The composer opens with the client chosen; nothing is sent.
    await expect(page).toHaveURL(new RegExp(`/messages/new\\?clientId=${C1}`));
    await settled(page);
    await expect(page.locator('main')).toContainText('QA Fixture Client 1');
    await shot(page, TAB, 'CP-F1-10-message', info);
    await page.goto(app(`/client-portal?client=${C1}`));
    await settled(page);
    await page
      .getByTestId('client-portal-actions')
      .getByRole('button', { name: 'View Profile' })
      .click();
    await expect(page).toHaveURL(new RegExp(`/clients/${C1}`));
    await shot(page, TAB, 'CP-F1-10-profile', info);
  });

  test('CP-F1-11 More menu: Portal Management, Access & Security, Activity', async ({
    page,
  }, info) => {
    await open(page, app(`/client-portal?client=${C1}`), info);
    const items: [RegExp, RegExp][] = [
      [/Portal Management/, new RegExp(`/client-portal/${C1}$`)],
      [/Access & Security/, new RegExp(`/client-portal/${C1}/access`)],
      [/View Activity History/, new RegExp(`/client-portal/${C1}/activity`)],
    ];
    for (const [name, url] of items) {
      await page.goto(app(`/client-portal?client=${C1}`));
      await settled(page);
      await page.getByRole('button', { name: 'More portal actions' }).click();
      await page.getByRole('menuitem', { name }).click();
      await expect(page).toHaveURL(url);
    }
    await shot(page, TAB, 'CP-F1-11', info);
  });

  test('CP-F1-12 record tabs open: Overview to Intake Forms', async ({ page }, info) => {
    await open(page, app(`/client-portal?client=${C1}`), info);
    const panel = page.getByTestId('client-panel');
    for (const tab of [
      'Documents',
      'Messages',
      'Appointments',
      'Tax Returns',
      'Invoices & Payments',
      'Intake Forms',
      'Overview',
    ]) {
      await panel.getByRole('tab', { name: tab, exact: true }).click();
      await expect(panel.getByRole('tab', { name: tab, exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await settled(page);
      await expect(errorAlerts(page)).toHaveCount(0);
      await expect(panel.getByText(/Something went wrong/i)).toHaveCount(0);
      await shot(page, TAB, `CP-F1-12-${tab}`, info);
    }
  });

  test('CP-F1-13 Portal Summary: six cards, range, each opens its tab', async ({ page }, info) => {
    await open(page, app(`/client-portal?client=${C1}`), info);
    const summary = page.getByTestId('portal-summary');
    const cards = summary.locator('[data-testid^="summary-"]');
    await expect(cards).toHaveCount(6);
    for (const range of ['Last 7 Days', 'Last 90 Days', 'Last 30 Days']) {
      await summary.getByLabel('Range').selectOption({ label: range });
      await expect(cards).toHaveCount(6);
    }
    await shot(page, TAB, 'CP-F1-13', info);
    const n = await cards.count();
    for (let i = 0; i < n; i++) {
      await page
        .getByTestId('client-panel')
        .getByRole('tab', { name: 'Overview', exact: true })
        .click();
      await cards.nth(i).click();
      const selected = page
        .getByTestId('client-panel')
        .getByRole('tablist')
        .first()
        .getByRole('tab', { selected: true });
      await expect(selected).not.toHaveText('Overview');
    }
  });

  test('CP-F1-14 Recent Activity and View All Activity', async ({ page }, info) => {
    await open(page, app(`/client-portal?client=${C1}`), info);
    const recent = page.getByTestId('recent-activity');
    await expect(recent).toContainText(/Portal Login|Portal login/);
    await recent
      .getByRole('button', { name: 'View All Activity' })
      .or(recent.getByRole('link', { name: 'View All Activity' }))
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/client-portal/${C1}/activity`));
    await expect(page.getByTestId('activity-row').first()).toBeVisible();
    await shot(page, TAB, 'CP-F1-14', info);
    expect(await page.getByTestId('activity-tab').innerText()).not.toMatch(/\bportal\.[a-z_]+\b/);
  });

  test('CP-F1-15 unsaved note warns before Back to All Clients', async ({ page }, info) => {
    await open(page, manage(C1), info);
    await page.getByLabel('New note').fill(`${runTag} unsaved`);
    await page.getByRole('button', { name: 'Back to All Clients' }).click();
    const dialog = page.getByRole('dialog', { name: /Leave without saving/ });
    await expect(dialog).toBeVisible();
    await shot(page, TAB, 'CP-F1-15', info);
    await dialog.getByRole('button', { name: 'Stay on This Page' }).click();
    await expect(page.getByLabel('New note')).toHaveValue(`${runTag} unsaved`);
    await page.getByLabel('New note').fill('');
  });

  test('CP-F2-01 breadcrumbs: Client Portal > Clients > client > tab', async ({ page }, info) => {
    await open(page, manage(C1, 'access'), info);
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(crumbs).toContainText('Client Portal');
    await expect(crumbs).toContainText('Clients');
    await expect(crumbs).toContainText('QA Fixture Client 1');
    await expect(crumbs).toContainText('Access & Security');
    await shot(page, TAB, 'CP-F2-01', info);
    await crumbs.getByRole('link', { name: 'Clients', exact: true }).click();
    await expect(page).toHaveURL(/\/client-portal(\?|$)/);
  });

  test('CP-F2-02 Back to All Clients and Switch Client on every tab', async ({ page }, info) => {
    for (const sub of [
      '',
      'access',
      'content',
      'documents',
      'forms',
      'communications',
      'activity',
    ]) {
      await open(page, manage(C1, sub), info);
      await expect(page.getByRole('button', { name: 'Back to All Clients' })).toBeVisible();
      await expect(page.getByTestId('client-switcher')).toBeVisible();
    }
    await page.getByRole('button', { name: 'Back to All Clients' }).click();
    await expect(page).toHaveURL(/\/client-portal(\?|$)/);
    await shot(page, TAB, 'CP-F2-02', info);
  });

  test('CP-F2-03 header: name, portal status, Client ID, email, type', async ({ page }, info) => {
    await open(page, manage(C1), info);
    const h = page.getByTestId('manage-header');
    await expect(h).toContainText('QA Fixture Client 1');
    await expect(h).toContainText('Active Portal');
    await expect(h).toContainText('CL-10001');
    await expect(h).toContainText('qa-fixture-1@example.test');
    await expect(h).toContainText('Individual');
    await shot(page, TAB, 'CP-F2-03', info);
  });

  test('CP-F2-04 status strip: six items, readable, Access Method Edit', async ({ page }, info) => {
    await open(page, manage(C1), info);
    const strip = page.getByTestId('status-strip');
    for (const label of [
      'Portal Status',
      'Last Login',
      'Portal Since',
      'Last Activity',
      'MFA',
      'Access Method',
    ]) {
      await expect(strip).toContainText(label);
    }
    await expect(
      strip
        .getByRole('button', { name: /Edit/ })
        .or(strip.getByRole('link', { name: /Edit/ }))
        .first(),
    ).toBeVisible();
    // Wait for the values, then: every value reads as words, never a raw event code such as
    // portal.preview_opened (a negative check alone would pass while the strip is loading).
    await expect(strip).toContainText(/Last Activity\s*\w{3} \d{1,2}, \d{4}/);
    await shot(page, TAB, 'CP-F2-04', info);
    expect(await strip.innerText()).not.toMatch(/\b[a-z]+\.[a-z]+_[a-z_]+\b|\bportal\.[a-z_]+\b/);
  });

  test('CP-F2-05 the seven management tabs open', async ({ page }, info) => {
    await open(page, manage(C1), info);
    const tabs: [string, string][] = [
      ['Access & Security', 'access'],
      ['Portal Content', 'content'],
      ['Documents', 'documents'],
      ['Forms & Requests', 'forms'],
      ['Communications', 'communications'],
      ['Activity', 'activity'],
      ['Overview', ''],
    ];
    const nav = page.getByRole('navigation', { name: 'Client portal management' });
    for (const [name, sub] of tabs) {
      await nav.getByRole('link', { name, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/client-portal/${C1}${sub ? `/${sub}` : ''}$`));
      await settled(page);
      await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
    }
    await shot(page, TAB, 'CP-F2-05', info);
  });

  test('CP-F2-06 Pending Client Actions: empty state reads well', async ({ page }, info) => {
    await open(page, manage(C1), info);
    await expect(page.getByTestId('pending-actions')).toContainText(
      'Nothing is waiting on this client.',
    );
    await shot(page, TAB, 'CP-F2-06', info);
  });

  test('CP-F2-07 Portal Content & Visibility: eight areas; a change survives reload', async ({
    page,
  }, info) => {
    // Client 1 (the login): every area on, and the client's own portal agrees.
    await open(page, manage(C1, 'content'), info);
    const vis = page.getByTestId('portal-visibility');
    const switches = vis.getByRole('switch');
    await expect(switches).toHaveCount(8);
    const client = await apiAs('client');
    const tabs = (await (await client.get(portalApi('me/tabs'))).json()) as {
      tabs: Record<string, boolean>;
      more: Record<string, boolean>;
    };
    await client.dispose();
    expect(Object.values({ ...tabs.tabs, ...tabs.more }).every(Boolean)).toBe(true);
    // Client 2 (no login): turn Reports off, reload, see it off, turn it back on.
    await page.goto(manage(C2, 'content'));
    await settled(page);
    const reports = page.getByRole('switch', {
      name: 'Reports (Client View) visible to this client',
    });
    await expect(reports).toBeChecked();
    try {
      await reports.click();
      await expect(reports).not.toBeChecked();
      await page.waitForLoadState('networkidle');
      await page.reload();
      await settled(page);
      await expect(reports).not.toBeChecked();
      await shot(page, TAB, 'CP-F2-07', info);
    } finally {
      if (!(await reports.isChecked())) await reports.click();
      await page.waitForLoadState('networkidle');
      await page.reload();
      await settled(page);
      await expect(reports).toBeChecked();
    }
  });

  test('CP-F2-08 Resend Portal Invitation: offered without a login, not with one', async ({
    page,
  }, info) => {
    await open(page, manage(C1, 'access'), info);
    await expect(page.getByTestId('invitation-card')).toContainText(/Accepted|Activated/);
    await expect(
      page.getByRole('button', { name: /Resend Portal Invitation|Send Portal Invitation/ }),
    ).toHaveCount(0);
    await page.goto(manage(C2, 'access'));
    await settled(page);
    await expect(
      page
        .getByRole('button', { name: /Resend Portal Invitation|Send Portal Invitation|Invite/ })
        .first(),
    ).toBeVisible();
    await shot(page, TAB, 'CP-F2-08', info);
  });

  test('CP-F2-09 Reset Client Access: the confirm reads well; Cancel sends nothing', async ({
    page,
  }, info) => {
    await open(page, manage(C1), info);
    await page.getByTestId('action-reset').click();
    const dialog = page.getByRole('dialog', { name: /Reset client access/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Send Reset' })).toBeVisible();
    await shot(page, TAB, 'CP-F2-09', info);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  test('CP-F2-10 Lock and Unlock Portal Access (Client 2), kept after reload', async ({
    page,
  }, info) => {
    await open(page, manage(C2), info);
    const lock = page.getByTestId('action-lock');
    await expect(lock).toContainText('Lock Portal Access');
    let locked = false;
    try {
      await lock.click();
      const dialog = page
        .getByTestId('confirm-action')
        .or(page.getByRole('dialog', { name: /Lock/ }))
        .first();
      await expect(dialog).toBeVisible();
      const reason = dialog.getByLabel('Reason (staff only, optional)');
      if (await reason.count()) await reason.fill(`${runTag} lock check`);
      await dialog.getByRole('button', { name: /^Lock/ }).click();
      locked = true;
      await expect(page.getByTestId('action-unlock')).toContainText('Unlock Portal Access');
      await page.reload();
      await settled(page);
      await expect(page.getByTestId('action-unlock')).toContainText('Unlock Portal Access');
      await expect(
        page.getByTestId('manage-header').or(page.getByTestId('status-strip')).first(),
      ).toContainText(/Locked/);
      await shot(page, TAB, 'CP-F2-10', info);
      await page.getByTestId('action-unlock').click();
      const confirm = page
        .getByTestId('confirm-action')
        .or(page.getByRole('dialog', { name: /Unlock/ }))
        .first();
      if (await confirm.isVisible().catch(() => false)) {
        await confirm.getByRole('button', { name: /^Unlock/ }).click();
      }
      await expect(page.getByTestId('action-lock')).toContainText('Lock Portal Access');
      locked = false;
    } finally {
      if (locked) {
        const owner = await apiAs('owner');
        await owner.post(`business/client-portal/clients/${C2}/unlock`);
        await owner.dispose();
      }
    }
  });

  test('CP-F2-11 Deactivate and Reactivate Portal: the confirm reads well', async ({
    page,
  }, info) => {
    await open(page, manage(C1), info);
    await page.getByTestId('action-deactivate').click();
    const dialog = page
      .getByTestId('confirm-action')
      .or(page.getByRole('dialog', { name: /Deactivate/ }))
      .first();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/Deactivate/);
    await shot(page, TAB, 'CP-F2-11', info);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('manage-header')).toContainText('Active Portal');
  });

  test('CP-F2-12 View Login History opens the login history', async ({ page }, info) => {
    await open(page, manage(C1), info);
    await page.getByTestId('quick-actions').getByText('View Login History').click();
    await expect(page).toHaveURL(new RegExp(`/client-portal/${C1}/access`));
    await expect(page.getByTestId('login-history')).toContainText(/Successful login/);
    await shot(page, TAB, 'CP-F2-12', info);
  });

  test('CP-F2-13 Portal Link for This Client with Copy Link', async ({ page, context }, info) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: app('') });
    await open(page, manage(C1), info);
    const link = page.getByTestId('portal-link');
    await expect(link).toContainText('https://portal.dev.firmivra.com/test-firm-b');
    await link.getByRole('button', { name: 'Copy Link' }).click();
    await expect(link.getByRole('button', { name: 'Copied' })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe('https://portal.dev.firmivra.com/test-firm-b');
    await shot(page, TAB, 'CP-F2-13', info);
  });

  test('CP-F2-14 Client Notes: saved, kept after reload, never in the portal (BK-X03)', async ({
    page,
  }, info) => {
    const text = `${runTag} internal note, staff only`;
    const owner = await apiAs('owner');
    let noteId: string | undefined;
    try {
      await open(page, manage(C1), info);
      await page.getByLabel('New note').fill(text);
      await page.getByRole('button', { name: 'Save Note' }).click();
      await expect(page.getByRole('list', { name: 'Internal notes' })).toContainText(text);
      await page.reload();
      await settled(page);
      await expect(page.getByRole('list', { name: 'Internal notes' })).toContainText(text);
      await shot(page, TAB, 'CP-F2-14', info);
      const notes = (await (await owner.get(`business/clients/${C1}/notes`)).json()) as {
        items?: { id: string; body?: string }[];
      };
      noteId = (notes.items ?? []).find((n) => n.body === text)?.id;
      // The client never sees it: not in the API, not on the Messages and Notes page.
      const client = await apiAs('client');
      const mine = await (await client.get(portalApi('me/notes'))).text();
      await client.dispose();
      expect(mine).not.toContain(runTag);
    } finally {
      if (noteId) {
        const del = await owner.delete(`business/notes/${noteId}`);
        expect(del.ok(), 'note deleted').toBe(true);
      }
      await owner.dispose();
    }
    expect(noteId, 'note found for cleanup').toBeTruthy();
  });

  test('CP-F2-15 Recent Portal Activity shows the IP address to the Owner', async ({
    page,
  }, info) => {
    await open(page, manage(C1), info);
    const act = page.getByTestId('portal-activity');
    await expect(act).toContainText('IP Address');
    await expect(act.getByTestId('activity-row').first()).toContainText(
      /\d+\.\d+\.\d+\.\d+|[0-9a-f]{1,4}:[0-9a-f:]+/,
    );
    await shot(page, TAB, 'CP-F2-15', info);
    // Each activity reads as words, never a raw event code such as portal.preview_opened.
    expect(await act.innerText()).not.toMatch(/\bportal\.[a-z_]+\b|\b[a-z]+\.[a-z]+_[a-z_]+\b/);
  });

  test('@narrow CP-F2-16 Access & Security: invitation, MFA, login history', async ({
    page,
  }, info) => {
    await open(page, manage(C1, 'access'), info);
    const inv = page.getByTestId('invitation-card');
    await expect(inv).toContainText('Status');
    await expect(inv).toContainText('Invitation date');
    await expect(inv).toContainText('qa-client-b@dev.firmivra.com');
    await expect(page.getByTestId('mfa-card')).toContainText(/not set up an authenticator/);
    await expect(page.getByTestId('login-history')).toContainText('Successful login');
    await expectNoSideScroll(page);
    await shot(page, TAB, 'CP-F2-16', info);
  });

  test('@narrow CP-F2-17 Activity tab: type, actor and date filters', async ({ page }, info) => {
    await open(page, manage(C1, 'activity'), info);
    const tab = page.getByTestId('activity-tab');
    await expect(tab.getByTestId('activity-row').first()).toBeVisible();
    await tab.getByLabel('Event type').selectOption({ label: 'Documents' });
    await expect(tab.getByTestId('activity-row')).toHaveCount(0);
    await tab.getByLabel('Event type').selectOption({ label: 'Portal access' });
    await expect(tab.getByTestId('activity-row').first()).toBeVisible();
    await tab.getByLabel('By').selectOption({ label: 'Firm staff' });
    await expect(tab.getByTestId('activity-row')).toHaveCount(0);
    await tab.getByLabel('By').selectOption({ label: 'The client' });
    await expect(tab.getByTestId('activity-row').first()).toBeVisible();
    await expect(tab.getByLabel('From')).toBeVisible();
    await expect(tab.getByLabel('To')).toBeVisible();
    await expectNoSideScroll(page);
    await shot(page, TAB, 'CP-F2-17', info);
  });

  test('CP-F2-20 Communications tab: threads and New Message', async ({ page }, info) => {
    await open(page, manage(C1, 'communications'), info);
    const threads = page.getByTestId('portal-messages');
    await expect(threads).toContainText(/No messages with this client yet|Read|Unread|unread/);
    await shot(page, TAB, 'CP-F2-20', info);
    await threads.getByRole('button', { name: 'New Message' }).first().click();
    // The composer opens with the client chosen; nothing is sent.
    await expect(page).toHaveURL(new RegExp(`/messages/new\\?clientId=${C1}`));
    await settled(page);
    await expect(page.locator('main')).toContainText('QA Fixture Client 1');
  });

  test('@narrow CP-F3-01 Documents: Upload and Request open with the client chosen', async ({
    page,
  }, info) => {
    await open(page, manage(C1, 'documents'), info);
    await expectNoSideScroll(page);
    await shot(page, TAB, 'CP-F3-01', info);
    await page.getByRole('button', { name: 'Upload Document' }).click();
    await expect(page).toHaveURL(new RegExp(`/documents/upload\\?clientId=${C1}`));
    await expect(page.getByTestId('upload-document')).toContainText('QA Fixture Client 1');
    await page.goBack();
    await settled(page);
    await page.getByRole('button', { name: 'Request Document' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/documents/requests/new\\?clientId=${C1}`));
    await settled(page);
    await expect(page.locator('main')).toContainText('QA Fixture Client 1');
  });

  test('CP-F3-02 Documents KPIs: five cards', async ({ page }, info) => {
    await open(page, manage(C1, 'documents'), info);
    const k = page.getByTestId('document-kpis');
    for (const label of [
      'Total Documents',
      'Client Uploaded',
      'Firm Shared',
      'Pending Review',
      'Requested',
    ]) {
      await expect(k).toContainText(label);
    }
    await shot(page, TAB, 'CP-F3-02', info);
  });

  test('CP-F3-03 Documents: search and filters, with Clear', async ({ page }, info) => {
    await open(page, manage(C1, 'documents'), info);
    const docs = page.getByTestId('portal-documents');
    await docs
      .getByPlaceholder('Search documents by name, type, or keyword...')
      .fill('zzz-live-check');
    await docs.getByLabel('Status').selectOption({ label: 'Reviewed' });
    const clear = docs.getByRole('button', { name: /Clear/ });
    await expect(clear).toBeVisible();
    await clear.click();
    await expect(
      docs.getByPlaceholder('Search documents by name, type, or keyword...'),
    ).toHaveValue('');
    await expect(docs.getByLabel('Status')).toHaveValue('');
    await shot(page, TAB, 'CP-F3-03', info);
  });

  test('CP-F3-04 Documents tabs: All, Client Uploaded, Firm Shared, Pending Review, Requested', async ({
    page,
  }, info) => {
    await open(page, manage(C1, 'documents'), info);
    for (const name of [
      'Client Uploaded',
      'Firm Shared',
      'Pending Review',
      'Requested',
      'All Documents',
    ]) {
      const tab = page.getByRole('tab', { name: new RegExp(`^${name}`) });
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
    }
    await shot(page, TAB, 'CP-F3-04', info);
  });

  test('CP-F3-08 Document Requests panel and Request New Document', async ({ page }, info) => {
    await open(page, manage(C1, 'documents'), info);
    const panel = page.getByTestId('document-requests-panel');
    await expect(panel).toContainText('Document Requests');
    await panel.getByRole('button', { name: '+ Request New Document' }).click();
    await expect(page).toHaveURL(new RegExp(`/documents/requests/new\\?clientId=${C1}`));
    await shot(page, TAB, 'CP-F3-08', info);
  });

  test('CP-F3-09 Recent Document Activity', async ({ page }, info) => {
    await open(page, manage(C1, 'documents'), info);
    await expect(page.getByTestId('recent-document-activity')).toContainText(
      'Recent Document Activity',
    );
    await expect(page.getByTestId('recent-document-activity')).not.toContainText(
      /Something went wrong/i,
    );
    await shot(page, TAB, 'CP-F3-09', info);
  });

  test('@narrow CP-IF-01 Intake Forms header: Request Form, Send Reminder, More Actions', async ({
    page,
  }, info) => {
    await open(page, manage(C1, 'forms'), info);
    const forms = page.getByTestId('portal-forms');
    for (const name of ['Request Form', 'Send Reminder']) {
      await expect(forms.getByRole('button', { name, exact: true }).first()).toBeVisible();
    }
    await expect(forms.getByRole('button', { name: 'More form actions' })).toBeVisible();
    await expectNoSideScroll(page);
    await shot(page, TAB, 'CP-IF-01', info);
    await forms.getByRole('button', { name: 'Request Form', exact: true }).click();
    await settled(page);
    await expect(page.locator('body')).toContainText('QA Fixture Client 1');
    await shot(page, TAB, 'CP-IF-01-request', info);
  });

  test('CP-IF-02 Intake KPIs: six cards', async ({ page }, info) => {
    await open(page, manage(C1, 'forms'), info);
    const k = page.getByTestId('form-kpis');
    for (const label of [
      'Total Forms',
      'Completed',
      'Submitted Needs Review',
      'In Progress',
      'Not Started',
      'Archived',
    ]) {
      await expect(k).toContainText(label);
    }
    await shot(page, TAB, 'CP-IF-02', info);
  });

  test('CP-IF-03 Intake: search, status, form type, service and dates, with Clear (P1-17)', async ({
    page,
  }, info) => {
    await open(page, manage(C1, 'forms'), info);
    const forms = page.getByTestId('portal-forms');
    await forms.getByPlaceholder('Search forms by name or keyword...').fill('zzz-live-check');
    await forms.getByLabel('Status').selectOption({ label: 'Archived' });
    await expect(forms.getByLabel('Form Type')).toBeVisible();
    await expect(forms.getByLabel('Service')).toBeVisible();
    await expect(forms.getByLabel('Requested from')).toBeVisible();
    await expect(forms.getByLabel('Requested to')).toBeVisible();
    const clear = forms.getByRole('button', { name: /Clear/ });
    await expect(clear).toBeVisible();
    await clear.click();
    await expect(forms.getByPlaceholder('Search forms by name or keyword...')).toHaveValue('');
    await shot(page, TAB, 'CP-IF-03', info);
  });

  test('CP-IF-08 Pending Client Actions, Quick Actions, Form Templates', async ({ page }, info) => {
    await open(page, manage(C1, 'forms'), info);
    await expect(page.getByTestId('form-pending-actions')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Quick Actions' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Form Templates' })).toBeVisible();
    await shot(page, TAB, 'CP-IF-08', info);
    await page.getByRole('button', { name: 'Manage Templates' }).click();
    await expect(page).not.toHaveURL(new RegExp(`/client-portal/${C1}/forms`));
    await settled(page);
    await expect(page.getByText(/Something went wrong/i)).toHaveCount(0);
  });

  test('CP-IF-09 Form Settings (Client Permissions): the Intake Forms switch', async ({
    page,
  }, info) => {
    await open(page, manage(C1, 'forms'), info);
    const settings = page
      .getByRole('heading', { name: 'Form Settings (Client Permissions)' })
      .locator('xpath=ancestor::section[1]');
    await expect(settings).toContainText(/intake forms in their portal/);
    await shot(page, TAB, 'CP-IF-09', info);
    // Edit opens Portal Content, where the client's Intake Forms switch is.
    await settings.getByRole('button', { name: 'Edit' }).click();
    await expect(page).toHaveURL(new RegExp(`/client-portal/${C1}/content`));
    await expect(
      page.getByRole('switch', { name: 'Intake Forms visible to this client' }),
    ).toBeVisible();
  });

  test('@narrow CP-R-04 layout: each management page has no sideways scroll', async ({
    page,
  }, info) => {
    for (const sub of [
      '',
      'access',
      'content',
      'documents',
      'forms',
      'communications',
      'activity',
      'preview',
    ]) {
      await open(page, manage(C1, sub), info);
      await expectNoSideScroll(page);
      await shot(page, TAB, `CP-R-04-${sub || 'overview'}`, info);
    }
    await open(page, app(`/client-portal?client=${C1}`), info);
    await expectNoSideScroll(page);
  });
});

test.describe('firm side as Admin', () => {
  test.use(as('admin'));
  test('CP-ROLE-02 Admin manages access and sees the IP address', async ({ page }, info) => {
    await open(page, manage(C1), info);
    await expect(page.getByTestId('action-reset')).toBeVisible();
    await expect(page.getByTestId('action-lock')).toBeVisible();
    await expect(page.getByTestId('portal-activity')).toContainText('IP Address');
    await expect(page.getByRole('switch').first()).toBeEnabled();
    await shot(page, TAB, 'CP-ROLE-02', info);
  });
});

test.describe('firm side as Staff', () => {
  test.use(as('staff'));
  test('@narrow CP-ROLE-01 Staff sees only assigned clients; another client reads as not found', async ({
    page,
  }, info) => {
    await open(page, app('/client-portal'), info);
    await expect(page.getByTestId('portal-client-row')).toHaveCount(0);
    await expectNoSideScroll(page);
    await shot(page, TAB, 'CP-ROLE-01-list', info);
    await page.goto(manage(C1));
    await settled(page);
    await expect(page.getByText('QA Fixture Client 1')).toHaveCount(0);
    await expect(page.locator('main')).toContainText(/couldn.t find this|not found|no access/i);
    await shot(page, TAB, 'CP-ROLE-01-direct', info);
  });
});

test.describe('the portal as the client', () => {
  test.use(as('client'));
  const pages: [string, string][] = [
    ['documents', 'My Uploaded Documents'],
    ['taxes', 'Tax Return'],
    ['invoices', 'Invoice'],
    ['messages', 'Message'],
    ['intake', 'Intake'],
    ['business', 'Business'],
    ['appointments', 'Appointment'],
    ['announcements', 'Announcement'],
    ['notifications', 'Notification'],
    ['profile', 'Profile'],
    ['signatures', 'Signature'],
    ['services', 'Service'],
  ];

  test('CP-PT-01 the client menu shows every visible area', async ({ page }, info) => {
    await open(page, portal('/documents'), info);
    const menu = page
      .getByRole('navigation', { name: 'Portal menu' })
      .or(page.locator('aside'))
      .first();
    for (const label of [
      'Intake Form',
      'Business Documents',
      'My Uploaded Documents',
      'Tax Return',
      'Receipts',
      'Messages',
    ]) {
      await expect(page.locator('body')).toContainText(new RegExp(label));
    }
    await expect(menu).toBeVisible();
    await shot(page, TAB, 'CP-PT-01', info);
  });

  for (const [path, word] of pages) {
    test(`@narrow CP-PT-02 portal page /${path} opens, reads well, no sideways scroll`, async ({
      page,
    }, info) => {
      await open(page, portal(`/${path}`), info);
      await expect(page).not.toHaveURL(/\/sign-in/);
      await expect(page.locator('main').first()).toContainText(new RegExp(word, 'i'));
      await expect(page.getByText(/Something went wrong|Not found|404/i)).toHaveCount(0);
      await expectNoSideScroll(page);
      await shot(page, TAB, `CP-PT-02-${path}`, info);
    });
  }

  test('CP-PT-03 Documents: My Uploads and Firm Documents, filters, empty state', async ({
    page,
  }, info) => {
    await open(page, portal('/documents'), info);
    await expect(page.getByText('No documents yet')).toBeVisible();
    await page.getByRole('button', { name: 'Firm Documents' }).first().click();
    await settled(page);
    await expect(page.locator('main').first()).toContainText(/No documents|Firm/);
    await expect(page.getByLabel('Category').first()).toBeVisible();
    await expect(page.getByLabel('Year').first()).toBeVisible();
    await shot(page, TAB, 'CP-PT-03', info);
  });
});

/**
 * CP-PT-03b (Rasel, Nov 18): a document the firm shared, then trashed, archived and restored, as
 * the client sees it in the portal (Firm Documents list, the document, its download link). It
 * reuses this harness's own LIVE-CHECK staff upload on Client 1 (in the firm's Trash since Nov 17):
 * restored, shared, taken through trash, archive and restore, then hidden and trashed again. No
 * new record, and no send: sharing by visibility writes no notice, and nothing here emails.
 */
// Disabled (lead, Nov 18): since #1574 sharing by visibility tells the client (tellShared), and
// Client 1's login is not a simulator address. Being rebuilt on the lead's choice.
test.describe.skip('CP-PT-03b shared document: trash, archive, restore, seen by the client', () => {
  test.describe.configure({ mode: 'serial' });
  const firmPath = (id: string, action = '') =>
    `business/documents/${id}${action ? `/${action}` : ''}`;
  let docId = '';
  let fileName = '';

  /** What the client gets: the Firm Documents list (API), the document, and its download link. */
  async function clientSees(id: string) {
    const c = await apiAs('client');
    try {
      const list = await c.get(portalApi('me/documents?source=FIRM&limit=100'));
      expect(list.status(), 'client list').toBe(200);
      const items = ((await list.json()) as { items?: { id: string }[] }).items ?? [];
      const view = await c.get(portalApi(`me/documents/${id}`));
      const download = await c.get(portalApi(`me/documents/${id}/download`));
      return {
        listed: items.some((d) => d.id === id),
        view: view.status(),
        download: download.status(),
      };
    } finally {
      await c.dispose();
    }
  }

  async function owner(action: string, body?: object) {
    const o = await apiAs('owner');
    try {
      const res = await o.post(firmPath(docId, action), body ? { data: body } : undefined);
      expect(res.status(), `${action}: ${await res.text().catch(() => '')}`.slice(0, 300)).toBe(
        200,
      );
    } finally {
      await o.dispose();
    }
  }

  test('setup: our own trashed staff upload on Client 1, restored and shared', async () => {
    const o = await apiAs('owner');
    try {
      const res = await o.get(`business/documents?scope=trash&clientId=${C1}`);
      expect(res.status()).toBe(200);
      const items =
        ((await res.json()) as { items?: { id: string; fileName: string; direction: string }[] })
          .items ?? [];
      const ours = items.find(
        (d) => /^LIVE-CHECK-\d{12}-staff\.pdf$/.test(d.fileName) && d.direction === 'INTERNAL',
      );
      test.skip(!ours, 'no LIVE-CHECK staff upload of this harness is left in the Trash');
      docId = ours!.id;
      fileName = ours!.fileName;
    } finally {
      await o.dispose();
    }
    await owner('untrash');
    await owner('visibility', { clientVisible: true });
  });

  test('CP-PT-03b shared and active: listed, opens, downloads', async ({ browser }, info) => {
    test.skip(!docId, 'setup found no document');
    expect(await clientSees(docId)).toEqual({ listed: true, view: 200, download: 200 });
    // The page too: Firm Documents shows it.
    const ctx = await browser.newContext(as('client'));
    const page = await ctx.newPage();
    try {
      await open(page, portal('/documents'), info);
      await page.getByRole('button', { name: 'Firm Documents' }).first().click();
      await settled(page);
      await expect(page.locator('main').first()).toContainText(fileName);
      await shot(page, TAB, 'CP-PT-03b-shared', info);
    } finally {
      await ctx.close();
    }
  });

  test('CP-PT-03b trashed: gone from the list, view and download refused', async () => {
    test.skip(!docId, 'setup found no document');
    await owner('trash');
    const seen = await clientSees(docId);
    expect(seen.listed, 'still listed after Trash').toBe(false);
    expect(seen.view, 'view after Trash').toBe(404);
    expect(seen.download, 'download after Trash').toBe(404);
  });

  test('CP-PT-03b restored from Trash: back for the client', async () => {
    test.skip(!docId, 'setup found no document');
    await owner('untrash');
    expect(await clientSees(docId)).toEqual({ listed: true, view: 200, download: 200 });
  });

  test('CP-PT-03b archived: gone from the list, view and download refused', async () => {
    test.skip(!docId, 'setup found no document');
    await owner('archive');
    const seen = await clientSees(docId);
    expect(seen.listed, 'still listed after Archive').toBe(false);
    expect(seen.view, 'view after Archive').toBe(404);
    expect(seen.download, 'download after Archive').toBe(404);
  });

  test('CP-PT-03b restored from Archive: back for the client', async () => {
    test.skip(!docId, 'setup found no document');
    await owner('restore');
    expect(await clientSees(docId)).toEqual({ listed: true, view: 200, download: 200 });
  });

  test('zz CP-PT-03b cleanup: hidden from the client and back in the Trash', async () => {
    test.skip(!docId, 'setup found no document');
    const o = await apiAs('owner');
    try {
      // Whatever state a failed step left: out of Archive, out of Trash, hidden, then trashed.
      for (const action of ['restore', 'untrash']) await o.post(firmPath(docId, action));
      const hide = await o.post(firmPath(docId, 'visibility'), { data: { clientVisible: false } });
      expect(hide.status()).toBe(200);
      const trash = await o.post(firmPath(docId, 'trash'));
      expect(trash.status()).toBe(200);
    } finally {
      await o.dispose();
    }
    const seen = await clientSees(docId);
    expect(seen.listed).toBe(false);
  });
});
