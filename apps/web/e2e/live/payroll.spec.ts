import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { appUrl, shotsDir, statePath } from './env';
import { app, as, portal } from './helpers';

/**
 * Live checks, Payroll (Octavia's Review Two, every row incl. the green ones), on dev as Test Firm
 * B's Owner and portal Client. Test Firm B has no payroll client, so the run makes one fixture:
 * a "LIVE-CHECK" category, a Custom Quote "LIVE-CHECK Payroll" service (nothing bills), and QA
 * Fixture Client 1 (the portal client) added to Payroll. The fixture is found-or-made per worker
 * and removed by the last test ("zz cleanup"), with every LIVE-CHECK document and request.
 * Both widths are checked inside the LAYOUT test (390 and 1165 px), so one run makes one fixture.
 */
test.describe.configure({ timeout: 180_000 });
test.use(as('owner'));

const TAB = 'payroll';
const CLIENT1 = '00000000-0000-4a28-8001-000000000002';
const NAME1 = 'QA Fixture Client 1';
const SERVICE = 'LIVE-CHECK Payroll';
const CATEGORY = 'LIVE-CHECK';
/** One tag per run, kept across worker restarts (a failed test restarts the worker). */
const runTag = (() => {
  const f = join(shotsDir('payroll'), '.runtag');
  if (existsSync(f) && Date.now() - statSync(f).mtimeMs < 30 * 60_000)
    return readFileSync(f, 'utf8');
  const tag = `LIVE-CHECK ${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
  writeFileSync(f, tag);
  return tag;
})();
const STAMP = runTag.replace(/\s+/g, '-');
const REQUEST_TITLE = `${runTag} payroll register`;
const PORTAL_FILE = `${STAMP}-portal.pdf`;
const STAFF_FILE = `${STAMP}-staff.pdf`;
const SEARCH = 'Search clients, business name, or EIN...';
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

let pcId = '';
const ws = (q = '') => app(`/payroll/clients/${pcId}${q}`);

async function snap(page: Page, row: string): Promise<string> {
  const w = page.viewportSize()?.width ?? 0;
  const path = join(shotsDir(TAB), `${row.replace(/[^A-Za-z0-9_-]+/g, '-')}-${w}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

/**
 * The owner's API through a browser context: opening a page lets the app refresh an expired
 * access token, which a bare request context cannot. Writes send the site's Origin.
 */
interface Api {
  get(
    path: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- API JSON in a live check; each test reads only the fields it asserts
  ): Promise<{ ok(): boolean; status(): number; json(): Promise<any>; text(): Promise<string> }>;
  post(path: string, data?: unknown): ReturnType<Api['get']>;
  delete(path: string): ReturnType<Api['get']>;
  dispose(): Promise<void>;
}
async function ownerApi(browser: Browser): Promise<Api> {
  const ctx = await browser.newContext({ storageState: statePath('owner') });
  const url = (p: string) => `${appUrl}/api/v1/${p}`;
  const headers = { origin: appUrl };
  // The saved access token may have expired: refresh it as the app does on a 401.
  if ((await ctx.request.get(url('me'))).status() === 401) {
    const r = await ctx.request.post(url('auth/refresh'), { headers, data: {} });
    if (!r.ok()) throw new Error(`owner session refresh failed: ${r.status()}`);
  }
  return {
    get: (p) => ctx.request.get(url(p)),
    post: (p, data) => ctx.request.post(url(p), { headers, data: data ?? {} }),
    delete: (p) => ctx.request.delete(url(p), { headers }),
    dispose: () => ctx.close(),
  };
}

const items = <T>(body: unknown): T[] =>
  (Array.isArray(body) ? body : ((body as { items?: T[] })?.items ?? [])) as T[];

/** Finds the run's payroll fixture, or makes it (category, service, payroll client). */
async function ensureFixture(api: Api): Promise<string> {
  const listed = await api.get('business/payroll/clients');
  expect(listed.ok(), `payroll list ${listed.status()}`).toBe(true);
  const existing = items<{ id: string; client: { id: string } }>(await listed.json()).find(
    (r) => r.client.id === CLIENT1,
  );
  if (existing) return existing.id;
  const cats = items<{ id: string; name: string }>(
    await (await api.get('business/catalog/categories')).json(),
  );
  let categoryId = cats.find((c) => c.name === CATEGORY)?.id;
  if (!categoryId) {
    const made = await api.post('business/catalog/categories', {
      name: CATEGORY,
      description: 'Live check fixture (synthetic)',
    });
    expect(made.ok(), `category ${made.status()} ${await made.text()}`).toBe(true);
    categoryId = (await made.json()).id as string;
  }
  // Our own service from an earlier run, archived by its cleanup: restore it (Activate clears
  // the archive), never make a second one (409 DUPLICATE_NAME).
  const own = items<{ id: string; name: string; status: string; archivedAt?: string | null }>(
    await (
      await api.get(`business/catalog/services?status=all&search=${encodeURIComponent(SERVICE)}`)
    ).json(),
  ).find((x) => x.name === SERVICE);
  if (own && (own.status !== 'ACTIVE' || own.archivedAt)) {
    const r = await api.post(`business/catalog/services/${own.id}/activate`);
    expect(r.ok(), `restore service ${r.status()} ${await r.text()}`).toBe(true);
  }
  if (!own) {
    const made = await api.post('business/catalog/services', {
      name: SERVICE,
      categoryId,
      shortDescription: 'Live check fixture (synthetic), archived by each run',
      kind: 'PAYROLL',
      pricingType: 'CUSTOM_QUOTE',
      activate: true,
      allowDuplicateName: true,
    });
    expect(made.ok(), `service ${made.status()} ${await made.text()}`).toBe(true);
  }
  const added = await api.post('business/payroll/clients', {
    clientId: CLIENT1,
    frequency: 'WEEKLY',
    providerKey: 'gusto',
    industry: 'LIVE-CHECK',
  });
  expect(added.ok(), `add payroll client ${added.status()} ${await added.text()}`).toBe(true);
  return (await added.json()).id as string;
}

/**
 * Client-facing sends go only to the SES simulator (lead, Nov 18). Every address a send can reach
 * (the client record's, its contacts', its portal login's) must be @simulator.amazonses.com; a
 * portal login whose address the API does not show counts as unsafe.
 */
async function sendable(api: Api, clientId: string): Promise<{ ok: boolean; why: string }> {
  const c = await (await api.get(`business/clients/${clientId}`)).json();
  const text = JSON.stringify(c);
  const emails = [...new Set(text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [])];
  const unsafe = emails.filter((e) => !/@simulator\.amazonses\.com$/i.test(e));
  if (unsafe.length) return { ok: false, why: `non-simulator address(es): ${unsafe.join(', ')}` };
  if (/"portal(Status)?":"ACTIVE"/.test(text)) return { ok: false, why: 'has a portal login' };
  return { ok: emails.length > 0, why: emails.length ? 'simulator only' : 'no address' };
}

/** LIVE_PAYROLL_CLEANUP_ONLY=1 runs "zz cleanup" alone without making the fixture again. */
const cleanupOnly = Boolean(process.env['LIVE_PAYROLL_CLEANUP_ONLY']);

test.beforeAll(async ({ browser }) => {
  if (cleanupOnly) return;
  const api = await ownerApi(browser);
  pcId = await ensureFixture(api);
  await api.dispose();
});

async function openWorkspace(page: Page, q = '?tab=overview') {
  await page.goto(ws(q));
  await expect(page.getByTestId('client-title')).toContainText(NAME1);
}

async function moreActions(page: Page, item: string) {
  await page.getByTestId('quick-actions').getByRole('button', { name: 'More Actions' }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

async function openList(page: Page, query = '') {
  await page.goto(app(`/payroll${query}`));
  await expect(page.getByTestId('client-link').filter({ hasText: NAME1 })).toBeVisible();
}

/** The portal's row for this run's request (in Your Next Steps). */
const requestRow = (page: Page) =>
  page
    .getByRole('listitem')
    .filter({ hasText: REQUEST_TITLE })
    .filter({
      has: page
        .getByRole('button', { name: /^Upload$|I don.t have this/ })
        .or(page.getByText(/Received|Requested/)),
    })
    .last();

async function asClient(browser: Browser) {
  const ctx = await browser.newContext({
    storageState: statePath('client'),
    viewport: { width: 1165, height: 900 },
  });
  return { ctx, page: await ctx.newPage() };
}

// ---------- Layout at both widths ----------

test('LAYOUT every Payroll page at 390 and 1165 px, no sideways scroll', async ({ page }) => {
  const pages: [string, string][] = [
    ['list', app('/payroll')],
    ['overview', ws('?tab=overview')],
    ...(
      [
        'employees',
        'runs',
        'filings',
        'reports',
        'documents',
        'tasks',
        'notes',
        'communications',
        'settings',
      ] as const
    ).map((t) => [t, ws(`?tab=${t}`)] as [string, string]),
    ['demo-run', app('/payroll/runs/demo')],
  ];
  for (const width of [1165, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, url] of pages) {
      await page.goto(url);
      await page.waitForLoadState('networkidle').catch(() => {});
      await expect(page.locator('body')).toBeVisible();
      const over = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      await snap(page, `layout-${name}`);
      expect
        .soft(over, `${name} at ${width}px scrolls sideways by ${over}px`)
        .toBeLessThanOrEqual(1);
    }
  }
});

// ---------- Yellow: F01, F06 ----------

/** One provider state, one wording (#1603). */
const STATE =
  /Not connected|Pending setup|Connected · waiting for first sync|Connected · last sync/;

test('F01 one provider state, the same words on the panel and the client card', async ({
  page,
}) => {
  await openList(page);
  const card = page.getByTestId('card-providers');
  await expect(card.getByTestId('provider-states')).toContainText(
    'Pending setup: chosen for a client, not yet authorized in Integrations.',
  );
  const gusto = card.getByRole('listitem').filter({ hasText: 'Gusto' });
  await expect(gusto).toContainText(/\d+ clients? chose it/);
  await expect(card).not.toContainText(/\d+ Clients?\b/);
  const panelState = ((await gusto.innerText()).match(STATE) ?? [''])[0];
  expect(panelState, 'the panel names one of the four states').not.toBe('');
  console.log(`F01 NOTE Gusto on the panel: ${panelState}`);
  await snap(page, 'F01-list');
  await openWorkspace(page);
  const sync = page.getByTestId('provider-sync');
  await expect(sync).toContainText(panelState);
  await expect(sync).not.toContainText(/Provider connected|Not authorized|Authorized\b/);
  await snap(page, 'F01-client');
});

test('F01 Upcoming Payroll Runs follow the frequency: Weekly set, no "Set a frequency"', async ({
  page,
}) => {
  await openWorkspace(page);
  const state = ((await page.getByTestId('provider-sync').innerText()).match(STATE) ?? [''])[0];
  const upcoming = page.getByRole('region', { name: 'Upcoming Payroll Runs' });
  await expect(upcoming).not.toContainText('Set a frequency');
  await expect(upcoming).not.toContainText('set a pay frequency');
  if (state.startsWith('Connected')) {
    await expect(upcoming).toContainText(/Next payroll [A-Z][a-z]{2} \d{1,2}, \d{4}/);
    await expect(upcoming).toContainText(
      state.includes('waiting') ? 'Weekly · first sync pending' : 'Weekly ·',
    );
  } else {
    await expect(upcoming).toContainText('To see the schedule, connect Gusto in Integrations.');
  }
  const said = (await upcoming.innerText()).replace(/\s+/g, ' ').slice(0, 160);
  console.log(`F01 NOTE Upcoming with "${state}": ${said}`);
  await snap(page, 'F01-upcoming');
});

test('F06 chart, tab and Status filter agree; no-match message; Clear Filters', async ({
  page,
}) => {
  await openList(page, '?period=LAST_MONTH');
  const period = page.getByLabel('Period', { exact: true });
  const status = page.getByLabel('Status', { exact: true });
  await expect(period).toHaveValue('LAST_MONTH');
  await status.selectOption('ON_HOLD');
  await expect(status).toHaveValue('ON_HOLD');
  await expect(page.getByText('No clients match these filters')).toBeVisible();
  await page.getByRole('tab', { name: /^Processing/ }).click();
  await expect(status).toHaveValue('');
  await expect(period).toHaveValue('LAST_MONTH');
  const legend = page.getByRole('list', { name: 'Filter the client list by payroll status' });
  const pastDue = legend.getByRole('button', { name: /Past Due/ });
  const count = Number((await pastDue.locator('span.font-semibold').textContent()) ?? '0');
  await pastDue.click();
  await expect(page.getByRole('tab', { name: /^Past Due/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(status).toHaveValue('');
  await expect(period).toHaveValue('LAST_MONTH');
  await expect(page.getByTestId('client-link')).toHaveCount(count);
  await snap(page, 'F06-past-due');
  await page.getByRole('tab', { name: /^All Clients/ }).click();
  await page.getByPlaceholder(SEARCH).fill('zz-no-such-client');
  await expect(page.getByText('No clients match these filters')).toBeVisible();
  await page.getByRole('button', { name: 'Clear Filters' }).click();
  await expect(page.getByPlaceholder(SEARCH)).toHaveValue('');
  await expect(page.getByTestId('client-link').filter({ hasText: NAME1 })).toBeVisible();
  await snap(page, 'F06-cleared');
});

// ---------- F02 / F03 / UX02: requests, uploads, files ----------

test('F02 (green) Request Documents form: client, Payroll, portal login, name and due date', async ({
  page,
  browser,
}) => {
  await openWorkspace(page);
  await page
    .getByTestId('quick-actions')
    .getByRole('button', { name: 'Request Documents' })
    .click();
  const form = page.getByTestId('request-documents');
  await expect(form).toContainText(NAME1);
  await expect(form).toContainText('Payroll');
  await expect(form).toContainText(/portal login/);
  await form.getByLabel('Document needed').fill(REQUEST_TITLE);
  const due = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  await form.getByLabel('Due date').fill(due);
  await expect(page.getByRole('button', { name: 'Send Request' })).toBeEnabled();
  await snap(page, 'F02-request-form');
  // Send only when every address it reaches is the SES simulator; Client 1 has none.
  const api = await ownerApi(browser);
  const gate = await sendable(api, CLIENT1);
  await api.dispose();
  console.log(`F02 NOTE send to ${NAME1}: ${gate.ok ? 'allowed' : `NOT LIVE (${gate.why})`}`);
  if (gate.ok) {
    await page.getByRole('button', { name: 'Send Request' }).click();
    await expect(form).toBeHidden();
  } else {
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(form).toBeHidden();
  }
});

/** The run's request to Client 1, if one was sent (never, while Client 1 has unsafe addresses). */
async function sentRequest(browser: Browser): Promise<boolean> {
  const api = await ownerApi(browser);
  const list = items<{ title: string; status: string }>(
    await (await api.get(`business/clients/${CLIENT1}/document-requests`)).json(),
  );
  await api.dispose();
  return list.some((r) => r.title === REQUEST_TITLE && r.status !== 'CANCELLED');
}

test('F02 (red) portal shows the request with its due date on its own line', async ({
  browser,
}) => {
  test.skip(!(await sentRequest(browser)), 'NOT LIVE: no request may be sent to Client 1');
  const { ctx, page } = await asClient(browser);
  try {
    await page.goto(portal('/documents'));
    const row = requestRow(page);
    await expect(row).toBeVisible();
    await expect(row.getByTestId('request-due').first()).toHaveText(
      /^Due [A-Z][a-z]{2} \d{1,2}, \d{4}$/,
    );
    await snap(page, 'F02-portal-due');
  } finally {
    await ctx.close();
  }
});

test('UX02 (green) portal: the client uploads its own file and downloads it', async ({
  browser,
}) => {
  const { ctx, page } = await asClient(browser);
  try {
    await page.goto(portal('/documents'));
    if ((await page.getByRole('button', { name: `Download ${PORTAL_FILE}` }).count()) === 0) {
      await page.getByRole('button', { name: 'Upload Documents' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Upload Documents' });
      await dialog
        .getByRole('button', { name: /Upload more documents for my business services/ })
        .click();
      const service = dialog.getByLabel('Service');
      const payroll = await service
        .locator('option')
        .evaluateAll(
          (os) => os.find((o) => /Payroll/.test(o.textContent ?? ''))?.getAttribute('value') ?? '',
        );
      expect(payroll, 'the portal offers the Payroll service').not.toBe('');
      await service.selectOption(payroll);
      await dialog.locator('input[type=file]').setInputFiles({
        name: PORTAL_FILE,
        mimeType: 'application/pdf',
        buffer: PDF,
      });
      await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
      await expect(dialog).toBeHidden({ timeout: 60_000 });
      await page.reload();
    }
    const download = page.getByRole('button', { name: `Download ${PORTAL_FILE}` }).first();
    await expect(download).toBeVisible();
    await expect(download).toBeEnabled({ timeout: 90_000 });
    const got = page.waitForEvent('download', { timeout: 30_000 });
    await download.click();
    expect((await got).suggestedFilename()).toBe(PORTAL_FILE);
    await snap(page, 'UX02-portal-download');
  } finally {
    await ctx.close();
  }
});

test('F02 (red) staff file names the request, with a link to it', async ({ page, browser }) => {
  test.skip(!(await sentRequest(browser)), 'NOT LIVE: no request may be sent to Client 1');
  await openWorkspace(page, '?tab=documents');
  const doc = page.getByTestId('payroll-document').filter({ hasText: PORTAL_FILE });
  await expect(doc).toBeVisible();
  await expect(doc).toContainText(`For request: ${REQUEST_TITLE}`);
  await expect(doc.getByRole('link', { name: REQUEST_TITLE })).toHaveAttribute(
    'href',
    /\/documents\/requests\/[0-9a-f-]{36}/,
  );
  await snap(page, 'F02-staff-file');
});

test('F03 (green) staff upload with sharing off, kept after reload, not in the portal', async ({
  page,
  browser,
}) => {
  await openWorkspace(page, '?tab=documents');
  await page.getByTestId('tab-documents').getByRole('button', { name: 'Upload Document' }).click();
  const form = page.getByTestId('upload-document');
  await expect(form).toContainText(NAME1);
  await expect(form.getByLabel('Share with the client (shows in their portal)')).not.toBeChecked();
  await form.locator('input[type=file]').setInputFiles({
    name: STAFF_FILE,
    mimeType: 'application/pdf',
    buffer: PDF,
  });
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const row = page.getByTestId('payroll-document').filter({ hasText: STAFF_FILE });
  await expect(row).toBeVisible({ timeout: 60_000 });
  await page.reload();
  await expect(page.getByTestId('payroll-document').filter({ hasText: STAFF_FILE })).toBeVisible();
  await snap(page, 'F03-staff-upload');
  const { ctx, page: p } = await asClient(browser);
  try {
    await p.goto(portal('/documents'));
    await expect(p.getByRole('heading', { name: 'My Uploaded Documents', level: 1 })).toBeVisible();
    await p.waitForLoadState('networkidle').catch(() => {});
    await expect(p.getByText(STAFF_FILE)).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});

test('UX02 (red) staff document: service and source, View opens it, Download downloads it', async ({
  page,
}) => {
  await openWorkspace(page, '?tab=documents');
  const doc = page.getByTestId('payroll-document').filter({ hasText: STAFF_FILE });
  await expect(doc).toContainText(/Payroll.* · /);
  const view = doc.getByRole('link', { name: `View ${STAFF_FILE}` });
  await expect(view).toHaveAttribute('href', /^\/documents\/[0-9a-f-]{36}/);
  const download = doc.getByRole('button', { name: `Download ${STAFF_FILE}` });
  await expect(download).toBeEnabled({ timeout: 90_000 });
  const got = page.waitForEvent('download', { timeout: 30_000 });
  await download.click();
  expect((await got).suggestedFilename()).toBe(STAFF_FILE);
  await snap(page, 'UX02-staff');
  await view.click();
  await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}/);
  await expect(page.getByText(STAFF_FILE).first()).toBeVisible();
  await snap(page, 'UX02-view');
});

test('B01 Add Report from an uploaded file: saved, named, kept on reload, View and Download', async ({
  page,
}) => {
  await openWorkspace(page, '?tab=reports');
  await page
    .getByTestId('tab-reports')
    .getByRole('button', { name: /Add Report/ })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Add Report' });
  await dialog.getByLabel('Period start').fill('2026-10-01');
  await dialog.getByLabel('Period end').fill('2026-10-31');
  await dialog.getByLabel('Document').selectOption({ label: STAFF_FILE });
  await dialog.getByRole('button', { name: 'Add Report' }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByTestId('report-file-name').filter({ hasText: STAFF_FILE })).toBeVisible();
  await expect(page.getByRole('link', { name: `View ${STAFF_FILE}` }).first()).toBeVisible();
  const download = page.getByRole('button', { name: `Download ${STAFF_FILE}` }).first();
  await expect(download).toBeEnabled({ timeout: 90_000 });
  const got = page.waitForEvent('download', { timeout: 30_000 });
  await download.click();
  expect((await got).suggestedFilename()).toBe(STAFF_FILE);
  await snap(page, 'B01-report');
});

// ---------- Routing and return: F04, F05, F10, F11, UX01 ----------

test('F04 Create Task: Payroll service prefilled, Cancel back to the exact page', async ({
  page,
}) => {
  await openWorkspace(page);
  const origin = page.url();
  await page.getByTestId('quick-actions').getByRole('link', { name: 'Create Task' }).click();
  await expect(page).toHaveURL(/\/tasks\/new\?/);
  const service = page.locator('#tf-service');
  await expect(service).not.toHaveValue('');
  await expect(service.locator('option:checked')).toHaveText(/Payroll/);
  await expect(page.locator('body')).toContainText(NAME1);
  await snap(page, 'F04-task-form');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(origin);
  await expect(page.getByTestId('quick-actions')).toBeVisible();
});

test('F05 Messages: client preselected, selector works, Back returns to Communications', async ({
  page,
}) => {
  await openWorkspace(page, '?tab=communications');
  const open = page.getByTestId('tab-communications').getByRole('link', { name: 'Open Messages' });
  await expect(open).toHaveAttribute('href', /clientId=/);
  await open.click();
  await expect(page).toHaveURL(/\/messages\?clientId=[0-9a-f-]{36}&service=Payroll&from=/);
  const select = page.getByTestId('messages-client');
  await expect(select).toHaveValue(CLIENT1);
  const other = await select
    .locator('option')
    .evaluateAll(
      (os, id) => os.map((o) => (o as HTMLOptionElement).value).find((v) => v && v !== id),
      CLIENT1,
    );
  if (other) {
    await select.selectOption(other);
    await expect(select).toHaveValue(other);
    await select.selectOption(CLIENT1);
    await expect(select).toHaveValue(CLIENT1);
  }
  await snap(page, 'F05-messages');
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(/\/payroll\/clients\/[0-9a-f-]{36}\?tab=communications/);
  await expect(page.getByTestId('tab-communications')).toBeVisible();
});

test('F10 (green) in-app Back from Manage Integrations keeps period and search; refresh keeps them', async ({
  page,
}) => {
  await openList(page);
  const period = page.getByLabel('Period', { exact: true });
  const search = page.getByPlaceholder(SEARCH);
  await period.selectOption('LAST_MONTH');
  await search.fill('Fixture');
  await expect(page).toHaveURL(/q=Fixture/);
  await page.reload();
  await expect(period).toHaveValue('LAST_MONTH');
  await expect(search).toHaveValue('Fixture');
  await page.getByRole('link', { name: 'Manage Integrations' }).click();
  await expect(page).toHaveURL(/\/integrations/);
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(/\/payroll\?.*period=LAST_MONTH/);
  await expect(search).toHaveValue('Fixture');
  await expect(page.getByTestId('client-link').filter({ hasText: NAME1 })).toBeVisible();
  await snap(page, 'F10-in-app-back');
});

test('F10 (red) browser Back restores the newest filters, twice', async ({ page }) => {
  await openList(page);
  const period = page.getByLabel('Period', { exact: true });
  const search = page.getByPlaceholder(SEARCH);
  await period.selectOption('THIS_MONTH');
  await search.fill('QA');
  await expect(page).toHaveURL(/q=QA/);
  // Newer filters, then away and the browser's Back: the newer ones, each time.
  for (const [p, q] of [
    ['LAST_MONTH', 'Fixture'],
    ['THIS_QUARTER', 'Client'],
  ] as const) {
    await period.selectOption(p);
    await search.fill(q);
    await expect(page).toHaveURL(new RegExp(`q=${q}`));
    await page.getByRole('link', { name: 'Manage Integrations' }).click();
    await expect(page).toHaveURL(/\/integrations/);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`period=${p}`));
    await expect(period).toHaveValue(p);
    await expect(search).toHaveValue(q);
  }
  await snap(page, 'F10-browser-back');
});

test('F11 Schedule Appointment: client and Payroll prefilled, Cancel to the exact page', async ({
  page,
}) => {
  await openWorkspace(page);
  const origin = page.url();
  await moreActions(page, 'Schedule Appointment');
  await expect(page).toHaveURL(/\/calendar\/new\?clientId=[0-9a-f-]{36}&engagementId=/);
  await expect(page.getByTestId('appointment-summary')).toContainText(NAME1);
  await expect(page.getByLabel('Related Service').locator('option:checked')).toHaveText(/Payroll/);
  await snap(page, 'F11-appointment');
  await page
    .getByRole('link', { name: 'Cancel', exact: true })
    .or(page.getByRole('button', { name: 'Cancel', exact: true }))
    .first()
    .click();
  await expect(page).toHaveURL(origin);
});

test('UX01 Reports tab stays selected on reload', async ({ page }) => {
  await openWorkspace(page);
  const tabs = page.getByRole('tablist', { name: 'Payroll client tabs' });
  await tabs.getByRole('tab', { name: 'Reports' }).click();
  await expect(page).toHaveURL(/[?&]tab=reports/);
  await page.reload();
  await expect(page.getByTestId('tab-reports')).toBeVisible();
  await expect(tabs.getByRole('tab', { name: 'Reports' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('client-title')).toContainText(NAME1);
  await snap(page, 'UX01-reports-reload');
});

test('UX03 Settings tab visible at 1165 px without sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1165, height: 900 });
  await openWorkspace(page);
  const tabs = page.getByRole('tablist', { name: 'Payroll client tabs' });
  await expect(tabs.getByRole('tab', { name: 'Settings' })).toBeInViewport();
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(over).toBeLessThanOrEqual(1);
  await snap(page, 'UX03-settings-tab');
});

// ---------- Menus: F07, F08, S15 ----------

test('F07 row menu: outside the table, End to Remove, Escape closes and returns focus', async ({
  page,
}) => {
  await openList(page);
  const trigger = page.getByRole('button', { name: `Actions for ${NAME1}` });
  await trigger.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  const vp = page.viewportSize()!;
  expect(box && box.y + box.height <= vp.height + 1 && box.x + box.width <= vp.width + 1).toBe(
    true,
  );
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Remove Payroll Service' })).toBeFocused();
  await snap(page, 'F07-row-menu');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('F08 More Actions shows a single dropdown indicator', async ({ page }) => {
  await openWorkspace(page);
  const more = page.getByTestId('quick-actions').getByRole('button', { name: 'More Actions' });
  await expect(more.locator('svg.size-3\\.5')).toHaveCount(1);
  await more.click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Remove Payroll Service' })).toBeAttached();
  await snap(page, 'F08-more-actions');
  await page.keyboard.press('Escape');
});

// ---------- F09 runs, F12 plan, F13 / cross-service billing ----------

test('F09 Payroll Runs: columns, empty-state reason, no zero amounts; start gated', async ({
  page,
}) => {
  await openWorkspace(page, '?tab=runs');
  const runs = page.getByTestId('tab-runs');
  for (const h of [
    'Run and Pay Period',
    'Pay Date',
    'Frequency',
    'Workers',
    'Gross (confirmed)',
    'Total Cost (confirmed)',
    'Firmivra Status',
    'Provider Status',
  ]) {
    await expect(runs.getByRole('columnheader', { name: h })).toBeVisible();
  }
  await expect(runs).toContainText('No payroll runs yet');
  await expect(runs).not.toContainText('$0.00');
  await snap(page, 'F09-runs');
  await openWorkspace(page);
  // The start gate needs an authorized provider and a frequency; Test Firm B's seeded Gusto
  // connection is authorized, so the gate is open here. Unauthorized: it must be closed.
  const start = page.getByTestId('run-payroll');
  const authorized = /Connected · /.test(await page.getByTestId('provider-sync').innerText());
  if (await start.count()) {
    if (authorized) await expect(start).toBeEnabled();
    else await expect(start).toBeDisabled();
    console.log(
      `F09 NOTE Run Payroll ${authorized ? 'enabled (provider authorized)' : 'disabled'}`,
    );
  }
});

test('F12 plan: dropdown from Services & Pricing, saved plan survives reload, history, no invoice', async ({
  page,
  browser,
}) => {
  const api = await ownerApi(browser);
  const inv = async () => {
    const r = await api.get(`business/invoices?clientId=${CLIENT1}`);
    if (!r.ok()) return -1;
    const body = await r.json();
    return (body.total as number | undefined) ?? items(body).length;
  };
  const before = await inv();
  await openWorkspace(page);
  await moreActions(page, 'Change Payroll Plan/Service');
  const dialog = page.getByRole('dialog', { name: 'Change Payroll Plan / Service' });
  const plan = dialog.getByLabel('Plan or service');
  await expect(plan.locator('option', { hasText: 'No plan' })).toHaveCount(1);
  await expect(dialog).toContainText('Choosing a plan does not bill the client');
  const save = dialog.getByRole('button', { name: 'Save', exact: true });
  if ((await plan.locator('option:checked').innerText()).trim() !== SERVICE) {
    await plan.selectOption({ label: SERVICE });
    await save.click();
    await expect(page.getByText('Plan saved.')).toBeVisible();
  } else {
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  }
  await openWorkspace(page, '?tab=settings');
  await page.reload();
  const settings = page.getByTestId('tab-settings');
  await expect(settings.getByLabel('Plan or service').locator('option:checked')).toHaveText(
    SERVICE,
  );
  await expect(page.getByTestId('change-history')).toContainText(/plan/i);
  await snap(page, 'F12-settings-history');
  const after = await inv();
  await api.dispose();
  if (before >= 0) expect(after, 'an invoice appeared after the plan save').toBe(before);
});

test('F12 (dialog) Change Payroll Plan/Service opens on the saved plan; untouched Save is off', async ({
  page,
}) => {
  await openWorkspace(page, '?tab=settings');
  const saved = await page
    .getByTestId('tab-settings')
    .getByLabel('Plan or service')
    .locator('option:checked')
    .innerText();
  await openWorkspace(page);
  await moreActions(page, 'Change Payroll Plan/Service');
  const dialog = page.getByRole('dialog', { name: 'Change Payroll Plan / Service' });
  await expect(dialog.getByLabel('Plan or service').locator('option:checked')).toHaveText(saved);
  // F01 (#1603): an untouched Save can never clear the plan.
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await snap(page, 'F12-dialog');
  // Reloaded straight on the Overview (run 2's case): still the saved plan.
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByTestId('client-title')).toContainText(NAME1);
  await moreActions(page, 'Change Payroll Plan/Service');
  await expect(
    page
      .getByRole('dialog', { name: 'Change Payroll Plan / Service' })
      .getByLabel('Plan or service')
      .locator('option:checked'),
  ).toHaveText(saved);
});

test('F13 + cross-service: Service & Billing dialog shows each state and its effects', async ({
  page,
}) => {
  await openWorkspace(page);
  await moreActions(page, 'Pause or Resume Billing');
  const dialog = page.getByRole('dialog', { name: 'Service & Billing' });
  await expect(dialog).toContainText(`${NAME1} · Payroll`);
  const state = dialog.getByTestId('service-billing-state');
  await expect(state).toContainText('Service');
  await expect(state).toContainText('Billing');
  await expect(dialog.getByRole('group', { name: 'What to change' })).toBeVisible();
  await expect(dialog.getByTestId('service-billing-effects')).toBeVisible();
  await snap(page, 'F13-billing');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await moreActions(page, 'Pause Payroll Service');
  const d2 = page.getByRole('dialog', { name: 'Service & Billing' });
  await expect(d2.getByTestId('service-billing-state')).toBeVisible();
  await expect(d2.getByRole('radio')).not.toHaveCount(0);
  await snap(page, 'CROSS-service-billing');
  await d2.getByRole('button', { name: 'Cancel' }).click();
});

// ---------- Demo run: N01, B02 ----------

async function amount(summary: Locator, label: string): Promise<number> {
  const text = await summary
    .getByText(label, { exact: true })
    .locator('xpath=following-sibling::dd[1]')
    .innerText();
  return Math.round(Number(text.replace(/[^0-9.]/g, '')) * 100);
}

test('N01 demo names its sample rates and its figures follow them after an edit', async ({
  page,
}) => {
  await openWorkspace(page);
  await page.getByTestId('demo-run-link').click();
  await page.waitForURL(/\/payroll\/runs\/demo$/);
  const rates = 'employee taxes 12%, employer taxes 7.65%, benefits 3.8%';
  await expect(page.getByTestId('demo-sample')).toContainText(rates);
  const summary = page.getByTestId('run-summary');
  await expect(summary).toContainText('That is an illustration, not a tax calculation');
  const check = async () => {
    const gross = await amount(summary, 'Gross Payroll');
    expect(await amount(summary, 'Employee Taxes')).toBe(Math.round(gross * 0.12));
    expect(await amount(summary, 'Employer Taxes')).toBe(Math.round(gross * 0.0765));
    expect(await amount(summary, 'Employer Benefits')).toBe(Math.round(gross * 0.038));
    return gross;
  };
  const before = await check();
  await page
    .getByTestId('run-employees')
    .getByRole('button', { name: /^Edit (?!Selected$)/ })
    .first()
    .click();
  const other = page.getByRole('dialog').getByLabel('Other earnings ($)');
  await other.fill(String(Number((await other.inputValue()) || '0') + 100));
  await page.getByRole('button', { name: 'Save Line' }).click();
  await expect.poll(() => amount(summary, 'Gross Payroll')).toBe(before + 10_000);
  await check();
  await snap(page, 'N01-demo');
});

test('B02 demo: Ready/Approve gated, negative hours refused, Save Draft, reload restores', async ({
  page,
}) => {
  await page.goto(app('/payroll/runs/demo'));
  await expect(page.getByTestId('demo-banner')).toBeVisible();
  const gross = await amount(page.getByTestId('run-summary'), 'Gross Payroll');
  await expect(page.getByRole('button', { name: /Mark Ready for Review/ })).toBeDisabled();
  await expect(page.getByRole('button', { name: /Approve Payroll/ })).toBeDisabled();
  await page
    .getByTestId('run-employees')
    .getByRole('button', { name: /^Edit (?!Selected$)/ })
    .first()
    .click();
  await page.getByRole('dialog').getByLabel('Hours').fill('-1');
  await page.getByRole('button', { name: 'Save Line' }).click();
  await expect(
    page.getByText('Some details need fixing. Check the highlighted fields.'),
  ).toBeVisible();
  await snap(page, 'B02-negative-hours');
  await page.keyboard.press('Escape');
  const saveDraft = page.getByRole('button', { name: /Save Draft/ });
  if (await saveDraft.isEnabled()) {
    await saveDraft.click();
    await expect(page.getByText('Draft saved.')).toBeVisible();
  }
  await page.reload();
  await expect.poll(() => amount(page.getByTestId('run-summary'), 'Gross Payroll')).toBe(gross);
});

// ---------- Earlier successes S01–S14 (narrow regressions; nothing saved) ----------

test('S01 reminder setting shows in Payroll Settings', async ({ page }) => {
  await openList(page);
  await page.getByRole('button', { name: 'Payroll Settings' }).click();
  await expect(page.getByLabel('Remind this many days before a pay date')).toHaveValue(/^\d+$/);
  await snap(page, 'S01-settings');
  await page
    .getByRole('dialog', { name: 'Payroll Settings' })
    .getByRole('button', { name: 'Cancel' })
    .click();
});

test('S02 S05 notes tab loads; Add Note and Log Activity open and cancel', async ({ page }) => {
  await openWorkspace(page, '?tab=notes');
  await expect(page.getByTestId('tab-notes')).toBeVisible();
  for (const item of ['Add Note', 'Log Activity'] as const) {
    await openWorkspace(page);
    await moreActions(page, item);
    const d = page.getByRole('dialog', { name: item });
    await expect(d).toBeVisible();
    await d.getByRole('button', { name: 'Cancel' }).click();
    await expect(d).toBeHidden();
  }
});

test('S03 S11 S14 Assign, Frequency and Archive dialogs open and cancel', async ({ page }) => {
  for (const [item, title] of [
    ['Assign/Reassign Staff', 'Assign / Reassign Staff'],
    ['Change Payroll Frequency', 'Change Payroll Frequency'],
    ['Archive Payroll Client', 'Archive Payroll Client'],
  ] as const) {
    await openWorkspace(page);
    await moreActions(page, item);
    const d = page.getByRole('dialog', { name: title });
    await expect(d).toBeVisible();
    await snap(page, `S-${item}`);
    await d.getByRole('button', { name: 'Cancel' }).click();
    await expect(d).toBeHidden();
  }
  await openWorkspace(page, '?tab=settings');
  await expect(page.getByTestId('tab-settings')).toContainText('Weekly');
});

test('S04 S06 S07 status shows; runs and reports load; tabs keep the client', async ({ page }) => {
  await openList(page);
  const row = page
    .getByRole('row')
    .filter({ has: page.getByTestId('client-link').filter({ hasText: NAME1 }) });
  await expect(row).toContainText(
    /Not Started|On Track|Processing|Action Required|Past Due|On Hold/,
  );
  for (const t of ['runs', 'reports', 'documents', 'communications'] as const) {
    await openWorkspace(page, `?tab=${t}`);
    await expect(page.getByTestId(`tab-${t}`)).toBeVisible();
  }
});

test('S08 S09 main Request Documents goes to All Requests; Manage Integrations carries from', async ({
  page,
}) => {
  await openList(page);
  await expect(page.getByRole('link', { name: 'Request Documents' })).toHaveAttribute(
    'href',
    /\/documents\/requests/,
  );
  await expect(page.getByRole('link', { name: 'Manage Integrations' })).toHaveAttribute(
    'href',
    /\/integrations.*from=/,
  );
});

test('S10 worker form opens from Add Employee and cancels', async ({ page }) => {
  await openWorkspace(page);
  await page.getByTestId('quick-actions').getByRole('button', { name: 'Add Employee' }).click();
  await expect(page.getByTestId('worker-form')).toBeVisible();
  await snap(page, 'S10-worker-form');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
});

// ---------- Cleanup: everything this run made ----------

test('zz cleanup: LIVE-CHECK documents, request, payroll client, service, category', async ({
  browser,
}) => {
  const api = await ownerApi(browser);
  const log: string[] = [];
  const docs = items<{ id: string; name?: string; fileName?: string }>(
    await (await api.get(`business/documents?clientId=${CLIENT1}&search=LIVE-CHECK`)).json(),
  );
  for (const d of docs) {
    const r = await api.post(`business/documents/${d.id}/trash`);
    log.push(`doc ${d.fileName ?? d.name ?? d.id}: trash ${r.status()}`);
  }
  const packets = items<{ id: string; status: string }>(
    await (
      await api.get(`business/document-request-packets?clientId=${CLIENT1}&search=LIVE-CHECK`)
    ).json(),
  );
  for (const p of packets.filter((x) => x.status !== 'CANCELLED')) {
    const r = await api.post(`business/document-request-packets/${p.id}/cancel`);
    log.push(`request ${p.id}: cancel ${r.status()}`);
  }
  // Requests made from a workspace (Request Documents) are never deleted: cancel tells nobody.
  const requests = items<{ id: string; title: string; status: string }>(
    await (await api.get(`business/clients/${CLIENT1}/document-requests`)).json(),
  ).filter((r) => r.title.startsWith('LIVE-CHECK') && r.status !== 'CANCELLED');
  for (const r of requests) {
    const c = await api.post(`business/document-requests/${r.id}/cancel`);
    log.push(`client request "${r.title}" (${r.status}): cancel ${c.status()}`);
  }
  if (pcId) {
    const r = await api.post(`business/payroll/clients/${pcId}/remove-service`, {
      reason: `${runTag} cleanup`,
    });
    log.push(`payroll client ${pcId}: remove-service ${r.status()}`);
  }
  // Our service is archived (restored by the next run); the category stays for reuse.
  const svcs = items<{ id: string; name: string; archivedAt?: string | null }>(
    await (
      await api.get(`business/catalog/services?status=all&search=${encodeURIComponent(SERVICE)}`)
    ).json(),
  ).filter((x) => x.name === SERVICE);
  for (const x of svcs) {
    const ar = await api.post(`business/catalog/services/${x.id}/archive`);
    log.push(`service ${x.id}: archive ${ar.status()}`);
  }
  log.push(`category "${CATEGORY}": kept for the next run (in use by the archived service)`);
  console.log(`CLEANUP\n${log.join('\n')}`);
  await api.dispose();
});
