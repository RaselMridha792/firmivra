import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { appUrl, shotsDir, statePath, type Role } from './env';
import { app, as, expectNoSideScroll, hasLogin, settled, shot } from './helpers';

/**
 * Leads, Review Two (Octavia, Nov 8) and her checklist: one test per row (the green ones too), live
 * on dev as Test Firm B's Owner, Admin and Staff. Every record this run makes carries the run tag
 * ("LIVE-CHECK yyyymmddhhmm") in its name, and every lead's email is an SES simulator address
 * (success+live-check-<stamp>-<n>@simulator.amazonses.com), so any notice the app sends goes there.
 * Leads have no delete: "zz cleanup" archives each lead of the run, removes its files, cancels its
 * appointments, archives the converted clients and the campaign draft. Tags have no delete, so every
 * run reuses one fixed tag, "LIVE-CHECK" (found, or made once ever).
 *
 * Sends: only to SES simulator addresses, checked on the screen (or the record) just before each send.
 *
 * The run's tag and ids live in files, so a failed test that restarts the worker keeps both. The
 * tag is keyed by the runner's process id (a worker's parent), so a new run gets a new tag.
 *
 * Lead appointments (R55's P4-1) are not on dev yet: that block runs only with LIVE_LEAD_APPTS=1.
 */
test.describe.configure({ timeout: 180_000 });

const TAB = 'leads';
const TZ = 'America/New_York';

const runTag = (() => {
  const f = join(shotsDir(TAB), '.runtag');
  try {
    const saved = JSON.parse(readFileSync(f, 'utf8')) as { ppid: number; tag: string };
    if (saved.ppid === process.ppid) return saved.tag;
  } catch {
    // no tag yet
  }
  const tag = `LIVE-CHECK ${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
  writeFileSync(f, JSON.stringify({ ppid: process.ppid, tag }));
  return tag;
})();
/** The tag's digits: one search word that finds this run's leads only. */
const STAMP = runTag.slice('LIVE-CHECK '.length);
const email = (n: number | string) => `success+live-check-${STAMP}-${n}@simulator.amazonses.com`;
const SIMULATOR = /@simulator\.amazonses\.com$/;
const full = (last: string) => `${runTag} ${last}`;
/** One fixed tag for every run (tags have no delete): Test Firm B gains at most this one, ever. */
const TAG = 'LIVE-CHECK';
const CAMPAIGN = `${runTag} Campaign`;
const NOTE_TOKEN = `N${STAMP}x6`;
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

// ---------------------------------------------------------------- the run's records

interface Ctx {
  tag: string;
  ownerId: string;
  ownerName: string;
  staffId: string;
  staffName: string;
  serviceId: string;
  serviceName: string;
  alpha: string;
  beta: string;
  gamma: string;
  delta: string;
  layout: string;
  pages: string[]; // p01..p08
  clients: string[];
  appt: string; // the lead-appointment block's lead (R55)
  appointments: string[];
  /** The run's own catalog service (Test Firm B has none) and the category if the run made it. */
  serviceMade: string;
  categoryMade: string;
  /** The run's own appointment type (Test Firm B keeps none active). */
  typeMade: string;
  typeName: string;
  /** The run's own follow-up sequence (Test Firm B has none). */
  sequenceMade: string;
  sequenceName: string;
  /** Set on an earlier run's entry once its cleanup left nothing. */
  cleaned?: boolean;
}
const SERVICE = `${runTag} Service`;
const CATEGORY = 'LIVE-CHECK';
const ctxFile = () => join(process.env['LIVE_OUT_DIR']!, 'leads-ctx.json');
const blankCtx = (): Ctx => ({
  tag: runTag,
  ownerId: '',
  ownerName: '',
  staffId: '',
  staffName: '',
  serviceId: '',
  serviceName: '',
  alpha: '',
  beta: '',
  gamma: '',
  delta: '',
  layout: '',
  pages: [],
  clients: [],
  appt: '',
  appointments: [],
  serviceMade: '',
  categoryMade: '',
  typeMade: '',
  typeName: '',
  sequenceMade: '',
  sequenceName: '',
});
const readCtx = (): Ctx => ({
  ...blankCtx(),
  ...(JSON.parse(readFileSync(ctxFile(), 'utf8')) as Partial<Ctx>),
});
/**
 * Every run's records, by tag (outside the repo), so a run that stopped before its cleanup is
 * cleaned by the next one's.
 */
const registryFile = () => join(shotsDir(TAB), '.runs.json');
function readRegistry(): Ctx[] {
  try {
    return (JSON.parse(readFileSync(registryFile(), 'utf8')) as Partial<Ctx>[]).map((x) => ({
      ...blankCtx(),
      ...x,
    }));
  } catch {
    return [];
  }
}
function register(c: Ctx) {
  const all = readRegistry();
  const i = all.findIndex((x) => x.tag === c.tag);
  if (i >= 0) all[i] = { ...all[i]!, ...c };
  else all.push(c);
  writeFileSync(registryFile(), JSON.stringify(all, null, 2));
}
const saveCtx = (c: Ctx) => {
  writeFileSync(ctxFile(), JSON.stringify(c, null, 2));
  register(c);
};
const P = (n: number) => `P${String(n).padStart(2, '0')}`;

interface Res {
  ok(): boolean;
  status(): number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- API JSON in a live check; each test reads only the fields it asserts
  json(): Promise<any>;
  text(): Promise<string>;
}
interface Api {
  get(path: string): Promise<Res>;
  post(path: string, data?: unknown): Promise<Res>;
  patch(path: string, data: unknown): Promise<Res>;
  delete(path: string): Promise<Res>;
  dispose(): Promise<void>;
}

/**
 * Refreshes the role's saved session when its access token has expired (as the app does on a 401)
 * and saves it back, so the page tests start signed in even when the setup project did not run
 * (a `-g` run). Owner, Admin and Staff all sign in on the app host.
 */
async function freshSession(browser: Browser, role: Role): Promise<void> {
  if (!existsSync(statePath(role))) {
    throw new Error(`no saved ${role} session: run the setup project once (without -g)`);
  }
  const ctx = await browser.newContext({ storageState: statePath(role) });
  try {
    const url = (p: string) => `${appUrl}/api/v1/${p}`;
    if ((await ctx.request.get(url('me'))).status() !== 401) return;
    const r = await ctx.request.post(url('auth/refresh'), {
      headers: { origin: appUrl },
      data: {},
    });
    if (!r.ok()) {
      throw new Error(
        `${role} session refresh failed (${r.status()}): run the setup project to sign in again`,
      );
    }
    if ((await ctx.request.get(url('me'))).status() === 401) {
      throw new Error(`${role} session still signed out after a refresh`);
    }
    // Only the cookies change: the rest of the saved state (as the setup wrote it) is kept.
    const cookies = (await ctx.storageState()).cookies;
    const saved = JSON.parse(readFileSync(statePath(role), 'utf8')) as Record<string, unknown>;
    writeFileSync(statePath(role), JSON.stringify({ ...saved, cookies }, null, 2));
  } finally {
    await ctx.close();
  }
}

/**
 * The role's API through a browser context (setup and cleanup only): the saved session is
 * refreshed first (freshSession), and a call that answers 401 (the access token lapsed meanwhile)
 * refreshes it and is sent once more. Writes send the site's Origin.
 */
async function roleApi(browser: Browser, role: Role): Promise<Api> {
  await freshSession(browser, role);
  const ctx = await browser.newContext({ storageState: statePath(role) });
  const url = (p: string) => `${appUrl}/api/v1/${p}`;
  const headers = { origin: appUrl };
  const retry = async (call: () => Promise<Res>): Promise<Res> => {
    const first = await call();
    if (first.status() !== 401) return first;
    const r = await ctx.request.post(url('auth/refresh'), { headers, data: {} });
    if (!r.ok()) throw new Error(`${role} session refresh failed: ${r.status()}`);
    return call();
  };
  return {
    get: (p) => retry(() => ctx.request.get(url(p))),
    post: (p, data) => retry(() => ctx.request.post(url(p), { headers, data: data ?? {} })),
    patch: (p, data) => retry(() => ctx.request.patch(url(p), { headers, data })),
    delete: (p) => retry(() => ctx.request.delete(url(p), { headers })),
    dispose: () => ctx.close(),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- API JSON in a live check; each test reads only the fields it asserts
async function ok(res: Res, what: string): Promise<any> {
  if (!res.ok()) throw new Error(`${what}: ${res.status()} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/** YYYY-MM-DD in the firm's zone, `days` from today. */
const firmDay = (days: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(
    new Date(Date.now() + days * 86_400_000),
  );
/** EST until March: every date this run uses is in November or December. */
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00-05:00`;
/** The next weekday at least `days` ahead (firm zone). */
function weekday(days: number): string {
  for (let d = days; ; d++) {
    const day = firmDay(d);
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) return day;
  }
}

async function createLead(api: Api, last: string, n: number, extra: Record<string, unknown> = {}) {
  if (!SIMULATOR.test(email(n)))
    throw new Error(`lead email ${email(n)} is not a simulator address`);
  const made = await ok(
    await api.post('business/leads', {
      firstName: runTag,
      lastName: last,
      email: email(n),
      source: 'OTHER',
      sourceDetail: `${runTag} synthetic`,
      priority: 'WARM',
      allowDuplicate: true,
      ...extra,
    }),
    `create lead ${last}`,
  );
  return made.id as string;
}

type LeadKey = 'alpha' | 'beta' | 'gamma' | 'delta' | 'layout';

/** Makes the lead; if an earlier attempt of this run made it already (409), finds that one. */
async function ensureLead(api: Api, last: string, n: number, extra: Record<string, unknown>) {
  try {
    return await createLead(api, last, n, extra);
  } catch (e) {
    if (!String(e).includes('POSSIBLE_DUPLICATE')) throw e;
    const found = await ok(
      await api.get(
        `business/leads/pipeline?search=${encodeURIComponent(`${STAMP} ${last}`)}&pageSize=100`,
      ),
      'find lead',
    );
    const lead = (found.items as { id: string; firstName: string; lastName: string }[]).find(
      (l) => l.firstName === runTag && l.lastName === last,
    );
    if (!lead) throw e;
    return lead.id;
  }
}

/**
 * Finds the run's records, or makes them: who is who, the run's catalog service and appointment
 * type (Test Firm B keeps neither active), then the leads. Saved after each record, so a restarted
 * worker or a failed step resumes where it stopped. With `withLeads` false (the lead-appointment
 * block alone) the leads are not made.
 */
async function fixture(browser: Browser, withLeads = true): Promise<Ctx> {
  let c = blankCtx();
  if (existsSync(ctxFile())) {
    const old = readCtx();
    if (old.tag === runTag) c = old;
    else register(old); // an earlier run's records: its cleanup is swept by this run's
  }
  const ready = Boolean(c.ownerId && c.serviceMade && c.typeMade && c.sequenceMade);
  if (ready && (!withLeads || (c.layout && c.pages.length === 8))) return c;
  const api = await roleApi(browser, 'owner');
  try {
    if (!c.ownerId) {
      // An earlier run that stopped before its cleanup: clean it first.
      for (const run of readRegistry().filter((r) => r.tag !== runTag && !r.cleaned)) {
        const left: string[] = [];
        await cleanRun(api, run, [], left);
        if (!left.length) register({ ...run, cleaned: true });
        else console.log(`EARLIER RUN ${run.tag} left: ${left.join('; ')}`);
      }
      const me = await ok(await api.get('me'), 'me');
      c.ownerId = me.user.id as string;
      if (hasLogin('staff')) {
        const s = await roleApi(browser, 'staff');
        c.staffId = (await ok(await s.get('me'), 'staff me')).user.id as string;
        await s.dispose();
      }
      const opts = await ok(await api.get('business/leads/options'), 'options');
      const staff = opts.staff as { userId: string; name: string }[];
      c.ownerName = staff.find((m) => m.userId === c.ownerId)?.name ?? '';
      c.staffName = staff.find((m) => m.userId === c.staffId)?.name ?? '';
      saveCtx(c);
    }
    if (!c.serviceMade) {
      // A Custom Quote service (nothing bills) in the "LIVE-CHECK" category (found, or made).
      const listed = await ok(await api.get('business/catalog/categories'), 'categories');
      const cats = (Array.isArray(listed) ? listed : (listed.items ?? [])) as {
        id: string;
        name: string;
      }[];
      let categoryId = cats.find((x) => x.name === CATEGORY)?.id;
      if (!categoryId) {
        const made = await ok(
          await api.post('business/catalog/categories', {
            name: CATEGORY,
            description: 'Live check fixture (synthetic)',
          }),
          'category',
        );
        categoryId = made.id as string;
        c.categoryMade = categoryId;
        saveCtx(c);
      }
      const made = await ok(
        await api.post('business/catalog/services', {
          name: SERVICE,
          categoryId,
          shortDescription: 'Live check fixture (synthetic), removed by the run',
          kind: 'OTHER',
          pricingType: 'CUSTOM_QUOTE',
          activate: true,
          allowDuplicateName: true,
        }),
        'service',
      );
      c.serviceMade = c.serviceId = made.id as string;
      c.serviceName = SERVICE;
      saveCtx(c);
    }
    if (!c.typeMade) {
      // Staff only (not bookable from the portal); archived by cleanup.
      const made = await ok(
        await api.post('business/appointment-types', {
          name: `${runTag} Lead 30m`,
          durationMinutes: 30,
          methods: ['IN_PERSON', 'PHONE', 'VIDEO'],
          clientBookable: false,
        }),
        'appointment type',
      );
      c.typeMade = made.id as string;
      c.typeName = (made.name as string | undefined) ?? `${runTag} Lead 30m`;
      saveCtx(c);
    }
    if (!c.sequenceMade) {
      // Reminders only, plus one outreach step that only reminds its owner: nothing is sent.
      const made = await ok(
        await api.post('business/lead-sequences', {
          name: `${runTag} Sequence`,
          description: 'Live check fixture (synthetic)',
          steps: [
            {
              offsetDays: 1,
              actionType: 'CALL',
              mode: 'REMINDER',
              note: 'Live check: reminder only',
            },
            {
              offsetDays: 3,
              actionType: 'EMAIL',
              mode: 'OUTREACH',
              note: 'Live check: nothing is sent',
            },
          ],
        }),
        'sequence',
      );
      c.sequenceMade = made.id as string;
      c.sequenceName = (made.name as string | undefined) ?? `${runTag} Sequence`;
      saveCtx(c);
    }
    if (!withLeads) return c;
    const svc = { serviceIds: [c.serviceId] };
    const lead = async (key: LeadKey, last: string, n: number, extra: Record<string, unknown>) => {
      if (c[key]) return;
      c[key] = await ensureLead(api, last, n, { ...svc, ...extra });
      saveCtx(c);
    };
    await lead('alpha', 'Alpha', 1, {
      source: 'REFERRAL',
      phone: '(202) 555-0101',
      priority: 'HOT',
      preferredContact: ['EMAIL'],
      nextAction: {
        type: 'CALL',
        dueAt: at(firmDay(-1), '09:00'),
        notes: 'Live check: overdue reminder only',
      },
    });
    await lead('beta', 'Beta', 2, {
      source: 'WEBSITE_FORM',
      stage: 'IN_REVIEW',
      nextAction: {
        type: 'FOLLOW_UP',
        dueAt: at(weekday(9), '14:15'),
        notes: 'Live check: future reminder only',
      },
    });
    await lead('gamma', 'Gamma', 3, {
      phone: '(202) 555-0103',
      priority: 'COLD',
      assignedUserId: c.ownerId,
    });
    await lead('delta', 'Delta', 4, c.staffId ? { assignedUserId: c.staffId } : {});
    await lead('layout', 'Layout', 5, { phone: '(202) 555-0105' });
    for (let i = 1; i <= 8; i++) {
      if (c.pages[i - 1]) continue;
      c.pages[i - 1] = await ensureLead(api, P(i), 10 + i, {
        ...svc,
        ...(i === 3 ? { phone: '(202) 555-0113' } : {}),
      });
      saveCtx(c);
    }
    return c;
  } finally {
    await api.dispose();
  }
}

/** The layout lead, active (a @narrow run after an earlier cleanup restores it). */
async function layoutLead(browser: Browser): Promise<string> {
  const c = await fixture(browser);
  const api = await roleApi(browser, 'owner');
  try {
    if (!(await api.get(`business/leads/${c.layout}/profile`)).ok()) {
      await ok(
        await api.post('business/leads/bulk', { action: 'RESTORE', ids: [c.layout] }),
        'restore layout lead',
      );
    }
  } finally {
    await api.dispose();
  }
  return c.layout;
}

// ---------------------------------------------------------------- page helpers

const table = (page: Page) => page.getByRole('table', { name: 'Leads' });
const rows = (page: Page) => table(page).locator('tbody tr');
const rowOf = (page: Page, last: string) =>
  table(page).getByRole('row', { name: new RegExp(`${STAMP} ${last}(\\s|$)`) });
const searchBox = (page: Page) => page.getByRole('searchbox', { name: 'Search leads' });
const pager = (page: Page) => page.getByRole('navigation', { name: 'Pagination' });
const chips = (page: Page) => page.getByLabel('Active filters');
const moreFilters = (page: Page) => page.getByRole('button', { name: /More Filters/ });
const filterPanel = (page: Page) => page.getByRole('region', { name: 'More filters' });
const bulkBar = (page: Page) => page.getByRole('toolbar', { name: 'Bulk actions' }).first();
const lead = (id: string, tab = '') => app(`/leads/${id}${tab ? `/${tab}` : ''}`);

const signInHeading = (page: Page) => page.getByRole('heading', { name: 'Welcome Back' });
// The table's empty title (leads-table.tsx), whatever element shows it.
const noMatch = (page: Page) =>
  page.getByText('No leads match these filters', { exact: true }).first();

/** A lost session: leave the sign-in screen (no screenshot of it) and say so plainly. */
async function failIfSignedOut(page: Page) {
  if (
    await signInHeading(page)
      .isVisible()
      .catch(() => false)
  ) {
    await page.goto('about:blank');
    throw new Error(
      'the page went to sign-in: the session was lost (harness, not a product finding)',
    );
  }
}

/**
 * Opens the list, searched to this run's leads, 24 per page (all of them on one page). The search
 * reaches the address (debounced) before anything else changes, so no filter is undone by it.
 */
async function openList(page: Page, search = STAMP, size = '24') {
  await page.goto(app('/leads'));
  // The table shows only when the firm has leads; the search box always.
  await expect(searchBox(page).or(signInHeading(page))).toBeVisible({ timeout: 60_000 });
  await failIfSignedOut(page);
  await settled(page);
  if (search) {
    await searchBox(page).fill(search);
    await expect(page).toHaveURL(/[?&]search=/);
    await expect(rows(page).first()).toContainText(search, { timeout: 30_000 });
    if (
      size !== '8' &&
      (await pager(page)
        .isVisible()
        .catch(() => false))
    ) {
      await pager(page).locator('select').selectOption(size);
      await expect(page).toHaveURL(new RegExp(`[?&]size=${size}`));
    }
    await settled(page);
  }
}

async function openLead(page: Page, id: string, tab = '') {
  await page.goto(lead(id, tab));
  await expect(page.getByTestId('lead-name').or(signInHeading(page))).toBeVisible({
    timeout: 60_000,
  });
  await failIfSignedOut(page);
  await expect(page.getByTestId('lead-name')).toContainText(STAMP, { timeout: 60_000 });
}

/** Opens a lead from its row's name link (its own address). */
async function openFromRow(page: Page, last: string) {
  const link = rowOf(page, last).getByRole('link', { name: new RegExp(`${STAMP} ${last}`) });
  const href = await link.getAttribute('href');
  expect(href, `the row of ${last} links to its lead`).toMatch(/\/leads\/[0-9a-f-]{36}/);
  await page.goto(app(href!));
  await expect(page.getByTestId('lead-name')).toContainText(last, { timeout: 60_000 });
  return /\/leads\/([0-9a-f-]{36})/.exec(href!)![1]!;
}

/** The element shows whole, sideways, inside the table's scrolling frame and the window. */
async function expectInFrame(page: Page, frame: Locator, el: Locator, what: string) {
  const f = await frame.boundingBox();
  const b = await el.boundingBox();
  expect(f, 'the table frame is on the page').not.toBeNull();
  expect(b, `${what} is on the page`).not.toBeNull();
  if (!f || !b) return;
  const right = Math.min(f.x + f.width, page.viewportSize()!.width);
  expect(b.x, `${what}: left edge in view`).toBeGreaterThanOrEqual(f.x - 1);
  expect(b.x + b.width, `${what}: right edge in view`).toBeLessThanOrEqual(right + 1);
}

/** The member's name as the screens shorten it ("QA Perf (fake)" shows as "Q. Perf (fake)"). */
const tail = (name: string) => name.split(' ').slice(1).join(' ') || name;

/** "Showing 1 – 8 of 12 leads": the 12 (0 when the list says nothing matches). */
async function listTotal(page: Page): Promise<number> {
  const empty = noMatch(page);
  if (await empty.isVisible().catch(() => false)) return 0;
  const text = await pager(page)
    .innerText()
    .catch(() => '');
  const m = /of\s+([\d,]+)\s+lead/.exec(text);
  if (m) return Number(m[1]!.replace(/,/g, ''));
  // No pager: an empty list shows no rows (its empty state may not be the no-match one).
  return (await rows(page).count()) === 0 ? 0 : -1;
}

async function rowMenu(page: Page, last: string, item: string) {
  await page.getByRole('button', { name: `More actions for ${full(last)}` }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

async function check(page: Page, last: string) {
  await rowOf(page, last).getByRole('checkbox').check();
}

/**
 * Rule: a send may reach only SES simulator addresses. Reads every address the screen shows for the
 * send and fails the test before the send if one is not a simulator address.
 */
async function expectOnlySimulator(scope: Locator, what: string) {
  const text = await scope.innerText();
  const addresses = (text.match(/[^\s<>(),;:"']+@[^\s<>(),;:"']+/g) ?? []).map((a) =>
    a.replace(/\.$/, ''),
  );
  expect(addresses.length, `${what}: the recipient's address is shown`).toBeGreaterThan(0);
  for (const a of addresses) expect(a, `${what}: recipient ${a}`).toMatch(SIMULATOR);
}

/** The tag picker: type, then choose the option. */
async function pickTag(scope: Locator, name: string) {
  const box = scope.getByTestId('tag-picker').getByRole('combobox');
  await box.fill(name);
  await scope.getByTestId('tag-picker').getByRole('option', { name, exact: true }).click();
}

/** Opens Add New Lead and fills the three required fields. */
async function newLeadDialog(page: Page, last: string, mail: string) {
  expect(mail, 'a lead the run makes has a simulator address').toMatch(SIMULATOR);
  await page.getByRole('button', { name: 'Add New Lead' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('First name').fill(runTag);
  await dialog.getByLabel('Last name').fill(last);
  await dialog.getByRole('textbox', { name: 'Email' }).fill(mail);
  await dialog.getByRole('checkbox', { name: readCtx().serviceName }).first().check();
  return dialog;
}

const note = (info: TestInfo, type: string, description: string) => {
  info.annotations.push({ type, description });
  console.log(`${type}: ${info.title}: ${description}`);
};

/** Runs the conversion wizard on a lead, with "Send later" (no invitation). Returns the client id. */
async function convertLead(page: Page, id: string, c: Ctx, address: string): Promise<string> {
  await page.goto(lead(id, 'convert'));
  const fields = page.getByTestId('convert-lead-client-fields');
  await expect(fields.getByLabel('Full Name *')).toHaveValue(new RegExp(STAMP), {
    timeout: 60_000,
  });
  const next = page.getByRole('button', { name: /Review & Continue/ });
  await fields.getByLabel('Address', { exact: true }).fill(address);
  await next.click();
  await expect(page).toHaveURL(/\/convert\/details$/);
  // The details step: phone, services and staff (prefilled from the lead).
  const phone = fields.getByLabel('Phone *');
  if (await phone.isVisible().catch(() => false)) {
    if (!(await phone.inputValue())) await phone.fill('(202) 555-0199');
  }
  const svc = fields.getByRole('checkbox', { name: c.serviceName });
  if ((await svc.count()) && !(await svc.isChecked())) await svc.check();
  const primary = page
    .getByTestId('convert-lead-staff-assignment')
    .getByLabel('Primary Staff Member *');
  if ((await primary.count()) && !(await primary.inputValue())) {
    await primary.selectOption({ label: c.ownerName });
  }
  await next.click();
  await expect(page).toHaveURL(/\/convert\/portal$/);
  await page
    .getByTestId('convert-lead-portal-access')
    .getByRole('radio', { name: /Send later/ })
    .check();
  await next.click();
  await expect(page).toHaveURL(/\/convert\/review$/);
  await expect(page.getByTestId('convert-lead-review-summary')).toContainText(address);
  // No portal invitation is sent: "Send later" is the choice under review.
  await expect(
    page
      .getByTestId('convert-lead-review-selections')
      .getByRole('img', { name: 'Selected: Send later' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Convert to Client/ }).click();
  await expect(page).toHaveURL(/\/convert\/done$/, { timeout: 60_000 });
  await expect(page.getByTestId('conversion-result')).toBeVisible();
  const view = page.getByTestId('conversion-actions').getByRole('link', { name: 'View Client' });
  const href = (await view.getAttribute('href')) ?? '';
  const clientId = decodeURIComponent(/\/clients\/([^/?#]+)/.exec(href)?.[1] ?? '');
  expect(clientId, 'the View Client link names the new client').toMatch(/^[0-9a-f-]{36}$/);
  const now = readCtx();
  if (!now.clients.includes(clientId)) now.clients.push(clientId);
  saveCtx(now);
  return clientId;
}

// ================================================================ Admin
test.describe('Leads (Admin)', () => {
  test.use(as('admin'));
  test.skip(() => !hasLogin('admin'), 'no admin login');
  test.beforeAll(async ({ browser }) => {
    await freshSession(browser, 'admin');
    await fixture(browser);
  });

  test('20a admin: Archive, Delete and Restore are offered (Firm Admin may)', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page);
    await page.getByRole('button', { name: `More actions for ${full(P(1))}` }).click();
    await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Archive' })).toBeVisible();
    await page.keyboard.press('Escape');
    await check(page, P(1));
    await expect(bulkBar(page).getByRole('button', { name: 'Delete' })).toBeVisible();
    await shot(page, TAB, '20a-admin', info);
  });
});

// ================================================================ Staff
test.describe('Leads (Staff)', () => {
  test.use(as('staff'));
  test.skip(() => !hasLogin('staff'), 'no staff login');
  let c: Ctx;
  test.beforeAll(async ({ browser }) => {
    await freshSession(browser, 'staff');
    c = await fixture(browser);
  });

  test('20a staff: no Archive, Delete or Restore', async ({ page }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page);
    const row = rowOf(page, 'Delta');
    await row.getByRole('button', { name: /^More actions for / }).click();
    const items = (await page.getByRole('menu').getByRole('menuitem').allInnerTexts()).map((s) =>
      s.trim(),
    );
    expect(items).not.toContain('Archive');
    await page.keyboard.press('Escape');
    await row.getByRole('checkbox').check();
    await expect(
      page.getByText('1 leads selected').filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(bulkBar(page).getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await shot(page, TAB, '20a-staff', info);
  });

  test('25 staff see only their own leads; another lead by its address is refused', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page);
    await expect(rowOf(page, 'Delta')).toHaveCount(1);
    await expect(rowOf(page, 'Alpha')).toHaveCount(0);
    await expect(rowOf(page, 'Beta')).toHaveCount(0);
    await shot(page, TAB, '25-staff-list', info);
    await page.goto(lead(c.alpha));
    await expect(
      page
        .getByText(
          /not found|no access|can.t find|couldn.t find|doesn.t exist|not available|permission|404/i,
        )
        .first(),
    ).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId('lead-name')).not.toContainText(STAMP);
    await expect(page.locator('main')).not.toContainText(email(1));
    await expect(page.locator('main')).not.toContainText(full('Alpha'));
    await shot(page, TAB, '25-staff-refused', info);
    note(info, 'NOT LIVE', '25 cross-firm isolation: needs a second firm login (never LVP)');
  });
});

// ================================================================ Owner
test.describe('Leads (Owner)', () => {
  test.use(as('owner'));
  test.skip(() => !hasLogin('owner'), 'no owner login');
  let c: Ctx;
  test.beforeAll(async ({ browser }) => {
    await freshSession(browser, 'owner');
    c = await fixture(browser);
  });

  test('1 summary cards: Not Qualified populated; each card equals its filtered list', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    // P08 marked Not Qualified from its Overview (populates the card).
    await openLead(page, c.pages[7]!);
    await page
      .getByTestId('card-quick-actions')
      .getByRole('button', { name: 'Mark Not Qualified' })
      .click();
    await page
      .getByTestId('mark-not-qualified')
      .getByRole('button', { name: 'Mark Not Qualified' })
      .click();
    await expect(page.getByTestId('card-lead-details')).toContainText('Not Qualified');
    await page.reload();
    await expect(page.getByTestId('card-lead-details')).toContainText('Not Qualified');

    const cards = [
      'Total Leads',
      'New Leads',
      'In Follow-Up',
      'Converted to Clients',
      'Not Qualified',
      'Overdue Follow-Ups',
    ];
    const seen: string[] = [];
    for (const label of cards) {
      await openList(page, '');
      const card = page.getByRole('button', { name: new RegExp(label) }).first();
      await expect(card).toContainText(/\d/);
      const cardValue = async () => {
        const text = (await card.innerText()).replace(label, '');
        return Number(/(\d[\d,]*)/.exec(text)?.[1]?.replace(/,/g, '') ?? NaN);
      };
      await card.click();
      // Both settle first: the filtered list loads after the address changes, and the cards
      // refresh with it. Then the card and its list agree (the message names both numbers).
      let value = NaN;
      await expect
        .poll(
          async () => {
            await page.waitForLoadState('networkidle').catch(() => {});
            value = await cardValue();
            const total = await listTotal(page);
            return total === value ? 'equal' : `card ${value}, list ${total}`;
          },
          { message: `${label}: card and list`, timeout: 60_000, intervals: [1_000, 2_000, 5_000] },
        )
        .toBe('equal');
      seen.push(`${label} ${value}`);
      if (label === 'Not Qualified') {
        expect(value).toBeGreaterThan(0);
        await searchBox(page).fill(STAMP);
        await expect(rowOf(page, P(8))).toHaveCount(1);
      }
    }
    note(info, 'cards', seen.join(', '));
    await shot(page, TAB, '01-summary-cards', info);
  });

  test('2 overdue follow-up: card filter, red, status kept; completing it clears it', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page);
    await page
      .getByRole('button', { name: /Overdue Follow-Ups/ })
      .first()
      .click();
    await expect(chips(page).getByText('Overdue Follow-Ups')).toBeVisible();
    await expect(rowOf(page, 'Alpha')).toHaveCount(1);
    await expect(rows(page)).toHaveCount(1);
    await expect(rowOf(page, 'Alpha')).toContainText('New Lead');
    await expect(rowOf(page, 'Alpha').getByText(/^Overdue:/)).toBeVisible();
    await shot(page, TAB, '02-overdue-list', info);
    await openLead(page, c.alpha);
    const next = page.getByTestId('card-lead-details').getByText(/^Overdue:/);
    await expect(next).toHaveClass(/text-danger/);
    await expect(page.getByTestId('figure-next-follow-up')).toContainText('Overdue');
    // Complete it on the Tasks tab.
    await openLead(page, c.alpha, 'tasks');
    const card = page.getByTestId('card-follow-up');
    const steps = card.getByTestId('follow-up-steps').getByRole('listitem');
    await steps.first().getByRole('button', { name: 'Complete follow-up' }).click();
    const dialog = page.getByRole('dialog');
    if (await dialog.isVisible().catch(() => false)) {
      await dialog
        .getByRole('button', { name: /Complete|Save|Done/ })
        .last()
        .click();
    }
    await expect(card.getByText('Follow-up completed and logged.')).toBeVisible();
    await openList(page);
    await page
      .getByRole('button', { name: /Overdue Follow-Ups/ })
      .first()
      .click();
    await expect(rowOf(page, 'Alpha')).toHaveCount(0);
    await expect(noMatch(page)).toBeVisible();
    await openLead(page, c.alpha);
    await expect(page.getByTestId('card-lead-details')).toContainText('New Lead');
  });

  test('3 create lead in the screen: company, source, service, staff and activity persist', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page, '');
    const dialog = await newLeadDialog(page, 'Created', email(20));
    await dialog.getByLabel('Business / Company name').fill(`${runTag} Company`);
    await dialog.getByLabel('Lead source').selectOption({ label: 'Referral' });
    await dialog.getByLabel('Source / campaign detail').fill(`${runTag} created detail`);
    await dialog.getByRole('checkbox', { name: c.serviceName }).first().check();
    await dialog.getByLabel('Assigned staff').selectOption({ label: c.ownerName });
    await shot(page, TAB, '03-create-form', info);
    await dialog.getByRole('button', { name: 'Save Lead' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 30_000 });
    await searchBox(page).fill(STAMP);
    await expect(rowOf(page, 'Created')).toHaveCount(1);
    await openFromRow(page, 'Created');
    await page.reload();
    await expect(page.getByTestId('card-contact')).toContainText(`${runTag} Company`);
    await expect(page.getByTestId('card-contact')).toContainText(email(20));
    const details = page.getByTestId('card-lead-details');
    await expect(details).toContainText('Referral');
    await expect(details).toContainText(c.serviceName);
    await expect(details).toContainText(tail(c.ownerName));
    await expect(page.getByTestId('card-recent-activity')).toContainText('Lead created');
    await shot(page, TAB, '03-created-lead', info);
  });

  test('4 view lead: the name and More > View open the same Overview', async ({ page }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page);
    await rowOf(page, 'Beta')
      .getByRole('link', { name: new RegExp(`${STAMP} Beta`) })
      .click();
    await expect(page).toHaveURL(lead(c.beta));
    await expect(page.getByTestId('lead-name')).toContainText('Beta');
    for (const card of ['card-contact', 'card-lead-details', 'card-recent-activity']) {
      await expect(page.getByTestId(card)).toBeVisible();
    }
    await openList(page);
    await rowMenu(page, 'Beta', 'View');
    await expect(page).toHaveURL(lead(c.beta));
    await expect(page.getByTestId('lead-overview')).toBeVisible();
    await expect(page.getByTestId('card-contact')).toContainText(email(2));
    await shot(page, TAB, '04-view', info);
  });

  test('5 edit lead: profile Edit and list More > Edit both persist after reload', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openLead(page, c.pages[0]!);
    await page.getByRole('button', { name: 'Edit lead', exact: true }).click();
    let edit = page.getByRole('dialog', { name: 'Edit Lead' });
    await edit.getByLabel('Source details').fill(`${runTag} profile edit`);
    await edit.getByLabel('Priority').selectOption('COLD');
    await edit.getByRole('button', { name: 'Save Changes' }).click();
    await expect(edit).toBeHidden();
    await expect(page.getByTestId('lead-saved')).toHaveText('Changes saved.');
    await openList(page);
    await rowMenu(page, P(2), 'Edit');
    edit = page.getByRole('dialog', { name: 'Edit Lead' });
    await edit.getByLabel('Source details').fill(`${runTag} list edit`);
    await edit.getByRole('button', { name: 'Save Changes' }).click();
    await expect(edit).toBeHidden();
    await openLead(page, c.pages[0]!);
    await expect(page.getByTestId('card-lead-details')).toContainText(`${runTag} profile edit`);
    await expect(page.getByTestId('card-lead-details')).toContainText('Cold');
    await openLead(page, c.pages[1]!);
    await expect(page.getByTestId('card-lead-details')).toContainText(`${runTag} list edit`);
    await shot(page, TAB, '05-edit', info);
  });

  test('6 notes and activity: a note and a logged contact persist with author and time; search finds the note', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openLead(page, c.pages[2]!, 'notes');
    const add = page.getByLabel('Add a note (only your firm sees it)');
    await expect(page.getByRole('button', { name: 'Save Note' })).toBeDisabled();
    await add.fill(`Live check note ${NOTE_TOKEN}. Synthetic, no contact made.`);
    await page.getByRole('button', { name: 'Save Note' }).click();
    const notes = page.getByTestId('lead-notes');
    await expect(notes).toContainText(NOTE_TOKEN);
    await page.reload();
    await expect(notes).toContainText(NOTE_TOKEN);
    await expect(notes.getByRole('listitem').filter({ hasText: NOTE_TOKEN })).toContainText(
      tail(c.ownerName),
    );
    await shot(page, TAB, '06-note', info);
    // Manual activity from Communications.
    await openLead(page, c.pages[2]!, 'communications');
    await page.getByRole('button', { name: 'Log Call or Contact' }).click();
    await page.getByLabel('What happened').fill(`${runTag} logged contact (synthetic)`);
    await page.getByRole('button', { name: 'Log activity', exact: true }).click();
    const list = page.getByTestId('activity-list');
    await expect(list).toContainText(`${runTag} logged contact`);
    await page.reload();
    const item = list.getByRole('listitem').filter({ hasText: `${runTag} logged contact` });
    await expect(item).toBeVisible();
    await expect(item).toContainText(tail(c.ownerName));
    // The note's token finds only this lead.
    await openList(page, '');
    await searchBox(page).fill(NOTE_TOKEN);
    await expect(rows(page)).toHaveCount(1);
    await expect(rowOf(page, P(3))).toHaveCount(1);
    await shot(page, TAB, '06-activity-search', info);
  });

  test('7 call: asks how it went; Log Call records it, Not Now records nothing (no telephony)', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openLead(page, c.alpha, 'activity');
    const list = page.getByTestId('activity-list');
    await expect(list.getByRole('listitem').first()).toBeVisible({ timeout: 60_000 });
    const actions = page.getByRole('group', { name: 'Lead actions' });
    const call = actions.getByRole('link', { name: 'Call' });
    await expect(call).toHaveAttribute('href', /^tel:/);
    // The tel: link would open the device's phone app; the screen's own dialog is what we check.
    await call.evaluate((a) =>
      a.addEventListener('click', (e) => e.preventDefault(), { once: false }),
    );
    await call.click();
    let dialog = page.getByTestId('call-outcome-dialog');
    await expect(dialog).toBeVisible();
    await page.getByRole('button', { name: 'Not Now' }).click();
    await expect(dialog).toBeHidden();
    await expect(list).not.toContainText('Call: ');
    await call.click();
    dialog = page.getByTestId('call-outcome-dialog');
    await page.getByRole('button', { name: 'Log Call' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Choose how the call went.');
    await dialog.getByRole('radio', { name: 'No answer' }).check();
    await dialog.getByLabel('Note (optional)').fill(`${STAMP} synthetic, no call made`);
    await page.getByRole('button', { name: 'Log Call' }).click();
    await expect(dialog).toBeHidden();
    await expect(list).toContainText(`Call: No answer. ${STAMP} synthetic`);
    await page.reload();
    await expect(list).toContainText(`Call: No answer. ${STAMP} synthetic`);
    await shot(page, TAB, '07-call', info);
    note(
      info,
      'NOT LIVE',
      '7 telephony: no calling integration (after Nov 17); outcome logging checked only',
    );
  });

  test('8 email composer: formatting tools, the simulator recipient, sent and in the history', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page);
    await table(page)
      .getByRole('button', { name: `Send email to ${email(1)}` })
      .click();
    const dialog = page.getByTestId('lead-message-email');
    const recipients = dialog.getByTestId('message-recipients');
    await expect(recipients).toContainText(email(1));
    for (const name of ['Font', 'Size'])
      await expect(dialog.getByLabel(name, { exact: true })).toBeVisible();
    for (const name of ['Bold', 'Italic', 'Insert image']) {
      await expect(dialog.getByRole('button', { name })).toBeVisible();
    }
    await expect.soft(dialog.getByRole('button', { name: /signature/i }).first()).toBeVisible();
    await dialog.getByLabel('Subject').fill(`${runTag} email`);
    const box = dialog.getByRole('textbox', { name: 'Message' });
    await box.click();
    await page.keyboard.type('Live check message (synthetic, to the SES simulator).');
    await shot(page, TAB, '08-composer', info);
    // Rule: right before the send, every recipient is a simulator address.
    await expectOnlySimulator(recipients, 'row 8 email');
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(dialog.getByTestId('message-result')).toHaveText('Email sent to 1 lead.', {
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await openLead(page, c.alpha, 'communications');
    await expect(page.getByTestId('activity-list')).toContainText('Email sent');
    await expect.soft(page.getByTestId('activity-list')).toContainText(`${runTag} email`);
    await shot(page, TAB, '08-history', info);
    note(
      info,
      'NOT LIVE',
      '8 delivery: the received formatting and logo need a person reading a real inbox',
    );
  });

  test('9 SMS composer shows the saved number (not sent: no approved phone)', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page);
    await table(page)
      .getByRole('button', { name: `Send SMS to ${full('Alpha')}` })
      .click();
    const dialog = page.getByTestId('lead-message-sms');
    await expect(dialog.getByTestId('message-recipients')).toContainText(full('Alpha'));
    await expect(dialog.getByTestId('message-recipients')).toContainText('555-0101');
    await shot(page, TAB, '09-sms', info);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    note(
      info,
      'NOT LIVE',
      '9 send: a text needs an approved phone; toll-free number not registered',
    );
  });

  test('10 staff assignment: Assign saves, survives a reload', async ({ page }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page);
    await rowMenu(page, P(4), 'Assign');
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Staff member').selectOption({ label: c.ownerName });
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await searchBox(page).fill(STAMP);
    await expect(rowOf(page, P(4))).toContainText(tail(c.ownerName));
    await openLead(page, c.pages[3]!);
    await expect(page.getByTestId('card-lead-details')).toContainText(tail(c.ownerName));
    await shot(page, TAB, '10-assign', info);
  });

  test('11 change status: row and bulk change only the chosen, persist, and show in activity', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page);
    await rowMenu(page, P(5), 'Change Status');
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('New status').selectOption({ label: 'Contacted' });
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();
    await check(page, P(6));
    await check(page, P(7));
    await bulkBar(page).getByRole('button', { name: 'Change Status' }).click();
    dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('2 selected leads');
    await dialog.getByLabel('New status').selectOption({ label: 'In Follow-Up' });
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await searchBox(page).fill(STAMP);
    await expect(rowOf(page, P(5))).toContainText('Contacted');
    await expect(rowOf(page, P(6))).toContainText('In Follow-Up');
    await expect(rowOf(page, P(7))).toContainText('In Follow-Up');
    await expect(rowOf(page, P(4))).toContainText('New Lead');
    await shot(page, TAB, '11-status', info);
    await openLead(page, c.pages[4]!, 'activity');
    await expect(page.getByTestId('activity-list')).toContainText(/Contacted/);
  });

  test('13 standalone tag: Add New Tag adds it to the one list, a repeat is refused', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page, '');
    await page.getByTestId('add-tag').click();
    const dialog = page.getByRole('dialog', { name: 'Add New Tag' });
    const list = dialog.getByRole('region', { name: "The firm's tags" });
    await expect(list).toBeVisible();
    await page.waitForTimeout(1000);
    if (!(await list.getByText(TAG, { exact: true }).count())) {
      await dialog.getByLabel('Tag name').fill(TAG);
      await dialog.getByRole('button', { name: 'Add Tag' }).click();
      await expect(dialog.getByTestId('tag-added')).toBeVisible();
      note(info, 'tag', `made the fixed tag "${TAG}" (once ever)`);
    } else {
      note(info, 'tag', `the fixed tag "${TAG}" exists from an earlier run: creation not repeated`);
    }
    await expect(list).toContainText(TAG);
    await dialog.getByLabel('Tag name').fill(TAG.toLowerCase());
    await dialog.getByRole('button', { name: 'Add Tag' }).click();
    await expect(dialog).toContainText('The firm already has a tag with this name.');
    await shot(page, TAB, '13-add-tag', info);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  });

  test('12 tags: the existing tag on one lead (row) and two (bulk), once each, kept after reload', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page);
    await rowMenu(page, 'Alpha', 'Tags');
    let dialog = page.getByRole('dialog');
    await pickTag(dialog, TAG);
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();
    await check(page, 'Alpha');
    await check(page, 'Beta');
    await bulkBar(page).getByRole('button', { name: 'Add Tags' }).click();
    dialog = page.getByRole('dialog');
    await pickTag(dialog, TAG);
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await searchBox(page).fill(STAMP);
    await rowMenu(page, 'Alpha', 'Edit');
    const edit = page.getByRole('dialog', { name: 'Edit Lead' });
    await expect(
      edit
        .getByRole('list', { name: /: chosen$/ })
        .getByRole('listitem')
        .filter({ hasText: TAG }),
    ).toHaveCount(1);
    await shot(page, TAB, '12-tags-once', info);
    await edit.getByRole('button', { name: 'Cancel' }).click();
    await openLead(page, c.beta, 'campaigns');
    await expect(page.getByTestId('card-tags')).toContainText(TAG);
    await openLead(page, c.alpha, 'activity');
    await expect(
      page
        .getByTestId('activity-list')
        .getByRole('listitem')
        .filter({ hasText: 'Tag added' })
        .first(),
    ).toContainText(TAG);
  });

  test('14 setup: an email campaign opens its builder (channel connected); text campaigns say why not', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page, '');
    await page.getByTestId('create-campaign').click();
    const panel = page.getByRole('dialog', { name: 'Create Campaign' });
    await expect(panel).toContainText('no lead is added by creating it');
    const text = panel.getByRole('button', { name: 'Text message campaign' });
    if (await text.isVisible().catch(() => false)) {
      note(info, 'sms', `text campaign button disabled=${await text.isDisabled()}`);
    }
    await panel.getByRole('button', { name: 'Email campaign' }).click();
    const composer = panel.getByTestId('composer');
    await expect(composer).toBeVisible();
    await expect(panel).not.toContainText('That channel is not connected');
    await shot(page, TAB, '14-setup', info);
    await composer.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(panel).toBeHidden();
    note(
      info,
      'NOT LIVE',
      '14 setup (SMS): text campaigns wait for the toll-free number (after Nov 17)',
    );
  });

  test('14 test: Create Campaign saves a draft and keeps the page; Add to Campaign enrols only the chosen', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page);
    await page.getByLabel('All Lead Sources').selectOption({ label: 'Website Form' });
    await expect(rows(page)).toHaveCount(1);
    await check(page, 'Beta');
    await expect(
      page.getByText('1 leads selected').filter({ visible: true }).first(),
    ).toBeVisible();
    await page.getByTestId('create-campaign').click();
    const panel = page.getByRole('dialog', { name: 'Create Campaign' });
    await panel.getByRole('button', { name: 'Email campaign' }).click();
    const composer = panel.getByTestId('composer');
    await composer.getByLabel('Campaign Name').fill(CAMPAIGN);
    await composer
      .getByRole('group', { name: 'Top actions' })
      .getByRole('button', { name: 'Save Draft' })
      .click();
    await expect(composer).toContainText(/saved|Draft/i);
    await page.waitForTimeout(1500);
    await composer.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(panel).toBeHidden();
    await expect(page.getByLabel('All Lead Sources')).toHaveValue('WEBSITE_FORM');
    await expect(
      page.getByText('1 leads selected').filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(rowOf(page, 'Beta').getByRole('checkbox')).toBeChecked();
    // Enrol Beta only, on purpose (a fresh page, so the campaign list includes the new draft).
    await page.reload();
    if (!(await searchBox(page).inputValue())) await searchBox(page).fill(STAMP);
    await expect(rowOf(page, 'Beta')).toHaveCount(1);
    await check(page, 'Beta');
    await bulkBar(page).getByRole('button', { name: 'Add to Campaign' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add to Campaign' });
    await dialog.getByLabel('Campaign').selectOption({ label: CAMPAIGN });
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();
    await openLead(page, c.beta, 'campaigns');
    await expect(page.locator('main')).toContainText(CAMPAIGN);
    await expect(page.getByText('Not in a campaign', { exact: true })).toHaveCount(0);
    await shot(page, TAB, '14-campaign', info);
    await openLead(page, c.alpha, 'campaigns');
    // Alpha was not chosen: its Campaign field says so (the dropdown still lists the campaign).
    await expect(page.getByText('Not in a campaign', { exact: true })).toBeVisible();
    // Nothing sent on creation or enrolment.
    await openLead(page, c.beta, 'communications');
    await expect(page.getByTestId('activity-list')).not.toContainText(CAMPAIGN);
    note(
      info,
      'NOT LIVE',
      '14 test (delivery): a campaign send and its receipt need an approved recipient',
    );
  });

  test('15 multiple follow-ups: several at creation; completing one keeps the other as the next action', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page, '');
    const dialog = await newLeadDialog(page, 'Steps', email(21));
    const add = dialog.getByRole('button', { name: '+ Add Follow-Up' });
    await add.click();
    await add.click();
    await add.click();
    const one = dialog.getByRole('group', { name: 'Follow-up 1' });
    await one.getByLabel('Action type').selectOption('CALL');
    await one.getByLabel('Date').fill(weekday(5));
    const two = dialog.getByRole('group', { name: 'Follow-up 2' });
    await two.getByLabel('Action type').selectOption('EMAIL');
    await two.getByLabel('Date').fill(weekday(12));
    await dialog.getByRole('button', { name: 'Remove follow-up 3' }).click();
    await expect(dialog.getByRole('group', { name: /Follow-up \d/ })).toHaveCount(2);
    await shot(page, TAB, '15-steps-form', info);
    await dialog.getByRole('button', { name: 'Save Lead' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 30_000 });
    await searchBox(page).fill(STAMP);
    await expect(rowOf(page, 'Steps')).toHaveCount(1);
    const id = await openFromRow(page, 'Steps');
    await openLead(page, id, 'tasks');
    const card = page.getByTestId('card-follow-up');
    const steps = card.getByTestId('follow-up-steps').getByRole('listitem');
    await expect(steps).toHaveCount(2);
    await steps
      .filter({ hasText: /Call/ })
      .getByRole('button', { name: 'Complete follow-up' })
      .click();
    const done = page.getByRole('dialog');
    if (await done.isVisible().catch(() => false)) {
      await done
        .getByRole('button', { name: /Complete|Save|Done/ })
        .last()
        .click();
    }
    await expect(card.getByText('Follow-up completed and logged.')).toBeVisible();
    await page.reload();
    await expect(
      steps.filter({ hasText: /Email/ }).getByRole('button', { name: 'Complete follow-up' }),
    ).toBeVisible();
    await openLead(page, id);
    await expect(page.getByTestId('figure-next-follow-up')).toContainText('Email');
    await shot(page, TAB, '15-steps-after', info);
  });

  test('16 17 conversion: edited values land on one client; Converted, the lead kept, no second conversion', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const address = `${STAMP} Live Check Road, Testville`;
    const clientId = await convertLead(page, c.gamma, c, address);
    await shot(page, TAB, '16-converted', info);
    await page.goto(app(`/clients/${clientId}`));
    await expect(page.locator('main')).toContainText(full('Gamma'), { timeout: 60_000 });
    await expect(page.locator('main')).toContainText(email(3));
    await expect(page.locator('main')).toContainText(STAMP);
    await shot(page, TAB, '17-client', info);
    await openLead(page, c.gamma);
    await expect(page.getByTestId('card-lead-details')).toContainText('Converted');
    await expect(
      page.getByTestId('card-quick-actions').getByText('Convert to Client', { exact: true }),
    ).toHaveCount(0);
    await openList(page);
    await expect(rowOf(page, 'Gamma')).toContainText('Converted');
    note(
      info,
      'see',
      '17 carry-forward of appointments: the "lead appointments (R55)" block (LIVE_LEAD_APPTS=1)',
    );
    note(
      info,
      'NOT LIVE',
      '17 portal invitation delivery: sent later by choice (needs an approved recipient)',
    );
  });

  test('13 clients: the same tag is found and kept on a client (the converted one)', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const clientId = readCtx().clients[0];
    test.skip(!clientId, 'no converted client (16 17 failed)');
    await page.goto(app(`/clients/${clientId}`));
    const card = page.getByTestId('client-tags');
    await expect(card).toBeVisible({ timeout: 60_000 });
    await card.getByRole('button', { name: /Add tags|Edit tags/ }).click();
    await pickTag(card, TAG);
    await card.getByRole('button', { name: 'Save tags' }).click();
    await page.reload();
    await expect(
      page.getByTestId('client-tags').getByRole('list', { name: 'Client tags' }),
    ).toContainText(TAG);
    await shot(page, TAB, '13-client-tag', info);
  });

  test('18 19 archive and restore: out of the list and count, found under Archived Leads, back as it was', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page);
    const before = await listTotal(page);
    const was = await rowOf(page, P(7)).innerText();
    const status = ['In Follow-Up', 'Contacted', 'In Review', 'Qualified', 'New Lead'].find((s) =>
      was.includes(s),
    )!;
    await rowMenu(page, P(7), 'Archive');
    await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
    await expect(rowOf(page, P(7))).toHaveCount(0);
    await expect.poll(() => listTotal(page)).toBe(before - 1);
    await moreFilters(page).click();
    await page.getByLabel('Archived leads').check();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    await expect(chips(page)).toContainText('Archived Leads');
    const archived = rowOf(page, P(7));
    await expect(archived).toHaveCount(1);
    await shot(page, TAB, '18-archived', info);
    await archived.getByRole('button', { name: `Restore ${full(P(7))}` }).click();
    await expect(page.getByRole('status').filter({ hasText: 'restored' })).toBeVisible();
    await page.getByRole('button', { name: 'Remove Archived Leads' }).click();
    await expect(rowOf(page, P(7))).toContainText(status);
    await expect.poll(() => listTotal(page)).toBe(before);
    await openLead(page, c.pages[6]!, 'activity');
    await expect(page.getByTestId('activity-list')).toContainText('Lead created');
  });

  test('20a owner: Archive, Delete (an archive, confirmed) and Restore are offered', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page);
    await page.getByRole('button', { name: `More actions for ${full(P(1))}` }).click();
    await expect(page.getByRole('menu').getByRole('menuitem', { name: 'Archive' })).toBeVisible();
    await page.keyboard.press('Escape');
    await check(page, P(1));
    await expect(bulkBar(page).getByRole('button', { name: 'Delete' })).toBeVisible();
    await bulkBar(page).getByRole('button', { name: 'Delete' }).click();
    const dialog = page.getByRole('dialog', { name: 'Archive Leads' });
    await expect(dialog).toBeVisible();
    await shot(page, TAB, '20a-owner-delete-confirm', info);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(rowOf(page, P(1))).toHaveCount(1);
  });

  test('21 filters: source, status, priority, tag and date combine; Reset clears', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page);
    await page.getByLabel('All Lead Sources').selectOption({ label: 'Referral' });
    await expect(rowOf(page, 'Alpha')).toHaveCount(1);
    await expect(rowOf(page, 'Beta')).toHaveCount(0);
    await page.getByRole('combobox', { name: 'All Lead Statuses' }).selectOption('SUBMITTED');
    await expect(rowOf(page, 'Alpha')).toHaveCount(1);
    await page.getByRole('combobox', { name: 'All Lead Statuses' }).selectOption('IN_REVIEW');
    await expect(noMatch(page)).toBeVisible();
    await page.getByLabel('All Lead Sources').selectOption({ label: 'Website Form' });
    await expect(rowOf(page, 'Beta')).toHaveCount(1);
    await expect(rows(page)).toHaveCount(1);
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(searchBox(page)).toHaveValue('');
    await searchBox(page).fill(STAMP);
    // Today's range keeps them; a range in the past has none.
    await page.getByLabel(/^Date range:/).click();
    await page.getByLabel('Date Range: From, start date').fill(firmDay(0));
    await page.getByLabel('Date Range: To, end date').fill(firmDay(0));
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(rowOf(page, 'Alpha')).toHaveCount(1);
    await page.getByLabel(/^Date range:/).click();
    await page.getByLabel('Date Range: From, start date').fill('2026-01-01');
    await page.getByLabel('Date Range: To, end date').fill('2026-01-31');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(noMatch(page)).toBeVisible();
    await shot(page, TAB, '21-filters', info);
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(chips(page)).toHaveCount(0);
  });

  test('22 search and paging: name, email, phone, note; Next, Previous, Page 2; 8, 16 and 24 per page', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page, STAMP, '8');
    const total = await listTotal(page);
    expect(total).toBeGreaterThanOrEqual(13);
    await expect(rows(page)).toHaveCount(8);
    await expect(pager(page).getByRole('button', { name: 'Previous' })).toBeDisabled();
    await pager(page).getByRole('button', { name: 'Next' }).click();
    await expect(pager(page)).toContainText(`Showing 9 – ${Math.min(16, total)} of ${total} leads`);
    await pager(page).getByRole('button', { name: 'Previous' }).click();
    await expect(pager(page)).toContainText(`Showing 1 – 8 of ${total} leads`);
    await pager(page).getByRole('button', { name: 'Page 2' }).click();
    await expect(rows(page)).toHaveCount(Math.min(8, total - 8));
    await pager(page).locator('select').selectOption('16');
    await expect(rows(page)).toHaveCount(Math.min(16, total));
    await pager(page).locator('select').selectOption('24');
    await expect(rows(page)).toHaveCount(Math.min(24, total));
    await shot(page, TAB, '22-paging', info);
    await pager(page).locator('select').selectOption('8');
    for (const [term, last] of [
      [email(1), 'Alpha'],
      [`555-0101 ${STAMP}`, 'Alpha'],
      [`${STAMP} Beta`, 'Beta'],
      [NOTE_TOKEN, P(3)],
    ] as const) {
      await searchBox(page).fill(term);
      await expect(rows(page)).toHaveCount(1);
      await expect(rowOf(page, last)).toHaveCount(1);
    }
    await searchBox(page).fill(`${STAMP} nomatchzz`);
    await expect(noMatch(page)).toBeVisible();
  });

  test('23 bulk actions: Assign Staff changes only the selected leads', async ({ page }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page);
    await check(page, P(1));
    await check(page, P(2));
    await bulkBar(page).getByRole('button', { name: 'Assign Staff' }).click();
    const dialog = page.getByRole('dialog', { name: 'Assign Staff' });
    await dialog.getByLabel('Staff member').selectOption({ label: c.ownerName });
    await dialog.getByRole('button', { name: 'Apply' }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await searchBox(page).fill(STAMP);
    const first = tail(c.ownerName);
    await expect(rowOf(page, P(1))).toContainText(first);
    await expect(rowOf(page, P(2))).toContainText(first);
    await expect(rowOf(page, P(3))).not.toContainText(first);
    await shot(page, TAB, '23-bulk-assign', info);
  });

  test('24 website capture: Integrations says link or button and opens Intake Forms', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await page.goto(app('/integrations/marketplace'));
    const card = page
      .getByTestId('marketplace-integration')
      .filter({ hasText: 'Website & Lead Forms' });
    await expect(card).toContainText('Intake form links and website buttons', { timeout: 60_000 });
    await expect(card.getByRole('link', { name: 'Open Intake Forms' })).toHaveAttribute(
      'href',
      /\/intake-forms/,
    );
    await shot(page, TAB, '24-website-capture', info);
    note(info, 'NOT LIVE', '24 live demo: needs her approved test site and one submission');
  });

  test('26 fields, statuses, appointment dialog prefill and the firm time zone label', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page);
    const headers = (await table(page).getByRole('columnheader').allInnerTexts()).map((h) =>
      h.trim(),
    );
    for (const h of [
      'Contact Info',
      'Priority',
      'Status',
      'Last Contact',
      'Next Action',
      'Preferred',
    ]) {
      expect(headers, `column ${h}`).toContain(h);
    }
    const statuses = (
      await page
        .getByRole('combobox', { name: 'All Lead Statuses' })
        .locator('option')
        .allInnerTexts()
    ).map((s) => s.trim());
    for (const s of [
      'New Lead',
      'In Review',
      'Contacted',
      'In Follow-Up',
      'Appointment Scheduled',
      'Qualified',
      'Converted',
      'Not Qualified',
    ]) {
      expect(statuses, `status ${s}`).toContain(s);
    }
    expect(statuses.some((s) => /No Response/.test(s))).toBe(true);
    await expect(rowOf(page, 'Alpha')).toContainText('Email');
    await rowOf(page, 'Alpha')
      .getByRole('button', { name: `Schedule an appointment with ${full('Alpha')}` })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(`For ${full('Alpha')}`);
    const contact = dialog.getByLabel('Lead contact');
    await expect(contact).toContainText('555-0101');
    await expect(contact).toContainText(email(1));
    const start = dialog.getByText(/^Start \(/);
    await expect(start).toBeVisible();
    const zone = (await start.innerText()).trim();
    note(info, 'zone', zone);
    expect
      .soft(zone, 'the firm zone (New York), not the device')
      .not.toMatch(/Chicago|CST|CDT|Central/);
    await shot(page, TAB, '26-appointment-dialog', info);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    note(info, 'see', '26 appointment save and activity: the "lead appointments (R55)" block');
  });

  test('R2 1 Back to Leads keeps the search, a filter, the page size and the page', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page, STAMP, '8');
    await pager(page).getByRole('button', { name: 'Page 2' }).click();
    await settled(page);
    const name = new RegExp(`${STAMP} \\S+`).exec(await rows(page).first().innerText())![0];
    await rows(page).first().getByRole('link').first().click();
    await expect(page.getByTestId('lead-name')).toContainText(STAMP);
    await page.getByRole('link', { name: 'Back to Leads' }).click();
    await expect(searchBox(page)).toHaveValue(STAMP);
    await expect(pager(page).getByRole('button', { name: 'Page 2' })).toHaveAttribute(
      'aria-current',
      /page|true/,
    );
    await expect(rows(page).first()).toContainText(name);
    await page.getByLabel('All Lead Sources').selectOption({ label: 'Other' });
    await pager(page).locator('select').selectOption('16');
    await rowOf(page, P(1)).getByRole('link').first().click();
    await expect(page.getByTestId('lead-name')).toContainText(P(1));
    await page.getByRole('link', { name: 'Back to Leads' }).click();
    await expect(searchBox(page)).toHaveValue(STAMP);
    await expect(page.getByLabel('All Lead Sources')).toHaveValue('OTHER');
    await expect(pager(page).locator('select')).toHaveValue('16');
    await shot(page, TAB, 'R2-1-back', info);
  });

  test('R2 2 Add Task from the lead: the lead is chosen, the task saves on it, the way back is the lead', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const id = c.pages[2]!;
    await openLead(page, id, 'tasks');
    await page.getByTestId('card-open-tasks').getByRole('link', { name: 'Add Task' }).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/new\\?leadId=${id}$`));
    const form = page.getByTestId('lead-task-create');
    await expect(form.getByTestId('lead-task-for')).toContainText(full(P(3)));
    await expect(form.getByRole('link', { name: `Back to ${full(P(3))}` })).toBeVisible();
    await form.getByRole('button', { name: 'Save Task' }).click();
    await expect(form).toContainText('Enter the task name');
    const task = `${runTag} task`;
    await form.getByLabel('Task name *').fill(task);
    await form.getByLabel('Due date *').fill(weekday(6));
    await shot(page, TAB, 'R2-2-task-form', info);
    await form.getByRole('button', { name: 'Save Task' }).click();
    await expect(page).toHaveURL(new RegExp(`/leads/${id}/tasks$`));
    const card = page.getByTestId('card-open-tasks');
    await expect(card).toContainText(task);
    await page.reload();
    await expect(card).toContainText(task);
    await card.getByRole('checkbox', { name: `Mark ${task} done` }).click();
    await expect(card).not.toContainText(task);
  });

  test('R2 3a Send Intake Form from the lead: the lead is chosen, nothing is sent, Back returns to it', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const id = c.pages[2]!;
    await openLead(page, id);
    await page
      .getByTestId('card-quick-actions')
      .getByRole('link', { name: 'Send Intake Form' })
      .click();
    await expect(page).toHaveURL(new RegExp(`/intake-forms/send\\?leadId=${id}$`));
    await expect(page.getByRole('radio', { name: 'Lead' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('button', { name: /^Lead \*/ })).toContainText(full(P(3)));
    await expect(page.getByTestId('send-result')).toHaveCount(0);
    await shot(page, TAB, 'R2-3a-send-intake', info);
    await page.getByRole('link', { name: `Back to ${full(P(3))}` }).click();
    await expect(page).toHaveURL(new RegExp(`/leads/${id}/documents$`));
    note(info, 'NOT LIVE', 'R2 3b: an intake send and her check of it as received');
  });

  test('R2 4 Upload Document from the lead adds the file to that lead, kept after reload', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const id = c.pages[2]!;
    const file = `${STAMP}-lead.pdf`;
    await openLead(page, id, 'documents');
    await page.getByTestId('card-documents').getByRole('link', { name: 'Upload Document' }).click();
    await expect(page).toHaveURL(new RegExp(`/documents/upload\\?leadId=${id}$`));
    const upload = page.getByTestId('lead-upload');
    await expect(upload.getByRole('radio', { name: /Lead/ })).toBeChecked();
    await expect(upload).toContainText(full(P(3)));
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: file, mimeType: 'application/pdf', buffer: PDF });
    await upload.getByRole('button', { name: 'Upload Document' }).click();
    await expect(upload.getByRole('status')).toContainText(`added to ${full(P(3))}`, {
      timeout: 60_000,
    });
    await upload.getByRole('button', { name: `Back to ${full(P(3))}` }).click();
    await expect(page).toHaveURL(new RegExp(`/leads/${id}/documents$`));
    const docs = page.getByTestId('card-documents');
    await expect(docs).toContainText(file);
    await page.reload();
    await expect(docs).toContainText(file);
    await expect(docs).toContainText('Added by');
    await shot(page, TAB, 'R2-4-upload', info);
  });

  test('R2 5 follow-up time: the editor opens on the saved 2:15 PM; an unchanged save keeps it', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openLead(page, c.beta);
    const card = page.getByTestId('card-follow-up');
    await expect(card).toContainText('2:15 PM');
    const time = card.getByRole('combobox', { name: 'Time' });
    await expect(time).toHaveValue('14:15');
    await card.getByRole('button', { name: 'Save Follow-Up' }).click();
    const told = await page
      .getByText('Follow-up saved.')
      .first()
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
    await shot(page, TAB, 'R2-5-after-save', info);
    note(
      info,
      'feedback',
      told ? '"Follow-up saved." shown' : 'no "Follow-up saved." after the save',
    );
    expect.soft(told, 'the save says "Follow-up saved."').toBe(true);
    await page.reload();
    await expect(card).toContainText('2:15 PM');
    await expect(time).toHaveValue('14:15');
    await expect(card.getByLabel('Date', { exact: true })).toHaveValue(weekday(9));
    await shot(page, TAB, 'R2-5-follow-up-time', info);
  });

  test('R2 6a at 1165 px the select box, name and actions stay in view while the table scrolls', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page);
    const frame = table(page).locator('xpath=..');
    const row = rowOf(page, 'Alpha');
    const pinned = [
      row.getByRole('checkbox'),
      row.getByRole('link', { name: new RegExp(`${STAMP} Alpha`) }),
      row.getByRole('button', { name: `More actions for ${full('Alpha')}` }),
    ];
    const names = ['select box', 'name', 'More actions'];
    await row.evaluate((r) =>
      window.scrollTo(0, r.getBoundingClientRect().top + window.scrollY - 300),
    );
    for (const [i, cell] of pinned.entries())
      await expectInFrame(page, frame, cell, `start: ${names[i]}`);
    const overflow = await frame.evaluate((el) => el.scrollWidth - el.clientWidth);
    if (overflow > 0) {
      await frame.evaluate((el) => (el.scrollLeft = el.scrollWidth));
      await page.waitForTimeout(300);
      for (const [i, cell] of pinned.entries())
        await expectInFrame(page, frame, cell, `end: ${names[i]}`);
    }
    note(info, 'table', `table frame overflow ${overflow}px`);
    await shot(page, TAB, 'R2-6a-pinned', info);
    await expectNoSideScroll(page);
  });

  test('R2 6b a long name shows in full at 1165 px with the row actions in view', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const LONG = 'Alexandrina-Maximiliana Vanderbilt-Featherstonehaugh';
    await openList(page, '');
    const dialog = await newLeadDialog(page, LONG, email(22));
    await dialog.getByRole('button', { name: 'Save Lead' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 30_000 });
    await searchBox(page).fill(STAMP);
    const row = rowOf(page, LONG);
    await expect(row).toHaveCount(1);
    const name = row.getByText(full(LONG), { exact: true });
    await expect(name).toBeVisible();
    const fit = await name.evaluate((el) => ({
      scroll: el.scrollHeight,
      client: el.clientHeight,
      w: el.scrollWidth,
      cw: el.clientWidth,
    }));
    expect(fit.scroll, 'the name is not cut off').toBeLessThanOrEqual(fit.client + 1);
    expect(fit.w, 'the name is not cut sideways').toBeLessThanOrEqual(fit.cw + 1);
    await row.evaluate((r) =>
      window.scrollTo(0, r.getBoundingClientRect().top + window.scrollY - 300),
    );
    await expectInFrame(
      page,
      table(page).locator('xpath=ancestor::*[contains(@class,"overflow-x-auto")][1]'),
      row.getByRole('button', { name: `More actions for ${full(LONG)}` }),
      'More actions',
    );
    await shot(page, TAB, 'R2-6b-long-name', info);
    await expectNoSideScroll(page);
  });

  test('R2 7 status save: the new status and "Changes saved." at once; kept after reload', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openLead(page, c.pages[1]!);
    await page.getByRole('button', { name: 'Edit lead', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit Lead' });
    await dialog.getByLabel('Status', { exact: true }).selectOption({ label: 'Qualified' });
    await dialog.getByRole('button', { name: 'Save Changes' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('lead-saved')).toHaveText('Changes saved.');
    await expect(page.getByTestId('card-lead-details')).toContainText('Qualified');
    await expect(page.getByRole('alert').filter({ hasText: /went wrong/ })).toHaveCount(0);
    await shot(page, TAB, 'R2-7-status', info);
    await page.reload();
    await expect(page.getByTestId('card-lead-details')).toContainText('Qualified');
  });

  test('R2 8 the contact card Edit saves address, preferred contact, best time and date of birth', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openLead(page, c.pages[1]!);
    const card = page.getByTestId('card-contact');
    await card.getByRole('button', { name: /Edit/ }).click();
    const edit = page.getByRole('dialog');
    const preferred = edit.getByRole('group', { name: 'Preferred contact' });
    await edit.getByLabel('Address', { exact: true }).fill(`${STAMP} Sample Road, Austin TX 78701`);
    await preferred.getByLabel('Email').check();
    await edit.getByLabel('Best time to contact').fill('Weekday mornings');
    await edit.getByLabel('Date of birth').fill('1988-07-14');
    await edit.getByRole('button', { name: 'Save Changes' }).click();
    await expect(edit).toBeHidden();
    await page.reload();
    await expect(card).toContainText(`${STAMP} Sample Road`);
    await expect(card).toContainText('Weekday mornings');
    await expect(card).toContainText('Jul 14, 1988');
    await expect(card).toContainText(/Preferred Contact\s*Email/);
    await card.getByRole('button', { name: /Edit/ }).click();
    await expect(edit.getByLabel('Address', { exact: true })).toHaveValue(
      `${STAMP} Sample Road, Austin TX 78701`,
    );
    await expect(preferred.getByLabel('Email')).toBeChecked();
    await expect(edit.getByLabel('Best time to contact')).toHaveValue('Weekday mornings');
    await expect(edit.getByLabel('Date of birth')).toHaveValue('1988-07-14');
    await shot(page, TAB, 'R2-8-contact-edit', info);
    await edit.getByRole('button', { name: 'Cancel' }).click();
  });

  test('R2 9 another email: added, kept after reload, the same one twice refused', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openLead(page, c.pages[1]!);
    const card = page.getByTestId('card-contact');
    await card.getByRole('button', { name: /Edit/ }).click();
    const edit = page.getByRole('dialog');
    const others = edit.getByTestId('lead-other-contacts');
    await others.getByRole('button', { name: 'Add phone or email' }).click();
    await others.getByLabel('Type').last().selectOption('EMAIL');
    await others.getByLabel('Email', { exact: true }).last().fill(email('12b'));
    await others.getByLabel('Label (optional)').last().fill('Personal');
    await edit.getByRole('button', { name: 'Save Changes' }).click();
    await expect(edit).toBeHidden();
    await page.reload();
    await expect(card).toContainText('Personal email');
    await expect(card).toContainText(email('12b'));
    await card.getByRole('button', { name: /Edit/ }).click();
    await others.getByRole('button', { name: 'Add phone or email' }).click();
    await others.getByLabel('Type').last().selectOption('EMAIL');
    await others.getByLabel('Email', { exact: true }).last().fill(email('12b').toUpperCase());
    await edit.getByRole('button', { name: 'Save Changes' }).click();
    await expect(others).toContainText('This email is already listed');
    await shot(page, TAB, 'R2-9-other-contacts', info);
    await edit.getByRole('button', { name: 'Cancel' }).click();
  });

  test('R2 10 active filters show as chips; removing one keeps the other; reopen shows them; Reset clears', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page);
    await moreFilters(page).click();
    const panel = filterPanel(page);
    await panel.getByRole('combobox', { name: 'All Priorities' }).selectOption('HOT');
    await panel.getByRole('combobox', { name: 'All Tags' }).selectOption(TAG);
    await panel.getByRole('button', { name: 'Apply Filters' }).click();
    await expect(panel).toHaveCount(0);
    await expect(chips(page).getByText('Priority: Hot')).toBeVisible();
    await expect(chips(page).getByText(`Tag: ${TAG}`)).toBeVisible();
    await expect(moreFilters(page)).toContainText('2 in force');
    await expect(rows(page)).toHaveCount(1);
    await expect(rowOf(page, 'Alpha')).toHaveCount(1);
    await shot(page, TAB, 'R2-10-chips', info);
    await page
      .getByRole('button', { name: 'Remove Priority: Hot' })
      .or(page.getByRole('button', { name: /^Remove Priority/ }))
      .first()
      .click();
    await expect(chips(page).getByText('Priority: Hot')).toHaveCount(0);
    await expect(chips(page).getByText(`Tag: ${TAG}`)).toBeVisible();
    await expect(rowOf(page, 'Beta')).toHaveCount(1);
    await expect(rowOf(page, 'Alpha')).toHaveCount(1);
    await moreFilters(page).click();
    await expect(panel.getByRole('combobox', { name: 'All Tags' })).toHaveValue(TAG);
    await expect(panel.getByRole('combobox', { name: 'All Priorities' })).toHaveValue('');
    await moreFilters(page).click();
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(chips(page)).toHaveCount(0);
    await expect(moreFilters(page)).not.toContainText('in force');
  });

  test('R2 11 required fields: marked, her messages for blank and invalid, focus on First name', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page, '');
    await page.getByRole('button', { name: 'Add New Lead' }).click();
    const dialog = page.getByRole('dialog');
    for (const label of ['First name *', 'Last name *', 'Email *'])
      await expect(dialog).toContainText(label);
    await dialog.getByRole('button', { name: 'Save Lead' }).click();
    await expect(dialog).toContainText('First name is required');
    await expect(dialog).toContainText('Last name is required');
    await expect(dialog).toContainText('Email is required');
    await expect(dialog.getByLabel('First name')).toBeFocused();
    await dialog.getByRole('textbox', { name: 'Email' }).fill('not-an-email');
    await dialog.getByRole('button', { name: 'Save Lead' }).click();
    await expect(dialog).toContainText('Enter a valid email address');
    await shot(page, TAB, 'R2-11-required', info);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('R2 12 More Filters wait for Apply, apply together; closing without Apply drops them', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page);
    const before = await listTotal(page);
    await moreFilters(page).click();
    const panel = filterPanel(page);
    await panel.getByRole('combobox', { name: 'All Priorities' }).selectOption('HOT');
    await panel.getByRole('combobox', { name: 'All Tags' }).selectOption(TAG);
    await expect(chips(page)).toHaveCount(0);
    expect(await listTotal(page)).toBe(before);
    await expect(page).not.toHaveURL(/priority=|tag=/);
    await panel.getByRole('button', { name: 'Apply Filters' }).click();
    await expect(chips(page).getByText(/^(Priority|Tag): /)).toHaveCount(2);
    await expect(rows(page)).toHaveCount(1);
    await moreFilters(page).click();
    await panel.getByRole('combobox', { name: 'All Priorities' }).selectOption('COLD');
    await moreFilters(page).click();
    await expect(panel).toHaveCount(0);
    await expect(chips(page).getByText('Priority: Hot')).toBeVisible();
    await expect(rowOf(page, 'Alpha')).toHaveCount(1);
    await moreFilters(page).click();
    await expect(panel.getByRole('combobox', { name: 'All Priorities' })).toHaveValue('HOT');
    await shot(page, TAB, 'R2-12-apply', info);
    await moreFilters(page).click();
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
  });

  test('R2 13 a reversed date range shows her message and is not applied; equal and corrected ranges apply', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page);
    await page.getByLabel(/^Date range:/).click();
    const from = page.getByLabel('Date Range: From, start date');
    const to = page.getByLabel('Date Range: To, end date');
    const done = page.getByRole('button', { name: 'Done' });
    const alert = page.getByRole('group', { name: 'Date Range' }).getByRole('alert');
    // A valid range first (each date applies live, by design: leads-date-filter.tsx).
    await from.fill(firmDay(0));
    await to.fill(firmDay(0));
    await expect(alert).toHaveCount(0);
    await expect(page).toHaveURL(/from=/);
    const applied = page.url();
    await expect.poll(() => listTotal(page)).toBeGreaterThanOrEqual(0);
    const before = await listTotal(page);
    // Reversed: her message, Done disabled, and the applied range stays as it was.
    await from.fill('2026-12-10');
    await expect(alert).toHaveText('End date must be on or after the start date');
    await expect(done).toBeDisabled();
    await expect(page).toHaveURL(applied);
    await expect.poll(() => listTotal(page)).toBe(before);
    await shot(page, TAB, 'R2-13-reversed', info);
    await from.fill(firmDay(0));
    await to.fill(firmDay(0));
    await expect(alert).toHaveCount(0);
    await expect(done).toBeEnabled();
    await from.fill('2026-11-01');
    await expect(done).toBeEnabled();
    await done.click();
    await expect(rowOf(page, 'Alpha')).toHaveCount(1);
    await page.getByRole('button', { name: 'Reset', exact: true }).click();
  });

  test('R2 14 after Escape the focus is back on Add New Lead', async ({ page }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page, '');
    const add = page.getByRole('button', { name: 'Add New Lead' });
    await add.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('First name').fill('Esc');
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(add).toBeFocused();
    await shot(page, TAB, 'R2-14-focus', info);
  });

  test('R2 15 duplicates: a warning on create, listed for review, merged only on purpose', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page, '');
    const dialog = await newLeadDialog(page, 'Twin', email(1));
    await dialog.getByRole('button', { name: 'Save Lead' }).click();
    const anyway = dialog.getByLabel(
      'Create this lead anyway if the matching email or phone is correct',
    );
    await expect(anyway).toBeVisible();
    await shot(page, TAB, 'R2-15-warning', info);
    await anyway.check();
    await dialog.getByRole('button', { name: 'Save Lead' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 30_000 });
    await searchBox(page).fill(STAMP);
    await expect(rowOf(page, 'Twin')).toHaveCount(1);
    await openFromRow(page, 'Twin');
    const warning = page.getByTestId('lead-duplicates');
    await expect(warning).toContainText('Possible duplicate');
    await expect(warning.getByRole('link', { name: new RegExp(`${STAMP} Alpha`) })).toBeVisible();
    await page.goto(app('/leads'));
    await page.getByTestId('review-duplicates').click();
    await expect(page).toHaveURL(/\/leads\/duplicates$/);
    const pair = page
      .getByRole('list', { name: 'Possible duplicates' })
      .getByRole('listitem')
      .filter({ hasText: full('Twin') });
    await expect(pair).toContainText('Same email');
    await expect(pair).toContainText(full('Alpha'));
    await pair.getByRole('link', { name: 'Compare and Merge' }).click();
    const merge = page.getByTestId('lead-merge');
    await merge
      .getByRole('radio', { name: new RegExp(`Keep ${STAMP} Alpha|Keep ${runTag} Alpha`) })
      .check();
    await merge.getByTestId('merge-start').click();
    const confirm = page.getByRole('dialog', { name: 'Merge these leads?' });
    await confirm.getByRole('button', { name: 'Merge' }).click();
    await expect(page).toHaveURL(new RegExp(`/leads/${c.alpha}$`), { timeout: 60_000 });
    await expect(page.getByTestId('lead-merged-from')).toBeVisible();
    await shot(page, TAB, 'R2-15-merged', info);
  });

  test('R2 16 import: map, check, preview, create only the new; export states its scope', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const csv = [
      'First Name,Last Name,E-mail,Company,Lead Source',
      `${runTag},Imported,${email(23)},${runTag} Import Co,Referral`,
      `${runTag},Dupe,${email(1)},,Referral`,
    ].join('\r\n');
    await openList(page, '');
    await page.getByTestId('import-leads').click();
    const screen = page.getByTestId('leads-import');
    await expect(screen.getByRole('heading', { name: 'Import Leads' })).toBeVisible();
    await screen
      .getByTestId('import-upload')
      .locator('input[type=file]')
      .setInputFiles({
        name: `${STAMP}-leads.csv`,
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      });
    const map = screen.getByTestId('import-map');
    await expect(map).toContainText('2 rows');
    await expect(map.getByLabel('E-mail')).toHaveValue('email');
    await map.getByTestId('import-default-service').selectOption({ label: c.serviceName });
    await map.getByTestId('import-check').click();
    const preview = screen.getByTestId('import-preview');
    await expect(preview).toContainText('1New leads to create');
    await expect(preview).toContainText(/1\s*Possible duplicate/);
    const run = preview.getByTestId('import-run');
    await expect(run).toHaveText('Import 1 Lead');
    await shot(page, TAB, 'R2-16-preview', info);
    await run.click();
    const results = screen.getByTestId('import-results');
    await expect(results).toContainText('1Created', { timeout: 60_000 });
    await results.getByRole('link', { name: 'Go to Leads' }).click();
    await searchBox(page).fill(STAMP);
    await expect(rowOf(page, 'Imported')).toHaveCount(1);
    await expect(rowOf(page, 'Dupe')).toHaveCount(0);
    // Export: the list as filtered now.
    await page.getByTestId('export-leads').click();
    const dialog = page.getByRole('dialog', { name: 'Export Leads' });
    const filtered = dialog.getByRole('radio', { name: /The list as filtered now \(\d+\)/ });
    await expect(filtered).toBeChecked();
    await expect(dialog).toContainText('Dates of birth and addresses are never exported.');
    await dialog.getByTestId('export-make').click();
    const ready = dialog.getByTestId('export-ready');
    await expect(ready).toContainText(/\d+ leads in leads[-\d]*\.csv/);
    await shot(page, TAB, 'R2-16-export', info);
  });

  test('R2 17 routing rules: the settings screen and its preview (not saved: firm-wide)', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await page.goto(app('/settings/lead-routing'));
    const screen = page.getByTestId('lead-routing');
    await expect(screen.getByRole('heading', { name: 'Lead assignment' })).toBeVisible({
      timeout: 60_000,
    });
    await expect(screen.getByTestId('routing-preview')).toBeVisible();
    await expect(
      screen.getByRole('switch', { name: 'Assign new leads by these rules' }),
    ).toBeVisible();
    await shot(page, TAB, 'R2-17-routing', info);
    note(
      info,
      'NOT LIVE',
      'R2 17 save and 17a/17b: saving rules changes every new lead of Test Firm B',
    );
  });

  test('R2 18 funnel and aging report: from Leads, counts, drill-down, reversed range message', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openList(page, '');
    await page.getByTestId('leads-report-link').click();
    const report = page.getByTestId('leads-report');
    await expect(report.getByRole('heading', { name: 'Leads Funnel & Aging' })).toBeVisible({
      timeout: 60_000,
    });
    const reached = report
      .getByTestId('report-funnel')
      .getByRole('list', { name: 'Reached each stage' })
      .getByRole('button')
      .first();
    await expect(reached).toBeVisible();
    await reached.click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByTestId('report-leads')).toBeVisible();
    await drawer.getByRole('button', { name: 'Close panel' }).click();
    await expect(report.getByTestId('report-aging')).toContainText('Time in current stage');
    await expect(report.getByTestId('report-definitions')).toContainText('Conversion rate');
    await shot(page, TAB, 'R2-18-report', info);
    await report.getByLabel('From', { exact: true }).fill('2026-06-10');
    await report.getByLabel('To', { exact: true }).fill('2026-06-01');
    await expect(report).toContainText('End date must be on or after the start date');
  });

  test('R2 19 sequence: preview, leave a step out, apply; reminders only, nothing sent', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const id = c.pages[5]!;
    await openLead(page, id, 'tasks');
    const card = page.getByTestId('card-sequences');
    await expect(card).toContainText('No sequence applied');
    await card.getByTestId('sequence-apply').click();
    const dialog = page.getByRole('dialog', { name: 'Apply a Follow-up Sequence' });
    const select = dialog.getByLabel('Sequence');
    const option = (await select
      .locator('option', { hasText: c.sequenceName })
      .first()
      .textContent())!;
    await select.selectOption({ label: option.trim() });
    const chosen = (
      await dialog.getByLabel('Sequence').locator('option:checked').innerText()
    ).trim();
    const preview = dialog.getByTestId('sequence-preview');
    const n = await preview.getByRole('listitem').count();
    expect(n).toBeGreaterThan(0);
    await expect(preview).toContainText(/Reminder|Outreach \(you send it\)/);
    if (n > 1) {
      await dialog.getByRole('button', { name: `Leave out step ${n}` }).click();
      await expect(preview.getByRole('listitem')).toHaveCount(n - 1);
    }
    await shot(page, TAB, 'R2-19-preview', info);
    await dialog.getByTestId('sequence-apply-confirm').click();
    await expect(dialog).toHaveCount(0);
    await expect(card).toContainText(chosen.replace(/\s*\(.*\)$/, ''));
    await expect(card).toContainText('Running');
    await openLead(page, id, 'communications');
    await expect(page.getByTestId('activity-list')).not.toContainText(
      /Email sent|Text sent|SMS sent/,
    );
  });

  test('checklist lead scoring: a score, its label and why', async ({ page }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openLead(page, c.alpha);
    const figure = page.getByTestId('figure-lead-score');
    await expect(figure.getByRole('paragraph')).toHaveText(/^\d+$/);
    await expect(figure).toContainText(/Low|Medium|High Intent/);
    await figure.getByText('Why this score').click();
    await expect(
      figure.getByRole('list', { name: 'Why this score' }).getByRole('listitem').first(),
    ).toBeVisible();
    await shot(page, TAB, 'checklist-score', info);
  });
});

// ================================================================ Lead appointments (R55, P4-1)
test.describe('lead appointments (R55)', () => {
  test.use(as('owner'));
  test.skip(
    () => process.env['LIVE_LEAD_APPTS'] !== '1',
    'R55 lead appointments are not on dev yet',
  );
  let c: Ctx;
  test.beforeAll(async ({ browser }) => {
    if (process.env['LIVE_LEAD_APPTS'] !== '1') return;
    await freshSession(browser, 'owner');
    c = await fixture(browser, false);
    if (!c.appt) {
      const api = await roleApi(browser, 'owner');
      try {
        c.appt = await createLead(api, 'Appt', 6, {
          phone: '(202) 555-0106',
          serviceIds: [c.serviceId],
          assignedUserId: c.ownerId,
        });
      } finally {
        await api.dispose();
      }
      const now = readCtx();
      now.appt = c.appt;
      saveCtx(now);
    }
  });

  test('26 appt: book an appointment for a lead; it shows on the lead, kept after reload', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await openLead(page, c.appt, 'appointments');
    const upcoming = page.getByTestId('card-upcoming-appointments');
    await upcoming.getByRole('button', { name: 'Schedule Appointment' }).click();
    const dialog = page.getByRole('dialog');
    const contact = dialog.getByLabel('Lead contact');
    // The confirmation goes to the lead's email: it must be a simulator address.
    await expect(contact).toContainText(email(6));
    const type = dialog.getByLabel('Appointment type');
    await type.selectOption({ label: `${c.typeName} (30 min)` });
    const typeName = (await type.locator('option:checked').innerText())
      .replace(/\s*\(\d+ min\)$/, '')
      .trim();
    await dialog.getByLabel('Staff member').selectOption({ label: c.ownerName });
    await dialog.getByLabel('Meeting method').selectOption('PHONE');
    await dialog.getByLabel('Details').fill(`${runTag} lead appointment (synthetic)`);
    const day = weekday(12);
    let booked = false;
    for (const hhmm of ['10:30', '11:30', '13:30', '15:00']) {
      await dialog.getByLabel(/^Start \(/).fill(`${day}T${hhmm}`);
      // Rule: right before the send (the booking confirmation), the lead's address is a simulator one.
      await expectOnlySimulator(contact, 'booking confirmation');
      await dialog.getByRole('button', { name: 'Schedule Appointment' }).click();
      await page.waitForTimeout(500);
      await expect(dialog.getByRole('button', { name: 'Scheduling…' })).toHaveCount(0, {
        timeout: 30_000,
      });
      await page.waitForTimeout(500);
      if (!(await dialog.isVisible().catch(() => false))) {
        booked = true;
        break;
      }
      const alert = dialog.getByRole('alert');
      note(info, 'retry', `${hhmm}: ${(await alert.innerText().catch(() => '')).slice(0, 200)}`);
    }
    expect(booked, 'the lead appointment was booked').toBe(true);
    const row = page.getByTestId('lead-appointment').filter({ hasText: typeName });
    await expect(row).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('lead-appointment').filter({ hasText: typeName })).toBeVisible();
    await shot(page, TAB, '26-appt-booked', info);
    await openLead(page, c.appt, 'activity');
    await expect(page.getByTestId('activity-list')).toContainText(/Appointment/i);
  });

  test('17 appt: converting the lead moves its appointment to the new client', async ({
    page,
    browser,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    // Locate the appointment (setup read); every check below is on the page.
    const api = await roleApi(browser, 'owner');
    const appts = (
      await ok(await api.get(`business/leads/${c.appt}/appointments`), 'lead appointments')
    ).items as { id: string }[];
    await api.dispose();
    expect(appts.length, 'the lead has its appointment').toBeGreaterThan(0);
    const apptId = appts[0]!.id;
    const now = readCtx();
    if (!now.appointments.includes(apptId)) now.appointments.push(apptId);
    saveCtx(now);
    await page.goto(app(`/calendar/${apptId}`));
    await expect(page.locator('main').locator('dt', { hasText: /^Lead$/ })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('main')).toContainText(full('Appt'));
    await shot(page, TAB, '17-appt-before', info);
    const clientId = await convertLead(page, c.appt, c, `${STAMP} Appointment Lane`);
    await page.goto(app(`/calendar/${apptId}`));
    const main = page.locator('main');
    await expect(main).toContainText(full('Appt'), { timeout: 60_000 });
    await expect(main.locator('dt', { hasText: /^Client$/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Send Message' })).toHaveAttribute(
      'href',
      new RegExp(`clientId=${clientId}`),
    );
    await shot(page, TAB, '17-appt-on-client', info);
    await openLead(page, c.appt, 'appointments');
    await expect(page.getByTestId('lead-appointment')).toHaveCount(1);
    // P4-1: the lead's row names the client it went to.
    await expect(page.getByTestId('lead-appointment')).toContainText(`Client: ${full('Appt')}`);
    await shot(page, TAB, '17-appt-lead-row', info);
  });
});

// ================================================================ Layout (both widths)
const layoutPages: [string, (id: string) => string][] = [
  ['list', () => '/leads'],
  ['overview', (id) => `/leads/${id}`],
  ...(
    [
      'communications',
      'appointments',
      'tasks',
      'documents',
      'campaigns',
      'notes',
      'activity',
    ] as const
  ).map((t) => [t, (id: string) => `/leads/${id}/${t}`] as [string, (id: string) => string]),
  ['convert', (id) => `/leads/${id}/convert`],
  ['add-task', (id) => `/tasks/new?leadId=${id}`],
  ['upload', (id) => `/documents/upload?leadId=${id}`],
  ['send-intake', (id) => `/intake-forms/send?leadId=${id}`],
  ['duplicates', () => '/leads/duplicates'],
  ['import', () => '/leads/import'],
  ['report', () => '/reports/leads'],
  ['routing', () => '/settings/lead-routing'],
  ['sequences', () => '/templates/lead-sequences'],
];

test.describe('Leads layout', () => {
  test.use(as('owner'));
  test.skip(() => !hasLogin('owner'), 'no owner login');
  test.beforeAll(async ({ browser }) => {
    await freshSession(browser, 'owner');
  });
  for (const [name, path] of layoutPages) {
    test(`@narrow layout ${name}: no sideways scroll`, async ({ page, browser }, info) => {
      const id = await layoutLead(browser);
      await page.goto(app(path(id)));
      await expect(page).not.toHaveURL(/sign-in/);
      await settled(page);
      await page.waitForTimeout(1000);
      await shot(page, TAB, `layout-${name}`, info);
      await expectNoSideScroll(page);
    });
  }
  test('@narrow layout add-lead dialog: no sideways scroll', async ({ page }, info) => {
    await openList(page, '');
    await page.getByRole('button', { name: 'Add New Lead' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot(page, TAB, 'layout-add-lead', info);
    await expectNoSideScroll(page);
  });
  test('@narrow layout create-campaign panel: no sideways scroll', async ({ page }, info) => {
    await openList(page, '');
    await page.getByTestId('create-campaign').click();
    await expect(page.getByRole('dialog', { name: 'Create Campaign' })).toBeVisible();
    await shot(page, TAB, 'layout-create-campaign', info);
    await expectNoSideScroll(page);
  });
});

// ================================================================ Cleanup (after every role's checks)

/** Cancel only when every address the cancellation notice reaches is a simulator one. */
const LIVE_STATUSES = ['SCHEDULED', 'PENDING', 'CONFIRMED', 'RESCHEDULED'];

/** Removes one run's records (by its tag). Returns what it did and what it could not do. */
async function cleanRun(api: Api, c: Ctx, done: string[], left: string[]) {
  const stamp = c.tag.slice('LIVE-CHECK '.length);
  const tagged = (x: string) => x.includes(stamp);
  const found = await ok(
    await api.get(`business/leads/pipeline?search=${encodeURIComponent(stamp)}&pageSize=100`),
    'pipeline',
  );
  const leads = (found.items as { id: string; firstName: string; lastName: string }[]).filter(
    (l) => tagged(l.firstName) || tagged(l.lastName),
  );
  const ids = new Set(leads.map((l) => l.id));
  const appointments = new Set(c.appointments);
  for (const id of ids) {
    const files = await api.get(`business/leads/${id}/documents-and-forms`);
    if (files.ok()) {
      for (const d of ((await files.json()).documents ?? []) as {
        id: string;
        fileName: string;
      }[]) {
        if (!tagged(d.fileName)) continue;
        const r = await api.delete(`business/leads/${id}/files/${d.id}`);
        (r.ok() ? done : left).push(`file ${d.fileName} (${r.status()})`);
      }
    }
    const appts = await api.get(`business/leads/${id}/appointments`);
    if (appts.ok()) {
      for (const a of ((await appts.json()).items ?? []) as { id: string }[])
        appointments.add(a.id);
    }
  }
  for (const id of appointments) {
    const r = await api.get(`business/appointments/${id}`);
    if (!r.ok()) continue;
    const a = (await r.json()) as { status: string };
    if (!LIVE_STATUSES.includes(a.status)) continue;
    // Who the cancellation notice reaches: the record's contact (client or lead); other attendees
    // are listed by name only, so an appointment with any is left alone.
    const rec = await api.get(`business/appointments/${id}/record`);
    const record = rec.ok()
      ? ((await rec.json()) as {
          contact?: { email?: string | null } | null;
          attendees?: unknown[];
        })
      : {};
    const to = record.contact?.email ?? '';
    if (!SIMULATOR.test(to) || (record.attendees ?? []).length) {
      left.push(
        `appointment ${id} not cancelled: recipient ${to || 'unknown'}${(record.attendees ?? []).length ? ' and other attendees' : ''}`,
      );
      continue;
    }
    const res = await api.post(`business/appointments/${id}/cancel`, {
      reason: `${c.tag} cleanup`,
    });
    (res.ok() ? done : left).push(`appointment ${id} cancel (${res.status()})`);
  }
  if (ids.size) {
    const r = await api.post('business/leads/bulk', { action: 'ARCHIVE', ids: [...ids] });
    const body = await r.text();
    (r.ok() ? done : left).push(`archive ${ids.size} leads (${r.status()}) ${body.slice(0, 160)}`);
  }
  for (const id of c.clients) {
    const r = await api.post(`business/clients/${id}/archive`, {});
    (r.ok() || r.status() === 409 ? done : left).push(`client ${id} archive (${r.status()})`);
  }
  const comms = await api.get(`business/communications?search=${encodeURIComponent(stamp)}`);
  if (comms.ok()) {
    const body = await comms.json();
    const list = (Array.isArray(body) ? body : (body.items ?? [])) as {
      id: string;
      name?: string;
      title?: string;
      archivedAt?: string | null;
    }[];
    for (const m of list.filter((x) => tagged(x.name ?? x.title ?? '') && !x.archivedAt)) {
      const r = await api.post(`business/communications/${m.id}/archive`);
      (r.ok() || r.status() === 409 ? done : left).push(
        `campaign ${m.name ?? m.id} archive (${r.status()})`,
      );
    }
  } else {
    left.push(`campaign list ${comms.status()}`);
  }
  if (c.sequenceMade) {
    const r = await api.post(`business/lead-sequences/${c.sequenceMade}/archive`);
    (r.ok() || r.status() === 409 || r.status() === 404 ? done : left).push(
      `sequence ${c.sequenceName || c.sequenceMade}: archive ${r.status()}`,
    );
  }
  if (c.typeMade) {
    const r = await api.post(`business/appointment-types/${c.typeMade}/archive`);
    (r.ok() || r.status() === 409 || r.status() === 404 ? done : left).push(
      `appointment type ${c.typeName || c.typeMade}: archive ${r.status()}`,
    );
  }
  // The run's service: deleted, or archived when something (a converted client) still uses it.
  if (c.serviceMade) {
    const del = await api.delete(`business/catalog/services/${c.serviceMade}`);
    if (del.ok() || del.status() === 404)
      done.push(`service ${c.serviceMade}: delete ${del.status()}`);
    else {
      const ar = await api.post(`business/catalog/services/${c.serviceMade}/archive`);
      (ar.ok() || ar.status() === 409 ? done : left).push(
        `service ${c.serviceMade}: delete ${del.status()}, archive ${ar.status()}`,
      );
    }
  }
  if (c.categoryMade) {
    const r = await api.delete(`business/catalog/categories/${c.categoryMade}`);
    (r.ok() || r.status() === 404 ? done : left).push(`category ${CATEGORY}: delete ${r.status()}`);
  }
  const after = await ok(
    await api.get(`business/leads/pipeline?search=${encodeURIComponent(stamp)}&pageSize=100`),
    'pipeline after',
  );
  for (const l of after.items as { lastName: string; firstName: string; stage?: string }[]) {
    if (!(tagged(l.firstName) || tagged(l.lastName))) continue;
    // A converted lead is kept by design (its client is archived above); it cannot be archived.
    if (l.stage === 'CONVERTED') done.push(`lead ${l.lastName} kept as Converted (no archive)`);
    else left.push(`lead ${l.lastName} still active`);
  }
}

test.describe('Leads cleanup', () => {
  test.use(as('owner'));
  test('zz cleanup @narrow: archive every lead of the run, remove its files, cancel its appointments, archive its clients, campaign, type and service', async ({
    browser,
  }, info) => {
    if (existsSync(ctxFile())) register(readCtx());
    const runs = readRegistry().filter((r) => r.tag === runTag || !r.cleaned);
    if (!runs.length) return;
    const api = await roleApi(browser, 'owner');
    const left: string[] = [];
    const done: string[] = [];
    try {
      for (const run of runs) {
        const l: string[] = [];
        const d: string[] = [];
        await cleanRun(api, run, d, l);
        done.push(...d.map((x) => `[${run.tag}] ${x}`));
        left.push(...l.map((x) => `[${run.tag}] ${x}`));
        if (run.tag !== runTag && !l.length) register({ ...run, cleaned: true });
      }
    } finally {
      await api.dispose();
    }
    done.push(`tag "${TAG}" kept: the one fixed tag every run reuses (tags have no delete)`);
    console.log(`CLEANUP done:\n${done.join('\n')}\nCLEANUP left:\n${left.join('\n')}`);
    info.annotations.push({ type: 'left-behind', description: left.join('; ') || 'none' });
  });
});
