import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
  type Response,
  type Route,
  type TestInfo,
} from '@playwright/test';
import { appUrl, firmSlug, shotsDir, statePath, type Role } from './env';
import { apiAs, app, as, expectNoSideScroll, hasLogin, narrow, settled, shot } from './helpers';

/**
 * Dashboard, Octavia's Review Two (the Developer Working Guide of Nov 2 and its comprehensive
 * companion): one test per row, the green ones too, live on dev as Test Firm B's Owner, Admin and
 * Staff. Rows are named by their IDs only; docs/qa/dashboard.md maps each one to its PR and tests.
 *
 * The dashboard only reads. Every read-only test holds back each write the page tries: the
 * request is answered inside the browser and never reaches dev (readOnly below), so a menu, a
 * dialog or a validation that lets something through cannot change anything. V6 makes a read fail
 * the same way, in the browser only.
 *
 * The run makes one record: the task "LIVE-CHECK <stamp> dashboard task" on the QA seed's
 * synthetic appointments client (its email is the SES simulator's; never QA Fixture Client 1), not
 * visible to the client, with no reminders and no assignee, so nothing is sent to anyone. T5
 * completes it from the dashboard; "zz cleanup" archives it (tasks have no delete). The run changes
 * no setting (layout, cards, tax season or time zone).
 *
 * V8 times the cold load in new browser contexts (the session cookie only) and writes every sample
 * to LIVE_SHOTS_DIR/dashboard/v8-timings.json and to the test's annotations.
 */
test.describe.configure({ timeout: 180_000 });

const TAB = 'dashboard';
/** QA seed part 4: the synthetic appointments client (success+qa-appointments@simulator...). */
const APPT_CLIENT = '00000000-0000-4a28-8005-000000000900';
const APPT_CLIENT_NAME = 'QA Appointments Client (fake)';
/** QA Fixture Client 1 is Octavia's portal login: never acted on. */
const CLIENT1 = '00000000-0000-4a28-8001-000000000002';

/** One tag per run, kept across worker restarts (a failed test restarts the worker). */
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
const taskTitle = (tag: string) => `${tag} dashboard task`;

/** Every run's record, so "zz cleanup" also finishes a run that stopped before it. */
interface Run {
  tag: string;
  taskIds: string[];
  cleaned: boolean;
}
const runsFile = () => join(shotsDir(TAB), '.runs.json');
function readRuns(): Run[] {
  try {
    return JSON.parse(readFileSync(runsFile(), 'utf8')) as Run[];
  } catch {
    return [];
  }
}
function saveRun(run: Run) {
  const runs = readRuns().filter((r) => r.tag !== run.tag);
  writeFileSync(runsFile(), JSON.stringify([...runs, run], null, 2));
}

// ---------------------------------------------------------------- what the API sends the page

interface Kpi {
  value: number;
  previous: number | null;
}
type FixedKey =
  | 'totalClients'
  | 'newLeads'
  | 'returnsInProgress'
  | 'acceptedReturns'
  | 'outstandingInvoicesCents'
  | 'appointmentsToday';
interface Range {
  period: string;
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
}
interface ServiceCard extends Kpi {
  slot: number;
  label: string;
  metric: string;
  link: { list: string; query: Record<string, string> };
}
interface Revenue {
  period: string;
  from: string;
  to: string;
  totalCents: number;
  previousCents: number | null;
  buckets: { from: string; to: string; cents: number }[];
  byService: { serviceId: string | null; name: string | null; cents: number }[];
}
interface DueTask {
  id: string;
  title: string;
  dueOn: string;
  client: { id: string; displayName: string };
}
interface Summary {
  today: string;
  timeZone?: string;
  range: Range;
  kpis: Partial<Record<FixedKey, Kpi>>;
  serviceCards: ServiceCard[];
  pipeline: {
    leads?: number | null;
    consultation: number | null;
    intake?: number | null;
    inProgress?: number | null;
    completed?: number | null;
    period: string;
    from: string;
    to: string;
  };
  revenue?: Revenue;
  tasksDue?: DueTask[];
  taxSeason: { start: string; end: string; inSeason: boolean } | null;
}
interface Thread {
  id: string;
  client: { id: string; displayName: string };
  unreadCount?: number;
}
interface Appt {
  id: string;
  startsAt: string;
  status: string;
  restricted?: boolean;
  client?: { id: string; displayName?: string } | null;
  lead?: { id: string } | null;
}
interface Notice {
  id: string;
  title: string;
  target: { kind: string; id: string };
  readAt: string | null;
}
interface FirmSettings {
  timezone: string;
  taxSeasonStart: string | null;
  taxSeasonEnd: string | null;
}
interface AuditRow {
  at: string;
  action: string;
  entity: { type: string };
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------- helpers

const note = (info: TestInfo, type: string, description: string) => {
  info.annotations.push({ type, description });
  console.warn(`${type}: ${info.title}: ${description}`);
};

/** A successful GET of `/api/v1/<path>` (exact path; the query is free). */
const isApi = (r: Response, path: string) =>
  r.request().method() === 'GET' && new URL(r.url()).pathname === `/api/v1/${path}` && r.ok();

/** The page's own next GET of `path`, parsed. Start it before the action that sends it. */
const nextJson = <T>(
  page: Page,
  path: string,
  match: (q: URLSearchParams) => boolean = () => true,
) =>
  page
    .waitForResponse((r) => isApi(r, path) && match(new URL(r.url()).searchParams), {
      timeout: 60_000,
    })
    .then(async (r) => (await r.json()) as T);

const nextSummary = (page: Page, match?: (q: URLSearchParams) => boolean) =>
  nextJson<Summary>(page, 'business/dashboard/summary', match);

const WIDGETS = [
  'Client Pipeline',
  'Revenue Overview',
  'Service Breakdown',
  'Recent Messages',
  'Tasks Due',
  'Upcoming Appointments',
] as const;
const widget = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const card = (page: Page, label: string) => page.getByTestId('kpi-card').filter({ hasText: label });
const cardValue = (page: Page, label: string) => card(page, label).locator('span.text-2xl').first();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const backToDashboard = (page: Page) =>
  page
    .getByTestId('back-to-dashboard')
    .or(page.getByTestId('back-to-origin'))
    .filter({ hasText: 'Back to Dashboard' })
    .first();

/** The dashboard and every widget have their data (or their empty, error or no-access state). */
async function loaded(page: Page) {
  const dash = page.getByTestId('firm-dashboard');
  await expect(dash).toBeVisible({ timeout: 60_000 });
  for (const w of WIDGETS) await expect(widget(page, w)).toBeVisible({ timeout: 60_000 });
  await expect(dash.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 60_000 });
  await expect(dash.getByTestId('kpi-card').locator('.animate-pulse')).toHaveCount(0, {
    timeout: 60_000,
  });
}

/** Opens the dashboard (with `query`, such as "?period=LAST_YEAR"); returns what it shows. */
async function openDashboard(page: Page, query = ''): Promise<Summary> {
  const summary = nextSummary(page);
  await page.goto(app(`/${query}`));
  const s = await summary;
  await loaded(page);
  return s;
}

/** Chooses a period in one of the dashboard's dropdowns; returns the summary it loads. */
async function pickPeriod(page: Page, select: string, value: string): Promise<Summary> {
  const param =
    select === 'Dashboard period'
      ? 'period'
      : select === 'Client Pipeline period'
        ? 'pipelinePeriod'
        : 'revenuePeriod';
  const next = nextSummary(page, (q) => q.get(param) === value);
  await page.getByRole('combobox', { name: select }).selectOption(value);
  const s = await next;
  await loaded(page);
  return s;
}

const money = (cents: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'usd',
    maximumFractionDigits: 0,
  }).format(cents / 100);
/** Cents from a money text: exact when it shows cents, else whole dollars. */
const centsOf = (text: string) => Math.round(Number(text.replace(/[^0-9.-]/g, '')) * 100);
const sameMoney = (shown: string, cents: number) =>
  /\.\d{2}/.test(shown)
    ? centsOf(shown) === cents
    : Math.round(centsOf(shown) / 100) === Math.round(cents / 100);

/** "Showing 1 – 8 of N" under a list, or the rows of a short or empty one. */
async function shownTotal(page: Page): Promise<number> {
  await settled(page);
  const showing = page
    .getByText(/Showing \d+ \S \d+ of [\d,]+/)
    .filter({ visible: true })
    .first();
  if (
    await showing.waitFor({ timeout: 15_000 }).then(
      () => true,
      () => false,
    )
  ) {
    const m = /of ([\d,]+)/.exec(await showing.innerText());
    return Number((m?.[1] ?? 'NaN').replace(/,/g, ''));
  }
  // No pagination: the list is empty (its own message), or has no total.
  return page
    .locator('main table tbody tr')
    .filter({ visible: true })
    .filter({ has: page.locator('a[href], input[type="checkbox"]') })
    .count();
}

/**
 * Holds back every write the page tries (anything but GET/HEAD to the API, except the session's
 * own refresh): the browser gets a 503 and nothing reaches dev. Returns what it held back.
 */
async function readOnly(page: Page): Promise<string[]> {
  const held: string[] = [];
  await page.route(
    (u) => u.pathname.startsWith('/api/v1/'),
    async (route: Route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      if (['GET', 'HEAD', 'OPTIONS'].includes(req.method()) || /^\/api\/v1\/auth\//.test(path)) {
        return route.fallback();
      }
      held.push(`${req.method()} ${path.replace('/api/v1/', '')}`);
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          statusCode: 503,
          code: 'LIVE_CHECK_READ_ONLY',
          message: 'The live check held this change back.',
        }),
      });
    },
  );
  return held;
}

/** The writes that would make or send a record (not a read mark or a session call). */
const creates = (held: string[]) =>
  held.filter((h) =>
    /^(POST|PUT|PATCH) business\/(clients|leads|appointments|tasks|invoices|message|communications|documents)/.test(
      h,
    ),
  );

/** Makes the page's GETs of `path` fail (in the browser only) until the returned stop(). */
async function failing(page: Page, path: string): Promise<() => Promise<void>> {
  const match = (u: URL) => u.pathname === `/api/v1/${path}`;
  const handler = (route: Route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ statusCode: 500, message: 'The live check made this call fail.' }),
        })
      : route.fallback();
  await page.route(match, handler);
  return () => page.unroute(match, handler);
}

/** Refreshes a role's saved session when its access token has expired (the cookies only). */
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
    if (!r.ok()) throw new Error(`${role} session refresh failed (${r.status()}): sign in again`);
    const cookies = (await ctx.storageState()).cookies;
    const saved = JSON.parse(readFileSync(statePath(role), 'utf8')) as Record<string, unknown>;
    writeFileSync(statePath(role), JSON.stringify({ ...saved, cookies }, null, 2));
  } finally {
    await ctx.close();
  }
}

// ---------------------------------------------------------------- days and periods

const pad = (n: number) => String(n).padStart(2, '0');
const dayOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
/** Days in month `m` (1 to 12). */
const lastOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
const monthBefore = (y: number, m: number) => (m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 });
const partsOf = (day: string) => {
  const [y = 0, m = 0, d = 0] = day.split('-').map(Number);
  return { y, m, d };
};

/**
 * The period rules (docs/qa/dashboard.md, Periods): this month, quarter and year run to date;
 * last month and last year are whole; the comparison is the equivalent elapsed period before.
 */
function expectRange(r: Range, today: string) {
  const { y, m, d } = partsOf(today);
  const pm = monthBefore(y, m);
  const at = `${r.period} on ${today}`;
  switch (r.period) {
    case 'TODAY':
      expect([r.from, r.to, r.previousFrom, r.previousTo], at).toEqual([
        today,
        today,
        addDays(today, -1),
        addDays(today, -1),
      ]);
      break;
    case 'THIS_WEEK':
      expect(r.to, at).toBe(today);
      expect(daysBetween(r.from, today), at).toBeGreaterThanOrEqual(0);
      expect(daysBetween(r.from, today), at).toBeLessThan(7);
      expect(r.previousTo < r.from, at).toBe(true);
      expect(daysBetween(r.previousFrom, r.previousTo), at).toBe(daysBetween(r.from, r.to));
      break;
    case 'THIS_MONTH':
      expect([r.from, r.to, r.previousFrom, r.previousTo], at).toEqual([
        dayOf(y, m, 1),
        today,
        dayOf(pm.y, pm.m, 1),
        dayOf(pm.y, pm.m, Math.min(d, lastOf(pm.y, pm.m))),
      ]);
      break;
    case 'LAST_MONTH': {
      const p2 = monthBefore(pm.y, pm.m);
      expect([r.from, r.to, r.previousFrom, r.previousTo], at).toEqual([
        dayOf(pm.y, pm.m, 1),
        dayOf(pm.y, pm.m, lastOf(pm.y, pm.m)),
        dayOf(p2.y, p2.m, 1),
        dayOf(p2.y, p2.m, lastOf(p2.y, p2.m)),
      ]);
      break;
    }
    case 'THIS_QUARTER': {
      const qs = 3 * Math.floor((m - 1) / 3) + 1;
      const pq = qs === 1 ? { y: y - 1, m: 10 } : { y, m: qs - 3 };
      expect([r.from, r.to, r.previousFrom], at).toEqual([
        dayOf(y, qs, 1),
        today,
        dayOf(pq.y, pq.m, 1),
      ]);
      expect(r.previousTo < r.from, at).toBe(true);
      break;
    }
    case 'THIS_YEAR':
      expect([r.from, r.to, r.previousFrom, r.previousTo], at).toEqual([
        dayOf(y, 1, 1),
        today,
        dayOf(y - 1, 1, 1),
        dayOf(y - 1, m, Math.min(d, lastOf(y - 1, m))),
      ]);
      break;
    case 'LAST_YEAR':
      expect([r.from, r.to, r.previousFrom, r.previousTo], at).toEqual([
        dayOf(y - 1, 1, 1),
        dayOf(y - 1, 12, 31),
        dayOf(y - 2, 1, 1),
        dayOf(y - 2, 12, 31),
      ]);
      break;
    case 'CUSTOM': {
      const n = daysBetween(r.from, r.to);
      expect([r.previousFrom, r.previousTo], at).toEqual([
        addDays(r.from, -n - 1),
        addDays(r.from, -1),
      ]);
      break;
    }
    default:
      throw new Error(`unknown period ${r.period}`);
  }
}

/** What a card's trend says (K8): words with every colour. */
function trendWords(k: Kpi, favour: 'up' | 'down' | 'neutral'): RegExp {
  if (k.previous === null) return /N\/A/;
  if (k.previous === 0) return k.value === 0 ? /No change/ : /New/;
  const change = Math.round(((k.value - k.previous) / k.previous) * 100);
  if (change === 0) return /No change/;
  const tone =
    favour === 'neutral'
      ? ''
      : change > 0 === (favour === 'up')
        ? ', favourable'
        : ', unfavourable';
  return new RegExp(`${change > 0 ? 'Up' : 'Down'} ${Math.abs(change)}%${tone}`);
}

const FIXED = [
  { key: 'totalClients', label: 'Total Clients', module: 'Clients', favour: 'up' },
  { key: 'newLeads', label: 'New Leads', module: 'Leads', favour: 'up' },
  {
    key: 'outstandingInvoicesCents',
    label: 'Outstanding Invoices',
    module: 'Invoices & Payments',
    favour: 'down',
  },
  { key: 'appointmentsToday', label: 'Appointments Today', module: 'Appointments', favour: null },
] as const;

const serviceFavour = (c: ServiceCard): 'up' | 'neutral' =>
  c.metric === 'COMPLETED_IN_PERIOD' ? 'up' : 'neutral';

/** The text a card shows for its number. */
const shownNumber = (key: FixedKey, k: Kpi) =>
  key === 'outstandingInvoicesCents' ? money(k.value) : String(k.value);

/** Where a service card opens (kpi-cards.tsx serviceCardHref), for comparing with its link. */
function serviceHref(c: ServiceCard): string {
  const q = c.link.query;
  const params = new URLSearchParams();
  const set = (key: string, value: string | undefined) => {
    if (value) params.set(key, value);
  };
  if (c.link.list === 'tax-returns') {
    set('status', q['workflowGroup'] ?? q['workflowStatus']);
    set('acceptedFrom', q['acceptedFrom']);
    set('acceptedTo', q['acceptedTo']);
    set('serviceId', q['serviceId']);
    set('asOf', q['asOf']);
  } else {
    set('service', q['serviceId']);
    set('engagement', q['engagementStatus']);
    set('completedFrom', q['completedFrom']);
    set('completedTo', q['completedTo']);
    set('asOf', q['asOf']);
  }
  return `/${c.link.list}?${params.toString()}&back=dashboard`;
}

/** The firm's day today, as the API counts it. */
const firmToday = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
const zoneName = (timeZone: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
    .formatToParts(new Date())
    .find((p) => p.type === 'timeZoneName')?.value ?? '';
const seasonDay = (d: string, year: boolean) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...(year ? { year: 'numeric' } : {}),
  });
const seasonText = (s: { start: string; end: string }) =>
  `${seasonDay(s.start, s.start.slice(0, 4) !== s.end.slice(0, 4))} – ${seasonDay(s.end, true)}`;

/** Opens a card or link from the dashboard, checks the page, comes back on Back to Dashboard. */
async function roundTrip(
  page: Page,
  link: Locator,
  url: RegExp,
  address: string,
  onPage?: () => Promise<void>,
) {
  await link.click();
  await expect(page).toHaveURL(url, { timeout: 60_000 });
  if (onPage) await onPage();
  await expect(backToDashboard(page)).toBeVisible({ timeout: 60_000 });
  await backToDashboard(page).click();
  await expect(page).toHaveURL(app(address), { timeout: 60_000 });
  await loaded(page);
}

/** The Custom layout of one widget (R2 NEW3 to NEW5): title beside its dropdown, pairs below. */
async function customLayout(page: Page, name: string, info: TestInfo) {
  const w = widget(page, name);
  const select = w.getByRole('combobox', { name: `${name} period` });
  await select.selectOption('CUSTOM');
  const dates = w.getByTestId('custom-dates');
  await expect(dates).toBeVisible();
  await expect(dates.getByTestId('custom-hint')).toBeVisible();
  const heading = w.getByRole('heading', { name, level: 2 });
  const [h, s] = [(await heading.boundingBox())!, (await select.boundingBox())!];
  expect(
    Math.abs(h.y + h.height / 2 - (s.y + s.height / 2)),
    `${name}: dropdown on the title row`,
  ).toBeLessThan(12);
  const boxes = await Promise.all(
    [
      dates.getByText('From', { exact: true }),
      dates.getByLabel('From'),
      dates.getByText('To', { exact: true }),
      dates.getByLabel('To'),
    ].map(async (l) => (await l.boundingBox())!),
  );
  const [fl, fi, tl, ti] = boxes as [Box, Box, Box, Box];
  expect(fi.y, `${name}: dates below the title`).toBeGreaterThan(h.y + h.height - 1);
  for (const [label, input] of [
    [fl, fi],
    [tl, ti],
  ] as const) {
    expect(
      Math.abs(label.y + label.height / 2 - (input.y + input.height / 2)),
      `${name}: label on its field's line`,
    ).toBeLessThan(8);
    expect(
      input.x - (label.x + label.width),
      `${name}: label right before its field`,
    ).toBeGreaterThanOrEqual(0);
    expect(input.x - (label.x + label.width), `${name}: label right before its field`).toBeLessThan(
      24,
    );
  }
  if (!narrow(info))
    expect(Math.abs(fi.y - ti.y), `${name}: From and To side by side`).toBeLessThan(4);
}
type Box = { x: number; y: number; width: number; height: number };

/** The menu a role's Upcoming Appointments row offers (appointment-actions.ts, the role grids). */
const fullMenu = (a: Appt) => [
  'View Details',
  'Edit',
  'Reschedule',
  'Send Reminder',
  'Mark Complete',
  'Cancel',
  ...(a.client ? ['Open Client'] : a.lead ? ['Open Lead'] : []),
];

/** The rows Upcoming Appointments shows: scheduled, not restricted, soonest first. */
const upcomingOf = (items: Appt[]) =>
  items
    .filter((a) => !a.restricted && a.status === 'SCHEDULED')
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

// ---------------------------------------------------------------- the run's one record

/** The run's task (found, or made once): due soon enough to be among Tasks Due's five. */
async function ensureTask(): Promise<{ id: string; title: string }> {
  const title = taskTitle(runTag);
  const mine = readRuns().find((r) => r.tag === runTag);
  if (mine?.taskIds[0]) return { id: mine.taskIds[0], title };
  expect(APPT_CLIENT, 'never QA Fixture Client 1').not.toBe(CLIENT1);
  const api = await apiAs('owner');
  try {
    const s = await api.get('business/dashboard/summary');
    expect(s.ok(), `summary ${s.status()}`).toBe(true);
    const sum = (await s.json()) as Summary;
    const due = (sum.tasksDue ?? []).map((t) => t.dueOn).sort();
    const earliest = due[0];
    // Five shown already: a day before the soonest, so it is listed first.
    const dueOn =
      due.length >= 5 && earliest && earliest <= sum.today ? addDays(earliest, -1) : sum.today;
    const res = await api.post('business/tasks', {
      data: {
        clientId: APPT_CLIENT,
        title,
        details: 'Live check fixture (synthetic). The same run archives it.',
        dueOn,
        allDay: true,
        clientVisible: false,
        reminders: [],
        idempotencyKey: randomUUID(),
      },
    });
    expect(res.ok(), `create task ${res.status()} ${await res.text()}`).toBe(true);
    const id = ((await res.json()) as { id: string }).id;
    saveRun({ tag: runTag, taskIds: [id], cleaned: false });
    return { id, title };
  } finally {
    await api.dispose();
  }
}

// ---------------------------------------------------------------- V8: the cold load

const V8_WIDGETS = [
  'Date and season',
  'Key numbers',
  'Client Pipeline',
  'Revenue Overview',
  'Service Breakdown',
  'Recent Messages',
  'Tasks Due',
  'Upcoming Appointments',
] as const;
/** The calls each widget waits for (dashboard-screen.tsx). */
const FEEDS: Record<(typeof V8_WIDGETS)[number], string[]> = {
  'Date and season': ['business/dashboard/summary', 'business/availability'],
  'Key numbers': ['business/dashboard/summary'],
  'Client Pipeline': ['business/dashboard/summary'],
  'Revenue Overview': ['business/dashboard/summary'],
  'Service Breakdown': ['business/dashboard/summary'],
  'Recent Messages': ['business/message-threads', 'business/availability'],
  'Tasks Due': ['business/dashboard/summary'],
  'Upcoming Appointments': ['business/appointments', 'business/availability'],
};
const V8_SAMPLES = 5;
const V8_TARGET_MS = 2_500;
const V8_SUMMARY_TARGET_MS = 1_000;

interface Seen {
  ms: number;
  state: string;
}
type V8Window = Window & { __v8?: Record<string, Seen> };
interface ApiTiming {
  path: string;
  status: number;
  /** When the request started, from navigation start. */
  startMs: number;
  /** Request sent to first byte back (server time plus one network trip). */
  ttfbMs: number;
  /** Request start to last byte. */
  totalMs: number;
  /** Last byte, from navigation start. */
  endMs: number;
}
interface Sample {
  sample: number;
  widgets: Record<string, Seen & { feeds: { path: string; totalMs: number; endMs: number }[] }>;
  slowestMs: number;
  documentTtfbMs: number;
  domContentLoadedMs: number;
  api: ApiTiming[];
}

/**
 * Runs in the page before its own scripts: notes, from navigation start (performance.now()), when
 * each widget first shows its data, its empty state, its error or "no access": never a skeleton.
 */
function watchWidgets() {
  const seen: Record<string, { ms: number; state: string }> = {};
  (window as unknown as { __v8: typeof seen }).__v8 = seen;
  const EMPTY: Record<string, string> = {
    'Client Pipeline': 'No clients in the pipeline yet',
    'Revenue Overview': 'No revenue in this period',
    'Service Breakdown': 'No revenue in this period',
    'Recent Messages': 'No messages yet',
    'Tasks Due': 'No tasks due',
    'Upcoming Appointments': 'No upcoming appointments',
  };
  const check = () => {
    const now = performance.now();
    const keys = document.querySelector('section[aria-label="Key numbers"]');
    if (!seen['Key numbers'] && keys && !keys.hasAttribute('aria-busy')) {
      if (keys.querySelector('[data-testid="kpi-error"]'))
        seen['Key numbers'] = { ms: now, state: 'error' };
      else if (
        keys.querySelectorAll('[data-testid="kpi-card"]').length >= 4 &&
        !keys.querySelector('[data-testid="kpi-card"] .animate-pulse')
      )
        seen['Key numbers'] = { ms: now, state: 'data' };
    }
    for (const name of Object.keys(EMPTY)) {
      if (seen[name]) continue;
      const s = document.querySelector(`section[aria-label="${name}"]`);
      if (!s || s.querySelector('[aria-busy="true"]')) continue;
      const state = s.querySelector('[role="alert"]')
        ? 'error'
        : s.querySelector('[data-testid="widget-no-access"]')
          ? 'no-access'
          : (s.textContent ?? '').includes(EMPTY[name] ?? '\u0000')
            ? 'empty'
            : 'data';
      seen[name] = { ms: now, state };
    }
    if (!seen['Date and season']) {
      const season =
        document.querySelector('[data-testid="tax-season"]') ??
        Array.from(document.querySelectorAll('a')).find((a) =>
          (a.textContent ?? '').includes('Set your tax season'),
        );
      if (season) seen['Date and season'] = { ms: now, state: 'data' };
    }
  };
  new MutationObserver(check).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  setInterval(check, 50);
}

/** One cold load: a new context (no cache, no service worker, the session cookie only). */
async function coldSample(browser: Browser, n: number): Promise<Sample> {
  const ctx = await browser.newContext({
    ...as('owner'),
    viewport: { width: 1165, height: 900 },
    serviceWorkers: 'block',
  });
  try {
    await ctx.addInitScript(watchWidgets);
    const page = await ctx.newPage();
    const raw: {
      url: string;
      status: number;
      t: { startTime: number; requestStart: number; responseStart: number; responseEnd: number };
    }[] = [];
    const pending: Promise<void>[] = [];
    page.on('response', (res) => {
      if (!new URL(res.url()).pathname.startsWith('/api/v1/')) return;
      pending.push(
        res.finished().then(
          () => {
            raw.push({ url: res.url(), status: res.status(), t: res.request().timing() });
          },
          () => undefined,
        ),
      );
    });
    await page.goto(app('/'), { waitUntil: 'commit' });
    await page.waitForFunction(
      (count) => Object.keys((window as V8Window).__v8 ?? {}).length >= count,
      V8_WIDGETS.length,
      { timeout: 60_000 },
    );
    const seen = await page.evaluate(() => ({ ...((window as V8Window).__v8 ?? {}) }));
    const nav = await page.evaluate(() => {
      const e = performance.getEntriesByType('navigation')[0] as
        PerformanceNavigationTiming | undefined;
      return {
        origin: performance.timeOrigin,
        ttfb: e ? e.responseStart : -1,
        dcl: e ? e.domContentLoadedEventEnd : -1,
      };
    });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await Promise.all(pending);
    const r = (x: number) => Math.round(x);
    const api: ApiTiming[] = raw
      .map(({ url, status, t }) => {
        const startMs = t.startTime - nav.origin;
        const totalMs = Math.max(0, t.responseEnd);
        return {
          path: new URL(url).pathname.replace(/^\/api\/v1\//, ''),
          status,
          startMs: r(startMs),
          ttfbMs: r(Math.max(0, t.responseStart - Math.max(0, t.requestStart))),
          totalMs: r(totalMs),
          endMs: r(startMs + totalMs),
        };
      })
      .sort((a, b) => a.startMs - b.startMs);
    const widgets: Sample['widgets'] = {};
    for (const w of V8_WIDGETS) {
      const s = seen[w] ?? { ms: Number.POSITIVE_INFINITY, state: 'never' };
      widgets[w] = {
        ms: r(s.ms),
        state: s.state,
        feeds: FEEDS[w].flatMap((p) => {
          const call = api.find((a) => a.path === p && a.status < 400);
          return call ? [{ path: p, totalMs: call.totalMs, endMs: call.endMs }] : [];
        }),
      };
    }
    return {
      sample: n,
      widgets,
      slowestMs: Math.max(...Object.values(widgets).map((w) => w.ms)),
      documentTtfbMs: r(nav.ttfb),
      domContentLoadedMs: r(nav.dcl),
      api,
    };
  } finally {
    await ctx.close();
  }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? Number.NaN;
};

// ================================================================ Owner (read only)
test.describe('Dashboard (Owner)', () => {
  test.use(as('owner'));
  test.skip(() => !hasLogin('owner'), 'no owner login');
  let held: string[] = [];
  test.beforeAll(async ({ browser }) => {
    await freshSession(browser, 'owner');
  });
  test.beforeEach(async ({ page }) => {
    held = await readOnly(page);
  });
  // eslint-disable-next-line no-empty-pattern
  test.afterEach(async ({}, info) => {
    if (held.length) note(info, 'held back', held.join(', '));
  });

  // ------------------------------------------------------------ 1 Header and global controls

  test('N1 the bell lists the notifications, reminders among them', async ({ page }, info) => {
    const notices = nextJson<{ items: Notice[]; unreadCount: number }>(
      page,
      'business/me/notifications',
    );
    await openDashboard(page);
    const list = await notices;
    const bell = page.getByRole('button', { name: /^Notifications/ });
    await expect(bell).toBeVisible();
    await bell.click();
    const shown = page.getByTestId('bell-list');
    await expect(shown).toBeVisible();
    await expect(shown.locator('.animate-pulse')).toHaveCount(0, { timeout: 30_000 });
    if (!list.items.length) {
      await expect(shown).toContainText('all caught up');
      note(info, 'fixture', 'the harness Owner has no notifications: the empty list is checked');
    } else {
      for (const n of list.items.slice(0, 5)) await expect(shown).toContainText(n.title);
      const reminders = list.items.filter((n) => /remind|appointment/i.test(n.title));
      note(
        info,
        'reminders',
        reminders.length ? reminders.map((n) => n.title).join('; ') : 'none in the list',
      );
    }
    await shot(page, TAB, 'N1-bell', info);
    await page.keyboard.press('Escape');
  });

  test('N2 opening the bell marks only what it shows; the badge and the list survive a reload', async ({
    page,
  }, info) => {
    const notices = nextJson<{ items: Notice[]; unreadCount: number }>(
      page,
      'business/me/notifications',
    );
    await openDashboard(page);
    const before = await notices;
    const bell = page.getByRole('button', { name: /^Notifications/ });
    const name = before.unreadCount
      ? `Notifications, ${before.unreadCount} unread`
      : 'Notifications';
    await expect(bell).toHaveAccessibleName(name);
    await bell.click();
    await expect(page.getByTestId('bell-list').locator('.animate-pulse')).toHaveCount(0, {
      timeout: 30_000,
    });
    await page.keyboard.press('Escape');
    if (before.unreadCount) {
      // Marking them read cannot be undone, so it is held back: the badge and history are checked.
      const marks = held.filter((h) => /me\/notifications\/.+\/read$/.test(h)).length;
      note(
        info,
        'NOT LIVE',
        `N2 marking read: ${before.unreadCount} unread, ${marks} marks held back (no undo)`,
      );
    } else {
      expect(
        held.filter((h) => h.includes('notifications')),
        'nothing to mark, nothing sent',
      ).toEqual([]);
    }
    const again = nextJson<{ items: Notice[]; unreadCount: number }>(
      page,
      'business/me/notifications',
    );
    await page.reload();
    await loaded(page);
    const after = await again;
    expect(after.unreadCount, 'the badge after a reload').toBe(before.unreadCount);
    await expect(bell).toHaveAccessibleName(name);
    expect(
      after.items.map((n) => n.id),
      'the history stays',
    ).toEqual(expect.arrayContaining(before.items.map((n) => n.id)));
    await bell.click();
    for (const n of before.items.slice(0, 3))
      await expect(page.getByTestId('bell-list')).toContainText(n.title);
    await shot(page, TAB, 'N2-bell-after-reload', info);
  });

  test('N3 an appointment notice opens that exact appointment', async ({ page }, info) => {
    const notices = nextJson<{ items: Notice[]; unreadCount: number }>(
      page,
      'business/me/notifications',
    );
    await openDashboard(page);
    const list = await notices;
    const appt = list.items.find((n) => n.target.kind === 'appointment');
    if (!appt) {
      note(
        info,
        'NOT LIVE',
        'N3: the harness Owner has no appointment notice in the bell (none is seeded)',
      );
      test.skip(true, 'no appointment notice for the harness Owner');
      return;
    }
    await page.getByRole('button', { name: /^Notifications/ }).click();
    await page
      .getByTestId('bell-list')
      .getByRole('menuitem')
      .filter({ hasText: appt.title })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/calendar/${appt.target.id}`), { timeout: 60_000 });
    await settled(page);
    await expect(page.locator('main')).not.toContainText(/not found|no access|couldn.t find/i);
    await shot(page, TAB, 'N3-appointment', info);
  });

  test('D3 Report a Problem: the approved words; the email names the firm and the page only', async ({
    page,
  }, info) => {
    await openDashboard(page, '?period=LAST_MONTH');
    await page.getByRole('button', { name: 'Help & Support' }).click();
    const report = page.getByRole('link', { name: /Report a Problem/ });
    await expect(report).toBeVisible();
    await expect(report).toContainText(
      'Describe what went wrong. Your firm name and affected page will be included in the report.',
    );
    const href = (await report.getAttribute('href')) ?? '';
    expect(href).toMatch(/^mailto:[^?]+@[^?]+\?/);
    const q = new URLSearchParams(href.split('?')[1] ?? '');
    expect(q.get('subject')).toBe('Report a Problem');
    // The page's path only: the dashboard's periods (its query) stay out.
    expect(q.get('body')).toMatch(/^Firm: .+\nPage: \/\n\nWhat happened:\n$/);
    note(info, 'report body', (q.get('body') ?? '').replace(/\n/g, ' | '));
    await shot(page, TAB, 'D3-help', info);
  });

  test('R2 NEW1 the profile menu closes on a click outside and on Escape after focus left it', async ({
    page,
  }, info) => {
    await openDashboard(page);
    const trigger = page.getByRole('button', { name: /Owner$/ });
    const menu = page.getByRole('menu').filter({ has: page.getByTestId('me-email') });
    await trigger.click();
    await expect(menu).toBeVisible();
    await shot(page, TAB, 'R2NEW1-open', info);
    await page.getByTestId('page-title').click();
    await expect(menu).toHaveCount(0);
    await expect(page).toHaveURL(app('/'));
    await trigger.click();
    await expect(menu).toBeVisible();
    await page.getByRole('combobox', { name: 'Dashboard period' }).focus();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await trigger.click();
    await menu.getByRole('menuitem').first().focus();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('R2 NEW2 the Owner edits their own profile here; Cancel changes nothing', async ({
    page,
  }, info) => {
    await page.goto(app('/profile'));
    const edit = page.getByRole('button', { name: 'Edit Profile' });
    await expect(edit).toBeVisible({ timeout: 60_000 });
    await edit.click();
    const form = page.getByTestId('edit-profile');
    await expect(form).toBeVisible();
    const first = form.getByLabel('First name *');
    const was = await first.inputValue();
    expect(was.length).toBeGreaterThan(0);
    await expect(form.getByLabel('Last name *')).not.toHaveValue('');
    await shot(page, TAB, 'R2NEW2-edit', info);
    await first.fill(`${was} ${runTag}`);
    await form.getByRole('button', { name: 'Cancel' }).click();
    await expect(form).toHaveCount(0);
    expect(
      held.filter((h) => /profile/i.test(h)),
      'Cancel saves nothing',
    ).toEqual([]);
    await page.reload();
    await expect(page.getByText(runTag)).toHaveCount(0);
  });

  test('Tax season context: Tax Season or Off-Season from the firm settings, kept on reload', async ({
    page,
  }, info) => {
    const firm = nextJson<FirmSettings>(page, 'business/settings');
    await page.goto(app('/settings/preferences'));
    const settings = await firm;
    await expect(page.getByTestId('tax-season-fields')).toBeVisible({ timeout: 60_000 });
    const s = await openDashboard(page);
    const check = async () => {
      const line = page.getByTestId('tax-season');
      if (!settings.taxSeasonStart || !settings.taxSeasonEnd) {
        expect(s.taxSeason).toBeNull();
        await expect(line).toHaveCount(0);
        await expect(
          page.getByRole('link', { name: 'Set your tax season in Settings' }),
        ).toBeVisible();
        return;
      }
      const season = s.taxSeason;
      expect(season, 'the season comes from the settings').not.toBeNull();
      if (!season) return;
      expect([season.start.slice(5), season.end.slice(5)]).toEqual([
        settings.taxSeasonStart,
        settings.taxSeasonEnd,
      ]);
      const md = s.today.slice(5);
      const wraps = settings.taxSeasonStart > settings.taxSeasonEnd;
      const inSeason = wraps
        ? md >= settings.taxSeasonStart || md <= settings.taxSeasonEnd
        : md >= settings.taxSeasonStart && md <= settings.taxSeasonEnd;
      expect(season.inSeason, `in season on ${s.today}`).toBe(inSeason);
      expect(season.end >= s.today, 'the current or the next season').toBe(true);
      await expect(line).toContainText(inSeason ? 'Tax Season' : 'Off-Season');
      await expect(line).toContainText(seasonText(season));
      if (!inSeason) await expect(line).toContainText('Next tax season:');
    };
    await check();
    note(
      info,
      'season',
      s.taxSeason
        ? `${s.taxSeason.start} to ${s.taxSeason.end}, in season: ${s.taxSeason.inSeason}`
        : 'none set',
    );
    await shot(page, TAB, 'tax-season', info);
    await page.reload();
    await loaded(page);
    await check();
  });

  // ------------------------------------------------------------ 2 + New

  test('@narrow Q6 + New offers the eight places something new starts; opening it makes nothing', async ({
    page,
  }, info) => {
    await openDashboard(page);
    await page.getByRole('button', { name: 'New', exact: true }).click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText([
      'New client',
      'New lead',
      'New appointment',
      'New task',
      'New invoice',
      'New message',
      'Bulk email',
      'Upload documents',
    ]);
    await shot(page, TAB, 'Q6-new-menu', info);
    await page.keyboard.press('Escape');
    await expectNoSideScroll(page);
    expect(creates(held), 'opening the menu makes nothing').toEqual([]);
  });

  test('Q7 + New > New client opens the blank Add New Client form; Cancel adds nothing', async ({
    page,
  }, info) => {
    await openDashboard(page);
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New client' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add New Client' });
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByLabel('Full name *')).toHaveValue('');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await shot(page, TAB, 'Q7-new-client', info);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    expect(held.filter((h) => h.startsWith('POST business/clients'))).toEqual([]);
  });

  test('Q8 + New > New invoice opens a blank invoice', async ({ page }, info) => {
    await openDashboard(page);
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New invoice' }).click();
    await expect(page).toHaveURL(/\/invoices\/new\?from=%2F$/, { timeout: 60_000 });
    await expect(page.getByTestId('invoice-editor')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('invoice-total').first()).toContainText('$0');
    await shot(page, TAB, 'Q8-new-invoice', info);
  });

  test('Q9 + New > New appointment opens the calendar to book from', async ({ page }, info) => {
    await openDashboard(page);
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New appointment' }).click();
    await expect(page).toHaveURL(/\/calendar\?from=%2F$/, { timeout: 60_000 });
    await expect(backToDashboard(page)).toBeVisible({ timeout: 60_000 });
    await shot(page, TAB, 'Q9-new-appointment', info);
  });

  test('Q10 + New closes on Escape (focus back), a click outside and a choice; arrows move', async ({
    page,
  }) => {
    await openDashboard(page);
    const button = page.getByRole('button', { name: 'New', exact: true });
    const menu = page.getByRole('menu');
    await button.click();
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'New lead' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitem', { name: 'Upload documents' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();
    await button.click();
    await expect(menu).toBeVisible();
    await page.getByTestId('page-title').click();
    await expect(menu).toBeHidden();
    await button.click();
    await page.getByRole('menuitem', { name: 'New task' }).click();
    await expect(page).toHaveURL(/\/tasks\/new\?from=%2F$/, { timeout: 60_000 });
    await expect(menu).toBeHidden();
  });

  test('Q11 + New > New message opens a fresh message with no recipient', async ({
    page,
  }, info) => {
    await openDashboard(page);
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New message' }).click();
    await expect(page).toHaveURL(/\/messages\/new/, { timeout: 60_000 });
    await expect(page.getByTestId('compose')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('compose').getByLabel('Message')).toHaveValue('');
    await expect(page.getByTestId('compose-count')).toContainText('Characters: 0');
    await shot(page, TAB, 'Q11-new-message', info);
    expect(held.filter((h) => /message/.test(h))).toEqual([]);
  });

  // ------------------------------------------------------------ 3 KPI cards

  test('K1 Total Clients: this month and a past period open the clients they count', async ({
    page,
  }, info) => {
    const now = await openDashboard(page);
    const k = now.kpis.totalClients!;
    await expect(cardValue(page, 'Total Clients')).toHaveText(String(k.value));
    await expect(card(page, 'Total Clients')).toHaveAttribute('href', '/clients?back=dashboard');
    await roundTrip(
      page,
      card(page, 'Total Clients'),
      /\/clients\?back=dashboard$/,
      '/',
      async () => {
        expect(await shownTotal(page), 'the list holds the clients the card counts').toBe(k.value);
      },
    );
    const past = await openDashboard(page, '?period=LAST_YEAR');
    const end = past.range.to;
    expect(end).toBe(`${Number(past.today.slice(0, 4)) - 1}-12-31`);
    await expect(card(page, 'Total Clients')).toHaveAttribute(
      'href',
      `/clients?asOf=${end}&back=dashboard`,
    );
    await roundTrip(
      page,
      card(page, 'Total Clients'),
      new RegExp(`/clients\\?asOf=${end}`),
      '/?period=LAST_YEAR',
      async () => {
        await expect(page.getByTestId('as-of-filter')).toBeVisible({ timeout: 60_000 });
        expect(await shownTotal(page), `the clients on the books on ${end}`).toBe(
          past.kpis.totalClients!.value,
        );
        await shot(page, TAB, 'K1-clients-as-of', info);
      },
    );
  });

  test('K2 a card keeps the chosen period and the place on the page: Back returns to both', async ({
    page,
  }, info) => {
    await openDashboard(page);
    await pickPeriod(page, 'Dashboard period', 'LAST_MONTH');
    await pickPeriod(page, 'Client Pipeline period', 'THIS_QUARTER');
    await pickPeriod(page, 'Revenue Overview period', 'QUARTER');
    const address = '/?period=LAST_MONTH&pipeline=THIS_QUARTER&revenue=QUARTER';
    await expect(page).toHaveURL(app(address));
    await roundTrip(page, card(page, 'New Leads'), /\/leads\?stage=SUBMITTED&/, address);
    await expect(page.getByRole('combobox', { name: 'Dashboard period' })).toHaveValue(
      'LAST_MONTH',
    );
    await expect(page.getByRole('combobox', { name: 'Client Pipeline period' })).toHaveValue(
      'THIS_QUARTER',
    );
    await expect(page.getByRole('combobox', { name: 'Revenue Overview period' })).toHaveValue(
      'QUARTER',
    );
    const tasks = widget(page, 'Tasks Due');
    await tasks.scrollIntoViewIfNeeded();
    const y = await page.evaluate(() => window.scrollY);
    await roundTrip(
      page,
      tasks.getByRole('link', { name: 'View All' }),
      /\/tasks\?view=all&due=set&from=/,
      address,
    );
    await expect
      .poll(() => page.evaluate(() => window.scrollY), { timeout: 15_000 })
      .toBeGreaterThan(y - 80);
    await shot(page, TAB, 'K2-returned', info);
  });

  test('K3 New Leads opens Leads at New Lead for the period (this month and last month)', async ({
    page,
  }, info) => {
    for (const [query, address] of [
      ['', '/'],
      ['?period=LAST_MONTH', '/?period=LAST_MONTH'],
    ] as const) {
      const s = await openDashboard(page, query);
      const k = s.kpis.newLeads!;
      await expect(cardValue(page, 'New Leads')).toHaveText(String(k.value));
      const href = `/leads?stage=SUBMITTED&from=${s.range.from}&to=${s.range.to}&back=dashboard`;
      await expect(card(page, 'New Leads')).toHaveAttribute('href', href);
      await roundTrip(
        page,
        card(page, 'New Leads'),
        /\/leads\?stage=SUBMITTED&from=/,
        address,
        async () => {
          await expect(page.getByRole('combobox', { name: 'All Lead Statuses' })).toHaveValue(
            'SUBMITTED',
            {
              timeout: 60_000,
            },
          );
          expect(await shownTotal(page), `New Leads ${s.range.period}`).toBe(k.value);
          await shot(page, TAB, `K3-leads-${s.range.period}`, info);
        },
      );
    }
  });

  test('K4 In Progress keeps the period: today and a past period open the returns they count', async ({
    page,
  }, info) => {
    for (const [query, address] of [
      ['', '/'],
      ['?period=LAST_YEAR', '/?period=LAST_YEAR'],
    ] as const) {
      const s = await openDashboard(page, query);
      const c = s.serviceCards.find(
        (x) => x.link.list === 'tax-returns' && x.link.query['workflowGroup'] === 'IN_PROGRESS',
      );
      if (!c) {
        note(
          info,
          'fixture',
          'no In Progress card in Settings > Dashboard Cards: the pipeline stage is checked',
        );
      } else {
        await expect(card(page, c.label)).toHaveAttribute('href', serviceHref(c));
        if (s.range.to < s.today)
          expect(c.link.query['asOf'], 'a past period reads the history').toBe(s.range.to);
        await roundTrip(
          page,
          card(page, c.label),
          /\/tax-returns\?status=IN_PROGRESS/,
          address,
          async () => {
            await expect(page.getByRole('combobox', { name: 'Status' }).first()).toHaveValue(
              'IN_PROGRESS',
              {
                timeout: 60_000,
              },
            );
            if (s.range.to < s.today) await expect(page.getByTestId('as-of-filter')).toBeVisible();
            expect(await shownTotal(page), `${c.label} ${s.range.period}`).toBe(c.value);
            await shot(page, TAB, `K4-${s.range.period}`, info);
          },
        );
      }
    }
    const s = await openDashboard(page);
    const stage = widget(page, 'Client Pipeline').getByRole('link', { name: /^In Progress: / });
    await roundTrip(
      page,
      stage,
      /\/tax-returns\?status=IN_PROGRESS&back=dashboard$/,
      '/',
      async () => {
        expect(await shownTotal(page), 'the open-now stage').toBe(s.pipeline.inProgress ?? 0);
      },
    );
  });

  test('K5 Accepted Returns counts and opens Accepted only', async ({ page }, info) => {
    const s = await openDashboard(page);
    await expect(page.getByText('Completed Returns')).toHaveCount(0);
    const c = s.serviceCards.find(
      (x) => x.link.list === 'tax-returns' && x.link.query['workflowStatus'] === 'ACCEPTED',
    );
    if (!c)
      note(
        info,
        'fixture',
        'no Accepted card in Settings > Dashboard Cards: the pipeline stage is checked',
      );
    else {
      await expect(card(page, c.label)).toHaveAttribute('href', serviceHref(c));
      await roundTrip(
        page,
        card(page, c.label),
        /\/tax-returns\?status=ACCEPTED&acceptedFrom=/,
        '/',
        async () => {
          await expect(page.getByRole('combobox', { name: 'Status' }).first()).toHaveValue(
            'ACCEPTED',
            {
              timeout: 60_000,
            },
          );
          await expect(page.getByTestId('accepted-filter')).toContainText('Accepted');
          expect(await shownTotal(page)).toBe(c.value);
          await shot(page, TAB, 'K5-accepted', info);
        },
      );
    }
    const stage = widget(page, 'Client Pipeline').getByRole('link', { name: /^Accepted: / });
    await expect(stage).toHaveAttribute(
      'href',
      `/tax-returns?status=ACCEPTED&acceptedFrom=${s.pipeline.from}&acceptedTo=${s.pipeline.to}&back=dashboard`,
    );
    await roundTrip(page, stage, /\/tax-returns\?status=ACCEPTED/, '/', async () => {
      expect(await shownTotal(page)).toBe(s.pipeline.completed ?? 0);
    });
  });

  test('K6 Outstanding Invoices: every unpaid balance, the list adds up to the card', async ({
    page,
  }, info) => {
    const s = await openDashboard(page);
    const k = s.kpis.outstandingInvoicesCents!;
    await expect(cardValue(page, 'Outstanding Invoices')).toHaveText(money(k.value));
    await expect(card(page, 'Outstanding Invoices')).toHaveAttribute(
      'href',
      '/invoices?status=OUTSTANDING&back=dashboard',
    );
    await roundTrip(
      page,
      card(page, 'Outstanding Invoices'),
      /\/invoices\?status=OUTSTANDING/,
      '/',
      async () => {
        await expect(page.getByTestId('invoice-list').getByLabel('Status')).toHaveValue(
          'OUTSTANDING',
          {
            timeout: 60_000,
          },
        );
        await settled(page);
        if (k.value === 0) {
          await expect(page.getByTestId('outstanding-total')).toHaveCount(0);
        } else {
          const total = page.getByTestId('outstanding-total');
          await expect(total).toContainText('outstanding');
          const shown = (await total.innerText()).split('·')[1] ?? '';
          expect(sameMoney(shown, k.value), `list ${shown.trim()} vs card ${money(k.value)}`).toBe(
            true,
          );
        }
        await shot(page, TAB, 'K6-outstanding', info);
      },
    );
  });

  test("K7 Appointments Today and View Calendar open the firm's today", async ({ page }, info) => {
    const s = await openDashboard(page);
    const k = s.kpis.appointmentsToday!;
    const c = card(page, 'Appointments Today');
    await expect(cardValue(page, 'Appointments Today')).toHaveText(String(k.value));
    const view = c.getByRole('link', { name: 'View Calendar' });
    await expect(view).toHaveAttribute('href', '/calendar/today?back=dashboard');
    await roundTrip(page, view, /\/calendar\/today\?back=dashboard$/, '/', async () => {
      const today = page.getByTestId('today-schedule');
      await expect(today).toBeVisible({ timeout: 60_000 });
      await settled(page);
      const entries =
        (await today.locator('a[href*="/calendar/"]').count()) +
        (await today.getByText(/· Busy \(/).count());
      expect(entries, `today ${s.today}`).toBe(k.value);
      if (!k.value) await expect(today).toContainText('Nothing is booked today.');
      await shot(page, TAB, 'K7-today', info);
    });
  });

  // ------------------------------------------------------------ 4 Trends

  test('K8 each trend is the change against the equivalent period, in words', async ({
    page,
  }, info) => {
    for (const query of ['', '?period=LAST_MONTH', '?period=LAST_YEAR']) {
      const s = await openDashboard(page, query);
      for (const f of FIXED) {
        const k = s.kpis[f.key];
        if (!k || !f.favour) continue;
        await expect(
          card(page, f.label).getByTestId('kpi-trend'),
          `${f.label} ${s.range.period}`,
        ).toHaveText(trendWords(k, f.favour));
      }
      for (const c of s.serviceCards) {
        await expect(
          card(page, c.label).getByTestId('kpi-trend'),
          `${c.label} ${s.range.period}`,
        ).toHaveText(trendWords(c, serviceFavour(c)));
      }
      await expect(card(page, 'Total Clients').getByTestId('kpi-trend')).toContainText(
        /vs |in |no earlier/,
      );
      await expect(card(page, 'Appointments Today').getByTestId('kpi-trend')).toHaveCount(0);
      await shot(page, TAB, `K8-${s.range.period}`, info);
    }
  });

  test('V2 every period: its days, the equivalent period before, a valid Custom', async ({
    page,
  }, info) => {
    const first = await openDashboard(page);
    expectRange(first.range, first.today);
    for (const p of [
      'TODAY',
      'THIS_WEEK',
      'LAST_MONTH',
      'THIS_QUARTER',
      'THIS_YEAR',
      'LAST_YEAR',
    ]) {
      const s = await pickPeriod(page, 'Dashboard period', p);
      expect(s.range.period).toBe(p);
      expectRange(s.range, s.today);
      const k = s.kpis.totalClients;
      if (k)
        await expect(card(page, 'Total Clients').getByTestId('kpi-trend')).toHaveText(
          trendWords(k, 'up'),
        );
    }
    // Custom: the first of last month to the 10th, compared with as many days just before.
    const { y, m } = partsOf(first.today);
    const pm = monthBefore(y, m);
    const from = dayOf(pm.y, pm.m, 1);
    const to = dayOf(pm.y, pm.m, 10);
    await page.getByRole('combobox', { name: 'Dashboard period' }).selectOption('CUSTOM');
    const dates = page.getByRole('region', { name: 'Key numbers' }).getByTestId('custom-dates');
    await dates.getByLabel('From').fill(from);
    const next = nextSummary(
      page,
      (q) => q.get('period') === 'CUSTOM' && q.get('from') === from && q.get('to') === to,
    );
    await dates.getByLabel('To').fill(to);
    const custom = await next;
    expect([custom.range.from, custom.range.to]).toEqual([from, to]);
    expectRange(custom.range, custom.today);
    note(
      info,
      'custom',
      `${from} to ${to} vs ${custom.range.previousFrom} to ${custom.range.previousTo}`,
    );
    await shot(page, TAB, 'V2-custom', info);
  });

  test('Color system: every trend and status says it in words, never colour alone', async ({
    page,
  }, info) => {
    await openDashboard(page, '?period=LAST_MONTH');
    const trends = page.getByTestId('kpi-trend');
    const n = await trends.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      await expect(trends.nth(i)).toHaveText(/(N\/A|New|No change|(Up|Down) \d+%)/);
    }
    // An arrow's direction and its good or bad are words for a screen reader too.
    const arrows = page.locator('[data-testid="kpi-trend"] .sr-only');
    for (let i = 0; i < (await arrows.count()); i++) {
      await expect(arrows.nth(i)).toHaveText(/^\s*(Up|Down|, favourable|, unfavourable)\s*$/);
    }
    await shot(page, TAB, 'color-system', info);
  });

  // ------------------------------------------------------------ 5 Client Pipeline

  test('C5 each stage opens its list; Intake opens Not Finished as the selected filter', async ({
    page,
  }, info) => {
    const s = await openDashboard(page);
    const pipe = widget(page, 'Client Pipeline');
    const intake = pipe.getByRole('link', { name: /^Intake: / });
    await expect(intake).toHaveAttribute('href', '/intake-forms?tab=open&back=dashboard');
    await roundTrip(page, intake, /\/intake-forms\?tab=open&back=dashboard$/, '/', async () => {
      await expect(page.getByRole('tab', { name: 'Not Finished' })).toHaveAttribute(
        'aria-selected',
        'true',
        {
          timeout: 60_000,
        },
      );
      await expect(page.getByRole('tab', { name: 'All Forms' })).toHaveAttribute(
        'aria-selected',
        'false',
      );
      await expect(page.getByTestId('not-finished-filter')).toBeVisible();
      expect(await shownTotal(page), 'Intake').toBe(s.pipeline.intake ?? 0);
      await shot(page, TAB, 'C5-intake', info);
    });
    const leads = pipe.getByRole('link', { name: /^Leads: / });
    await expect(leads).toHaveAttribute(
      'href',
      `/leads?stage=SUBMITTED&from=${s.pipeline.from}&to=${s.pipeline.to}&back=dashboard`,
    );
    await roundTrip(page, leads, /\/leads\?stage=SUBMITTED/, '/', async () => {
      expect(await shownTotal(page), 'Leads').toBe(s.pipeline.leads ?? 0);
    });
    // Consultation holds no records: a dash for "no data", no link.
    await expect(pipe.getByRole('link', { name: /^Consultation/ })).toHaveCount(0);
  });

  test('C6 each stage count is the list it opens, for two pipeline periods', async ({
    page,
  }, info) => {
    for (const [query, address] of [
      ['', '/'],
      ['?pipeline=LAST_MONTH', '/?pipeline=LAST_MONTH'],
    ] as const) {
      const s = await openDashboard(page, query);
      const pipe = widget(page, 'Client Pipeline');
      for (const [stage, value, url] of [
        ['Leads', s.pipeline.leads, /\/leads\?/],
        ['Intake', s.pipeline.intake, /\/intake-forms\?/],
        ['In Progress', s.pipeline.inProgress, /\/tax-returns\?status=IN_PROGRESS/],
        ['Accepted', s.pipeline.completed, /\/tax-returns\?status=ACCEPTED/],
      ] as const) {
        const link = pipe.getByRole('link', { name: new RegExp(`^${stage}: `) });
        if (value === undefined || value === null) {
          await expect(link).toHaveCount(0);
          note(info, 'no count', `${stage} (${s.pipeline.period}) has no number to open`);
          continue;
        }
        await expect(link).toHaveAccessibleName(`${stage}: ${value}. Open the list`);
        await roundTrip(page, link, url, address, async () => {
          expect(await shownTotal(page), `${stage} (${s.pipeline.period})`).toBe(value ?? 0);
        });
      }
      await shot(page, TAB, `C6-${s.pipeline.period}`, info);
    }
    note(
      info,
      'NOT LIVE',
      'C6 a source change (send an intake form): a send to a client; the counts are reconciled read-only',
    );
  });

  test('@narrow R2 NEW4 Client Pipeline Custom: the title beside its dropdown, whole date pairs below', async ({
    page,
  }, info) => {
    await openDashboard(page);
    await customLayout(page, 'Client Pipeline', info);
    await expect(widget(page, 'Client Pipeline')).toContainText(
      'Leads and Accepted follow this period; Intake and In Progress are open now.',
    );
    await widget(page, 'Client Pipeline').scrollIntoViewIfNeeded();
    await shot(page, TAB, 'R2NEW4-pipeline-custom', info);
    await expectNoSideScroll(page);
  });

  // ------------------------------------------------------------ 6 Revenue Overview, 7 Service Breakdown

  test('C2 a revenue bar shows its value on hover and opens the payments of its days', async ({
    page,
  }, info) => {
    let s = await openDashboard(page);
    if (!s.revenue?.totalCents) s = await pickPeriod(page, 'Revenue Overview period', 'QUARTER');
    const rev = s.revenue!;
    const w = widget(page, 'Revenue Overview');
    if (!rev.totalCents) {
      await expect(w).toContainText('No revenue in this period');
      note(info, 'fixture', 'no revenue this year or quarter: the honest empty state is checked');
      return;
    }
    await expect(w).toContainText(money(rev.totalCents));
    const i = rev.buckets.findIndex((b) => b.cents > 0);
    const b = rev.buckets[i]!;
    const bar = w.getByTestId('revenue-bar').nth(i);
    await bar.hover();
    await expect(bar.getByRole('tooltip')).toBeVisible();
    await expect(bar.getByRole('tooltip')).toContainText(money(b.cents));
    const link = bar.getByRole('link');
    await expect(link).toHaveAccessibleName(
      new RegExp(`: \\${money(b.cents)}\\. Open the payments$`),
    );
    await expect(link).toHaveAttribute(
      'href',
      `/invoices/payments?start=${b.from}&end=${b.to}&back=dashboard`,
    );
    await shot(page, TAB, 'C2-hover', info);
    const address = s.revenue?.period === 'YEAR' ? '/' : '/?revenue=QUARTER';
    await roundTrip(page, link, /\/invoices\/payments\?start=/, address, async () => {
      await expect(page.getByTestId('all-payments')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByLabel('From', { exact: true })).toHaveValue(b.from);
      await expect(page.getByLabel('To', { exact: true })).toHaveValue(b.to);
      await settled(page);
      const received = (await page.getByTestId('received').locator('span').innerText()).trim();
      expect(sameMoney(received, b.cents), `payments ${received} vs bar ${money(b.cents)}`).toBe(
        true,
      );
      await shot(page, TAB, 'C2-payments', info);
    });
  });

  test('C3 the revenue total is the money received: bars, services and All Payments agree', async ({
    page,
  }, info) => {
    const s = await openDashboard(page);
    const rev = s.revenue!;
    const sum = (xs: { cents: number }[]) => xs.reduce((t, x) => t + x.cents, 0);
    expect(sum(rev.buckets), 'the bars add up to the total').toBe(rev.totalCents);
    expect(sum(rev.byService), 'the services add up to the total').toBe(rev.totalCents);
    if (rev.totalCents) {
      await expect(widget(page, 'Revenue Overview')).toContainText(money(rev.totalCents));
      await expect(widget(page, 'Service Breakdown').getByTestId('service-center')).toContainText(
        money(rev.totalCents),
      );
    }
    await page.goto(app(`/invoices/payments?start=${rev.from}&end=${rev.to}&back=dashboard`));
    await expect(page.getByTestId('all-payments')).toBeVisible({ timeout: 60_000 });
    await settled(page);
    const received = (await page.getByTestId('received').locator('span').innerText()).trim();
    expect(
      sameMoney(received, rev.totalCents),
      `All Payments ${received} vs dashboard ${money(rev.totalCents)}`,
    ).toBe(true);
    await shot(page, TAB, 'C3-all-payments', info);
    note(info, 'retest', 'Reports for the same days is her own retest (docs/qa/dashboard.md, V1)');
  });

  test('@narrow R2 NEW3 Revenue Overview Custom: the title beside its dropdown, whole date pairs below', async ({
    page,
  }, info) => {
    await openDashboard(page);
    await customLayout(page, 'Revenue Overview', info);
    await widget(page, 'Revenue Overview').scrollIntoViewIfNeeded();
    await shot(page, TAB, 'R2NEW3-revenue-custom', info);
    await expectNoSideScroll(page);
  });

  test("C4 a service's line shows its amount and opens that service's payments", async ({
    page,
  }, info) => {
    const s = await openDashboard(page);
    const rev = s.revenue!;
    const w = widget(page, 'Service Breakdown');
    if (!rev.byService.length) {
      await expect(w).toContainText('No revenue in this period');
      note(info, 'fixture', 'no revenue this year: the empty state is checked');
      return;
    }
    const svc = rev.byService[0]!;
    const name = svc.name ?? 'Other';
    const line = w.getByRole('link', { name: new RegExp(`^${escapeRe(name)}: `) }).first();
    await line.hover();
    await expect(w.getByTestId('service-center')).toContainText(money(svc.cents));
    await expect(w.getByTestId('service-center')).toContainText(name);
    await expect(line).toHaveAttribute(
      'href',
      `/invoices/payments?start=${rev.from}&end=${rev.to}&service=${svc.serviceId ?? 'NONE'}&back=dashboard`,
    );
    await shot(page, TAB, 'C4-hover', info);
    await roundTrip(page, line, /\/invoices\/payments\?.*service=/, '/', async () => {
      await expect(page.getByTestId('service-filter')).toBeVisible({ timeout: 60_000 });
      await settled(page);
      const received = (await page.getByTestId('received').locator('span').innerText()).trim();
      expect(sameMoney(received, svc.cents), `${name}: ${received} vs ${money(svc.cents)}`).toBe(
        true,
      );
      await shot(page, TAB, 'C4-payments', info);
    });
  });

  test("V3 totals, hover values and each service's share agree with the money", async ({
    page,
  }, info) => {
    const s = await openDashboard(page);
    const rev = s.revenue!;
    const total = rev.byService.reduce((t, x) => t + x.cents, 0);
    const w = widget(page, 'Service Breakdown');
    for (const svc of rev.byService) {
      const name = svc.name ?? 'Other';
      const pct = Math.round((svc.cents / total) * 100);
      await expect(
        w.getByRole('link', { name: `${name}: ${money(svc.cents)}, ${pct}%. Open the payments` }),
      ).toHaveCount(1);
    }
    const bars = widget(page, 'Revenue Overview').getByTestId('revenue-bar');
    await expect(bars).toHaveCount(rev.buckets.length);
    for (const [i, b] of rev.buckets.entries()) {
      await expect(bars.nth(i).getByRole('link')).toHaveAccessibleName(
        new RegExp(`: \\${money(b.cents)}\\. Open the payments$`),
      );
    }
    await shot(page, TAB, 'V3-revenue', info);
  });

  test('@narrow R2 NEW5 Service Breakdown Custom: the title beside its dropdown, whole date pairs below', async ({
    page,
  }, info) => {
    await openDashboard(page);
    await customLayout(page, 'Service Breakdown', info);
    await widget(page, 'Service Breakdown').scrollIntoViewIfNeeded();
    await shot(page, TAB, 'R2NEW5-services-custom', info);
    await expectNoSideScroll(page);
  });

  test('DATA1 Intake is Not Finished; Other is the money of invoices with no service', async ({
    page,
  }, info) => {
    const s = await openDashboard(page);
    await roundTrip(
      page,
      widget(page, 'Client Pipeline').getByRole('link', { name: /^Intake: / }),
      /\/intake-forms\?tab=open/,
      '/',
      async () => {
        await expect(page.getByTestId('not-finished-filter')).toContainText(
          'Not finished: sent, in progress, to correct, submitted or under review',
        );
        expect(await shownTotal(page)).toBe(s.pipeline.intake ?? 0);
      },
    );
    const other = s.revenue?.byService.find((x) => x.serviceId === null);
    if (!other) {
      note(info, 'fixture', 'no Other revenue this year: its link is not checked');
      return;
    }
    const line = widget(page, 'Service Breakdown').getByRole('link', { name: /^Other: / });
    await roundTrip(page, line, /service=NONE/, '/', async () => {
      await expect(page.getByTestId('service-filter')).toContainText(
        'Payments on invoices of no service',
      );
      await settled(page);
      const received = (await page.getByTestId('received').locator('span').innerText()).trim();
      expect(sameMoney(received, other.cents)).toBe(true);
      await shot(page, TAB, 'DATA1-other', info);
    });
  });

  // ------------------------------------------------------------ 8 Recent Messages

  test('T1 message previews: the latest threads, their unread counts, each opens its conversation', async ({
    page,
  }, info) => {
    const inbox = nextJson<{ items: Thread[] }>(page, 'business/message-threads');
    await openDashboard(page);
    const threads = (await inbox).items;
    const w = widget(page, 'Recent Messages');
    await expect(w.getByRole('link', { name: 'View All' })).toHaveAttribute(
      'href',
      '/messages?from=%2F',
    );
    if (!threads.length) {
      await expect(w).toContainText('No messages yet');
      note(info, 'fixture', 'Test Firm B has no message threads');
      return;
    }
    const rows = w.getByRole('listitem');
    await expect(rows).toHaveCount(threads.length);
    for (const [i, t] of threads.entries()) {
      const row = rows.nth(i);
      await expect(row).toContainText(t.client.displayName);
      await expect(row.getByRole('link')).toHaveAttribute(
        'href',
        `/clients/${t.client.id}/messages?from=%2F`,
      );
      if (t.unreadCount) await expect(row).toContainText(`${t.unreadCount} unread`);
      else await expect(row).not.toContainText('unread');
    }
    await shot(page, TAB, 'T1-messages', info);
    const read = threads.findIndex((t) => !t.unreadCount);
    if (read < 0) {
      note(
        info,
        'NOT LIVE',
        'T1 opening a preview: every thread has unread messages (opening one would read them)',
      );
      return;
    }
    const t = threads[read]!;
    await roundTrip(
      page,
      rows.nth(read).getByRole('link'),
      new RegExp(`/clients/${t.client.id}/messages\\?from=%2F`),
      '/',
      async () => {
        await expect(page.locator('main')).toContainText(t.client.displayName, { timeout: 60_000 });
      },
    );
  });

  // ------------------------------------------------------------ 9 Tasks Due (read only here)

  test('T2 Tasks Due and its View All list the same tasks', async ({ page }, info) => {
    const s = await openDashboard(page);
    const due = s.tasksDue ?? [];
    const w = widget(page, 'Tasks Due');
    if (!due.length) await expect(w).toContainText('No tasks due');
    else await expect(w.getByTestId('task-title')).toHaveText(due.map((t) => t.title));
    await roundTrip(
      page,
      w.getByRole('link', { name: 'View All' }),
      /\/tasks\?view=all&due=set&from=%2F$/,
      '/',
      async () => {
        await expect(page.getByRole('tab', { name: 'All Tasks' })).toHaveAttribute(
          'aria-selected',
          'true',
          {
            timeout: 60_000,
          },
        );
        await expect(page.getByTestId('due-set-filter')).toBeVisible();
        await settled(page);
        const listed = await page.getByTestId('task-link').allInnerTexts();
        for (const t of due)
          expect(
            listed.map((x) => x.trim()),
            `View All lists ${t.title}`,
          ).toContain(t.title);
        await shot(page, TAB, 'T2-view-all', info);
      },
    );
  });

  test('R2 NEW7 Tasks from the dashboard says Back to Dashboard; from the sidebar, no origin', async ({
    page,
  }, info) => {
    await openDashboard(page);
    await widget(page, 'Tasks Due').getByRole('link', { name: 'View All' }).click();
    await expect(page).toHaveURL(/\/tasks\?view=all&due=set&from=%2F$/, { timeout: 60_000 });
    await expect(page.getByTestId('back-to-origin')).toHaveText('Back to Dashboard');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(0);
    await shot(page, TAB, 'R2NEW7-from-dashboard', info);
    await page.goto(app('/tasks'));
    await expect(page.getByTestId('tasks-page')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('back-to-origin')).toHaveCount(0);
    await expect(page.getByTestId('due-set-filter')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'My Tasks' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('T7 a new task is all day until All Day is off; then the due time is set (not saved)', async ({
    page,
  }, info) => {
    const s = await openDashboard(page);
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByRole('menuitem', { name: 'New task' }).click();
    await expect(page).toHaveURL(/\/tasks\/new\?from=%2F$/, { timeout: 60_000 });
    const allDay = page.getByRole('checkbox', { name: 'All Day' });
    const time = page.locator('#tf-time');
    await expect(allDay).toBeChecked({ timeout: 60_000 });
    await expect(time).toBeDisabled();
    await expect(page.getByTestId('due-rule')).toContainText(
      'All day: due by the end of the due date.',
    );
    await page.locator('#tf-due').fill(addDays(s.today, 7));
    await allDay.uncheck();
    await expect(time).toBeEnabled();
    await expect(page.getByTestId('due-rule')).toContainText('Due at that time on the due date.');
    note(info, 'starting time', await time.locator('option:checked').innerText());
    await shot(page, TAB, 'T7-due-time', info);
    expect(held.filter((h) => h.startsWith('POST business/tasks'))).toEqual([]);
  });

  // ------------------------------------------------------------ 10 Upcoming Appointments

  test('A1 Upcoming Appointments lists the scheduled ones; View All opens Appointments', async ({
    page,
  }, info) => {
    const appts = nextJson<{ items: Appt[] }>(page, 'business/appointments');
    await openDashboard(page);
    const items = upcomingOf((await appts).items);
    const w = widget(page, 'Upcoming Appointments');
    const rows = w.getByTestId('upcoming-row');
    if (!items.length) {
      await expect(w).toContainText('No upcoming appointments');
      note(
        info,
        'fixture',
        'no scheduled appointment in the next two weeks: the QA seed needs a re-run (A1, A4)',
      );
    } else {
      const n = await rows.count();
      expect(n, 'the next two weeks, at most what the API sent').toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(items.length);
      await expect(rows.first()).toContainText(items[0]!.client?.displayName ?? '');
    }
    await shot(page, TAB, 'A1-upcoming', info);
    await roundTrip(page, w.getByRole('link', { name: 'View All' }), /\/calendar\?from=%2F$/, '/');
  });

  test('A2 a row opens that exact appointment', async ({ page }, info) => {
    const appts = nextJson<{ items: Appt[] }>(page, 'business/appointments');
    await openDashboard(page);
    const items = upcomingOf((await appts).items);
    test.skip(!items.length, 'no upcoming appointment (the QA seed needs a re-run)');
    const a = items[0]!;
    const link = widget(page, 'Upcoming Appointments')
      .getByTestId('upcoming-row')
      .first()
      .getByRole('link')
      .first();
    await expect(link).toHaveAttribute('href', `/calendar/${a.id}?from=%2F`);
    await roundTrip(page, link, new RegExp(`/calendar/${a.id}\\?from=%2F`), '/', async () => {
      if (a.client?.displayName)
        await expect(page.locator('main')).toContainText(a.client.displayName, { timeout: 60_000 });
      await shot(page, TAB, 'A2-appointment', info);
    });
  });

  test('A3 the row menu offers every action to the Owner; Cancel asks first and Keep It changes nothing', async ({
    page,
  }, info) => {
    const appts = nextJson<{ items: Appt[] }>(page, 'business/appointments');
    await openDashboard(page);
    const items = upcomingOf((await appts).items);
    test.skip(!items.length, 'no upcoming appointment (the QA seed needs a re-run)');
    const w = widget(page, 'Upcoming Appointments');
    const button = w.getByRole('button', { name: /^Actions for / }).first();
    await button.click();
    await expect(page.getByRole('menuitem')).toHaveText(fullMenu(items[0]!));
    await shot(page, TAB, 'A3-menu', info);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem')).toHaveCount(0);
    await expect(button).toBeFocused();
    await button.click();
    await page.getByRole('menuitem', { name: 'Cancel' }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancel Appointment' });
    await expect(dialog).toContainText('They are told');
    await shot(page, TAB, 'A3-cancel-asks', info);
    await dialog.getByRole('button', { name: 'Keep It' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(w.getByTestId('upcoming-row').first()).toBeVisible();
    expect(
      held.filter((h) => /appointments/.test(h)),
      'Keep It sends nothing',
    ).toEqual([]);
  });

  test('A4 a long list scrolls inside its panel and the keyboard reaches every row', async ({
    page,
  }, info) => {
    await openDashboard(page);
    const list = widget(page, 'Upcoming Appointments').getByTestId('upcoming-list');
    const rows = list.getByTestId('upcoming-row');
    const n = await rows.count();
    test.skip(!n, 'no upcoming appointment (the QA seed needs a re-run)');
    await expect(list).toHaveAttribute('tabindex', '0');
    await list.focus();
    await expect(list).toBeFocused();
    const { scroll, client } = await list.evaluate((el) => ({
      scroll: el.scrollHeight,
      client: el.clientHeight,
    }));
    if (scroll > client + 1) {
      await page.keyboard.press('End');
      await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      await rows
        .last()
        .getByRole('button', { name: /^Actions for / })
        .focus();
      await expect(rows.last().getByRole('button', { name: /^Actions for / })).toBeInViewport();
    } else note(info, 'fixture', `${n} rows fit without scrolling`);
    note(info, 'rows', String(n));
    await shot(page, TAB, 'A4-long-list', info);
  });

  // ------------------------------------------------------------ 11 Quick actions

  test('Q1 Add Client opens the blank Add New Client form', async ({ page }, info) => {
    await openDashboard(page);
    const actions = page.getByRole('region', { name: 'Quick actions' });
    await expect(actions.getByRole('link', { name: 'Add Client' })).toHaveAttribute(
      'href',
      '/clients?new=1&back=dashboard',
    );
    await actions.getByRole('link', { name: 'Add Client' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add New Client' });
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByLabel('Full name *')).toHaveValue('');
    await shot(page, TAB, 'Q1-add-client', info);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('Q2 Send Message opens a fresh message with no recipient', async ({ page }, info) => {
    await openDashboard(page);
    const link = page
      .getByRole('region', { name: 'Quick actions' })
      .getByRole('link', { name: 'Send Message' });
    await expect(link).toHaveAttribute('href', '/messages/new?from=%2F');
    await link.click();
    await expect(page).toHaveURL(/\/messages\/new\?from=%2F$/, { timeout: 60_000 });
    await expect(page.getByTestId('compose')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('compose').getByLabel('Message')).toHaveValue('');
    await expect(page.getByTestId('compose-count')).toContainText('Characters: 0');
    await shot(page, TAB, 'Q2-send-message', info);
  });

  test('Q3 Create Bulk Email opens the composer itself; nothing is saved or sent on open', async ({
    page,
  }, info) => {
    await openDashboard(page);
    const link = page
      .getByRole('region', { name: 'Quick actions' })
      .getByRole('link', { name: 'Create Bulk Email' });
    await expect(link).toHaveAttribute('href', '/communications/new?channel=EMAIL&from=%2F');
    await link.click();
    await expect(page.getByTestId('composer-form')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('save-state')).toHaveText('Not saved yet');
    await expect(page.getByTestId('back-to-origin')).toHaveText('Back to Dashboard');
    await page.waitForTimeout(3_000);
    await expect(page).toHaveURL(/\/communications\/new\?channel=EMAIL&from=%2F$/);
    expect(
      held.filter((h) => /communication|campaign/.test(h)),
      'no draft, no send',
    ).toEqual([]);
    await shot(page, TAB, 'Q3-composer', info);
  });

  test('Q4 Generate an Invoice opens a blank invoice', async ({ page }, info) => {
    await openDashboard(page);
    const link = page
      .getByRole('region', { name: 'Quick actions' })
      .getByRole('link', { name: 'Create Invoice' });
    await expect(link).toHaveAttribute('href', '/invoices/new?from=%2F');
    await link.click();
    await expect(page.getByTestId('invoice-editor')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('invoice-total').first()).toContainText('$0');
    await shot(page, TAB, 'Q4-invoice', info);
  });

  test('Q5 Upload Documents opens the secure upload, which asks for the client first', async ({
    page,
  }, info) => {
    await openDashboard(page);
    const link = page
      .getByRole('region', { name: 'Quick actions' })
      .getByRole('link', { name: 'Upload Now' });
    await expect(link).toHaveAttribute('href', '/documents/upload?from=%2F');
    await link.click();
    const upload = page.getByTestId('upload-document');
    await expect(upload).toBeVisible({ timeout: 60_000 });
    await expect(upload.getByText(/client/i).first()).toBeVisible();
    await shot(page, TAB, 'Q5-upload', info);
    expect(held.filter((h) => /document|upload/.test(h))).toEqual([]);
  });

  test('D1 Add Client as a Business: the business labels, and an empty form is refused', async ({
    page,
  }, info) => {
    await page.goto(app('/clients?new=1&back=dashboard'));
    const dialog = page.getByRole('dialog', { name: 'Add New Client' });
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await dialog.getByLabel('Client type *').selectOption({ label: 'Business' });
    for (const label of ['Business name *', 'Business email *', 'Business phone *']) {
      await expect(dialog.getByLabel(label)).toBeVisible();
    }
    await expect(dialog).toContainText('Business address');
    await dialog.getByRole('button', { name: 'Add Client' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Business name *')).toHaveAttribute('aria-invalid', 'true');
    // Refused on the page: the form never even tried to save.
    expect(held.filter((h) => h.startsWith('POST business/clients'))).toEqual([]);
    await shot(page, TAB, 'D1-business-refused', info);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });

  // ------------------------------------------------------------ 13 Customization

  test("D4 the service cards are the firm's Settings > Dashboard Cards; each opens what it counts", async ({
    page,
  }, info) => {
    await page.goto(app('/settings/dashboard-cards'));
    const screen = page.getByTestId('dashboard-cards');
    await expect(screen).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByTestId('using-defaults').or(page.getByTestId('card-row')).first(),
    ).toBeVisible({ timeout: 60_000 });
    const defaults = await page.getByTestId('using-defaults').isVisible();
    const rows = page.getByTestId('card-row');
    const enabled: string[] = [];
    for (let i = 0; i < (await rows.count()); i++) {
      const text = await rows.nth(i).innerText();
      if (!text.includes('(off)')) enabled.push(text);
    }
    await shot(page, TAB, 'D4-settings', info);
    const s = await openDashboard(page);
    const labels = s.serviceCards.map((c) => c.label);
    if (defaults) expect(labels).toEqual(['Returns In Progress', 'Accepted Returns']);
    else {
      expect(labels.length).toBe(enabled.length);
      for (const [i, l] of labels.entries()) expect(enabled[i], `card ${i + 1}`).toContain(l);
    }
    for (const c of s.serviceCards) {
      await expect(cardValue(page, c.label)).toHaveText(String(c.value));
      await roundTrip(
        page,
        card(page, c.label),
        new RegExp(`/${c.link.list}\\?`),
        '/',
        async () => {
          expect(await shownTotal(page), `${c.label} opens the ${c.value} it counts`).toBe(c.value);
        },
      );
    }
    note(
      info,
      'NOT LIVE',
      'D4 changing a card (label, order, on/off) is a firm-wide setting: read only here',
    );
  });

  test('D5 the fixed cards stay in place; tax cards count Accepted, never a made-up status', async ({
    page,
  }, info) => {
    const s = await openDashboard(page);
    const order = s.serviceCards.map((c) => c.label);
    await expect(page.getByTestId('kpi-card')).toHaveCount(4 + order.length);
    const texts = await page.getByTestId('kpi-card').allInnerTexts();
    const expected = [
      'Total Clients',
      'New Leads',
      ...order,
      'Outstanding Invoices',
      'Appointments Today',
    ];
    for (const [i, label] of expected.entries()) expect(texts[i], `card ${i + 1}`).toContain(label);
    for (const c of s.serviceCards.filter((x) => x.link.list === 'tax-returns')) {
      const status = c.link.query['workflowGroup'] ?? c.link.query['workflowStatus'];
      expect(status, c.label).toBeTruthy();
      if (/accepted/i.test(c.label)) expect(status).toBe('ACCEPTED');
    }
    await expect(page.getByText(/Completed Returns/)).toHaveCount(0);
    await shot(page, TAB, 'D5-cards', info);
  });

  // ------------------------------------------------------------ 14 Periods

  test('C1 the period controls: each period applies; a bad Custom pair is explained and not applied', async ({
    page,
  }, info) => {
    const s = await openDashboard(page);
    for (const p of ['LAST_MONTH', 'THIS_QUARTER', 'THIS_YEAR', 'LAST_YEAR']) {
      const picked = await pickPeriod(page, 'Dashboard period', p);
      await expect(page).toHaveURL(app(`/?period=${p}`));
      await expect(card(page, 'New Leads')).toHaveAttribute(
        'href',
        new RegExp(`from=${picked.range.from}&to=${picked.range.to}&`),
      );
    }
    // This Month again: the page already holds its numbers (no new call).
    const select = page.getByRole('combobox', { name: 'Dashboard period' });
    await select.selectOption('THIS_MONTH');
    await expect(page).toHaveURL(app('/'));
    await loaded(page);
    await expect(card(page, 'New Leads')).toHaveAttribute(
      'href',
      new RegExp(`from=${s.range.from}&to=${s.range.to}&`),
    );
    await select.selectOption('CUSTOM');
    const dates = page.getByRole('region', { name: 'Key numbers' }).getByTestId('custom-dates');
    await dates.getByLabel('From').fill(s.today);
    await dates.getByLabel('To').fill(addDays(s.today, -1));
    await expect(dates.getByRole('alert')).toHaveText(
      'The end date must be on or after the start date.',
    );
    await expect(page).toHaveURL(app('/'));
    await dates.getByLabel('From').fill(addDays(s.today, -3));
    await dates.getByLabel('To').fill(addDays(s.today, 1));
    await expect(dates.getByRole('alert')).toHaveText('The end date cannot be after today.');
    await expect(page).toHaveURL(app('/'));
    await shot(page, TAB, 'C1-custom-refused', info);
    const next = nextSummary(page, (q) => q.get('period') === 'CUSTOM');
    await dates.getByLabel('To').fill(s.today);
    const custom = await next;
    expect([custom.range.from, custom.range.to]).toEqual([addDays(s.today, -3), s.today]);
    await expect(page).toHaveURL(
      app(`/?period=CUSTOM&start=${addDays(s.today, -3)}&end=${s.today}`),
    );
  });

  test('@narrow OPT1 Custom with a blank date says what applies it, and the period shown stays', async ({
    page,
  }, info) => {
    const s = await openDashboard(page);
    const before = await cardValue(page, 'Total Clients').innerText();
    await page.getByRole('combobox', { name: 'Dashboard period' }).selectOption('CUSTOM');
    const dates = page.getByRole('region', { name: 'Key numbers' }).getByTestId('custom-dates');
    const hint = dates.getByTestId('custom-hint');
    await expect(hint).toHaveText(
      'Choose both dates to apply this period; until then the current one stays.',
    );
    await dates.getByLabel('From').fill(addDays(s.today, -7));
    await expect(hint).toBeVisible();
    await expect(page).toHaveURL(app('/'));
    await expect(cardValue(page, 'Total Clients')).toHaveText(before);
    await shot(page, TAB, 'OPT1-blank-cue', info);
    await expectNoSideScroll(page);
    const next = nextSummary(page, (q) => q.get('period') === 'CUSTOM');
    await dates.getByLabel('To').fill(s.today);
    await next;
    await expect(hint).toHaveCount(0);
    await expect(page).toHaveURL(
      app(`/?period=CUSTOM&start=${addDays(s.today, -7)}&end=${s.today}`),
    );
  });

  // ------------------------------------------------------------ 15 Refresh and consistency

  test('U5 a reload brings back the greeting, date, numbers and lists', async ({ page }, info) => {
    const a = await openDashboard(page);
    const heading = await page.getByTestId('page-title').innerText();
    const values = await page.getByTestId('kpi-card').allInnerTexts();
    const next = nextSummary(page);
    await page.reload();
    const b = await next;
    await loaded(page);
    await expect(page.getByTestId('page-title')).toHaveText(heading);
    expect(heading).toMatch(/^Welcome back, .+!$/);
    const date = new Intl.DateTimeFormat('en-US', {
      timeZone: b.timeZone ?? 'America/New_York',
      dateStyle: 'full',
    }).format(new Date());
    await expect(page.getByText(date, { exact: true }).first()).toBeVisible();
    expect(b.kpis).toEqual(a.kpis);
    expect(await page.getByTestId('kpi-card').allInnerTexts()).toEqual(values);
    expect((b.tasksDue ?? []).map((t) => t.id)).toEqual((a.tasksDue ?? []).map((t) => t.id));
    await shot(page, TAB, 'U5-reloaded', info);
  });

  test('V1 Total Clients, Outstanding Invoices and Appointments Today equal the lists they open (Owner)', async ({
    page,
  }, info) => {
    const s = await openDashboard(page);
    await roundTrip(page, card(page, 'Total Clients'), /\/clients\?/, '/', async () => {
      expect(await shownTotal(page), 'Total Clients').toBe(s.kpis.totalClients!.value);
    });
    await roundTrip(
      page,
      card(page, 'Outstanding Invoices'),
      /\/invoices\?status=OUTSTANDING/,
      '/',
      async () => {
        await settled(page);
        const cents = s.kpis.outstandingInvoicesCents!.value;
        if (cents) {
          const shown = (
            (await page.getByTestId('outstanding-total').innerText()).split('·')[1] ?? ''
          ).trim();
          expect(sameMoney(shown, cents), `Outstanding ${shown} vs ${money(cents)}`).toBe(true);
        } else await expect(page.getByTestId('outstanding-total')).toHaveCount(0);
      },
    );
    await roundTrip(
      page,
      card(page, 'Appointments Today').getByRole('link', { name: 'View Calendar' }),
      /\/calendar\/today/,
      '/',
      async () => {
        const today = page.getByTestId('today-schedule');
        await expect(today).toBeVisible({ timeout: 60_000 });
        await settled(page);
        const n =
          (await today.locator('a[href*="/calendar/"]').count()) +
          (await today.getByText(/· Busy \(/).count());
        expect(n, 'Appointments Today').toBe(s.kpis.appointmentsToday!.value);
      },
    );
    await shot(page, TAB, 'V1-owner', info);
    note(info, 'retest', 'Reports totals for the same days are her own retest');
  });

  // ------------------------------------------------------------ 16 States

  test('V6 a failing widget says so with Try again; the others still show; Try again recovers', async ({
    page,
  }, info) => {
    // The numbers fail: the cards and the summary's widgets say so; messages and appointments show.
    let stop = await failing(page, 'business/dashboard/summary');
    await page.goto(app('/'));
    const kpiError = page.getByTestId('kpi-error');
    await expect(kpiError).toBeVisible({ timeout: 90_000 });
    await expect(kpiError.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(widget(page, 'Tasks Due').getByRole('alert')).toBeVisible();
    for (const w of ['Recent Messages', 'Upcoming Appointments']) {
      await expect(widget(page, w)).toBeVisible({ timeout: 60_000 });
      await expect(widget(page, w).locator('[aria-busy="true"]')).toHaveCount(0, {
        timeout: 60_000,
      });
      await expect(widget(page, w).getByRole('alert')).toHaveCount(0);
    }
    await shot(page, TAB, 'V6-summary-failed', info);
    await stop();
    await kpiError.getByRole('button', { name: 'Try again' }).click();
    await expect(kpiError).toHaveCount(0, { timeout: 60_000 });
    await loaded(page);

    // One list fails: that widget says so; the numbers stay.
    for (const [path, name] of [
      ['business/message-threads', 'Recent Messages'],
      ['business/appointments', 'Upcoming Appointments'],
    ] as const) {
      stop = await failing(page, path);
      await page.reload();
      const alert = widget(page, name).getByRole('alert');
      await expect(alert).toBeVisible({ timeout: 90_000 });
      await expect(page.getByTestId('kpi-error')).toHaveCount(0);
      await expect(page.getByTestId('kpi-card').first()).not.toContainText('—');
      await shot(page, TAB, `V6-${name.replace(/\s+/g, '-')}-failed`, info);
      await stop();
      await alert.getByRole('button', { name: 'Try again' }).click();
      await expect(widget(page, name).getByRole('alert')).toHaveCount(0, { timeout: 60_000 });
    }

    // A completion and a reminder that cannot go through say so and leave things as they were
    // (both are held back in the browser; nothing reaches dev).
    const s = await openDashboard(page);
    const t = (s.tasksDue ?? [])[0];
    if (t) {
      const tasks = widget(page, 'Tasks Due');
      await tasks.getByRole('checkbox', { name: `Mark ${t.title} complete` }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Mark Complete' }).click();
      await expect(tasks.getByRole('alert')).toContainText('The task could not be marked complete');
      await expect(tasks.getByTestId('task-title').filter({ hasText: t.title })).toHaveCount(1);
      await shot(page, TAB, 'V6-task-failed', info);
    } else note(info, 'fixture', 'no task due: the failed completion is not checked');
    const rows = widget(page, 'Upcoming Appointments').getByTestId('upcoming-row');
    if (await rows.count()) {
      await rows
        .first()
        .getByRole('button', { name: /^Actions for / })
        .click();
      await page.getByRole('menuitem', { name: 'Send Reminder' }).click();
      await expect(widget(page, 'Upcoming Appointments').getByRole('status')).toContainText(
        'The reminder was not sent',
      );
      await shot(page, TAB, 'V6-reminder-failed', info);
    } else note(info, 'fixture', 'no upcoming appointment: the failed reminder is not checked');
  });

  // ------------------------------------------------------------ 17 Permissions

  test('V5 the Owner sees every number, each with its link', async ({ page }, info) => {
    const s = await openDashboard(page);
    for (const f of FIXED) expect(s.kpis[f.key], f.label).toBeDefined();
    await expect(page.getByTestId('kpi-no-access')).toHaveCount(0);
    await expect(page.getByTestId('widget-no-access')).toHaveCount(0);
    await expect(page.getByTestId('stage-no-access')).toHaveCount(0);
    for (const f of FIXED) {
      await expect(cardValue(page, f.label)).toHaveText(shownNumber(f.key, s.kpis[f.key]!));
    }
    await expect(page.getByTestId('quick-action')).toHaveCount(5);
    await shot(page, TAB, 'V5-owner', info);
  });

  // ------------------------------------------------------------ 18 Responsive and accessibility

  test('U3 the keyboard: Tab, Enter, Space and Escape on cards, menus and the task check', async ({
    page,
  }) => {
    const s = await openDashboard(page);
    await page.getByRole('combobox', { name: 'Dashboard period' }).focus();
    await page.keyboard.press('Tab');
    await expect(card(page, 'Total Clients')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/clients\?back=dashboard/, { timeout: 60_000 });
    await backToDashboard(page).click();
    await loaded(page);
    const newButton = page.getByRole('button', { name: 'New', exact: true });
    await newButton.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem').nth(1)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(newButton).toBeFocused();
    const t = (s.tasksDue ?? [])[0];
    if (t) {
      const box = widget(page, 'Tasks Due').getByRole('checkbox', {
        name: `Mark ${t.title} complete`,
      });
      await box.focus();
      await page.keyboard.press('Space');
      const dialog = page.getByRole('dialog', { name: 'Mark this task complete?' });
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      expect(
        held.filter((h) => h.includes('tasks')),
        'Escape completes nothing',
      ).toEqual([]);
    }
    const list = widget(page, 'Upcoming Appointments').getByTestId('upcoming-list');
    if (await list.count()) {
      await list.focus();
      await expect(list).toBeFocused();
    }
  });

  test('V10 a screen reader hears every value: charts, stages, trends, lists and checks have words', async ({
    page,
  }, info) => {
    const s = await openDashboard(page);
    const rev = s.revenue!;
    if (rev.totalCents) {
      await expect(
        widget(page, 'Revenue Overview').getByRole('img', { name: /^Revenue from / }),
      ).toHaveAccessibleName(`Revenue from ${rev.from} to ${rev.to}: ${money(rev.totalCents)}`);
    }
    const bars = widget(page, 'Revenue Overview').getByTestId('revenue-bar').getByRole('link');
    for (let i = 0; i < (await bars.count()); i++) {
      await expect(bars.nth(i)).toHaveAccessibleName(/: \$[\d,]+\. Open the payments$/);
    }
    for (const stage of ['Leads', 'Intake', 'In Progress', 'Accepted']) {
      await expect(
        widget(page, 'Client Pipeline').getByRole('link', {
          name: new RegExp(`^${stage}: \\d+\\. Open the list$`),
        }),
      ).toHaveCount(1);
    }
    await expect(widget(page, 'Client Pipeline').getByLabel('No data')).toHaveCount(1);
    if (await widget(page, 'Upcoming Appointments').getByTestId('upcoming-list').count()) {
      await expect(
        widget(page, 'Upcoming Appointments').getByTestId('upcoming-list'),
      ).toHaveAccessibleName('Upcoming appointments, next two weeks');
    }
    for (const t of s.tasksDue ?? []) {
      await expect(
        widget(page, 'Tasks Due').getByRole('checkbox', { name: `Mark ${t.title} complete` }),
      ).toHaveCount(1);
    }
    for (const label of ['Total Clients', 'New Leads']) {
      await expect(card(page, label).getByTestId('kpi-trend')).toHaveText(
        /(N\/A|New|No change|(Up|Down) \d+%)/,
      );
    }
    await shot(page, TAB, 'V10-names', info);
  });

  test('@narrow U4 the dashboard has no sideways scroll; cards, charts and lists stack', async ({
    page,
  }, info) => {
    await openDashboard(page);
    await shot(page, TAB, 'U4-dashboard', info);
    await expectNoSideScroll(page);
    if (narrow(info)) {
      const [a, b] = [
        (await widget(page, 'Client Pipeline').boundingBox())!,
        (await widget(page, 'Revenue Overview').boundingBox())!,
      ];
      expect(b.y, 'widgets stack at 390 px').toBeGreaterThan(a.y + a.height - 1);
    }
  });

  test('@narrow layout Last Year: a past period reads well, no sideways scroll', async ({
    page,
  }, info) => {
    await openDashboard(page, '?period=LAST_YEAR&pipeline=LAST_YEAR');
    await shot(page, TAB, 'layout-last-year', info);
    await expectNoSideScroll(page);
  });

  // ------------------------------------------------------------ 20 Security and audit

  test('V7 opening the dashboard is audited, without its numbers', async ({ page }, info) => {
    const start = new Date(Date.now() - 60_000).toISOString();
    await openDashboard(page);
    const res = await page.request.get(
      app('/api/v1/business/audit-log?action=dashboard.viewed&limit=10'),
    );
    expect(res.ok(), `audit log ${res.status()}`).toBe(true);
    const rows = ((await res.json()) as { items: AuditRow[] }).items;
    const mine = rows.find((r) => r.at >= start);
    expect(mine, 'a dashboard.viewed entry for this visit').toBeDefined();
    expect(mine!.entity.type).toBe('dashboard');
    expect(JSON.stringify(mine!.metadata), 'no numbers in the audit').not.toMatch(
      /cents|totalClients|value|kpi/i,
    );
    await page.goto(app('/audit-log'));
    await settled(page);
    await shot(page, TAB, 'V7-audit-log', info);
    note(
      info,
      'NOT LIVE',
      'V7 a client refused the dashboard (403): a portal session cannot call the firm API; the API e2e covers it',
    );
  });

  // ------------------------------------------------------------ 21 Return context and breadcrumbs

  test('V9 R2 NEW6 Back returns to the same periods and place, from a card, a list and a record', async ({
    page,
  }, info) => {
    await openDashboard(page, '?period=LAST_MONTH&revenue=QUARTER');
    const address = '/?period=LAST_MONTH&revenue=QUARTER';
    await roundTrip(
      page,
      card(page, 'Outstanding Invoices'),
      /\/invoices\?status=OUTSTANDING&back=dashboard$/,
      address,
    );
    await expect(page.getByRole('combobox', { name: 'Revenue Overview period' })).toHaveValue(
      'QUARTER',
    );
    const msgs = widget(page, 'Recent Messages');
    await msgs.scrollIntoViewIfNeeded();
    const y = await page.evaluate(() => window.scrollY);
    await roundTrip(
      page,
      msgs.getByRole('link', { name: 'View All' }),
      /\/messages\?from=%2F%3Fperiod%3DLAST_MONTH/,
      address,
    );
    await expect
      .poll(() => page.evaluate(() => window.scrollY), { timeout: 15_000 })
      .toBeGreaterThan(y - 80);
    await expect(page.getByRole('combobox', { name: 'Dashboard period' })).toHaveValue(
      'LAST_MONTH',
    );
    await shot(page, TAB, 'V9-returned', info);
  });

  test('B01 Add New Client: the form, then Back to Dashboard with the period', async ({ page }) => {
    await openDashboard(page, '?period=LAST_MONTH');
    await roundTrip(
      page,
      page.getByRole('region', { name: 'Quick actions' }).getByRole('link', { name: 'Add Client' }),
      /\/clients\?new=1&back=dashboard$/,
      '/?period=LAST_MONTH',
      async () => {
        const dialog = page.getByRole('dialog', { name: 'Add New Client' });
        await expect(dialog).toBeVisible({ timeout: 60_000 });
        await dialog.getByRole('button', { name: 'Cancel' }).click();
      },
    );
  });

  for (const [row, button, url] of [
    ['B02 Send Message', 'Send Message', /\/messages\/new\?from=%2F%3Fperiod%3DLAST_MONTH$/],
    [
      'B03 Create Bulk Email',
      'Create Bulk Email',
      /\/communications\/new\?channel=EMAIL&from=%2F%3Fperiod%3DLAST_MONTH$/,
    ],
    [
      'B04 Generate an Invoice',
      'Create Invoice',
      /\/invoices\/new\?from=%2F%3Fperiod%3DLAST_MONTH$/,
    ],
    ['B05 Upload Documents', 'Upload Now', /\/documents\/upload\?from=%2F%3Fperiod%3DLAST_MONTH$/],
  ] as const) {
    test(`${row}: the page, then Back to Dashboard with the period`, async ({ page }, info) => {
      await openDashboard(page, '?period=LAST_MONTH');
      await roundTrip(
        page,
        page.getByRole('region', { name: 'Quick actions' }).getByRole('link', { name: button }),
        url,
        '/?period=LAST_MONTH',
        async () => {
          await settled(page);
          await shot(page, TAB, row.split(' ')[0]!, info);
        },
      );
    });
  }

  test('B06 Recent Messages View All, then Back to Dashboard', async ({ page }) => {
    await openDashboard(page, '?period=LAST_MONTH');
    await roundTrip(
      page,
      widget(page, 'Recent Messages').getByRole('link', { name: 'View All' }),
      /\/messages\?from=%2F%3Fperiod%3DLAST_MONTH$/,
      '/?period=LAST_MONTH',
    );
  });

  test('B07 a message preview opens that conversation, then Back to Dashboard', async ({
    page,
  }, info) => {
    const inbox = nextJson<{ items: Thread[] }>(page, 'business/message-threads');
    await openDashboard(page, '?period=LAST_MONTH');
    const threads = (await inbox).items;
    const i = threads.findIndex((t) => !t.unreadCount);
    test.skip(
      i < 0,
      threads.length
        ? 'every thread has unread messages (opening one would read them)'
        : 'no thread',
    );
    const t = threads[i]!;
    await roundTrip(
      page,
      widget(page, 'Recent Messages').getByRole('listitem').nth(i).getByRole('link'),
      new RegExp(`/clients/${t.client.id}/messages\\?from=%2F%3Fperiod%3DLAST_MONTH$`),
      '/?period=LAST_MONTH',
      async () => {
        await expect(page.locator('main')).toContainText(t.client.displayName, { timeout: 60_000 });
        await shot(page, TAB, 'B07-conversation', info);
      },
    );
  });

  test('B08 Tasks View All, a task and its client, each with Back to Dashboard', async ({
    page,
  }) => {
    const s = await openDashboard(page, '?period=LAST_MONTH');
    const address = '/?period=LAST_MONTH';
    const w = widget(page, 'Tasks Due');
    await roundTrip(
      page,
      w.getByRole('link', { name: 'View All' }),
      /\/tasks\?view=all&due=set&from=/,
      address,
    );
    const t = (s.tasksDue ?? [])[0];
    test.skip(!t, 'no task due');
    await roundTrip(
      page,
      w.getByTestId('task-title').first(),
      new RegExp(`/tasks/${t!.id}\\?from=`),
      address,
    );
    await roundTrip(
      page,
      w.getByRole('link', { name: `Open client ${t!.client.displayName}` }).first(),
      new RegExp(`/clients/${t!.client.id}\\?from=`),
      address,
    );
  });

  test('B09 every card and stage drill-down returns to the dashboard with its periods', async ({
    page,
  }) => {
    const s = await openDashboard(page, '?period=LAST_MONTH&pipeline=THIS_YEAR');
    const address = '/?period=LAST_MONTH&pipeline=THIS_YEAR';
    for (const label of [
      'Total Clients',
      'New Leads',
      ...s.serviceCards.map((c) => c.label),
      'Outstanding Invoices',
    ]) {
      await roundTrip(page, card(page, label), /back=dashboard/, address);
    }
    for (const stage of ['Leads', 'Intake', 'In Progress', 'Accepted']) {
      await roundTrip(
        page,
        widget(page, 'Client Pipeline').getByRole('link', { name: new RegExp(`^${stage}: `) }),
        /back=dashboard/,
        address,
      );
    }
    await expect(page.getByRole('combobox', { name: 'Client Pipeline period' })).toHaveValue(
      'THIS_YEAR',
    );
  });

  test('B10 the calendar, a row and View Details each return to the dashboard', async ({
    page,
  }) => {
    const appts = nextJson<{ items: Appt[] }>(page, 'business/appointments');
    await openDashboard(page, '?period=LAST_MONTH');
    const address = '/?period=LAST_MONTH';
    await roundTrip(
      page,
      card(page, 'Appointments Today').getByRole('link', { name: 'View Calendar' }),
      /\/calendar\/today\?back=dashboard$/,
      address,
    );
    const w = widget(page, 'Upcoming Appointments');
    await roundTrip(page, w.getByRole('link', { name: 'View All' }), /\/calendar\?from=/, address);
    const items = upcomingOf((await appts).items);
    test.skip(!items.length, 'no upcoming appointment (the QA seed needs a re-run)');
    await roundTrip(
      page,
      w.getByTestId('upcoming-row').first().getByRole('link').first(),
      new RegExp(`/calendar/${items[0]!.id}\\?from=`),
      address,
    );
    await w
      .getByRole('button', { name: /^Actions for / })
      .first()
      .click();
    await roundTrip(
      page,
      page.getByRole('menuitem', { name: 'View Details' }),
      new RegExp(`/calendar/${items[0]!.id}\\?from=`),
      address,
    );
  });

  test('B11 + New keeps the way back only when it leaves the page; search adds none', async ({
    page,
  }) => {
    await openDashboard(page);
    const newButton = page.getByRole('button', { name: 'New', exact: true });
    await newButton.click();
    await page.getByRole('menuitem', { name: 'New task' }).click();
    await expect(page).toHaveURL(/\/tasks\/new\?from=%2F$/, { timeout: 60_000 });
    await expect(page.getByTestId('back-to-origin')).toHaveText('Back to Dashboard');
    await newButton.click();
    await page.getByRole('menuitem', { name: 'New task' }).click();
    await expect(page).toHaveURL(/\/tasks\/new$/, { timeout: 60_000 });
    await expect(page.getByTestId('back-to-origin')).toHaveCount(0);
    const search = page.getByLabel('Search clients, locations, or team members');
    await search.fill('QA Appointments');
    const hit = page
      .getByRole('region', { name: 'Search results' })
      .getByRole('link', { name: new RegExp(APPT_CLIENT_NAME.replace(/[()]/g, '\\$&')) })
      .first();
    await expect(hit).toHaveAttribute('href', `/clients/${APPT_CLIENT}`);
  });

  test('B12 a link from another module carries its own origin; a direct visit shows none', async ({
    page,
  }) => {
    await page.goto(app('/tasks?from=%2Fpayroll'));
    await expect(page.getByTestId('back-to-origin')).toHaveText('Back to Payroll', {
      timeout: 60_000,
    });
    await page.getByTestId('back-to-origin').click();
    await expect(page).toHaveURL(app('/payroll'), { timeout: 60_000 });
    await page.goto(app(`/tasks?from=${encodeURIComponent('https://example.com/')}`));
    await expect(page.getByTestId('tasks-page')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('back-to-origin')).toHaveCount(0);
    await page.goto(app('/tasks'));
    await expect(page.getByTestId('tasks-page')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('back-to-origin')).toHaveCount(0);
  });

  // ------------------------------------------------------------ Verified in Review 2 (regressions)

  test('U1 the header search finds a client and a team member and opens them; nonsense finds nothing', async ({
    page,
  }, info) => {
    const s = await openDashboard(page);
    expect(s.today).toBeTruthy();
    const search = page.getByLabel('Search clients, locations, or team members');
    const results = page.getByRole('region', { name: 'Search results' });
    await search.fill('Zzzq');
    await expect(results).toContainText('No matches.', { timeout: 30_000 });
    await search.fill('QA Appointments');
    const client = results
      .getByRole('link', { name: new RegExp(APPT_CLIENT_NAME.replace(/[()]/g, '\\$&')) })
      .first();
    await expect(client).toBeVisible({ timeout: 30_000 });
    await shot(page, TAB, 'U1-search', info);
    await client.click();
    await expect(page).toHaveURL(new RegExp(`/clients/${APPT_CLIENT}`), { timeout: 60_000 });
    await openDashboard(page);
    const first = (await page.getByTestId('page-title').innerText())
      .replace(/^Welcome back, |!$/g, '')
      .trim();
    await search.fill(first);
    const member = results.locator('a[href^="/team/"]').first();
    await expect(member).toBeVisible({ timeout: 30_000 });
    await member.click();
    await expect(page).toHaveURL(/\/team\/[^/?]+/, { timeout: 60_000 });
  });

  test('D2 Help & Support offers its channels and sends nothing on open', async ({
    page,
  }, info) => {
    await openDashboard(page);
    await page.getByRole('button', { name: 'Help & Support' }).click();
    const help = page.getByRole('dialog', { name: 'Help & Support' });
    await expect(help).toBeVisible();
    await expect(help).toContainText('Nothing is sent until you press Send.');
    await expect(help.getByRole('link', { name: /Call Firmivra/ })).toHaveAttribute(
      'href',
      /^tel:/,
    );
    await expect(help.getByRole('link', { name: /Contact Support/ })).toHaveAttribute(
      'href',
      /^mailto:/,
    );
    await expect(help.getByRole('heading', { name: 'Common Questions' })).toBeVisible();
    await shot(page, TAB, 'D2-help', info);
    expect(
      held.filter((h) => /support|help/i.test(h)),
      'opening Help sends nothing',
    ).toEqual([]);
  });
});

// ================================================================ U2: a browser far from the firm
test.describe('Dashboard (Owner, a browser in another time zone)', () => {
  test.use({ ...as('owner'), timezoneId: 'Pacific/Kiritimati' });
  test.skip(() => !hasLogin('owner'), 'no owner login');
  test.beforeEach(async ({ page }) => {
    await readOnly(page);
  });

  test("U2 the header clock and the dashboard's date follow Settings > Preferences, not the browser", async ({
    page,
  }, info) => {
    const firm = nextJson<FirmSettings>(page, 'business/settings');
    await page.goto(app('/settings/preferences'));
    const settings = await firm;
    await expect(page.getByLabel('Time Zone')).toHaveValue(settings.timezone, { timeout: 60_000 });
    await shot(page, TAB, 'U2-preferences', info);
    const s = await openDashboard(page);
    expect(s.timeZone ?? settings.timezone).toBe(settings.timezone);
    expect(s.today, "the firm's today").toBe(firmToday(settings.timezone));
    const clock = page.getByTestId('header-clock');
    await expect(clock).toHaveAttribute('title', `Time zone: ${settings.timezone}`);
    await expect(page.getByTestId('header-clock-note')).toHaveCount(0);
    await expect(clock).toContainText(zoneName(settings.timezone));
    if (settings.timezone !== 'Pacific/Kiritimati')
      await expect(clock).not.toContainText(zoneName('Pacific/Kiritimati'));
    const date = new Intl.DateTimeFormat('en-US', {
      timeZone: settings.timezone,
      dateStyle: 'full',
    }).format(new Date());
    await expect(page.getByText(date, { exact: true }).first()).toBeVisible();
    note(info, 'zone', `${settings.timezone}, browser Pacific/Kiritimati, today ${s.today}`);
    note(
      info,
      'NOT LIVE',
      'U2 saving another time zone in Preferences: a firm-wide setting; read and compared only',
    );
    await shot(page, TAB, 'U2-clock', info);
  });
});

// ================================================================ the run's task (writes, cleaned)
test.describe("Dashboard (Owner): the run's task", () => {
  test.use(as('owner'));
  test.skip(() => !hasLogin('owner'), 'no owner login');
  let task = { id: '', title: '' };
  test.beforeAll(async ({ browser }) => {
    await freshSession(browser, 'owner');
    task = await ensureTask();
  });

  test('V4 a task added in Tasks shows on the next dashboard visit; Reload shows the latest', async ({
    page,
  }, info) => {
    const s = await openDashboard(page);
    expect(
      (s.tasksDue ?? []).map((t) => t.id),
      'the run task is due',
    ).toContain(task.id);
    const w = widget(page, 'Tasks Due');
    await expect(w.getByTestId('task-title').filter({ hasText: task.title })).toHaveCount(1);
    await shot(page, TAB, 'V4-added', info);
    await page.reload();
    await loaded(page);
    await expect(w.getByTestId('task-title').filter({ hasText: task.title })).toHaveCount(1);
  });

  test('T3 a due task stays after reload', async ({ page }, info) => {
    const a = await openDashboard(page);
    const next = nextSummary(page);
    await page.reload();
    const b = await next;
    await loaded(page);
    expect((b.tasksDue ?? []).map((t) => t.id)).toEqual((a.tasksDue ?? []).map((t) => t.id));
    await expect(
      widget(page, 'Tasks Due').getByTestId('task-title').filter({ hasText: task.title }),
    ).toHaveCount(1);
    await shot(page, TAB, 'T3-after-reload', info);
  });

  test('T4 a task title opens that task; the client is its own link', async ({ page }, info) => {
    await openDashboard(page);
    const w = widget(page, 'Tasks Due');
    const row = w.getByRole('listitem').filter({ hasText: task.title });
    const title = row.getByTestId('task-title');
    await expect(title).toHaveAttribute('href', `/tasks/${task.id}?from=%2F`);
    await expect(
      row.getByRole('link', { name: `Open client ${APPT_CLIENT_NAME}` }),
    ).toHaveAttribute('href', `/clients/${APPT_CLIENT}?from=%2F`);
    await roundTrip(page, title, new RegExp(`/tasks/${task.id}\\?from=%2F$`), '/', async () => {
      await expect(page.locator('main')).toContainText(task.title, { timeout: 60_000 });
      await shot(page, TAB, 'T4-task', info);
    });
  });

  test('Reminder delivery (section 9): the task page shows who reminders reach, never the client', async ({
    page,
  }, info) => {
    await readOnly(page);
    await page.goto(app(`/tasks/${task.id}`));
    const history = page.getByTestId('reminder-history');
    await expect(history).toBeVisible({ timeout: 60_000 });
    await expect(history.getByTestId('reminder-recipients')).toContainText('Goes to:');
    await expect(history.getByTestId('reminder-recipients')).toContainText('never the client');
    await expect(history).toContainText('No reminder has gone out yet.');
    await shot(page, TAB, 'section9-reminder-history', info);
  });

  test('T5 completing asks first: Cancel leaves it; Mark Complete completes it once', async ({
    page,
  }, info) => {
    await openDashboard(page);
    const w = widget(page, 'Tasks Due');
    const title = w.getByTestId('task-title').filter({ hasText: task.title });
    test.skip(
      !(await title.count()),
      'the run task is not open (an earlier run of T5 completed it)',
    );
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET' && r.url().includes(`/business/tasks/${task.id}`))
        writes.push(`${r.method()} ${r.url()}`);
    });
    const box = w.getByRole('checkbox', { name: `Mark ${task.title} complete` });
    const dialog = page.getByRole('dialog', { name: 'Mark this task complete?' });
    await box.click();
    await expect(dialog).toContainText('moves to Done and leaves Tasks Due. It is not deleted.');
    await shot(page, TAB, 'T5-asks', info);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(title).toHaveCount(1);
    await expect(box).not.toBeChecked();
    expect(writes, 'Cancel changes nothing').toEqual([]);
    await box.click();
    const done = page.waitForResponse(
      (r) => r.request().method() === 'PATCH' && r.url().includes(`/business/tasks/${task.id}`),
      { timeout: 60_000 },
    );
    await dialog.getByRole('button', { name: 'Mark Complete' }).click();
    expect((await done).ok(), 'the completion is saved').toBe(true);
    await expect(title).toHaveCount(0, { timeout: 30_000 });
    expect(writes.length, `completed once: ${writes.join(', ')}`).toBe(1);
  });

  test('T6 a completed task leaves Tasks Due at once and is Done, not deleted', async ({
    page,
  }, info) => {
    const get = async () => {
      const r = await page.request.get(app(`/api/v1/business/tasks/${task.id}`));
      expect(r.status(), 'the task is still there').toBe(200);
      return (await r.json()) as { status: string; title: string };
    };
    if ((await get()).status === 'OPEN') {
      // T5 did not finish: complete the run's own task from the dashboard here.
      await openDashboard(page);
      await widget(page, 'Tasks Due')
        .getByRole('checkbox', { name: `Mark ${task.title} complete` })
        .click();
      await page.getByRole('dialog').getByRole('button', { name: 'Mark Complete' }).click();
      await expect(
        widget(page, 'Tasks Due').getByTestId('task-title').filter({ hasText: task.title }),
      ).toHaveCount(0, {
        timeout: 30_000,
      });
    }
    const t = await get();
    expect(t.status).toBe('DONE');
    expect(t.title).toBe(task.title);
    const s = await openDashboard(page);
    expect((s.tasksDue ?? []).map((x) => x.id)).not.toContain(task.id);
    await expect(
      widget(page, 'Tasks Due').getByTestId('task-title').filter({ hasText: task.title }),
    ).toHaveCount(0);
    await page.goto(app(`/tasks/${task.id}`));
    await expect(page.locator('main')).toContainText(task.title, { timeout: 60_000 });
    await expect(page.locator('main')).toContainText(/Done|Completed/);
    await shot(page, TAB, 'T6-done', info);
  });
});

// ================================================================ Admin
test.describe('Dashboard (Admin)', () => {
  test.use(as('admin'));
  test.skip(() => !hasLogin('admin'), 'no admin login');
  test.beforeAll(async ({ browser }) => {
    await freshSession(browser, 'admin');
  });
  test.beforeEach(async ({ page }) => {
    await readOnly(page);
  });

  test('V5 (Admin) the firm Admin sees every number, as the Owner does', async ({ page }, info) => {
    const s = await openDashboard(page);
    for (const f of FIXED) {
      expect(s.kpis[f.key], f.label).toBeDefined();
      await expect(cardValue(page, f.label)).toHaveText(shownNumber(f.key, s.kpis[f.key]!));
    }
    await expect(page.getByTestId('kpi-no-access')).toHaveCount(0);
    await expect(page.getByTestId('widget-no-access')).toHaveCount(0);
    await shot(page, TAB, 'V5-admin', info);
  });

  test('A3 (Admin) the row menu offers every action to a firm Admin', async ({ page }, info) => {
    const appts = nextJson<{ items: Appt[] }>(page, 'business/appointments');
    await openDashboard(page);
    const items = upcomingOf((await appts).items);
    test.skip(!items.length, 'no upcoming appointment the Admin may see');
    await widget(page, 'Upcoming Appointments')
      .getByRole('button', { name: /^Actions for / })
      .first()
      .click();
    await expect(page.getByRole('menuitem')).toHaveText(fullMenu(items[0]!));
    await shot(page, TAB, 'A3-admin-menu', info);
  });

  test('@narrow layout (Admin): the dashboard reads well, no sideways scroll', async ({
    page,
  }, info) => {
    await openDashboard(page);
    await shot(page, TAB, 'layout-admin', info);
    await expectNoSideScroll(page);
  });
});

// ================================================================ Staff
test.describe('Dashboard (Staff)', () => {
  test.use(as('staff'));
  test.skip(() => !hasLogin('staff'), 'no staff login');
  let held: string[] = [];
  test.beforeAll(async ({ browser }) => {
    await freshSession(browser, 'staff');
  });
  test.beforeEach(async ({ page }) => {
    held = await readOnly(page);
  });

  test("V5 (Staff) a number Staff may not view says so, with no number or link; the rest are Staff's own", async ({
    page,
  }, info) => {
    const s = await openDashboard(page);
    for (const f of FIXED) {
      const c = card(page, f.label);
      const k = s.kpis[f.key];
      if (k) {
        await expect(cardValue(page, f.label)).toHaveText(shownNumber(f.key, k));
        await expect(c.getByTestId('kpi-no-access')).toHaveCount(0);
      } else {
        await expect(c.getByTestId('kpi-no-access')).toHaveText(
          `You don't have access to ${f.module}.`,
        );
        await expect(c.getByRole('link')).toHaveCount(0);
        await expect(c).not.toHaveAttribute('href', /./);
      }
    }
    const pipe = widget(page, 'Client Pipeline');
    for (const [stage, value] of [
      ['Leads', s.pipeline.leads],
      ['Intake', s.pipeline.intake],
      ['In Progress', s.pipeline.inProgress],
      ['Accepted', s.pipeline.completed],
    ] as const) {
      const link = pipe.getByRole('link', { name: new RegExp(`^${stage}: `) });
      if (value === undefined || value === null) await expect(link).toHaveCount(0);
      else await expect(link).toHaveAccessibleName(`${stage}: ${value}. Open the list`);
    }
    for (const name of ['Revenue Overview', 'Service Breakdown']) {
      if (s.revenue)
        await expect(widget(page, name).getByTestId('widget-no-access')).toHaveCount(0);
      else
        await expect(widget(page, name).getByTestId('widget-no-access')).toHaveText(
          "You don't have access to Invoices & Payments.",
        );
    }
    if (!s.tasksDue) {
      await expect(widget(page, 'Tasks Due').getByTestId('widget-no-access')).toHaveText(
        "You don't have access to Tasks.",
      );
      await expect(widget(page, 'Tasks Due').getByRole('link', { name: 'View All' })).toHaveCount(
        0,
      );
    }
    // The role grid: Staff create no bulk email.
    await expect(
      page
        .getByRole('region', { name: 'Quick actions' })
        .getByRole('link', { name: 'Create Bulk Email' }),
    ).toHaveCount(0);
    note(
      info,
      'staff sees',
      FIXED.map((f) => `${f.label}: ${s.kpis[f.key] ? s.kpis[f.key]!.value : 'no access'}`).join(
        '; ',
      ),
    );
    await shot(page, TAB, 'V5-staff', info);
  });

  test("V1 (Staff) the numbers Staff see equal Staff's own lists", async ({ page }, info) => {
    const s = await openDashboard(page);
    if (s.kpis.totalClients) {
      await roundTrip(page, card(page, 'Total Clients'), /\/clients\?/, '/', async () => {
        expect(await shownTotal(page), 'Total Clients (assigned to Staff)').toBe(
          s.kpis.totalClients!.value,
        );
      });
    }
    if (s.kpis.outstandingInvoicesCents) {
      const cents = s.kpis.outstandingInvoicesCents.value;
      await roundTrip(
        page,
        card(page, 'Outstanding Invoices'),
        /\/invoices\?status=OUTSTANDING/,
        '/',
        async () => {
          await settled(page);
          if (cents) {
            const shown = (
              (await page.getByTestId('outstanding-total').innerText()).split('·')[1] ?? ''
            ).trim();
            expect(sameMoney(shown, cents), `${shown} vs ${money(cents)}`).toBe(true);
          } else await expect(page.getByTestId('outstanding-total')).toHaveCount(0);
        },
      );
    }
    if (s.kpis.appointmentsToday) {
      await roundTrip(
        page,
        card(page, 'Appointments Today').getByRole('link', { name: 'View Calendar' }),
        /\/calendar\/today/,
        '/',
        async () => {
          const today = page.getByTestId('today-schedule');
          await expect(today).toBeVisible({ timeout: 60_000 });
          await settled(page);
          const n =
            (await today.locator('a[href*="/calendar/"]').count()) +
            (await today.getByText(/· Busy \(/).count());
          expect(n).toBe(s.kpis.appointmentsToday!.value);
        },
      );
    }
    await shot(page, TAB, 'V1-staff', info);
  });

  test('Q6 (Staff) + New offers only what Staff may create', async ({ page }, info) => {
    await openDashboard(page);
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText([
      'New client',
      'New lead',
      'New appointment',
      'New task',
      'New invoice',
      'New message',
      'Upload documents',
    ]);
    await shot(page, TAB, 'Q6-staff', info);
    await page.keyboard.press('Escape');
    expect(creates(held)).toEqual([]);
  });

  test('A3 (Staff) the row menu follows the Staff grid', async ({ page }, info) => {
    const appts = nextJson<{ items: Appt[] }>(page, 'business/appointments');
    await openDashboard(page);
    const items = upcomingOf((await appts).items);
    if (!items.length) {
      await expect(widget(page, 'Upcoming Appointments')).toContainText('No upcoming appointments');
      note(
        info,
        'fixture',
        'Staff see no upcoming appointment of their own: the quiet empty state is checked',
      );
      return;
    }
    await widget(page, 'Upcoming Appointments')
      .getByRole('button', { name: /^Actions for / })
      .first()
      .click();
    await expect(page.getByRole('menuitem')).toHaveText(fullMenu(items[0]!));
    await shot(page, TAB, 'A3-staff-menu', info);
  });

  test('R2 NEW2 (Staff) an employee reads their profile here; the Owner changes it', async ({
    page,
  }, info) => {
    await page.goto(app('/profile'));
    await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible({
      timeout: 60_000,
    });
    await settled(page);
    await expect(page.getByRole('button', { name: 'Edit Profile' })).toHaveCount(0);
    await shot(page, TAB, 'R2NEW2-staff', info);
  });

  test('Tax season context (Staff): the season shows; the way to set it does not', async ({
    page,
  }, info) => {
    const s = await openDashboard(page);
    await expect(page.getByRole('link', { name: 'Set your tax season in Settings' })).toHaveCount(
      0,
    );
    if (s.taxSeason)
      await expect(page.getByTestId('tax-season')).toContainText(seasonText(s.taxSeason));
    else await expect(page.getByTestId('tax-season')).toHaveCount(0);
    await shot(page, TAB, 'tax-season-staff', info);
  });

  test('@narrow layout (Staff): the dashboard reads well, no sideways scroll', async ({
    page,
  }, info) => {
    await openDashboard(page);
    await shot(page, TAB, 'layout-staff', info);
    await expectNoSideScroll(page);
  });
});

// ================================================================ V8: cold load timings (Owner)
test.describe('Dashboard V8 (Owner, cold loads)', () => {
  test.skip(() => !hasLogin('owner'), 'no owner login');

  test('V8 every widget has its data within 2.5 s of a cold load (median of five), timings kept', async ({
    browser,
  }, info) => {
    test.setTimeout(420_000);
    await freshSession(browser, 'owner');
    const samples: Sample[] = [];
    for (let n = 1; n <= V8_SAMPLES; n++) samples.push(await coldSample(browser, n));
    const bySlowest = [...samples].sort((a, b) => a.slowestMs - b.slowestMs);
    const mid = bySlowest[Math.floor(bySlowest.length / 2)]!;
    const perWidgetMedian = Object.fromEntries(
      V8_WIDGETS.map((w) => [w, median(samples.map((s) => s.widgets[w]!.ms))]),
    );
    const summaryTtfb = samples.map(
      (s) =>
        s.api.find((a) => a.path === 'business/dashboard/summary' && a.status < 400)?.ttfbMs ??
        Number.NaN,
    );
    const report = {
      measuredAt: new Date().toISOString(),
      url: app('/'),
      firm: firmSlug,
      role: 'owner',
      viewport: { width: 1165, height: 900 },
      cold: 'a new browser context per sample: empty cache, service workers blocked, the session cookie only',
      signal:
        "a widget's first frame with its data, empty state, error or no-access (never a skeleton), from navigation start (performance.now())",
      targets: { widgetMs: V8_TARGET_MS, summaryServerMs: V8_SUMMARY_TARGET_MS },
      medianSample: mid.sample,
      perWidgetMedianMs: perWidgetMedian,
      summaryTtfbMs: { samples: summaryTtfb, median: median(summaryTtfb) },
      samples,
    };
    const file = join(shotsDir(TAB), 'v8-timings.json');
    writeFileSync(file, JSON.stringify(report, null, 2));
    await info.attach('v8-timings.json', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });
    for (const s of samples) {
      note(
        info,
        `V8 sample ${s.sample}${s.sample === mid.sample ? ' (median)' : ''}`,
        `${V8_WIDGETS.map((w) => `${w} ${s.widgets[w]!.ms} ms (${s.widgets[w]!.state})`).join('; ')} | API: ${s.api
          .filter((a) =>
            /dashboard|availability|message-threads|appointments|^me$|^business$/.test(a.path),
          )
          .map((a) => `${a.path} ${a.totalMs} ms (ttfb ${a.ttfbMs})`)
          .join('; ')}`,
      );
    }
    note(
      info,
      'V8 per-widget median',
      V8_WIDGETS.map((w) => `${w} ${perWidgetMedian[w]} ms`).join('; '),
    );
    note(
      info,
      'V8 summary ttfb',
      `median ${median(summaryTtfb)} ms (target ${V8_SUMMARY_TARGET_MS} ms server time on a large firm; reported, not gated)`,
    );
    note(info, 'V8 file', file);
    for (const w of V8_WIDGETS) {
      const seen = mid.widgets[w]!;
      expect
        .soft(seen.state, `${w}: loaded, not failed (median sample ${mid.sample})`)
        .not.toMatch(/error|never/);
      expect
        .soft(seen.ms, `${w} in the median sample (${mid.sample})`)
        .toBeLessThanOrEqual(V8_TARGET_MS);
    }
  });
});

// ================================================================ Rows not checked live
const NOT_LIVE: [row: string, reason: string][] = [
  [
    'Multi-firm: a firm only ever sees its own numbers',
    'needs a second firm login (never LVP); the isolation suite covers every dashboard route',
  ],
  [
    'V11 authorized flows: a client, an invoice, a message, a bulk email draft, an upload, a cancelled appointment',
    'writes in other modules (their own live checks) and client notices; completing a task is checked live (T5, T6)',
  ],
];

test.describe('Rows not checked live', () => {
  for (const [row, reason] of NOT_LIVE) {
    // eslint-disable-next-line no-empty-pattern
    test(`${row} (NOT LIVE)`, async ({}, info) => {
      info.annotations.push({ type: 'NOT LIVE', description: reason });
      test.skip(true, `NOT LIVE: ${reason}`);
    });
  }
});

// ================================================================ Cleanup (after every row)
test.describe('Dashboard cleanup', () => {
  test.use(as('owner'));
  test.skip(() => !hasLogin('owner'), 'no owner login');

  // eslint-disable-next-line no-empty-pattern
  test('zz cleanup: archive the run task (tasks have no delete)', async ({}, info) => {
    const runs = readRuns().filter((r) => r.tag === runTag || !r.cleaned);
    const done: string[] = [];
    const left: string[] = [];
    if (runs.length) {
      const api = await apiAs('owner');
      try {
        for (const run of runs) {
          const ids = new Set(run.taskIds);
          // A create whose id was lost: the run's own title on the fixture client.
          for (const status of ['OPEN', 'DONE']) {
            const res = await api.get(
              `business/tasks?clientId=${APPT_CLIENT}&status=${status}&limit=100`,
            );
            if (!res.ok()) continue;
            for (const t of ((await res.json()) as { items: { id: string; title: string }[] })
              .items) {
              if (t.title === taskTitle(run.tag)) ids.add(t.id);
            }
          }
          let ok = true;
          for (const id of ids) {
            const r = await api.post(`business/tasks/${id}/archive`, { data: {} });
            if (r.ok() || r.status() === 404 || r.status() === 409)
              done.push(`[${run.tag}] task ${id} archived`);
            else {
              ok = false;
              left.push(`[${run.tag}] task ${id}: archive ${r.status()}`);
            }
          }
          if (ok) saveRun({ ...run, cleaned: true });
        }
      } finally {
        await api.dispose();
      }
    }
    console.warn(
      `CLEANUP done:\n${done.join('\n') || 'nothing'}\nCLEANUP left:\n${left.join('\n') || 'none'}`,
    );
    info.annotations.push({ type: 'cleaned', description: done.join('; ') || 'nothing to clean' });
    info.annotations.push({ type: 'left-behind', description: left.join('; ') || 'none' });
    expect(left, 'everything the run made is archived').toEqual([]);
  });
});
