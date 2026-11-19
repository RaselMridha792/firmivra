import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type Page,
  type Response,
  type Route,
  type TestInfo,
} from '@playwright/test';
import { appUrl, shotsDir, statePath, type Role } from './env';
import {
  apiAs,
  app,
  as,
  expectNoSideScroll,
  hasLogin,
  narrow,
  portal,
  settled,
  shot,
} from './helpers';

/**
 * Tax Planning, Octavia's Review Two and its checklist: one test per row (the ones she passed
 * too), live on dev as Test Firm B's Owner, Admin, Staff and portal Client. Rows are named by
 * their IDs only; docs/qa/tax-planning.md maps each one to its PR and tests.
 *
 * Every plan, task, opportunity, strategy and deadline the run makes is on the QA seed's synthetic
 * client "QA Appointments Client (fake)" (its email is the SES simulator's, it has no portal
 * login) and carries the run tag ("LIVE-CHECK yyyymmddhhmm") in its name. QA Fixture Client 1
 * (qa-client-b, Octavia's portal login) is only read, never planned for, sent to or changed. The
 * portal row signs in as the harness's own portal client (portalClient(), lead Nov 19).
 *
 * Sends: only to the simulator client. Before each one, every address the send can reach (the
 * client record, its responsible party, every portal login) is read and must be an SES simulator
 * address, or the test fails before it sends.
 *
 * The run keeps one fixture, found or made: an active "LIVE-CHECK <stamp> Tax Planning" service
 * (so the overview has a planning service and a deadline can name one) and two plans ("Workflow
 * Plan", taken through the approved workflow, and "Editor Plan", made in the wizard). Ids live in
 * a ledger (LIVE_SHOTS_DIR/tax-planning/.runs.json), so "zz cleanup" also finishes a run that
 * stopped before it: it archives the plans, tasks, strategies and the message threads the sends
 * made, closes the opportunities, deletes the deadlines and the service. Saved calculator
 * scenarios have no delete: the one a run saves stays, on its archived plan.
 *
 * Firm-wide settings are never changed: a built-in resource's Edit is opened and cancelled, and
 * Run Screening is never pressed.
 *
 * Staff notices (checked in the code, Nov 18): the harness staff logins are @dev.firmivra.com
 * (no MX), so nothing may email them. Send for Internal Review and Record Client's Request notify
 * no one (the plans service has no notifier); the implementation task has no reminder (no
 * template) and its assignment sends nothing; a project deadline sends nothing when it is made,
 * shared or completed, and its reminders here are in-app only, 45 days out, deleted the same day.
 */
test.describe.configure({ timeout: 180_000 });

const TAB = 'tax-planning';
const TZ = 'America/New_York';
/** QA seed part 4: the synthetic client (success+qa-appointments@simulator...), no portal login. */
const APPT = '00000000-0000-4a28-8005-000000000900';
const APPT_NAME = 'QA Appointments Client (fake)';
/** QA Fixture Client 1 is Octavia's portal login: never acted on. */
const CLIENT1 = '00000000-0000-4a28-8001-000000000002';
const SIMULATOR = /@simulator\.amazonses\.com$/i;

/** The firm's calendar day, `days` from today (YYYY-MM-DD). */
const firmDay = (days: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(
    new Date(Date.now() + days * 86_400_000),
  );
const YEAR = Number(firmDay(0).slice(0, 4));
/** The newest year the plan screens offer: the run's plans are the client's current ones. */
const PLAN_YEAR = YEAR + 1;

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
/** The tag's digits: one search word that finds this run's records only. */
const STAMP = runTag.slice('LIVE-CHECK '.length);

const SERVICE = `${runTag} Tax Planning`;
const CATEGORY = 'LIVE-CHECK';
const PLAN_W = `${runTag} Workflow Plan`;
const PLAN_E = `${runTag} Editor Plan`;
const W_STRATEGY = `${runTag} retirement contribution`;
const W_ASSUMPTIONS = 'Synthetic: a $10,000 contribution.';
const INTERNAL_NOTE = `${runTag} internal note, staff only`;
const CLIENT_NOTE = `${runTag} note for the client`;
const STRATEGY = `${runTag} Strategy`;
const STAFF_STRATEGY = `${runTag} Staff refused strategy`;
const OPP = `${runTag} Opportunity`;
const DEADLINE = `${runTag} deadline`;
const SHARED_DEADLINE = `${runTag} shared deadline`;
const TASK = `${runTag} implementation task`;
const SCENARIO = `${runTag} scenario`;
const CALC_STRATEGY = `${runTag} calculator strategy`;
const CUSTOM_ENTITY = 'Family trust (synthetic)';
const SEND_NOTE = `${runTag}: synthetic, please ignore.`;
const REOPEN_REASON = `${runTag}: reopened for a live check`;
const REVISE_REASON = `${runTag}: revised for a live check`;

const PLAN_STATUS: Record<string, string> = {
  DRAFT: 'Draft',
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In Progress',
  UNDER_REVIEW: 'Under Review',
  AWAITING_CLIENT: 'Awaiting Client Review',
  READY_FOR_REVIEW: 'Needs Review',
  FINALIZED: 'Finalized',
  CLIENT_APPROVED: 'Client Approved',
  IMPLEMENTED: 'Implemented',
  CLOSED: 'Closed',
};
const ACTION_LABEL: Record<string, string> = {
  START_WORK: 'Start Work',
  SEND_FOR_REVIEW: 'Send for Internal Review',
  RETURN_TO_WORK: 'Return to Work',
  FINALIZE: 'Finalize Plan',
  SEND_TO_CLIENT: 'Send to Client',
  REQUEST_INFORMATION: 'Request Information',
  RECORD_CLIENT_REQUEST: "Record Client's Request",
  START_REVISION: 'Start Revision',
  RECORD_APPROVAL: 'Record Client Approval',
  MARK_IMPLEMENTED: 'Mark Implemented',
  DELIVER: 'Deliver to Client',
  REVISE: 'Revise Plan',
  CLOSE: 'Close Plan',
  REOPEN: 'Reopen Plan',
  DUPLICATE: 'Duplicate Plan',
};

// ---------------------------------------------------------------- what the API answers

interface Me {
  user: { id: string; name: string };
}
interface Created {
  id: string;
}
interface Named {
  id: string;
  name: string;
}
interface Overview {
  activePlanningClients: { value: number };
  upcomingAppointments: { value: number };
  strategiesInProgress: { value: number };
  projectedSavings: { value: number };
  deadlines: { id: string; title: string }[];
  topOpportunities: { firstOpportunityId: string }[];
  planningServiceId: string | null;
}
interface ClientsPage {
  items: { client: { id: string; name: string }; planId: string | null; status: string | null }[];
  total: number;
}
interface PlanDetail {
  id: string;
  name: string;
  status: string;
  etag: string;
  archived: boolean;
  strategies: { id: string; name: string; assumptions: string | null }[];
  inputs: { key: string; kind: string; asOf: string | null }[] | null;
  workflow: { actions: string[]; sentVersion: number | null; approvedVersion: number | null };
  canEdit: boolean;
}
interface Resource {
  key: string;
  title: string;
  clientFacing: boolean;
  summary?: string;
  staffOnly?: boolean;
}
interface CalcResult {
  baselineTaxCents: number | null;
  modeledTaxCents: number | null;
  differenceCents: number | null;
  unavailableReason: string | null;
  assumptions: string[];
}
interface ClientRecord {
  email: string | null;
  assignedTo: { userId: string } | null;
  profile?: { responsibleParty?: { email?: string } | null };
  portalLogins?: { email: string }[];
}
interface PortalAccess {
  recipient: { email: string } | null;
  logins: { email: string }[];
}

// ---------------------------------------------------------------- the run's ledger

type Ref = 'service' | 'category' | 'w' | 'e' | 'opp' | 'strategy' | 'sent1';
type List = 'plans' | 'strategies' | 'opportunities' | 'deadlines' | 'tasks' | 'scenarios';
/** Every run's records, so "zz cleanup" also finishes a run that stopped before it. */
interface Run extends Record<Ref, string>, Record<List, string[]> {
  tag: string;
  cleaned: boolean;
}
const blankRun = (tag: string): Run => ({
  tag,
  service: '',
  category: '',
  w: '',
  e: '',
  opp: '',
  strategy: '',
  sent1: '',
  plans: [],
  strategies: [],
  opportunities: [],
  deadlines: [],
  tasks: [],
  scenarios: [],
  cleaned: false,
});
const runsFile = () => join(shotsDir(TAB), '.runs.json');
function readRuns(): Run[] {
  try {
    return (JSON.parse(readFileSync(runsFile(), 'utf8')) as Partial<Run>[]).map((r) => ({
      ...blankRun(r.tag ?? ''),
      ...r,
    }));
  } catch {
    return [];
  }
}
function saveRun(run: Run) {
  const runs = readRuns().filter((r) => r.tag !== run.tag);
  writeFileSync(runsFile(), JSON.stringify([...runs, run], null, 2));
}
const mine = (): Run => readRuns().find((r) => r.tag === runTag) ?? blankRun(runTag);
function setRef(key: Ref, id: string) {
  const run = mine();
  run[key] = id;
  run.cleaned = false;
  saveRun(run);
}
function addId(key: List, id: string) {
  const run = mine();
  if (!run[key].includes(id)) run[key] = [...run[key], id];
  run.cleaned = false;
  saveRun(run);
}

// ---------------------------------------------------------------- helpers

const note = (info: TestInfo, type: string, description: string) => {
  info.annotations.push({ type, description });
  console.warn(`${type}: ${info.title}: ${description}`);
};

async function ok<T>(res: APIResponse, what: string): Promise<T> {
  if (!res.ok()) throw new Error(`${what}: ${res.status()} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}
const items = <T>(body: unknown): T[] =>
  (Array.isArray(body) ? body : ((body as { items?: T[] } | null)?.items ?? [])) as T[];

/** The API path of a response, without /api/v1/ and the query. */
const apiPath = (r: Response) => new URL(r.url()).pathname.replace(/^\/api\/v1\//, '');
/** The page's own next call of `path` (exact, or a pattern), parsed. Start it before the action. */
function nextApi<T>(page: Page, method: string, path: string | RegExp) {
  return page
    .waitForResponse(
      (r) =>
        r.request().method() === method &&
        (typeof path === 'string' ? apiPath(r) === path : path.test(apiPath(r))),
      { timeout: 60_000 },
    )
    .then(async (r) => ({ status: r.status(), body: (await r.json().catch(() => null)) as T }));
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

/** Who a role is (setup only). */
async function whoIs(role: Role): Promise<{ id: string; name: string }> {
  const api = await apiAs(role);
  try {
    const me = await ok<Me>(await api.get('me'), `${role} me`);
    return { id: me.user.id, name: me.user.name };
  } finally {
    await api.dispose();
  }
}
let ownerMe: { id: string; name: string } | undefined;
const owner = async () => (ownerMe ??= await whoIs('owner'));

/**
 * Rule: a send may reach only SES simulator addresses. Reads every address the send can reach
 * (the client record, its responsible party and every portal login) and fails the test before
 * the send if one is not a simulator address.
 */
async function expectSimulatorOnly(clientId: string) {
  expect(clientId, 'never QA Fixture Client 1').not.toBe(CLIENT1);
  const api = await apiAs('owner');
  try {
    const rec = await ok<ClientRecord>(await api.get(`business/clients/${clientId}`), 'client');
    const access = await ok<PortalAccess>(
      await api.get(`business/clients/${clientId}/portal-access`),
      'portal access',
    );
    const addresses = [
      rec.email,
      rec.profile?.responsibleParty?.email,
      ...(rec.portalLogins ?? []).map((l) => l.email),
      access.recipient?.email,
      ...access.logins.map((l) => l.email),
    ].filter((a): a is string => Boolean(a));
    expect(addresses.length, 'the client has an address on file').toBeGreaterThan(0);
    for (const a of addresses) expect(a, `a send could reach ${a}`).toMatch(SIMULATOR);
  } finally {
    await api.dispose();
  }
}

/** The run's active Tax Planning service (found, or made once per run). */
async function service(): Promise<{ id: string; name: string }> {
  const run = mine();
  if (run.service) return { id: run.service, name: SERVICE };
  const api = await apiAs('owner');
  try {
    const cats = items<Named>(
      await ok<unknown>(await api.get('business/catalog/categories'), 'categories'),
    );
    let categoryId = cats.find((c) => c.name === CATEGORY)?.id;
    if (!categoryId) {
      categoryId = (
        await ok<Created>(
          await api.post('business/catalog/categories', {
            data: { name: CATEGORY, description: 'Live check fixture (synthetic)' },
          }),
          'category',
        )
      ).id;
      setRef('category', categoryId);
    }
    const made = await ok<Created>(
      await api.post('business/catalog/services', {
        data: {
          name: SERVICE,
          categoryId,
          shortDescription: 'Live check fixture (synthetic), removed by the run',
          kind: 'TAX_PLANNING',
          pricingType: 'CUSTOM_QUOTE',
          activate: true,
          allowDuplicateName: true,
        },
      }),
      'service',
    );
    setRef('service', made.id);
    return { id: made.id, name: SERVICE };
  } finally {
    await api.dispose();
  }
}

async function planDetail(id: string): Promise<PlanDetail> {
  const api = await apiAs('owner');
  try {
    return await ok<PlanDetail>(await api.get(`business/tax-planning/plans/${id}`), 'plan');
  } finally {
    await api.dispose();
  }
}
async function alive(api: APIRequestContext, id: string): Promise<boolean> {
  if (!id) return false;
  const r = await api.get(`business/tax-planning/plans/${id}`);
  return r.ok() && !((await r.json()) as PlanDetail).archived;
}

/** A plan of the run on the simulator client (setup only). */
async function makePlan(api: APIRequestContext, name: string, target: string): Promise<string> {
  const me = await owner();
  const made = await ok<Created>(
    await api.post('business/tax-planning/plans', {
      data: {
        clientId: APPT,
        planYear: PLAN_YEAR,
        name,
        filingStatus: 'SINGLE',
        entityType: 'Individual',
        goals: ['REDUCE_TAXABLE_INCOME'],
        assignedUserId: me.id,
        targetCompletionOn: target,
      },
    }),
    `plan ${name}`,
  );
  addId('plans', made.id);
  return made.id;
}

/**
 * The workflow plan: made as a Draft (the setup row starts it), assigned to the Owner, with its
 * target completion 23 days out (a planning milestone in the Tax Calendar, C04).
 */
async function planW(): Promise<string> {
  const run = mine();
  const api = await apiAs('owner');
  try {
    if (await alive(api, run.w)) return run.w;
    const id = await makePlan(api, PLAN_W, firmDay(23));
    setRef('w', id);
    return id;
  } finally {
    await api.dispose();
  }
}

/** The plan the wizard made (C05), or one made here when C05 did not run. */
async function planE(): Promise<string> {
  const run = mine();
  const api = await apiAs('owner');
  try {
    if (await alive(api, run.e)) return run.e;
    const id = await makePlan(api, PLAN_E, firmDay(40));
    setRef('e', id);
    return id;
  } finally {
    await api.dispose();
  }
}

/**
 * The workflow plan's content (setup): the internal and client notes, one custom strategy with
 * its estimate, and the wages figure with its source and a current as-of date. A content change
 * starts the work by itself, so this runs after the setup row. It also puts back a current as-of
 * date when C08 stopped before restoring it (a stale figure blocks every later Finalize).
 */
async function ensureWContent(id: string) {
  const api = await apiAs('owner');
  try {
    let p = await ok<PlanDetail>(await api.get(`business/tax-planning/plans/${id}`), 'plan');
    if (!p.canEdit) return;
    if (!p.strategies.some((s) => s.name === W_STRATEGY)) {
      p = await ok<PlanDetail>(
        await api.patch(`business/tax-planning/plans/${id}`, {
          data: { notes: INTERNAL_NOTE, clientNotes: CLIENT_NOTE, etag: p.etag },
        }),
        'notes',
      );
      p = await ok<PlanDetail>(
        await api.post(`business/tax-planning/plans/${id}/strategies`, {
          data: {
            kind: 'CUSTOM',
            name: W_STRATEGY,
            category: 'RETIREMENT',
            assumptions: W_ASSUMPTIONS,
            estimatedSavingsCents: 120_000,
          },
        }),
        'strategy',
      );
    }
    const wages = (p.inputs ?? []).find((i) => i.key === 'wages' && i.kind === 'PROJECTED');
    const current = wages?.asOf && Date.now() - Date.parse(wages.asOf) < 300 * 86_400_000;
    if (current) return;
    await ok<PlanDetail>(
      await api.put(`business/tax-planning/plans/${id}/inputs`, {
        data: {
          inputs: [
            {
              key: 'wages',
              kind: 'PROJECTED',
              taxYear: PLAN_YEAR,
              amountCents: 9_500_000,
              source: 'Client estimate',
              asOf: new Date().toISOString(),
            },
          ],
          etag: p.etag,
        },
      }),
      'figures',
    );
  } finally {
    await api.dispose();
  }
}

/** The run's opportunity (made in C10), or one made here when C10 did not run. */
async function opportunity(): Promise<string> {
  const run = mine();
  if (run.opp) return run.opp;
  const api = await apiAs('owner');
  try {
    const made = await ok<Created>(
      await api.post('business/tax-planning/opportunities', {
        data: {
          clientId: APPT,
          name: OPP,
          category: 'RETIREMENT',
          taxYear: YEAR,
          whyExplanation: 'Live check fixture (synthetic).',
          documentsNeeded: ['Latest pay stub (synthetic)'],
        },
      }),
      'opportunity',
    );
    setRef('opp', made.id);
    addId('opportunities', made.id);
    return made.id;
  } finally {
    await api.dispose();
  }
}

/** The run's library strategy (made in C13), or one made here when C13 did not run. */
async function libraryStrategy(): Promise<string> {
  const run = mine();
  if (run.strategy) return run.strategy;
  const api = await apiAs('owner');
  try {
    const made = await ok<Created>(
      await api.post('business/tax-planning/strategies', {
        data: {
          name: STRATEGY,
          category: 'RETIREMENT',
          description: 'Live check strategy (synthetic).',
          eligibility: ['Has W-2 wages (synthetic)'],
          requiredInputs: ['wages'],
          requiredDocuments: ['Plan statement (synthetic)'],
          implementationChecklist: ['Open the account (synthetic)', 'Fund it (synthetic)'],
        },
      }),
      'strategy',
    );
    setRef('strategy', made.id);
    addId('strategies', made.id);
    return made.id;
  } finally {
    await api.dispose();
  }
}

/** Skips the row when the workflow plan is not where it should be (an earlier step did not run). */
async function requireStatus(id: string, allowed: string[]): Promise<PlanDetail> {
  const p = await planDetail(id);
  test.skip(
    !allowed.includes(p.status),
    `the plan is ${PLAN_STATUS[p.status] ?? p.status}, not ${allowed.map((s) => PLAN_STATUS[s]).join(' or ')}: an earlier workflow row did not run`,
  );
  return p;
}

/** The screen's notice (a Toast: role alert for errors, status for success) with this text. */
const toast = (page: Page, text: string | RegExp) =>
  page.locator('[role="alert"], [role="status"]').filter({ hasText: text }).first();
const dialog = (page: Page) => page.getByRole('dialog');
const header = (page: Page) => page.getByTestId('plan-editor').locator('header').first();
const action = (page: Page, name: string) =>
  page.getByTestId('workflow-actions').getByRole('button', { name, exact: true });
async function expectActions(page: Page, labels: string[]) {
  await expect(page.getByTestId('workflow-actions').getByRole('button')).toHaveText(labels);
}
async function openPlan(page: Page, id: string, step = '') {
  await page.goto(app(`/tax-planning/plans/${id}/edit${step}`));
  await expect(page.getByTestId('plan-workflow')).toBeVisible({ timeout: 60_000 });
}
async function openClients(page: Page, query = '') {
  await page.goto(app(`/tax-planning/clients${query}`));
  await expect(page.getByTestId('tp-clients')).toBeVisible({ timeout: 60_000 });
  await settled(page);
}
const apptRow = (page: Page) =>
  page.getByTestId('tp-clients').getByRole('row').filter({ hasText: APPT_NAME });
const centsOf = (text: string) => Math.round(Number(text.replace(/[^0-9.-]/g, '')) * 100);

/**
 * What sticks out past the viewport and is not clipped by a scrolling box: each element's tag,
 * test id or label, its right edge and position. Reported only when the page scrolls sideways.
 */
async function sideScrollCulprits(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const clips = (el: Element) => {
      // An absolute element escapes every scroller below its containing block.
      let escaping = getComputedStyle(el).position === 'absolute';
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (escaping) {
          if (s.position === 'static') continue;
          escaping = false;
        }
        if (s.overflowX !== 'visible') return true;
      }
      return false;
    };
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.right <= width + 1 || r.width === 0 || clips(el)) continue;
      const name =
        el.getAttribute('data-testid') ??
        el.getAttribute('aria-label') ??
        (el.textContent ?? '').trim().slice(0, 40);
      out.push(
        `${el.tagName.toLowerCase()} "${name}" right ${Math.round(r.right)}px (${getComputedStyle(el).position})`,
      );
      if (out.length >= 8) break;
    }
    return out;
  });
}

/** Opens a page of the tab and checks its width (the @narrow rows). */
async function layout(page: Page, url: string, row: string, info: TestInfo) {
  await page.goto(url);
  await settled(page);
  await expect(page.locator('main').first()).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (overflow > 1)
    note(info, 'side-scroll', `${row}: ${(await sideScrollCulprits(page)).join('; ')}`);
  // Soft (expectNoSideScroll's measure): a page that scrolls fails the row, the next pages are
  // still checked.
  expect.soft(overflow, `${row}: page scrolls sideways`).toBeLessThanOrEqual(1);
  await shot(page, TAB, row, info);
}

// ================================================================ Owner
test.describe('Tax Planning (Owner)', () => {
  test.use(as('owner'));
  test.skip(() => !hasLogin('owner'), 'no owner login');
  test.beforeAll(async ({ browser }) => {
    await freshSession(browser, 'owner');
  });

  // ---------------------------------------------------------------- every page, both widths

  test('@narrow LAYOUT overview: no sideways scroll', async ({ page }, info) => {
    await layout(page, app('/tax-planning'), 'LAYOUT-overview', info);
    await expect(page.getByTestId('tp-kpis')).toBeVisible();
  });
  test('@narrow LAYOUT clients: no sideways scroll', async ({ page }, info) => {
    await layout(page, app('/tax-planning/clients'), 'LAYOUT-clients', info);
  });
  test('@narrow LAYOUT planning opportunities: no sideways scroll', async ({ page }, info) => {
    await layout(page, app('/tax-planning/opportunities'), 'LAYOUT-opportunities', info);
  });
  test('@narrow LAYOUT strategies and recommendations: no sideways scroll', async ({
    page,
  }, info) => {
    await layout(page, app('/tax-planning/strategies'), 'LAYOUT-strategies', info);
  });
  test('@narrow LAYOUT tax calendar, list and calendar views: no sideways scroll', async ({
    page,
  }, info) => {
    await layout(page, app('/tax-planning/calendar'), 'LAYOUT-calendar-list', info);
    await layout(page, app('/tax-planning/calendar?view=calendar'), 'LAYOUT-calendar-grid', info);
    await expect(page.getByTestId('month-grid')).toBeVisible();
  });
  test('@narrow LAYOUT resources: no sideways scroll', async ({ page }, info) => {
    await layout(page, app('/tax-planning/resources'), 'LAYOUT-resources', info);
  });
  test('@narrow LAYOUT reports: no sideways scroll', async ({ page }, info) => {
    await layout(page, app('/tax-planning/reports'), 'LAYOUT-reports', info);
  });
  test('@narrow LAYOUT project deadlines: no sideways scroll', async ({ page }, info) => {
    await layout(page, app('/tax-planning/deadlines'), 'LAYOUT-deadlines', info);
  });
  test('@narrow LAYOUT tax savings calculator: no sideways scroll', async ({ page }, info) => {
    await layout(page, app('/tax-planning/calculator'), 'LAYOUT-calculator', info);
  });
  test('@narrow LAYOUT create planning plan: no sideways scroll', async ({ page }, info) => {
    await layout(page, app('/tax-planning/plans/new'), 'LAYOUT-plan-new', info);
  });
  // ---------------------------------------------------------------- overview and lists

  test('C01 each KPI card opens its filtered list; Active Planning Clients counts the clients it opens', async ({
    page,
  }, info) => {
    const overview = nextApi<Overview>(page, 'GET', 'business/tax-planning/overview');
    await page.goto(app('/tax-planning'));
    const o = (await overview).body;
    await settled(page);
    const card = (label: string) => page.getByTestId('kpi-link').filter({ hasText: label });
    await expect(page.getByTestId('kpi-link')).toHaveCount(4);
    const counts: [string, number, string][] = [
      ['Active Planning Clients', o.activePlanningClients.value, '/tax-planning/clients?active=1'],
      [
        'Upcoming Planning Appointments',
        o.upcomingAppointments.value,
        '/tax-planning/clients?upcoming=1&sort=nextAppointment',
      ],
      [
        'Strategies In Progress',
        o.strategiesInProgress.value,
        '/tax-planning/clients?strategy=IN_PROGRESS',
      ],
    ];
    for (const [label, value, href] of counts) {
      await expect(card(label)).toHaveAttribute('href', href);
      await expect(card(label), `${label} shows the firm's own count`).toContainText(
        new RegExp(`(^|\\D)${value}(\\D|$)`),
      );
    }
    await expect(card('Projected Tax Savings')).toHaveAttribute('href', '/tax-planning/reports');
    await shot(page, TAB, 'C01-overview', info);

    // Active Planning Clients: the list counts what the card counts.
    const listed = nextApi<ClientsPage>(page, 'GET', 'business/tax-planning/clients');
    await card('Active Planning Clients').click();
    await expect(page).toHaveURL(/\/tax-planning\/clients\?active=1$/);
    expect((await listed).body.total, 'the list holds the clients the card counts').toBe(
      o.activePlanningClients.value,
    );
    await expect(page.getByTestId('kpi-filter')).toContainText(/active planning clients/i);
    await shot(page, TAB, 'C01-active', info);
    await page.getByRole('button', { name: 'Show all clients' }).click();
    await expect(page.getByTestId('kpi-filter')).toHaveCount(0);

    for (const [label, , href] of counts.slice(1)) {
      await page.goto(app('/tax-planning'));
      await card(label).click();
      await expect(page).toHaveURL(app(href));
      await expect(page.getByTestId('kpi-filter')).toBeVisible();
      await shot(page, TAB, `C01-${label}`, info);
    }

    // Projected Tax Savings: the savings report, with the estimate disclaimer.
    await page.goto(app('/tax-planning'));
    await card('Projected Tax Savings').click();
    await expect(page).toHaveURL(app('/tax-planning/reports'));
    await expect(page.getByTestId('tp-reports')).toContainText('Projected Savings by Plan');
    await expect(page.getByTestId('disclaimer')).toContainText('Actual results may vary');
    await shot(page, TAB, 'C01-savings-report', info);
  });

  test('C02 Schedule a Planning Consultation opens New Appointment on the Tax Planning service; the Clients menu adds the client; Cancel comes back', async ({
    page,
  }, info) => {
    await service();
    const overview = nextApi<Overview>(page, 'GET', 'business/tax-planning/overview');
    await page.goto(app('/tax-planning'));
    const o = (await overview).body;
    expect(o.planningServiceId, 'the firm has an active Tax Planning service').not.toBeNull();
    const cta = page.getByTestId('schedule-consultation');
    await expect(cta).toHaveAttribute(
      'href',
      `/calendar/new?serviceId=${o.planningServiceId}&from=%2Ftax-planning`,
    );
    await cta.click();
    await expect(page).toHaveURL(new RegExp(`/calendar/new\\?serviceId=${o.planningServiceId}`));
    await expect(page.getByTestId('page-title')).toHaveText('Schedule Appointment');
    await shot(page, TAB, 'C02-new-appointment', info);
    const cancel = page.getByRole('link', { name: 'Cancel', exact: true });
    await expect(cancel).toHaveAttribute('href', '/tax-planning');
    await cancel.click();
    await expect(page).toHaveURL(app('/tax-planning'));

    // From a client's row: the client is chosen as well, and the way back is the list.
    await planW();
    await openClients(page, `?q=${encodeURIComponent(STAMP)}`);
    await apptRow(page)
      .getByRole('button', { name: `Actions for ${APPT_NAME}` })
      .click();
    await page.getByRole('menuitem', { name: 'Schedule', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/calendar/new\\?clientId=${APPT}&serviceId=`));
    await expect(page.getByTestId('page-title')).toHaveText('Schedule Appointment');
    await expect(page.locator('main').first()).toContainText(APPT_NAME);
    await shot(page, TAB, 'C02-from-clients', info);
    await page.getByRole('link', { name: 'Cancel', exact: true }).click();
    await expect(page).toHaveURL(/\/tax-planning\/clients\?q=/);
  });

  test("C03 the Clients row menu offers every action for the client's plan, and each opens its place", async ({
    page,
  }, info) => {
    const w = await planW();
    const list = `?q=${encodeURIComponent(STAMP)}&year=${PLAN_YEAR}`;
    const pick = async (item: string) => {
      await openClients(page, list);
      await expect(apptRow(page)).toContainText(runTag);
      await apptRow(page)
        .getByRole('button', { name: `Actions for ${APPT_NAME}` })
        .click();
      await page.getByRole('menuitem', { name: item, exact: true }).click();
    };
    await openClients(page, list);
    const row = apptRow(page);
    await expect(row).toHaveCount(1);
    await expect(row, "the row's plan is the run's").toContainText(PLAN_W);
    await row.getByRole('button', { name: `Actions for ${APPT_NAME}` }).click();
    for (const item of [
      'View Plan',
      'Edit Plan',
      'Duplicate Plan',
      'Create Plan',
      'Schedule',
      'Send Resource',
      'Opportunities',
      'Assign Staff',
      'Close Plan',
      'Archive Plan',
    ])
      await expect(page.getByRole('menuitem', { name: item, exact: true })).toBeVisible();
    await shot(page, TAB, 'C03-menu', info);
    await page.keyboard.press('Escape');

    await pick('View Plan');
    await expect(page).toHaveURL(app(`/tax-planning/plans/${w}/edit/review`));
    await expect(page.getByTestId('step-review')).toBeVisible();
    await pick('Edit Plan');
    await expect(page).toHaveURL(app(`/tax-planning/plans/${w}/edit`));
    await expect(page.getByTestId('step-client')).toBeVisible();
    await pick('Create Plan');
    await expect(page).toHaveURL(app(`/tax-planning/plans/new?clientId=${APPT}`));
    await expect(page.getByTestId('step-client').getByLabel('Client *')).toHaveValue(APPT);
    await pick('Send Resource');
    await expect(page).toHaveURL(app(`/tax-planning/resources?clientId=${APPT}`));
    await expect(page.getByTestId('resource-for')).toContainText(APPT_NAME);
    await pick('Opportunities');
    await expect(page).toHaveURL(app(`/tax-planning/opportunities?clientId=${APPT}`));
    // Assign Staff, Close Plan and Archive Plan each ask first; Cancel (Keep it) changes nothing.
    for (const [item, title, keep] of [
      ['Assign Staff', /assign/i, 'Cancel'],
      ['Close Plan', /Close this plan\?/, 'Keep it'],
      ['Archive Plan', /Archive this plan\?/, 'Keep it'],
    ] as const) {
      await pick(item);
      await expect(dialog(page)).toContainText(title);
      await shot(page, TAB, `C03-${item}`, info);
      await dialog(page).getByRole('button', { name: keep, exact: true }).click();
      await expect(dialog(page)).toHaveCount(0);
    }
    const after = await planDetail(w);
    expect(after.status, 'Keep it changed nothing').toMatch(/DRAFT|IN_PROGRESS/);
    expect(after.archived, 'Keep it changed nothing').toBe(false);
  });

  test('C04 a deadline row opens its details and the client it affects', async ({ page }, info) => {
    const w = await planW();
    const overview = nextApi<Overview>(page, 'GET', 'business/tax-planning/overview');
    await page.goto(app('/tax-planning'));
    const o = (await overview).body;
    const links = page.getByTestId('deadline-link');
    if (o.deadlines.length > 0) {
      // Her report: the second row did not open. Every row is a link to its details.
      await expect(links).toHaveCount(o.deadlines.length);
      const pickRow = links.nth(Math.min(1, o.deadlines.length - 1));
      const target = o.deadlines[Math.min(1, o.deadlines.length - 1)]!;
      await pickRow.click();
      await expect(page).toHaveURL(
        app(`/tax-planning/calendar?item=${encodeURIComponent(target.id)}`),
      );
      // The details open in a dialog titled with the deadline; the body names its clients.
      await expect(dialog(page).getByRole('heading', { name: target.title })).toBeVisible();
      await expect(page.getByTestId('deadline-details')).toContainText(/Affected clients|Client/);
      await shot(page, TAB, 'C04-overview-row', info);
      await dialog(page).getByRole('button', { name: 'Close', exact: true }).click();
    } else note(info, 'note', 'no deadline in the next 120 days on the overview');

    // The run's own milestone (its plan's target completion) names its client and opens its plan.
    await page.goto(app('/tax-planning/calendar'));
    await settled(page);
    const candidates = page
      .getByTestId('calendar-item')
      .filter({ hasText: 'Plan target completion' });
    const n = await candidates.count();
    let found = false;
    for (let i = 0; i < n && !found; i++) {
      await candidates.nth(i).click();
      const details = page.getByTestId('deadline-details');
      await expect(details).toBeVisible();
      if (await details.locator(`a[href="/tax-planning/plans/${w}/edit"]`).count()) {
        found = true;
        await expect(details).toContainText(APPT_NAME);
        await shot(page, TAB, 'C04-milestone', info);
        await details.getByRole('link', { name: 'Open plan' }).click();
        await expect(page).toHaveURL(app(`/tax-planning/plans/${w}/edit`));
      } else {
        await dialog(page).getByRole('button', { name: 'Close', exact: true }).click();
      }
    }
    expect(found, "the run plan's target completion is listed and opens its client").toBe(true);
  });

  test('C16 the Tax Calendar switches between Calendar and List, kept in the address and after reload', async ({
    page,
  }, info) => {
    await page.goto(app('/tax-planning/calendar'));
    await settled(page);
    await page.getByTestId('view-calendar').click();
    await expect(page).toHaveURL(/view=calendar/);
    await expect(page.getByTestId('month-grid')).toBeVisible();
    await expect(page.getByTestId('view-calendar')).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.getByTestId('month-grid')).toBeVisible({ timeout: 60_000 });
    await shot(page, TAB, 'C16-calendar', info);
    await page.getByTestId('view-list').click();
    await expect(page.getByTestId('month-grid')).toHaveCount(0);
    await expect(page).not.toHaveURL(/view=calendar/);
    await shot(page, TAB, 'C16-list', info);
  });

  test('C18 Reports: the Tax Planning reports open in central Reports, filtered to Tax Planning, with the way back', async ({
    page,
  }, info) => {
    await page.goto(app('/tax-planning/reports'));
    await expect(page.getByTestId('tp-reports')).toContainText('Projected Savings by Plan');
    await shot(page, TAB, 'C18-local', info);
    await page.getByTestId('open-in-reports').click();
    await expect(page).toHaveURL(/\/reports\/library\?.*source=tax_plans/);
    await expect(page.getByLabel('Category', { exact: true })).toHaveValue('TAX:tax_plans');
    await expect(page.getByTestId('back-to-origin')).toContainText('Back to');
    await shot(page, TAB, 'C18-library', info);
    await page.getByTestId('back-to-origin').click();
    await expect(page).toHaveURL(/\/tax-planning\/reports/);
    await page.getByTestId('open-report-in-reports').click();
    await expect(page).toHaveURL(/\/reports\/tax_plan_savings/);
    await expect(page.getByText('Projected Savings by Plan').first()).toBeVisible();
    await expect(page.getByTestId('back-to-origin')).toBeVisible();
    await shot(page, TAB, 'C18-report', info);
  });

  test('C22 Clients: plan-name search and the status, plan, year, staff and entity filters, kept in the address and after reload', async ({
    page,
  }, info) => {
    const w = await planW();
    const me = await owner();
    const p = await planDetail(w);
    await openClients(page);
    const box = page.getByRole('searchbox', { name: 'Search clients or plans' });
    await box.fill(PLAN_W);
    await expect(page).toHaveURL(/q=/);
    await expect(apptRow(page)).toHaveCount(1);
    const select = (name: string) => page.getByRole('combobox', { name, exact: true });
    await select('Planning year').selectOption(String(PLAN_YEAR));
    await expect(page).toHaveURL(new RegExp(`year=${PLAN_YEAR}`));
    await expect(apptRow(page), "the row shows the run's plan").toContainText(PLAN_W);
    await select('Plan status').selectOption({ label: PLAN_STATUS[p.status]! });
    await expect(page).toHaveURL(new RegExp(`status=${p.status}`));
    await select('Assigned staff').selectOption(me.id);
    await expect(page).toHaveURL(new RegExp(`staff=${me.id}`));
    await select('Entity type').selectOption('Individual');
    await expect(page).toHaveURL(/entity=Individual/);
    await expect(apptRow(page)).toHaveCount(1);
    await shot(page, TAB, 'C22-filtered', info);
    await page.reload();
    await expect(apptRow(page)).toHaveCount(1, { timeout: 60_000 });
    await expect(select('Entity type')).toHaveValue('Individual');
    await expect(select('Planning year')).toHaveValue(String(PLAN_YEAR));
    // Without a plan: the client has one, so it leaves the list.
    await select('Has a plan').selectOption('no');
    await expect(page).toHaveURL(/plan=no/);
    await expect(apptRow(page)).toHaveCount(0);
    await expect(page.getByText('No clients match')).toBeVisible();
    await expect(page.getByText('Try another search or filter.')).toBeVisible();
    await shot(page, TAB, 'C22-none', info);
  });

  test("C17 Resources: View shows what is sent; Edit is the firm's own words; the staff reference is never client-facing", async ({
    page,
  }, info) => {
    const listed = nextApi<{ items: Resource[] }>(page, 'GET', 'business/tax-planning/resources');
    await page.goto(app('/tax-planning/resources'));
    const resources = (await listed).body.items;
    const staffRef = resources.find((r) => r.staffOnly);
    const sendable = resources.find((r) => r.clientFacing && !r.staffOnly);
    expect(staffRef, 'the staff screening reference is listed').toBeTruthy();
    expect(sendable, 'a client-facing resource is listed').toBeTruthy();
    const list = page.getByTestId('tp-resources');
    const row = (title: string) => list.getByRole('listitem').filter({ hasText: title }).first();

    // View: read-only, what the client is sent.
    await row(sendable!.title).getByRole('button', { name: 'View' }).click();
    const view = page.getByTestId('resource-view');
    await expect(view).toBeVisible();
    if (sendable!.summary) await expect(view).toContainText(sendable!.summary.slice(0, 40));
    await expect(view.getByRole('textbox')).toHaveCount(0);
    await shot(page, TAB, 'C17-view', info);
    // Edit: the firm's own words, with the client-facing switch. Nothing is saved here.
    await dialog(page).getByRole('button', { name: 'Edit' }).click();
    const edit = page.getByTestId('resource-edit');
    await expect(edit.getByLabel('Title *')).toHaveValue(sendable!.title);
    await expect(edit.getByRole('checkbox', { name: /Client-facing/ })).toBeVisible();
    await shot(page, TAB, 'C17-edit', info);
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog(page)).toHaveCount(0);

    // The staff reference: Send stays off, and Edit offers no client-facing switch.
    await expect(
      row(staffRef!.title).getByRole('button', { name: /Send to Client/ }),
    ).toBeDisabled();
    await row(staffRef!.title).getByRole('button', { name: 'View' }).click();
    await dialog(page).getByRole('button', { name: 'Edit' }).click();
    await expect(page.getByTestId('resource-staff-only')).toContainText('never sent to a client');
    await expect(dialog(page).getByRole('checkbox', { name: /Client-facing/ })).toHaveCount(0);
    await shot(page, TAB, 'C17-staff-reference', info);
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();

    // The six resource masters (baseline).
    const titles = resources.map((r) => r.title);
    const masters = [
      'Year-End Tax Planning Checklist',
      'Retirement Contribution Guide',
      'Small Business Deductions Guide',
      'Estimated Tax Payments Explained',
      'Planning Meeting Preparation Checklist',
      'Opportunity Screening Rules',
    ];
    const missing = masters.filter((m) => !titles.some((t) => t.includes(m)));
    expect(resources.length, 'the six masters are listed').toBeGreaterThanOrEqual(6);
    if (missing.length)
      note(info, 'note', `listed under the firm's own words, not the built-in title: ${missing}`);
    note(
      info,
      'NOT LIVE (part)',
      "Edit's save is not made: it changes firm-wide content and the built-in cannot be restored",
    );
  });

  // ---------------------------------------------------------------- the plan editor

  test('C05 Create Plan: Next waits for the client, then names every required field; each is marked; the plan saves', async ({
    page,
  }, info) => {
    const me = await owner();
    await page.goto(app('/tax-planning/plans/new'));
    const step = page.getByTestId('step-client');
    await expect(step).toBeVisible({ timeout: 60_000 });
    const next = page.getByRole('button', { name: 'Next', exact: true }).first();
    await expect(next, 'Next waits for the client').toBeDisabled();
    for (const name of [
      'Client *',
      'Planning Year *',
      'Filing Status *',
      'Entity Type *',
      'Assigned To *',
    ])
      await expect(page.getByRole('combobox', { name, exact: true })).toBeVisible();
    await expect(page.getByLabel('Plan Name *', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Target Completion Date *', { exact: true })).toBeVisible();

    await step.getByLabel('Client *').selectOption(APPT);
    await expect(page.getByTestId('client-card')).toContainText(APPT_NAME);
    // The client's record fills the entity type (it can still be changed).
    const entity = page.getByRole('combobox', { name: 'Entity Type *' });
    await expect(entity).toHaveValue('Individual');
    await entity.selectOption('');
    await page.getByRole('combobox', { name: 'Planning Year *' }).selectOption(String(PLAN_YEAR));
    await page.getByLabel('Plan Name *', { exact: true }).fill(PLAN_E);
    await next.click();
    const message = toast(page, /Complete the required fields:/);
    await expect(message).toBeVisible();
    for (const part of [
      'Choose the filing status',
      'Choose or type the entity type',
      'Choose at least one planning goal',
      'Assign a team member',
      'Choose the target completion date',
    ])
      await expect(message).toContainText(part);
    await expect(page).toHaveURL(app('/tax-planning/plans/new'));
    await shot(page, TAB, 'C05-required', info);

    await page.getByRole('combobox', { name: 'Filing Status *' }).selectOption('SINGLE');
    await page.getByRole('combobox', { name: 'Entity Type *' }).selectOption('Individual');
    await page.getByTestId('step-goals-box').getByLabel('Reduce taxable income').check();
    await page.getByRole('combobox', { name: 'Assigned To *' }).selectOption(me.id);
    await page.getByLabel('Target Completion Date *', { exact: true }).fill(firmDay(40));
    const made = nextApi<Created>(page, 'POST', 'business/tax-planning/plans');
    await next.click();
    const res = await made;
    expect(res.status, 'the plan is saved').toBe(201);
    const id = res.body.id;
    addId('plans', id);
    setRef('e', id);
    await expect(page).toHaveURL(app(`/tax-planning/plans/${id}/edit/financials`), {
      timeout: 60_000,
    });
    await openPlan(page, id);
    await expect(page.getByLabel('Plan Name *', { exact: true })).toHaveValue(PLAN_E);
    await expect(page.getByRole('combobox', { name: 'Entity Type *' })).toHaveValue('Individual');
    await expect(page.getByRole('combobox', { name: 'Assigned To *' })).toHaveValue(me.id);
    await shot(page, TAB, 'C05-saved', info);
  });

  test('C24 the six entity presets and a custom entity type, kept as typed after reload', async ({
    page,
  }, info) => {
    const id = await planE();
    await openPlan(page, id);
    const entity = page.getByRole('combobox', { name: 'Entity Type *' });
    for (const p of ['Individual', 'Sole Proprietor', 'LLC', 'S Corp', 'C Corp', 'Partnership'])
      await expect(entity.locator(`option[value="${p}"]`)).toHaveCount(1);
    await expect(entity.locator('option[value="OTHER"]')).toHaveText('Other (type it)');
    await entity.selectOption('OTHER');
    await page.getByLabel('Custom entity type *', { exact: true }).fill(CUSTOM_ENTITY);
    await page.getByRole('button', { name: 'Save as Draft' }).first().click();
    await expect(toast(page, 'Plan saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Custom entity type *', { exact: true })).toHaveValue(
      CUSTOM_ENTITY,
      { timeout: 60_000 },
    );
    await expect(entity).toHaveValue('OTHER');
    await shot(page, TAB, 'C24-custom', info);
  });

  test('C06 Financial Overview: each figure keeps its source and as-of date; Add Item adds several; all kept after reload', async ({
    page,
  }, info) => {
    const id = await planE();
    await openPlan(page, id, '/financials');
    const step = page.getByTestId('step-financial');
    await expect(step).toContainText(`${PLAN_YEAR - 1} (prior year, $)`);
    await expect(step).toContainText(`${PLAN_YEAR} (projected, $)`);
    const field = (label: string) => page.getByLabel(label, { exact: true });
    await field(`Wages (W-2) ${PLAN_YEAR - 1}`).fill('90000');
    await field(`Wages (W-2) ${PLAN_YEAR}`).fill('95000');
    await field('Wages (W-2) source').selectOption('Tax return');
    await field('Wages (W-2) as of').fill(firmDay(-10));
    // An item's name comes back from its key (custom_<words>): letters, digits and spaces only.
    for (const [item, amount] of [
      ['Home office costs live', '1200'],
      ['Vehicle costs live', '300'],
    ] as const) {
      await field('Additional item').fill(item);
      await page.getByRole('button', { name: 'Add Item' }).click();
      await field(`${item} ${PLAN_YEAR}`).fill(amount);
      await field(`${item} source`).selectOption('Manual entry');
      await field(`${item} as of`).fill(firmDay(-3));
    }
    await shot(page, TAB, 'C06-entered', info);
    await page.getByRole('button', { name: 'Save as Draft' }).click();
    await expect(toast(page, 'Figures saved.')).toBeVisible();
    await page.reload();
    await expect(field(`Wages (W-2) ${PLAN_YEAR}`)).toHaveValue('95000', { timeout: 60_000 });
    await expect(field(`Wages (W-2) ${PLAN_YEAR - 1}`)).toHaveValue('90000');
    await expect(field('Wages (W-2) source')).toHaveValue('Tax return');
    await expect(field('Wages (W-2) as of')).toHaveValue(firmDay(-10));
    await expect(field(`Home office costs live ${PLAN_YEAR}`)).toHaveValue('1200');
    await expect(field(`Vehicle costs live ${PLAN_YEAR}`)).toHaveValue('300');
    await expect(field('Vehicle costs live source')).toHaveValue('Manual entry');
    await expect(field('Vehicle costs live as of')).toHaveValue(firmDay(-3));
    await shot(page, TAB, 'C06-after-reload', info);
  });

  test('C07 Cancel and Back on Financial Overview ask first: Keep Editing, Discard, Save Draft; Cancel on every step', async ({
    page,
  }, info) => {
    const id = await planE();
    await openPlan(page, id, '/financials');
    const wages = page.getByLabel(`Wages (W-2) ${PLAN_YEAR}`, { exact: true });
    const before = await wages.inputValue();
    const prompt = page.getByTestId('leave-prompt');
    await wages.fill('96000');
    await page.getByTestId('plan-cancel').click();
    await expect(prompt).toBeVisible();
    await shot(page, TAB, 'C07-prompt', info);
    await dialog(page).getByRole('button', { name: 'Keep Editing' }).click();
    await expect(prompt).toHaveCount(0);
    await expect(wages).toHaveValue('96000');
    await page.getByTestId('plan-cancel').click();
    await dialog(page).getByRole('button', { name: 'Discard' }).click();
    await expect(page).toHaveURL(app('/tax-planning'));
    await openPlan(page, id, '/financials');
    await expect(wages, 'Discard kept nothing').toHaveValue(before);

    await wages.fill('97000');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(prompt).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Save Draft' }).click();
    await expect(page.getByTestId('step-client')).toBeVisible({ timeout: 60_000 });
    await openPlan(page, id, '/financials');
    await expect(wages, 'Save Draft kept it').toHaveValue('97000');
    for (const step of ['', '/goals', '/implementation', '/review']) {
      await openPlan(page, id, step);
      await expect(page.getByTestId('plan-cancel'), `Cancel on ${step || 'details'}`).toHaveCount(
        1,
      );
    }
    await shot(page, TAB, 'C07-review-cancel', info);
  });

  test('Baseline: the client summary, an editable plan name and the Other goal with its words, kept after reload', async ({
    page,
  }, info) => {
    const id = await planE();
    await openPlan(page, id);
    await expect(page.getByTestId('client-card')).toContainText(APPT_NAME);
    const name = page.getByLabel('Plan Name *', { exact: true });
    const goals = page.getByTestId('step-goals-box');
    await name.fill(`${PLAN_E} renamed`);
    await goals.getByLabel('Other (specify)').check();
    await page.getByLabel('Other goal *', { exact: true }).fill('Synthetic other goal');
    await page.getByRole('button', { name: 'Save as Draft' }).first().click();
    await expect(toast(page, 'Plan saved.')).toBeVisible();
    await page.reload();
    await expect(name).toHaveValue(`${PLAN_E} renamed`, { timeout: 60_000 });
    await expect(goals.getByLabel('Reduce taxable income')).toBeChecked();
    await expect(goals.getByLabel('Other (specify)')).toBeChecked();
    await expect(page.getByLabel('Other goal *', { exact: true })).toHaveValue(
      'Synthetic other goal',
    );
    await shot(page, TAB, 'Baseline-plan-details', info);
    await name.fill(PLAN_E);
    await page.getByRole('button', { name: 'Save as Draft' }).first().click();
    await expect(toast(page, 'Plan saved.')).toBeVisible();
  });

  test('Baseline: the same plan name for the same client and year is refused in words; nothing is made', async ({
    page,
  }, info) => {
    await planE();
    const me = await owner();
    await page.goto(app(`/tax-planning/plans/new?clientId=${APPT}`));
    await expect(page.getByTestId('step-client').getByLabel('Client *')).toHaveValue(APPT, {
      timeout: 60_000,
    });
    await page.getByRole('combobox', { name: 'Planning Year *' }).selectOption(String(PLAN_YEAR));
    await page.getByLabel('Plan Name *', { exact: true }).fill(PLAN_E);
    await page.getByRole('combobox', { name: 'Filing Status *' }).selectOption('SINGLE');
    await page.getByRole('combobox', { name: 'Entity Type *' }).selectOption('Individual');
    await page.getByTestId('step-goals-box').getByLabel('Reduce taxable income').check();
    await page.getByRole('combobox', { name: 'Assigned To *' }).selectOption(me.id);
    await page.getByLabel('Target Completion Date *', { exact: true }).fill(firmDay(40));
    const refused = nextApi<{ code?: string }>(page, 'POST', 'business/tax-planning/plans');
    await page.getByRole('button', { name: 'Next', exact: true }).first().click();
    const res = await refused;
    if (res.status < 300 && res.body) {
      addId('plans', (res.body as unknown as Created).id);
      throw new Error('a second plan with the same name and year was made');
    }
    expect(res.status).toBe(409);
    await expect(
      toast(page, 'This client already has a plan with that name for that year.'),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp('/tax-planning/plans/new'));
    await shot(page, TAB, 'Baseline-duplicate-refused', info);
  });

  // ---------------------------------------------------------------- library and opportunities

  test('C13 New Strategy keeps its required inputs, documents and checklist through edit, archive and restore', async ({
    page,
  }, info) => {
    await page.goto(app('/tax-planning/strategies'));
    await page.getByRole('button', { name: 'New Strategy' }).click();
    const d = page.getByTestId('strategy-dialog');
    await d.getByLabel('Name', { exact: true }).fill(STRATEGY);
    await d.getByLabel('Category', { exact: true }).selectOption('RETIREMENT');
    await d.getByLabel('Description', { exact: true }).fill('Live check strategy (synthetic).');
    await d.getByLabel('Eligibility (one per line)').fill('Has W-2 wages (synthetic)');
    await d.getByTestId('required-inputs').getByRole('checkbox', { name: 'Wages (W-2)' }).check();
    await d.getByLabel('Required Documents (one per line)').fill('Plan statement (synthetic)');
    await d
      .getByLabel('Implementation Checklist (one step per line)')
      .fill('Open the account (synthetic)\nFund it (synthetic)');
    // A new strategy is active; the Active switch shows only once it exists (Edit).
    await expect(d.getByRole('checkbox', { name: 'Active (offered in new plans)' })).toHaveCount(0);
    await shot(page, TAB, 'C13-new', info);
    const made = nextApi<Created>(page, 'POST', 'business/tax-planning/strategies');
    await dialog(page).getByRole('button', { name: 'Save Strategy' }).click();
    const id = (await made).body.id;
    addId('strategies', id);
    setRef('strategy', id);
    await expect(toast(page, 'Strategy added.')).toBeVisible();

    const lib = page.getByTestId('tp-library');
    const row = lib.getByRole('row').filter({ hasText: STRATEGY });
    const menu = async (item: string) => {
      await row.getByRole('button', { name: `Actions for ${STRATEGY}` }).click();
      await page.getByRole('menuitem', { name: item, exact: true }).click();
    };
    await page.reload();
    await page.getByRole('searchbox', { name: 'Search strategies' }).fill(STAMP);
    await expect(row).toHaveCount(1, { timeout: 60_000 });
    await menu('Edit');
    await expect(d.getByLabel('Required Documents (one per line)')).toHaveValue(
      'Plan statement (synthetic)',
    );
    await expect(d.getByLabel('Implementation Checklist (one step per line)')).toHaveValue(
      'Open the account (synthetic)\nFund it (synthetic)',
    );
    await expect(
      d.getByTestId('required-inputs').getByRole('checkbox', { name: 'Wages (W-2)' }),
    ).toBeChecked();
    await expect(d.getByRole('checkbox', { name: 'Active (offered in new plans)' })).toBeChecked();
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();

    await menu('Archive');
    await expect(toast(page, 'Archived.')).toBeVisible();
    await expect(row).toHaveCount(0);
    await page.getByLabel('Show archived').check();
    await expect(row).toHaveCount(1);
    await menu('Restore');
    await expect(toast(page, 'Restored.')).toBeVisible();
    await page.getByLabel('Show archived').uncheck();
    await expect(row).toHaveCount(1);
    await menu('View Details');
    await expect(page.getByTestId('strategy-view')).toContainText('Plan statement (synthetic)');
    await expect(page.getByTestId('strategy-view')).toContainText('Fund it (synthetic)');
    await shot(page, TAB, 'C13-restored', info);
  });

  test('C23 View Details shows the strategy read-only: description, eligibility, inputs, documents, checklist; Edit is apart', async ({
    page,
  }, info) => {
    await libraryStrategy();
    await page.goto(app('/tax-planning/strategies'));
    await page.getByRole('searchbox', { name: 'Search strategies' }).fill(STAMP);
    const row = page.getByTestId('tp-library').getByRole('row').filter({ hasText: STRATEGY });
    await row.getByRole('button', { name: `Actions for ${STRATEGY}` }).click();
    await page.getByRole('menuitem', { name: 'View Details', exact: true }).click();
    const view = page.getByTestId('strategy-view');
    for (const text of [
      'Live check strategy (synthetic).',
      'Has W-2 wages (synthetic)',
      'Wages (W-2)',
      'Plan statement (synthetic)',
      'Open the account (synthetic)',
    ])
      await expect(view).toContainText(text);
    await expect(view.getByRole('textbox')).toHaveCount(0);
    await expect(view.getByRole('checkbox')).toHaveCount(0);
    await expect(dialog(page).getByRole('button', { name: 'Edit' })).toBeVisible();
    await shot(page, TAB, 'C23-view', info);
    await dialog(page).getByRole('button', { name: 'Close', exact: true }).click();
  });

  test('C10 Add Opportunity takes its reasoning; Edit Details changes it, Client Data Used and the actions; kept after reload, with its history', async ({
    page,
  }, info) => {
    await page.goto(app('/tax-planning/opportunities'));
    await page.getByRole('button', { name: 'Add Opportunity' }).click();
    const d = page.getByTestId('add-opp');
    await d.getByLabel('Client', { exact: true }).selectOption(APPT);
    await d.getByLabel('Name', { exact: true }).fill(OPP);
    await d.getByLabel('Category', { exact: true }).selectOption('RETIREMENT');
    await d.getByLabel('Estimated savings ($, optional)').fill('1500');
    await d.getByLabel('Why This Opportunity', { exact: true }).fill('Synthetic reason one.');
    await d.getByRole('button', { name: 'Add Figure' }).click();
    await d.getByLabel('Figure 1', { exact: true }).fill(`${YEAR} W-2 wages (synthetic)`);
    await d.getByLabel('Amount or value 1', { exact: true }).fill('85000');
    await d
      .getByLabel('Recommended Actions (one per line)')
      .fill('Raise the 401(k) deferral (synthetic)');
    await d.getByRole('button', { name: 'Add Check' }).click();
    await d.getByLabel('Check 1', { exact: true }).fill('Has a workplace plan (synthetic)');
    await d.getByRole('checkbox', { name: 'Met' }).check();
    await d.getByLabel('Estimate Basis and Assumptions').fill('Synthetic basis.');
    await d.getByLabel('Documents Needed (one per line)').fill('Latest pay stub (synthetic)');
    await shot(page, TAB, 'C10-add', info);
    const made = nextApi<Created>(page, 'POST', 'business/tax-planning/opportunities');
    await dialog(page).getByRole('button', { name: 'Add', exact: true }).click();
    const id = (await made).body.id;
    addId('opportunities', id);
    setRef('opp', id);
    await expect(toast(page, 'Opportunity added.')).toBeVisible();

    await page.goto(app(`/tax-planning/opportunities/${id}`));
    const why = page.getByRole('region', { name: 'Why this opportunity' });
    await expect(why).toContainText('Synthetic reason one.', { timeout: 60_000 });
    await expect(page.getByTestId('data-used')).toContainText(`${YEAR} W-2 wages (synthetic)`);
    await page.getByTestId('edit-why').click();
    const e = page.getByTestId('edit-opportunity');
    await e.getByLabel('Why This Opportunity', { exact: true }).fill('Synthetic reason two.');
    await e.getByRole('button', { name: 'Add Figure' }).click();
    await e.getByLabel('Figure 2', { exact: true }).fill('Prior-year contributions (synthetic)');
    await e.getByLabel('Amount or value 2', { exact: true }).fill('6000');
    await e
      .getByLabel('Recommended Actions (one per line)')
      .fill('Raise the 401(k) deferral (synthetic)\nOpen an HSA (synthetic)');
    await e.getByRole('button', { name: 'Add Check' }).click();
    await e.getByLabel('Check 2', { exact: true }).fill('Under the limit (synthetic)');
    await shot(page, TAB, 'C10-edit', info);
    await dialog(page).getByRole('button', { name: 'Save Details' }).click();
    await expect(toast(page, 'Details saved.')).toBeVisible();
    await page.reload();
    await expect(why).toContainText('Synthetic reason two.', { timeout: 60_000 });
    await expect(page.getByTestId('data-used')).toContainText(
      'Prior-year contributions (synthetic)',
    );
    await expect(page.getByRole('region', { name: 'Recommended action' })).toContainText(
      'Open an HSA (synthetic)',
    );
    await expect(page.getByRole('region', { name: 'Eligibility and assumptions' })).toContainText(
      'Under the limit (synthetic)',
    );
    await expect(page.getByTestId('opp-history')).toContainText(/edit|detail/i);
    await shot(page, TAB, 'C10-after-reload', info);
  });

  test('C11 a closed opportunity is listed under Closed; Reopen brings it back to Under Review with its history', async ({
    page,
  }, info) => {
    const id = await opportunity();
    const more = async (item: string) => {
      await page.getByRole('button', { name: 'More actions' }).click();
      await page.getByRole('menuitem', { name: item, exact: true }).click();
    };
    await page.goto(app(`/tax-planning/opportunities/${id}`));
    await expect(page.getByTestId('opp-detail')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'More actions' }).click();
    if (await page.getByRole('menuitem', { name: 'Start Review', exact: true }).count()) {
      await page.getByRole('menuitem', { name: 'Start Review', exact: true }).click();
      await expect(toast(page, 'Review started.')).toBeVisible();
    } else await page.keyboard.press('Escape');
    await more('Close');
    await expect(toast(page, 'Closed.')).toBeVisible();
    await expect(page.getByTestId('opp-banner')).toContainText('Closed');

    const queue = async (group: 'open' | 'closed') => {
      await page.goto(app('/tax-planning/opportunities'));
      await page.getByLabel('Group', { exact: true }).selectOption(group);
      await page.getByRole('searchbox', { name: 'Search opportunities' }).fill(STAMP);
      await settled(page);
      return page.getByTestId('opp-link').filter({ hasText: OPP });
    };
    await expect(await queue('closed'), 'listed under Closed').toHaveCount(1, {
      timeout: 60_000,
    });
    await shot(page, TAB, 'C11-closed-filter', info);
    await expect(await queue('open')).toHaveCount(0);

    await page.goto(app(`/tax-planning/opportunities/${id}`));
    await more('Reopen');
    await expect(toast(page, 'Reopened.')).toBeVisible();
    await expect(page.getByTestId('opp-banner')).toContainText('Under Review');
    await page.reload();
    await expect(page.getByTestId('opp-banner')).toContainText('Under Review', {
      timeout: 60_000,
    });
    // Newest first: the reopen (status: under review) above the close (status: closed).
    await expect(page.getByTestId('opp-history')).toContainText(
      /status: under review[\s\S]*status: closed/i,
    );
    await shot(page, TAB, 'C11-reopened', info);
    await expect(await queue('open'), 'back under Open').toHaveCount(1, { timeout: 60_000 });
  });

  test('C10 (regression) Add to Plan merges the opportunity into the chosen plan, once', async ({
    page,
  }, info) => {
    const id = await opportunity();
    const e = await planE();
    await page.goto(app(`/tax-planning/opportunities/${id}`));
    const box = page.getByTestId('add-to-plan');
    await box
      .getByLabel('Select an Existing Plan (Optional)')
      .selectOption({ label: `${PLAN_E} (${PLAN_YEAR})` });
    await box.getByRole('button', { name: 'Add to Plan' }).click();
    await expect(toast(page, 'Added to the plan.')).toBeVisible();
    await expect(page.getByTestId('opp-history')).toContainText(/plan/i);
    await shot(page, TAB, 'C10-added-to-plan', info);
    await openPlan(page, e, '/goals');
    await expect(page.getByTestId('plan-strategy').filter({ hasText: OPP })).toHaveCount(1);
    await shot(page, TAB, 'C10-plan-has-it', info);
  });

  test('Release gate Normal — opportunities: a needed document is marked received and kept; Not Applicable and Dismiss need a reason', async ({
    page,
  }, info) => {
    const id = await opportunity();
    await page.goto(app(`/tax-planning/opportunities/${id}`));
    const docs = page.getByTestId('docs-needed');
    const box = docs.getByRole('checkbox').first();
    await expect(box).toBeVisible({ timeout: 60_000 });
    // The box shows the saved state: it turns once the save answers (a click, not setChecked).
    const was = await box.isChecked();
    await box.click();
    await expect(toast(page, was ? 'Marked not received.' : 'Marked received.')).toBeVisible();
    await expect(box).toBeChecked({ checked: !was });
    await page.reload();
    await expect(box).toBeChecked({ checked: !was, timeout: 60_000 });
    await box.click();
    await expect(toast(page, was ? 'Marked received.' : 'Marked not received.')).toBeVisible();
    await expect(box).toBeChecked({ checked: was });
    for (const name of ['Mark as Not Applicable', 'Dismiss Opportunity']) {
      await page.getByTestId('additional-actions').getByRole('button', { name }).click();
      const go = dialog(page).getByRole('button', { name });
      await expect(go, `${name} waits for the reason`).toBeDisabled();
      await shot(page, TAB, `opportunities-${name}`, info);
      await dialog(page).getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog(page)).toHaveCount(0);
    }
  });

  test('Collapse All (observation): the opportunity screens have no collapsible sections, so nothing to collapse', async ({
    page,
  }, info) => {
    const id = await opportunity();
    await page.goto(app(`/tax-planning/opportunities/${id}`));
    await expect(page.getByTestId('opp-detail')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: /Collapse All|Expand All/i })).toHaveCount(0);
    await expect(page.getByTestId('opp-detail').locator('details')).toHaveCount(0);
    await shot(page, TAB, 'CollapseAll-observation', info);
    note(info, 'observation', 'every section is open; nothing collapses (left for her to confirm)');
  });

  // ---------------------------------------------------------------- the calculator

  const calcField = (page: Page, label: string) => page.getByLabel(label, { exact: true });
  async function calculate(page: Page): Promise<CalcResult> {
    const r = nextApi<CalcResult>(page, 'POST', 'business/tax-planning/calculator/calculate');
    await page.getByRole('button', { name: 'Calculate', exact: true }).click();
    return (await r).body;
  }
  async function baseCase(page: Page, client = true) {
    await page.goto(app('/tax-planning/calculator'));
    const calc = page.getByTestId('tp-calculator');
    await expect(calc).toBeVisible({ timeout: 60_000 });
    if (client) await calc.getByLabel('Client (optional)').selectOption(APPT);
    await calc.getByLabel('Tax year').selectOption(String(YEAR));
    await calc.getByLabel('Filing status').selectOption('SINGLE');
    await calcField(page, 'Wages & salary').fill('120000');
    await calcField(page, 'Retirement contribution').fill('10000');
  }

  test('C26 a result is marked out of date once an input changes; Save waits for Calculate', async ({
    page,
  }, info) => {
    await baseCase(page);
    await calculate(page);
    await expect(page.getByTestId('saving')).toBeVisible();
    await calcField(page, 'Wages & salary').fill('130000');
    await expect(page.getByTestId('calc-stale')).toContainText('It is out of date');
    await expect(page.getByRole('button', { name: 'Save Scenario' })).toBeDisabled();
    await expect(page.getByTestId('save-to-plan')).toHaveCount(0);
    await shot(page, TAB, 'C26-stale', info);
    await calculate(page);
    await expect(page.getByTestId('calc-stale')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save Scenario' })).toBeEnabled();
  });

  test('C21 the calculator explains its method and limits; Add as Strategy names a strategy on the plan', async ({
    page,
  }, info) => {
    const e = await planE();
    await baseCase(page);
    await calculate(page);
    const method = page.getByTestId('methodology');
    await expect(method).toContainText('Federal ordinary income tax');
    await expect(method).toContainText('Checked:');
    await expect(method).toContainText('Not checked:');
    await expect(page.getByTestId('calc-result')).toContainText('Actual results may vary');
    const box = page.getByTestId('save-to-plan');
    await box
      .getByLabel('Plan', { exact: true })
      .selectOption({ label: `${PLAN_E} (${PLAN_YEAR})` });
    await box.getByRole('button', { name: 'Add as Strategy' }).click();
    const d = page.getByRole('dialog', { name: 'Add as Strategy' });
    await expect(d).toContainText(`To ${PLAN_E}`);
    await d.getByLabel('Strategy name').fill(CALC_STRATEGY);
    await shot(page, TAB, 'C21-add-as-strategy', info);
    await d.getByRole('button', { name: 'Add Strategy' }).click();
    await expect(toast(page, `${CALC_STRATEGY} added to the plan.`)).toBeVisible();
    await openPlan(page, e, '/goals');
    await expect(page.getByTestId('plan-strategy').filter({ hasText: CALC_STRATEGY })).toHaveCount(
      1,
    );
    await shot(page, TAB, 'C21-on-the-plan', info);
  });

  test('C19 Save to Plan keeps the scenario on the plan with its inputs and result', async ({
    page,
  }, info) => {
    await planE();
    await baseCase(page);
    await calculate(page);
    await calcField(page, 'Scenario name (optional)').fill(SCENARIO);
    const box = page.getByTestId('save-to-plan');
    await box
      .getByLabel('Plan', { exact: true })
      .selectOption({ label: `${PLAN_E} (${PLAN_YEAR})` });
    const saved = nextApi<Created>(page, 'POST', 'business/tax-planning/calculator/scenarios');
    await box.getByRole('button', { name: 'Save to Plan' }).click();
    const s = await saved;
    expect(s.status).toBe(201);
    addId('scenarios', s.body.id);
    await expect(toast(page, 'Scenario saved to the plan.')).toBeVisible();
    await expect(page.getByTestId('scenarios')).toContainText(SCENARIO);
    await shot(page, TAB, 'C19-saved', info);
  });

  test("C20 the plan lists the client's scenarios; one reopens with the result it kept", async ({
    page,
  }, info) => {
    test.skip(!mine().scenarios.length, 'no scenario of the run (C19 did not save one)');
    const e = await planE();
    await openPlan(page, e, '/goals');
    const link = page
      .getByTestId('plan-scenarios')
      .getByTestId('scenario-link')
      .filter({ hasText: SCENARIO });
    // The list loads after the plan: wait for it rather than count at once.
    await expect(link, "the plan lists the run's scenario").toHaveCount(1, { timeout: 60_000 });
    await shot(page, TAB, 'C20-plan-scenarios', info);
    await link.first().click();
    await expect(page).toHaveURL(/\/tax-planning\/calculator\?scenario=[0-9a-f-]{36}$/);
    await expect(page.getByTestId('kept-result')).toContainText(
      'This is the result kept then; Calculate again to work it out with today',
      { timeout: 60_000 },
    );
    await expect(calcField(page, 'Wages & salary')).toHaveValue('120000');
    await expect(calcField(page, 'Retirement contribution')).toHaveValue('10000');
    await shot(page, TAB, 'C20-reopened', info);
  });

  test('Release gate High — calculations: the saving is the difference shown; limits are flagged; unsupported cases say why', async ({
    page,
  }, info) => {
    await baseCase(page, false);
    const r = await calculate(page);
    expect(r.differenceCents, 'a supported case has a saving').not.toBeNull();
    expect(r.differenceCents).toBe((r.baselineTaxCents ?? 0) - (r.modeledTaxCents ?? 0));
    const shown = centsOf(await page.getByTestId('saving').innerText());
    expect(Math.abs(shown - (r.differenceCents ?? 0)), 'the saving shown').toBeLessThanOrEqual(100);
    await shot(page, TAB, 'gate-calc-supported', info);

    // Over the year's limit: flagged, the amount entered still modelled.
    await calcField(page, 'Retirement contribution').fill('90000');
    const over = await calculate(page);
    expect(over.assumptions.join(' ')).toMatch(/over the \d{4} limit/);
    await expect(page.getByTestId('calc-result')).toContainText(/is over the \d{4} limit/);
    await calcField(page, 'Retirement contribution').fill('10000');

    // Capital gains: unavailable, in words, never a figure.
    await calcField(page, 'Capital gains').fill('5000');
    const gains = await calculate(page);
    expect(gains.differenceCents).toBeNull();
    await expect(page.getByTestId('calc-result')).toContainText(
      'Capital gains rates are not modelled yet.',
    );
    await expect(page.getByTestId('saving')).toHaveCount(0);
    await calcField(page, 'Capital gains').fill('');

    // A year without tables: unavailable, in words.
    await page
      .getByTestId('tp-calculator')
      .getByLabel('Tax year')
      .selectOption(String(YEAR + 1));
    const later = await calculate(page);
    expect(later.differenceCents).toBeNull();
    await expect(page.getByTestId('calc-result')).toContainText(
      `Tax tables for ${YEAR + 1} are not loaded.`,
    );
    await page.getByTestId('tp-calculator').getByLabel('Tax year').selectOption(String(YEAR));

    // No income: blank is not zero.
    await calcField(page, 'Wages & salary').fill('');
    const blank = await calculate(page);
    expect(blank.differenceCents).toBeNull();
    await expect(page.getByTestId('calc-result')).toContainText(
      'Enter at least one income figure.',
    );
    await shot(page, TAB, 'gate-calc-unavailable', info);
    note(info, 'H', 'tax-law accuracy against known expected cases stays her retest');
  });

  // ---------------------------------------------------------------- implementation step

  test("C14 plan documents: Implementation lists the client's documents; one is linked, kept after reload, and removed", async ({
    page,
  }, info) => {
    const id = await planE();
    await openPlan(page, id, '/implementation');
    const docs = page.getByTestId('step-docs');
    await expect(docs).toBeVisible();
    const select = docs.getByLabel('Client document', { exact: true });
    // Until the client's documents load, the empty option reads "This client has no documents"
    // too: read the options only once the page's requests have finished.
    await page.waitForLoadState('networkidle').catch(() => {});
    const options = (await select.locator('option').allTextContents()).slice(1);
    await shot(page, TAB, 'C14-documents', info);
    if (!options.length) {
      await expect(select.locator('option').first()).toHaveText('This client has no documents');
      note(info, 'NOT LIVE (part)', 'the simulator client has no document to link');
      return;
    }
    const fileName = options[0]!;
    await select.selectOption({ index: 1 });
    await docs.getByRole('button', { name: 'Attach', exact: true }).click();
    await expect(toast(page, 'Document attached.')).toBeVisible();
    const remove = docs.getByRole('button', { name: `Remove ${fileName}` });
    await expect(remove).toHaveCount(1);
    await page.reload();
    await expect(remove).toHaveCount(1, { timeout: 60_000 });
    await shot(page, TAB, 'C14-attached', info);
    await remove.click();
    await expect(toast(page, 'Removed.')).toBeVisible();
    await expect(remove).toHaveCount(0);
    note(info, 'H', 'upload, privacy, replace, safe types and scanning stay her retest');
  });

  test('C15 Implementation tasks: Add Task with owner and due date, listed on the plan after reload and opening in Tasks', async ({
    page,
  }, info) => {
    const id = await planE();
    const me = await owner();
    await openPlan(page, id, '/implementation');
    const impl = page.getByTestId('step-implementation');
    const strategies = impl.getByTestId('impl-row');
    if (await strategies.count()) {
      // C15 corrected: assumptions, status options and the implementation date (regression).
      const first = strategies.first();
      await expect(first.getByLabel('Assumptions')).toBeVisible();
      await expect(first.getByRole('combobox', { name: /^Status of / })).toBeVisible();
      await expect(first.getByLabel('Implemented on')).toBeVisible();
    }
    const tasks = page.getByTestId('plan-tasks');
    await expect(tasks.getByRole('link', { name: /Tasks/ }).first()).toHaveAttribute(
      'href',
      '/tasks',
    );
    await page.getByTestId('add-plan-task').click();
    const form = page.getByTestId('plan-task-form');
    await form.getByLabel('Task *').fill(TASK);
    await form.getByLabel('Owner').selectOption(me.id);
    await form.getByLabel('Due date').fill(firmDay(30));
    await shot(page, TAB, 'C15-form', info);
    const made = nextApi<Created>(page, 'POST', 'business/tasks');
    await dialog(page).getByRole('button', { name: 'Add Task' }).click();
    const t = (await made).body.id;
    addId('tasks', t);
    await expect(toast(page, 'Task added.')).toBeVisible();
    await page.reload();
    await expect(tasks).toContainText(TASK, { timeout: 60_000 });
    await expect(tasks).toContainText(me.name);
    const link = tasks.getByRole('link', { name: TASK });
    await expect(link).toHaveAttribute('href', new RegExp(`/tasks/${t}`));
    await shot(page, TAB, 'C15-listed', info);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${t}`));
    await expect(page.locator('main').first()).toContainText(TASK, { timeout: 60_000 });
  });

  test('C12 Schedule Client Discussion opens New Appointment on this client, the planning service and this plan, with the way back', async ({
    page,
  }, info) => {
    const id = await planE();
    await service();
    await openPlan(page, id, '/implementation');
    await expect(page.getByTestId('plan-discussions')).toBeVisible();
    const link = page.getByTestId('schedule-discussion');
    // The planning service comes from the overview, read after the plan: wait for it.
    await expect(link).toHaveAttribute('href', /serviceId=[0-9a-f-]{36}/, { timeout: 60_000 });
    const href = (await link.getAttribute('href')) ?? '';
    expect(href).toContain(`clientId=${APPT}`);
    expect(href).toContain(`taxPlanId=${id}`);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/calendar/new\\?.*taxPlanId=${id}`));
    await expect(page.getByTestId('page-title')).toHaveText('Schedule Appointment');
    await expect(page.locator('main').first()).toContainText(APPT_NAME);
    await shot(page, TAB, 'C12-new-appointment', info);
    await page.getByRole('link', { name: 'Cancel', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/tax-planning/plans/${id}`));
    note(
      info,
      'NOT LIVE (part)',
      'nothing is booked: the link, the client, the service and the plan are checked',
    );
  });

  test('Baseline: overriding an estimate needs a reason and is kept after reload', async ({
    page,
  }, info) => {
    const id = await planE();
    await openPlan(page, id, '/goals');
    const rows = page.getByTestId('plan-strategy');
    test.skip(!(await rows.count()), 'the plan has no strategy (C21 and C10 did not add one)');
    const row = (await rows.filter({ hasText: CALC_STRATEGY }).count())
      ? rows.filter({ hasText: CALC_STRATEGY })
      : rows.first();
    await row.getByRole('button', { name: 'Override estimate' }).click();
    const d = page.getByTestId('override-dialog');
    await d.getByLabel('Estimated savings ($)').fill('2000');
    await d.getByLabel('Reason').fill('');
    const save = dialog(page).getByRole('button', { name: 'Save Override' });
    await expect(save, 'an override waits for its reason').toBeDisabled();
    await d.getByLabel('Reason').fill('Client confirmed the contribution (synthetic)');
    await save.click();
    await expect(row).toContainText('2,000');
    await page.reload();
    await expect(row).toContainText('2,000', { timeout: 60_000 });
    await shot(page, TAB, 'Baseline-override', info);
  });

  // ---------------------------------------------------------------- the approved workflow (plan W)

  test('Workflow plan setup: a Draft shows its next action, owner and readiness; Start Work makes it In Progress', async ({
    page,
  }, info) => {
    const w = await planW();
    const me = await owner();
    const p = await requireStatus(w, ['DRAFT', 'SCHEDULED']);
    await openPlan(page, w, '/review');
    await expect(header(page)).toContainText(PLAN_STATUS[p.status]!);
    await expect(page.getByTestId('workflow-next')).toContainText(
      p.status === 'DRAFT' ? 'Set the plan up' : 'Hold the client discussion',
    );
    await expect(page.getByTestId('workflow-owner')).toHaveText(me.name);
    const ready = page.getByTestId('workflow-readiness').getByRole('listitem');
    await expect(ready.filter({ hasText: 'Assigned to a team member' })).toContainText('Complete');
    await expect(ready.filter({ hasText: 'Target completion date set' })).toContainText('Complete');
    await expect(ready.filter({ hasText: 'A client discussion scheduled' })).toContainText(
      'Use Schedule Client Discussion in Implementation.',
    );
    await expectActions(page, ['Start Work', 'Close Plan', 'Duplicate Plan']);
    await shot(page, TAB, 'WF-setup', info);
    await action(page, 'Start Work').click();
    await expect(toast(page, 'Work started: the plan is In Progress.')).toBeVisible();
    await expect(header(page)).toContainText('In Progress');
    await page.reload();
    await expect(page.getByTestId('review-status')).toContainText('In Progress', {
      timeout: 60_000,
    });
  });

  test('Workflow internal review: a chosen reviewer, Under Review, then back to work', async ({
    page,
  }, info) => {
    const w = await planW();
    const me = await owner();
    await requireStatus(w, ['IN_PROGRESS']);
    await ensureWContent(w);
    await openPlan(page, w, '/review');
    await expectActions(page, [
      'Send for Internal Review',
      'Finalize Plan',
      'Send to Client',
      'Request Information',
      'Close Plan',
      'Duplicate Plan',
    ]);
    await action(page, 'Send for Internal Review').click();
    const go = dialog(page).getByRole('button', { name: 'Send for Review' });
    await expect(go, 'a reviewer is chosen first').toBeDisabled();
    await page.getByTestId('reviewer-dialog').getByLabel('Reviewer *').selectOption(me.id);
    await go.click();
    await expect(toast(page, 'Sent for internal review.')).toBeVisible();
    await expect(header(page)).toContainText('Under Review');
    await expect(page.getByTestId('workflow-reviewer')).toContainText(me.name);
    await page.reload();
    await expect(header(page)).toContainText('Under Review', { timeout: 60_000 });
    await expectActions(page, [
      'Return to Work',
      'Finalize Plan',
      'Send to Client',
      'Close Plan',
      'Duplicate Plan',
    ]);
    await shot(page, TAB, 'WF-under-review', info);
    await action(page, 'Return to Work').click();
    await expect(toast(page, 'The plan is back In Progress.')).toBeVisible();
    await expect(header(page)).toContainText('In Progress');
  });

  test('C09 a send before Finalize is refused and says what to do; nothing is sent', async ({
    page,
  }, info) => {
    const w = await planW();
    await requireStatus(w, ['IN_PROGRESS']);
    await expectSimulatorOnly(APPT);
    await openPlan(page, w, '/review');
    await action(page, 'Send to Client').click();
    const d = page.getByTestId('send-plan');
    await expect(d.getByLabel('Purpose')).toHaveValue('REVIEW');
    await expect(d.getByLabel('Send by').locator('option')).toHaveText(['Portal message', 'Email']);
    await d.getByLabel('Message (optional)').fill(SEND_NOTE);
    await dialog(page).getByRole('button', { name: 'Send', exact: true }).click();
    await expect(
      toast(page, 'The plan is not finalized: use Finalize Plan in Review & Save first.'),
    ).toBeVisible();
    await shot(page, TAB, 'C09-refused', info);
    if (await dialog(page).count())
      await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(header(page)).toContainText('In Progress');
    expect((await planDetail(w)).workflow.sentVersion, 'nothing was sent').toBeNull();
  });

  test('C08 Finalize names a stale figure and where to fix it; once fixed it is Finalized in every view', async ({
    page,
  }, info) => {
    const w = await planW();
    await requireStatus(w, ['IN_PROGRESS']);
    await ensureWContent(w);
    await openPlan(page, w, '/financials');
    const asOf = page.getByLabel('Wages (W-2) as of', { exact: true });
    try {
      await asOf.fill(`${YEAR - 2}-01-15`);
      await page.getByRole('button', { name: 'Save as Draft' }).click();
      await expect(toast(page, 'Figures saved.')).toBeVisible();
      await action(page, 'Finalize Plan').click();
      await expect(
        toast(
          page,
          `Not ready yet. Wages (W-2) (${PLAN_YEAR}) is more than a year old: update it in Financial Overview.`,
        ),
      ).toBeVisible();
      await expect(header(page)).toContainText('In Progress');
      await shot(page, TAB, 'C08-blocker', info);
      await asOf.fill(firmDay(0));
      await page.getByRole('button', { name: 'Save as Draft' }).click();
      await expect(toast(page, 'Figures saved.')).toBeVisible();
    } finally {
      // Setup only: a stale figure left behind would block every later Finalize.
      await ensureWContent(w);
    }

    await openPlan(page, w, '/review');
    await expect(
      page
        .getByTestId('workflow-readiness')
        .getByRole('listitem')
        .filter({ hasText: 'Financial figures current' }),
    ).toContainText('Complete');
    await action(page, 'Finalize Plan').click();
    await expect(toast(page, 'Plan finalized.')).toBeVisible();
    await expect(header(page)).toContainText('Finalized');
    await expect(page.getByTestId('review-status')).toContainText('Finalized');
    await expect(page.getByTestId('plan-frozen')).toContainText('change only through Revise');
    await shot(page, TAB, 'C08-finalized', info);
    // The Clients list shows the plan's own status.
    await openClients(page, `?q=${encodeURIComponent(PLAN_W)}&year=${PLAN_YEAR}`);
    await expect(apptRow(page)).toContainText(PLAN_W);
    await expect(apptRow(page)).toContainText('Finalized');
    await shot(page, TAB, 'C08-clients-list', info);
  });

  test('C09 Send to Client for review: Awaiting Client Review in every view, after reload (simulator client only)', async ({
    page,
  }, info) => {
    const w = await planW();
    await requireStatus(w, ['FINALIZED']);
    await expectSimulatorOnly(APPT);
    await openPlan(page, w, '/review');
    await expectActions(page, [
      'Send to Client',
      'Send for Internal Review',
      'Revise Plan',
      'Close Plan',
      'Duplicate Plan',
    ]);
    await action(page, 'Send to Client').click();
    const d = page.getByTestId('send-plan');
    await expect(dialog(page)).toContainText(
      'Only the client notes are sent, never the internal ones.',
    );
    await expect(d.getByLabel('Purpose')).toHaveValue('REVIEW');
    await d.getByLabel('Send by').selectOption('PORTAL_MESSAGE');
    await d.getByLabel('Message (optional)').fill(SEND_NOTE);
    await shot(page, TAB, 'C09-send-dialog', info);
    await dialog(page).getByRole('button', { name: 'Send', exact: true }).click();
    await expect(toast(page, /Plan sent for the client.s review\./)).toBeVisible();
    await expect(header(page)).toContainText('Awaiting Client Review');
    await expect(page.getByTestId('workflow-owner')).toHaveText('The client');
    await expect(page.getByTestId('plan-workflow')).toContainText(/Version \d+ sent for review/);
    await expect(action(page, 'Mark Implemented')).toHaveCount(0);
    await expect(action(page, 'Deliver to Client')).toHaveCount(0);
    const sent = (await planDetail(w)).workflow.sentVersion;
    expect(sent).not.toBeNull();
    setRef('sent1', String(sent));
    await page.reload();
    await expect(page.getByTestId('review-status')).toContainText('Awaiting Client Review', {
      timeout: 60_000,
    });
    await openClients(page, `?q=${encodeURIComponent(PLAN_W)}&year=${PLAN_YEAR}`);
    await expect(apptRow(page)).toContainText('Awaiting Client Review');
    await shot(page, TAB, 'C09-awaiting', info);
  });

  test('Release gate First — privacy: the message the client gets carries the client notes, never the internal notes', async ({
    page,
  }, info) => {
    const w = await planW();
    const p = await planDetail(w);
    test.skip(p.workflow.sentVersion === null, 'the plan was not sent (C09 did not run)');
    await page.goto(app(`/clients/${APPT}/messages`));
    await settled(page);
    const views = page.getByRole('button', {
      name: new RegExp(`^View Your ${PLAN_YEAR} tax plan$`),
    });
    const n = await views.count();
    let found = false;
    for (let i = 0; i < n && !found; i++) {
      await views.nth(i).click();
      // Every plan message lists its strategies: wait for the body before reading it.
      await expect(dialog(page)).toContainText('Strategies:', { timeout: 30_000 });
      const text = await dialog(page).innerText();
      if (text.includes(PLAN_W)) {
        found = true;
        expect(text, 'the client notes are sent').toContain(CLIENT_NOTE);
        expect(text, 'the internal notes are never sent').not.toContain(INTERNAL_NOTE);
        expect(text).toContain('Actual results may vary');
        await shot(page, TAB, 'gate-privacy-message', info);
      }
      await page.keyboard.press('Escape');
      await expect(dialog(page)).toHaveCount(0);
    }
    expect(found, "the plan's message is in the client's conversations").toBe(true);
    note(
      info,
      'NOT LIVE (part)',
      "the client's own view: QA Appointments Client has no portal login",
    );
  });

  test("Workflow information requests: Request Information asks by portal message; Mark Answered keeps the answer; a client's request sets Needs Review", async ({
    page,
  }, info) => {
    const w = await planW();
    await requireStatus(w, ['AWAITING_CLIENT']);
    await expectSimulatorOnly(APPT);
    await openPlan(page, w, '/review');
    await action(page, 'Request Information').click();
    const d = page.getByTestId('request-dialog');
    await d.getByLabel('The client answers with').selectOption('DOCUMENT');
    await d.getByLabel('What you need *').fill(`${runTag}: please upload a synthetic pay stub.`);
    await dialog(page).getByRole('button', { name: 'Send Request' }).click();
    await expect(toast(page, 'Request sent to the client by a portal message.')).toBeVisible();
    const requests = page.getByTestId('plan-requests');
    const asked = requests.getByRole('listitem').filter({ hasText: 'synthetic pay stub' });
    await expect(asked).toContainText('Asked of the client · Document upload');
    await asked.getByRole('button', { name: 'Mark Answered' }).click();
    await page.getByTestId('answer-dialog').getByLabel('The answer *').fill(`${runTag}: received.`);
    await dialog(page).getByRole('button', { name: 'Mark Answered' }).click();
    await expect(toast(page, 'Request marked answered.')).toBeVisible();
    await expect(asked).toContainText('Answered');
    await expect(asked).toContainText(`Answer: ${runTag}: received.`);
    await shot(page, TAB, 'WF-information-request', info);

    await action(page, "Record Client's Request").click();
    const r = page.getByTestId('request-dialog');
    await r.getByLabel('The client asked for').selectOption('REVISION');
    await r.getByLabel('Their request *').fill(`${runTag}: the client asked to add an HSA.`);
    await dialog(page).getByRole('button', { name: 'Record Request' }).click();
    await expect(toast(page, /The client.s request was recorded\./)).toBeVisible();
    await expect(header(page)).toContainText('Needs Review');
    await expect(requests).toContainText('From the client · Revision');
    await page.reload();
    await expect(header(page)).toContainText('Needs Review', { timeout: 60_000 });
    await shot(page, TAB, 'WF-needs-review', info);
  });

  test('Workflow revision work: Start Revision is In Progress; finalized again and resent as a newer version', async ({
    page,
  }, info) => {
    const w = await planW();
    const p = await requireStatus(w, ['READY_FOR_REVIEW']);
    const before = p.workflow.sentVersion ?? 0;
    await openPlan(page, w, '/review');
    await expect(page.getByTestId('plan-frozen')).toContainText(
      'Use Start Revision to change the plan.',
    );
    await expectActions(page, [
      'Start Revision',
      'Request Information',
      'Close Plan',
      'Duplicate Plan',
    ]);
    await action(page, 'Start Revision').click();
    await expect(toast(page, 'Revision started: the plan is In Progress.')).toBeVisible();
    await expect(header(page)).toContainText('In Progress');
    await expect(page.getByTestId('plan-frozen')).toHaveCount(0);
    await action(page, 'Finalize Plan').click();
    await expect(toast(page, 'Plan finalized.')).toBeVisible();
    await expectSimulatorOnly(APPT);
    await action(page, 'Send to Client').click();
    await page.getByTestId('send-plan').getByLabel('Message (optional)').fill(SEND_NOTE);
    await dialog(page).getByRole('button', { name: 'Send', exact: true }).click();
    await expect(toast(page, /Plan sent for the client.s review\./)).toBeVisible();
    await expect(header(page)).toContainText('Awaiting Client Review');
    const after = (await planDetail(w)).workflow.sentVersion ?? 0;
    expect(after, 'sent again as a newer version').toBeGreaterThan(before);
    await expect(page.getByTestId('plan-workflow')).toContainText(
      `Version ${after} sent for review`,
    );
    await shot(page, TAB, 'WF-resent', info);
  });

  test('Workflow client approval: a documented manual approval of the exact version sent, kept', async ({
    page,
  }, info) => {
    const w = await planW();
    const p = await requireStatus(w, ['AWAITING_CLIENT']);
    const v = p.workflow.sentVersion!;
    await openPlan(page, w, '/review');
    await action(page, 'Record Client Approval').click();
    const d = page.getByTestId('approval-dialog');
    await expect(d.getByLabel('Approved version *')).toHaveValue(String(v));
    await d.getByLabel('Approved on *').fill(firmDay(0));
    await d.getByLabel('How it was approved *').fill(`${runTag}: approved by phone (synthetic).`);
    await shot(page, TAB, 'WF-approval-dialog', info);
    await dialog(page).getByRole('button', { name: 'Record Approval' }).click();
    await expect(toast(page, 'Client approval recorded.')).toBeVisible();
    await expect(header(page)).toContainText('Client Approved');
    const approvals = page.getByTestId('plan-approvals');
    await expect(approvals).toContainText(`Version ${v} approved`);
    await expect(approvals).toContainText('documented manual approval');
    await page.reload();
    await expect(approvals).toContainText(`Version ${v} approved`, { timeout: 60_000 });
    await shot(page, TAB, 'WF-approved', info);
  });

  test('Workflow delivery: Deliver to Client is its own step; the status stays Client Approved (simulator client only)', async ({
    page,
  }, info) => {
    const w = await planW();
    await requireStatus(w, ['CLIENT_APPROVED']);
    await expectSimulatorOnly(APPT);
    await openPlan(page, w, '/review');
    await expectActions(page, [
      'Mark Implemented',
      'Deliver to Client',
      'Revise Plan',
      'Close Plan',
      'Duplicate Plan',
    ]);
    await action(page, 'Deliver to Client').click();
    const d = page.getByTestId('send-plan');
    await expect(d.getByLabel('Purpose')).toHaveValue('DELIVERY');
    await d.getByLabel('Message (optional)').fill(SEND_NOTE);
    await dialog(page).getByRole('button', { name: 'Send', exact: true }).click();
    await expect(toast(page, 'The approved plan was delivered to the client.')).toBeVisible();
    await expect(header(page)).toContainText('Client Approved');
    await expect(action(page, 'Deliver to Client')).toHaveCount(0);
    await expect(action(page, 'Mark Implemented')).toBeVisible();
    await expect(page.getByTestId('plan-workflow')).toContainText(/delivered/);
    await shot(page, TAB, 'WF-delivered', info);
  });

  test('Workflow implementation: Mark Implemented only after approval, asks first, kept after reload', async ({
    page,
  }, info) => {
    const w = await planW();
    await requireStatus(w, ['CLIENT_APPROVED']);
    // Implemented needs a strategy being put into action (tracking, not a change of content).
    await openPlan(page, w, '/implementation');
    await page
      .getByRole('combobox', { name: `Status of ${W_STRATEGY}` })
      .selectOption('IN_PROGRESS');
    await expect(toast(page, 'Status saved.')).toBeVisible();
    await openPlan(page, w, '/review');
    await action(page, 'Mark Implemented').click();
    const c = page.getByRole('dialog', { name: 'Mark this plan Implemented?' });
    await expect(c).toContainText('Delivering it to the client is a separate step.');
    await shot(page, TAB, 'WF-implemented-confirm', info);
    await c.getByRole('button', { name: 'Mark Implemented' }).click();
    await expect(toast(page, 'Plan marked Implemented.')).toBeVisible();
    await expect(header(page)).toContainText('Implemented');
    await page.reload();
    await expect(page.getByTestId('review-status')).toContainText('Implemented', {
      timeout: 60_000,
    });
  });

  test('C27 Closed is read-only until Reopen with a reason; Finalized is shown and changes only through Revise; both reasons kept', async ({
    page,
  }, info) => {
    const w = await planW();
    const p = await requireStatus(w, [
      'IN_PROGRESS',
      'FINALIZED',
      'AWAITING_CLIENT',
      'CLIENT_APPROVED',
      'IMPLEMENTED',
    ]);
    // Finalize needs a strategy: when the chain stopped early, the plan gets its content here.
    if (p.status === 'IN_PROGRESS') await ensureWContent(w);
    await openPlan(page, w, '/goals');
    await action(page, 'Close Plan').click();
    const c = page.getByRole('dialog', { name: 'Close this plan?' });
    await c.getByRole('button', { name: 'Close Plan' }).click();
    await expect(toast(page, 'Plan closed.')).toBeVisible();
    await expect(header(page)).toContainText('Closed');
    await expect(
      page.getByText('This plan is closed and read-only. Use Reopen Plan, with the reason'),
    ).toBeVisible();
    await expectActions(page, ['Reopen Plan', 'Duplicate Plan']);
    const include = page.getByRole('checkbox', { name: /^Include / }).first();
    await expect(include, 'a closed plan is not edited').toBeDisabled();
    await shot(page, TAB, 'C27-closed', info);

    await action(page, 'Reopen Plan').click();
    const go = dialog(page).getByRole('button', { name: 'Reopen Plan' });
    await expect(go, 'Reopen waits for the reason').toBeDisabled();
    await page.getByTestId('reason-dialog').getByLabel('Reason *').fill(REOPEN_REASON);
    await go.click();
    await expect(toast(page, 'Plan reopened.')).toBeVisible();
    await expect(header(page)).toContainText('In Progress');
    await expect(include).toBeEnabled();

    await action(page, 'Finalize Plan').click();
    await expect(toast(page, 'Plan finalized.')).toBeVisible();
    await expect(header(page)).toContainText('Finalized');
    await expect(page.getByTestId('plan-frozen')).toContainText('change only through Revise');
    await expect(include).toBeDisabled();
    await shot(page, TAB, 'C27-finalized', info);
    await action(page, 'Revise Plan').click();
    await page.getByTestId('reason-dialog').getByLabel('Reason *').fill(REVISE_REASON);
    await dialog(page).getByRole('button', { name: 'Revise Plan' }).click();
    await expect(toast(page, 'Plan back in progress for revision.')).toBeVisible();
    await expect(header(page)).toContainText('In Progress');
    await expect(include).toBeEnabled();

    await openPlan(page, w, '/review');
    const history = page.getByTestId('plan-history');
    await expect(history).toContainText(`Reason: ${REOPEN_REASON}`);
    await expect(history).toContainText(`Reason: ${REVISE_REASON}`);
    await shot(page, TAB, 'C27-history', info);
  });

  test('C25 a kept version opens read-only with its own send history and the approval of exactly that version', async ({
    page,
  }, info) => {
    const w = await planW();
    const p = await planDetail(w);
    const v = p.workflow.approvedVersion;
    test.skip(v === null, 'no approved version (the approval row did not run)');
    await openPlan(page, w, '/review');
    const entry = page
      .getByTestId('step-review')
      .getByRole('listitem')
      .filter({ hasText: `Version ${v} · sent` });
    await entry.getByTestId('view-version').click();
    const view = page.getByTestId('version-view');
    await expect(view).toContainText(W_STRATEGY, { timeout: 60_000 });
    await expect(view.getByRole('textbox')).toHaveCount(0);
    await expect(view.getByRole('combobox')).toHaveCount(0);
    const history = page.getByTestId('version-history');
    await expect(history).toContainText(/Sent for the client.s review/);
    await expect(history.getByTestId('version-approval')).toContainText(
      'Approved by the client on',
    );
    await expect(history.getByTestId('version-approval')).toContainText(
      'documented manual approval',
    );
    await shot(page, TAB, 'C25-version', info);
  });

  test('Release gate High — snapshots: a version sent earlier keeps what was sent after a later change', async ({
    page,
  }, info) => {
    const w = await planW();
    const first = Number(mine().sent1);
    test.skip(!first, 'no sent version recorded (C09 did not run)');
    const p = await requireStatus(w, ['IN_PROGRESS']);
    const s = p.strategies.find((x) => x.name === W_STRATEGY);
    test.skip(!s, 'the plan has no run strategy');
    // Setup: a later change of the strategy's assumptions (allowed while In Progress).
    const later = `${runTag}: assumptions changed after sending`;
    const api = await apiAs('owner');
    try {
      await ok<PlanDetail>(
        await api.patch(`business/tax-planning/plans/${w}/strategies/${s!.id}`, {
          data: { assumptions: later, etag: p.etag },
        }),
        'later change',
      );
    } finally {
      await api.dispose();
    }
    await openPlan(page, w, '/review');
    await page
      .getByTestId('step-review')
      .getByRole('listitem')
      .filter({ hasText: `Version ${first} · sent` })
      .getByTestId('view-version')
      .click();
    const view = page.getByTestId('version-view');
    await expect(view).toContainText(W_ASSUMPTIONS, { timeout: 60_000 });
    await expect(view).not.toContainText(later);
    await shot(page, TAB, 'gate-snapshot', info);
    note(info, 'NOT LIVE (part)', "the client's receipt: the simulator client has no portal login");
  });

  test('Release gate High — lifecycle: the history keeps every step, each with who and when', async ({
    page,
  }, info) => {
    const w = await planW();
    const p = await planDetail(w);
    test.skip(
      p.workflow.approvedVersion === null,
      'the workflow chain did not reach the approval: its own rows say where it stopped',
    );
    await openPlan(page, w, '/review');
    const history = page.getByTestId('plan-history');
    for (const status of [
      'In Progress',
      'Under Review',
      'Finalized',
      'Awaiting Client Review',
      'Needs Review',
      'Client Approved',
      'Implemented',
      'Closed',
    ])
      await expect(history, `the history records ${status}`).toContainText(`· ${status}`);
    await shot(page, TAB, 'gate-lifecycle', info);
  });

  test('Context relevant actions: each plan offers exactly the actions its status allows, never a strategy status', async ({
    page,
  }, info) => {
    for (const [id, row] of [
      [await planW(), 'workflow'],
      [await planE(), 'editor'],
    ] as const) {
      const read = nextApi<PlanDetail>(page, 'GET', `business/tax-planning/plans/${id}`);
      await openPlan(page, id, '/review');
      const p = (await read).body;
      await expectActions(
        page,
        p.workflow.actions.map((a) => ACTION_LABEL[a] ?? a),
      );
      for (const strategyStatus of ['Proposed', 'Accepted', 'Declined'])
        await expect(action(page, strategyStatus)).toHaveCount(0);
      await shot(page, TAB, `context-actions-${row}`, info);
    }
  });

  test('Duplicate Plan: an editable Draft copy; the original unchanged', async ({ page }, info) => {
    const w = await planW();
    const before = await planDetail(w);
    await openPlan(page, w, '/review');
    await action(page, 'Duplicate Plan').click();
    const name = page.getByTestId('duplicate-dialog').getByLabel('Name of the copy *');
    await expect(name).toHaveValue(`${before.name} (copy)`);
    const made = nextApi<Created>(page, 'POST', `business/tax-planning/plans/${w}/duplicate`);
    await dialog(page).getByRole('button', { name: 'Duplicate Plan' }).click();
    const copy = (await made).body.id;
    addId('plans', copy);
    await expect(page).toHaveURL(app(`/tax-planning/plans/${copy}/edit`), { timeout: 60_000 });
    await expect(header(page)).toContainText('Draft');
    await expect(page.getByTestId('workflow-actions').getByRole('button').first()).toHaveText(
      'Start Work',
    );
    await expect(page.getByLabel('Plan Name *', { exact: true })).toBeEditable();
    await shot(page, TAB, 'Duplicate-copy', info);
    const after = await planDetail(w);
    expect(after.status, 'the original keeps its status').toBe(before.status);
    expect(after.name).toBe(before.name);
  });

  // ---------------------------------------------------------------- project deadlines

  test('Project Deadlines: beside Reports; Add Deadline with service, client and reminders, private by default; kept after reload; Edit keeps the rest; Delete asks first', async ({
    page,
  }, info) => {
    const svc = await service();
    await page.goto(app('/tax-planning/deadlines'));
    const tabs = page.getByRole('tablist', { name: 'Tax planning views' }).getByRole('tab');
    await expect(tabs).toHaveText([
      'Overview',
      'Clients',
      'Planning Opportunities',
      'Strategies & Recommendations',
      'Tax Calendar',
      'Resources',
      'Reports',
      'Project Deadlines',
    ]);
    await expect(tabs.filter({ hasText: 'Project Deadlines' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.getByRole('button', { name: 'Add Deadline' }).click();
    const form = page.getByTestId('deadline-form');
    await form.getByLabel('Deadline name').fill(DEADLINE);
    await form.getByLabel('Due date').fill(firmDay(45));
    await form.getByLabel('Due time').fill('15:30');
    await form.getByLabel('Description (optional)').fill('Live check deadline (synthetic).');
    await form.getByRole('button', { name: 'Add Deadline' }).click();
    await expect(form.getByTestId('deadline-form-error')).toHaveText('Choose a service.');
    await form.getByLabel('Service', { exact: true }).selectOption({ label: svc.name });
    await form.getByLabel('Client (optional)').selectOption({ label: APPT_NAME });
    await expect(form.getByRole('radio', { name: 'Private: only me' })).toBeChecked();
    await form.getByRole('button', { name: 'Add Reminder' }).click();
    await form.getByLabel('Reminder 2 amount').fill('2');
    await form.getByLabel('Reminder 2 unit').selectOption('HOURS');
    // In the bell only: no email reaches anyone.
    const emails = form.getByTestId('deadline-reminders').getByRole('checkbox', { name: 'Email' });
    for (let i = 0; i < (await emails.count()); i++) await emails.nth(i).uncheck();
    await shot(page, TAB, 'Deadlines-add', info);
    const made = nextApi<Created>(page, 'POST', 'business/tax-planning/project-deadlines');
    await form.getByRole('button', { name: 'Add Deadline' }).click();
    addId('deadlines', (await made).body.id);
    await expect(page.getByTestId('deadlines-result')).toHaveText(`${DEADLINE} is added.`);
    const row = page
      .getByTestId('project-deadlines')
      .getByRole('row')
      .filter({ hasText: DEADLINE });
    await page.reload();
    await expect(row).toContainText(svc.name, { timeout: 60_000 });
    await expect(row).toContainText(APPT_NAME);
    await expect(row).toContainText('You');
    await expect(row).toContainText('Private');
    await expect(row).toContainText('2 hours before');
    await shot(page, TAB, 'Deadlines-listed', info);

    await page.getByRole('button', { name: `Actions for ${DEADLINE}` }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(form.getByLabel('Service', { exact: true })).toHaveValue(svc.id);
    await expect(form.getByLabel('Reminder 2 unit')).toHaveValue('HOURS');
    await form
      .getByLabel('Description (optional)')
      .fill('Live check deadline, edited (synthetic).');
    await form.getByRole('button', { name: 'Save Deadline' }).click();
    await expect(page.getByTestId('deadlines-result')).toHaveText(`${DEADLINE} is saved.`);
    await expect(row).toContainText('Private');

    await page.getByRole('button', { name: `Actions for ${DEADLINE}` }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await page
      .getByRole('dialog', { name: 'Delete this deadline?' })
      .getByRole('button', { name: 'Delete Deadline' })
      .click();
    await expect(page.getByTestId('deadlines-result')).toHaveText(`${DEADLINE} is deleted.`);
    await expect(row).toHaveCount(0);
  });

  test('Project Deadlines: shared with a chosen coworker, who sees its owner and may complete it but not edit or delete it', async ({
    page,
    browser,
  }, info) => {
    test.skip(!hasLogin('staff'), 'no staff login');
    const svc = await service();
    await freshSession(browser, 'staff');
    const coworker = await whoIs('staff');
    const me = await owner();
    await page.goto(app('/tax-planning/deadlines'));
    await page.getByRole('button', { name: 'Add Deadline' }).click();
    const form = page.getByTestId('deadline-form');
    await form.getByLabel('Deadline name').fill(SHARED_DEADLINE);
    await form.getByLabel('Due date').fill(firmDay(46));
    await form.getByLabel('Due time').fill('10:00');
    await form.getByLabel('Service', { exact: true }).selectOption({ label: svc.name });
    await form.getByRole('radio', { name: 'Shared with chosen coworkers' }).check();
    await form.getByRole('checkbox', { name: coworker.name, exact: true }).check();
    const emails = form.getByTestId('deadline-reminders').getByRole('checkbox', { name: 'Email' });
    for (let i = 0; i < (await emails.count()); i++) await emails.nth(i).uncheck();
    const made = nextApi<Created>(page, 'POST', 'business/tax-planning/project-deadlines');
    await form.getByRole('button', { name: 'Add Deadline' }).click();
    addId('deadlines', (await made).body.id);
    await expect(page.getByTestId('deadlines-result')).toHaveText(`${SHARED_DEADLINE} is added.`);
    const row = (p: Page) =>
      p.getByTestId('project-deadlines').getByRole('row').filter({ hasText: SHARED_DEADLINE });
    await expect(row(page).getByTestId('deadline-shared')).toContainText(coworker.name);
    await shot(page, TAB, 'Deadlines-shared', info);

    // The coworker's own screen.
    const ctx = await browser.newContext({
      storageState: statePath('staff'),
      viewport: page.viewportSize() ?? { width: 1165, height: 900 },
    });
    try {
      const other = await ctx.newPage();
      await other.goto(app('/tax-planning/deadlines'));
      await expect(row(other)).toContainText(me.name, { timeout: 60_000 });
      await other.getByRole('button', { name: `Actions for ${SHARED_DEADLINE}` }).click();
      await expect(other.getByRole('menuitem', { name: 'Edit' })).toHaveCount(0);
      await expect(other.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
      await shot(other, TAB, 'Deadlines-coworker', info);
      await other.getByRole('menuitem', { name: 'Mark Complete' }).click();
      await expect(other.getByTestId('deadlines-result')).toHaveText(
        `${SHARED_DEADLINE} is complete.`,
      );
    } finally {
      await ctx.close();
    }
    await page.reload();
    await page.getByRole('combobox', { name: 'Status' }).selectOption('completed');
    await expect(row(page)).toContainText('Completed', { timeout: 60_000 });
  });

  // ---------------------------------------------------------------- pages with the run's records, both widths
  // (after C05 and C10, which make the plan and the opportunity through the screens)

  test('@narrow LAYOUT an opportunity: no sideways scroll', async ({ page }, info) => {
    const id = await opportunity();
    await layout(page, app(`/tax-planning/opportunities/${id}`), 'LAYOUT-opportunity', info);
    await expect(page.getByTestId('opp-detail')).toBeVisible();
  });
  test('@narrow LAYOUT each step of a plan: no sideways scroll', async ({ page }, info) => {
    const id = await planE();
    for (const [step, name] of [
      ['', 'details'],
      ['/financials', 'financials'],
      ['/goals', 'goals'],
      ['/implementation', 'implementation'],
      ['/review', 'review'],
    ]) {
      await layout(page, app(`/tax-planning/plans/${id}/edit${step}`), `LAYOUT-plan-${name}`, info);
      await expect(page.getByTestId('plan-workflow')).toBeVisible();
    }
  });
  test('@narrow LAYOUT the pages Tax Planning opens elsewhere (New Appointment, central Reports): no sideways scroll', async ({
    page,
  }, info) => {
    const id = await planE();
    await layout(
      page,
      app(`/calendar/new?clientId=${APPT}&taxPlanId=${id}&from=%2Ftax-planning`),
      'LAYOUT-new-appointment',
      info,
    );
    await layout(page, app('/tax-planning/reports'), 'LAYOUT-reports-again', info);
    await page.getByTestId('open-in-reports').click();
    await expect(page).toHaveURL(/\/reports\/library/);
    await settled(page);
    await expectNoSideScroll(page);
    await shot(page, TAB, 'LAYOUT-central-reports-library', info);
  });

  // ---------------------------------------------------------------- release gates (Normal)

  test('Release gate Normal — plans and files: a save over a newer save is refused in words; nothing is overwritten', async ({
    page,
  }, info) => {
    const id = await planE();
    await openPlan(page, id);
    const other = await page.context().newPage();
    try {
      await openPlan(other, id);
      // The second page keeps the plan as it loaded it (its rereads fail, in this browser only).
      await other.route(
        (u) => u.pathname === `/api/v1/business/tax-planning/plans/${id}`,
        (route: Route) => (route.request().method() === 'GET' ? route.abort() : route.fallback()),
      );
      const notes = (p: Page) => p.getByLabel('Internal notes (staff only)', { exact: true });
      await notes(page).fill(`${runTag} note A`);
      await page.getByRole('button', { name: 'Save as Draft' }).first().click();
      await expect(toast(page, 'Plan saved.')).toBeVisible();
      await notes(other).fill(`${runTag} note B`);
      await other.getByRole('button', { name: 'Save as Draft' }).first().click();
      await expect(
        toast(other, 'Someone saved this after you opened it. Reload and try again.'),
      ).toBeVisible();
      await shot(other, TAB, 'gate-save-conflict', info);
    } finally {
      await other.close();
    }
    await page.reload();
    await expect(page.getByLabel('Internal notes (staff only)', { exact: true })).toHaveValue(
      `${runTag} note A`,
      { timeout: 60_000 },
    );
  });

  test('Release gate Normal — usability and failures: a failed load reads well; an empty search says so; a dialog closes on Escape and gives focus back', async ({
    page,
  }, info) => {
    const match = (u: URL) => u.pathname === '/api/v1/business/tax-planning/overview';
    const fail = (route: Route) =>
      route.request().method() === 'GET'
        ? route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({
              statusCode: 500,
              message: 'The live check made this call fail.',
            }),
          })
        : route.fallback();
    await page.route(match, fail);
    await page.goto(app('/tax-planning'));
    await expect(page.getByTestId('tp-error')).toHaveText(
      'Tax planning is not available right now. We could not load it. Try again in a moment.',
      { timeout: 60_000 },
    );
    await shot(page, TAB, 'gate-failed-load', info);
    await page.unroute(match, fail);

    await openClients(page, `?q=${encodeURIComponent(`zz no match ${STAMP}`)}`);
    await expect(page.getByText('No clients match')).toBeVisible();
    await expect(page.getByText('Try another search or filter.')).toBeVisible();

    await page.goto(app('/tax-planning/opportunities'));
    const add = page.getByRole('button', { name: 'Add Opportunity' });
    await add.click();
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(add, 'focus goes back to the button that opened it').toBeFocused();
    await shot(page, TAB, 'gate-focus', info);
  });

  test('Release gate Normal — navigation and resources: the tabs, View All links, a Review link, and a resource sent to the simulator client', async ({
    page,
  }, info) => {
    const overview = nextApi<Overview>(page, 'GET', 'business/tax-planning/overview');
    await page.goto(app('/tax-planning'));
    const o = (await overview).body;
    const tabs = page.getByRole('tablist', { name: 'Tax planning views' });
    for (const [name, path] of [
      ['Clients', '/tax-planning/clients'],
      ['Planning Opportunities', '/tax-planning/opportunities'],
      ['Strategies & Recommendations', '/tax-planning/strategies'],
      ['Tax Calendar', '/tax-planning/calendar'],
      ['Resources', '/tax-planning/resources'],
      ['Reports', '/tax-planning/reports'],
      ['Project Deadlines', '/tax-planning/deadlines'],
      ['Overview', '/tax-planning'],
    ]) {
      await tabs.getByRole('tab', { name, exact: true }).click();
      await expect(page).toHaveURL(app(path));
      await expect(tabs.getByRole('tab', { name, exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    }
    await page
      .getByTestId('recent-clients')
      .getByRole('link', { name: /View All/ })
      .click();
    await expect(page).toHaveURL(app('/tax-planning/clients'));
    if (o.topOpportunities.length) {
      await page.goto(app('/tax-planning'));
      await page
        .getByTestId('top-opportunities')
        .getByRole('link', { name: 'Review' })
        .first()
        .click();
      await expect(page).toHaveURL(
        app(`/tax-planning/opportunities/${o.topOpportunities[0]!.firstOpportunityId}`),
      );
      await expect(page.getByTestId('opp-detail')).toBeVisible({ timeout: 60_000 });
    } else note(info, 'note', 'Top Planning Opportunities is empty on dev');

    // A client-facing resource, sent to the simulator client only.
    const listed = nextApi<{ items: Resource[] }>(page, 'GET', 'business/tax-planning/resources');
    await page.goto(app(`/tax-planning/resources?clientId=${APPT}`));
    const sendable = (await listed).body.items.find((r) => r.clientFacing && !r.staffOnly);
    test.skip(!sendable, 'no client-facing resource');
    await expect(page.getByTestId('resource-for')).toContainText(APPT_NAME);
    await expectSimulatorOnly(APPT);
    await page
      .getByTestId('tp-resources')
      .getByRole('listitem')
      .filter({ hasText: sendable!.title })
      .first()
      .getByRole('button', { name: /Send to Client/ })
      .click();
    const d = page.getByTestId('send-resource');
    await d.getByLabel('Client', { exact: true }).selectOption(APPT);
    await expect(d.getByLabel('Client', { exact: true })).toHaveValue(APPT);
    await d.getByLabel('Send by').selectOption('PORTAL_MESSAGE');
    await d.getByLabel('Message (optional)').fill(SEND_NOTE);
    await shot(page, TAB, 'gate-resource-send', info);
    await dialog(page).getByRole('button', { name: 'Send', exact: true }).click();
    await expect(toast(page, 'Resource sent.')).toBeVisible();
  });
});

// ================================================================ Admin
test.describe('Tax Planning (Admin)', () => {
  test.use(as('admin'));
  test.skip(() => !hasLogin('admin'), 'no admin login');
  test.beforeAll(async ({ browser }) => {
    await freshSession(browser, 'admin');
  });

  test("Release gate High — roles (Admin): every client's planning, the run plan with its actions, the library and overrides", async ({
    page,
  }, info) => {
    const e = await planE();
    await openClients(page, `?q=${encodeURIComponent(STAMP)}`);
    await expect(apptRow(page)).toContainText(runTag);
    await openPlan(page, e, '/goals');
    await expect(page.getByTestId('workflow-actions').getByRole('button').first()).toBeVisible();
    const override = page.getByRole('button', { name: 'Override estimate' }).first();
    if (await override.count()) await expect(override).toBeEnabled();
    await shot(page, TAB, 'Admin-plan', info);
    await page.goto(app('/tax-planning/strategies'));
    await page.getByRole('button', { name: 'New Strategy' }).click();
    await expect(page.getByTestId('strategy-dialog')).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog(page)).toHaveCount(0);
  });
});

// ================================================================ Staff
test.describe('Tax Planning (Staff)', () => {
  test.use(as('staff'));
  test.skip(() => !hasLogin('staff'), 'no staff login');
  test.beforeAll(async ({ browser }) => {
    await freshSession(browser, 'staff');
  });

  test('Release gate High — roles (Staff): only assigned clients; no override; the library refuses a change in words', async ({
    page,
  }, info) => {
    const e = await planE();
    const staff = await whoIs('staff');
    const api = await apiAs('owner');
    let assigned: string | undefined;
    try {
      assigned = (await ok<ClientRecord>(await api.get(`business/clients/${APPT}`), 'client'))
        .assignedTo?.userId;
    } finally {
      await api.dispose();
    }
    const read = page.waitForResponse(
      (r) => r.request().method() === 'GET' && apiPath(r) === `business/tax-planning/plans/${e}`,
      { timeout: 60_000 },
    );
    await page.goto(app(`/tax-planning/plans/${e}/edit/goals`));
    const status = (await read).status();
    if (assigned === staff.id) {
      expect(status, 'an assigned client is reached').toBe(200);
      await expect(page.getByTestId('plan-workflow')).toBeVisible({ timeout: 60_000 });
      const override = page.getByRole('button', { name: 'Override estimate' }).first();
      if (await override.count()) await expect(override, 'Staff may not override').toBeDisabled();
    } else {
      expect(status, 'a client not assigned is not found').toBe(404);
      await expect(page.getByTestId('plan-error')).toContainText(
        'This plan is not available. It may have been removed, you may not have access to it',
        { timeout: 60_000 },
      );
    }
    await shot(page, TAB, 'Staff-plan', info);

    // The Clients list holds only clients the Staff member reaches.
    const listed = nextApi<ClientsPage>(page, 'GET', 'business/tax-planning/clients');
    await openClients(page, `?q=${encodeURIComponent(APPT_NAME)}`);
    const rows = (await listed).body.items;
    expect(
      rows.some((r) => r.client.id === APPT),
      'the simulator client is listed only when assigned',
    ).toBe(assigned === staff.id);

    // The library: New Strategy is refused by the server, in words; nothing is made.
    await page.goto(app('/tax-planning/strategies'));
    await page.getByRole('button', { name: 'New Strategy' }).click();
    const d = page.getByTestId('strategy-dialog');
    await d.getByLabel('Name', { exact: true }).fill(STAFF_STRATEGY);
    const refused = nextApi<{ code?: string }>(page, 'POST', 'business/tax-planning/strategies');
    await dialog(page).getByRole('button', { name: 'Save Strategy' }).click();
    const res = await refused;
    expect(res.status, 'Staff may not manage the library').toBe(403);
    await expect(toast(page, 'Your role cannot do this.')).toBeVisible();
    await shot(page, TAB, 'Staff-library-refused', info);
  });
});

// ================================================================ Client (portal, read-only)
test.describe('Tax Planning (portal Client, read-only)', () => {
  test.use(as('client'));
  test.skip(() => !hasLogin('client'), 'no client login');

  test("@narrow P4-8 portal Tax Plans: the client reads only the plans sent to them, never the run's", async ({
    page,
  }, info) => {
    await page.goto(portal('/tax-plans'));
    await expect(page.getByRole('heading', { name: 'Tax Plans' }).first()).toBeVisible({
      timeout: 60_000,
    });
    await settled(page);
    const rows = page.getByTestId('tax-plan-row');
    const n = await rows.count();
    if (!n)
      await expect(
        page.getByText('No tax plans yet. When your firm sends you a plan, it shows here.'),
      ).toBeVisible();
    await expect(page.locator('body')).not.toContainText('LIVE-CHECK');
    if (!narrow(info)) {
      // The menu line is there once a plan was sent.
      const menuLine = page.getByRole('link', { name: 'Tax Plans', exact: true });
      if (n) await expect(menuLine.first()).toBeVisible();
      else await expect(menuLine).toHaveCount(0);
    }
    await expectNoSideScroll(page);
    await shot(page, TAB, 'P4-8-portal-list', info);
    if (n) {
      // Read-only: opened, never approved or asked here (Octavia's own login).
      await rows.first().getByRole('link').first().click();
      await expect(page.getByTestId('read-only-note')).toContainText('Read-only: version', {
        timeout: 60_000,
      });
      await expect(page.getByRole('textbox')).toHaveCount(0);
      await expectNoSideScroll(page);
      await shot(page, TAB, 'P4-8-portal-plan', info);
    }
  });
});

// ================================================================ rows not run live
test.describe('Tax Planning rows not run live', () => {
  const NOT_LIVE: [string, string][] = [
    [
      'P4-8 portal Approve Plan, Ask a Question, Request a Revision, Request a Meeting',
      'needs a plan sent to a portal client: a later pass on the harness portal client',
    ],
    [
      'Workflow information requests, portal side (the client asks from the portal)',
      "the same: a portal client with a plan sent to it; the staff side runs live (Request Information, Record Client's Request)",
    ],
    [
      'Workflow client approval, portal side (Approve in the portal)',
      'the same; the documented manual approval runs live',
    ],
    [
      'C14 upload: upload success, privacy, replace, safe types, size and scanning',
      "an upload to the client's documents is her retest (H); the run links an existing document only",
    ],
    [
      "C17 Edit save: the firm's own words for a built-in resource",
      'a save changes firm-wide content and the built-in cannot be restored (no reset); Edit is opened and cancelled',
    ],
    [
      'C12 booking the client discussion',
      'nothing is booked from the plan: the link, client, service and plan are checked; booking on the simulator client is the Appointments live check',
    ],
    [
      'Release gate High — roles and isolation: another firm',
      "needs a second firm's login (never LVP)",
    ],
    [
      "Release gate High — snapshots and delivery: the client's actual receipt",
      'the simulator client has no portal login, and QA Fixture Client 1 may not be sent to',
    ],
    [
      'Release gate High — lifecycle: version-specific signatures and staff sign-off',
      'her retest (H); approvals, revisions, close and reopen run live',
    ],
    [
      'Release gate Normal — plans and files: upload type, size, scanning and metadata',
      'her retest (H): an upload',
    ],
    [
      'Run Screening',
      'firm-wide: it screens every client of Test Firm B and makes opportunities that are not the run',
    ],
    [
      'Project Deadlines: a reminder delivered',
      'a reminder fires at its time (hours or a day before); the run deletes its deadlines the same day',
    ],
  ];
  for (const [row, reason] of NOT_LIVE) {
    // eslint-disable-next-line no-empty-pattern
    test(`${row} (NOT LIVE)`, async ({}, info) => {
      info.annotations.push({ type: 'NOT LIVE', description: reason });
      test.skip(true, `NOT LIVE: ${reason}`);
    });
  }
});

// ================================================================ cleanup (after every row)

/** Archives, closes or deletes everything one run made; `left` names what could not be. */
async function cleanRun(api: APIRequestContext, run: Run, done: string[], left: string[]) {
  const tag = run.tag;
  const stamp = tag.slice('LIVE-CHECK '.length);
  const has = (s: string | null | undefined) => Boolean(s?.includes(tag));
  const record = (r: APIResponse, what: string, fine = [404, 409]) =>
    (r.ok() || fine.includes(r.status()) ? done : left).push(`${what}: ${r.status()}`);

  // The conversations the sends made (each message carries the run tag).
  const threads = await api.get(
    `business/clients/${APPT}/message-threads?search=${encodeURIComponent(stamp)}`,
  );
  if (threads.ok()) {
    for (const t of items<{ id: string; subject: string }>(await threads.json())) {
      const detail = await api.get(`business/message-threads/${t.id}`);
      if (!detail.ok()) continue;
      const messages = ((await detail.json()) as { messages?: { body?: string | null }[] })
        .messages;
      if (!(messages ?? []).some((m) => has(m.body))) continue;
      record(
        await api.post(`business/message-threads/${t.id}/archive`, { data: {} }),
        `thread "${t.subject}" archive`,
      );
    }
  } else left.push(`threads list: ${threads.status()}`);

  // Tasks (no delete): archived.
  const tasks = new Set(run.tasks);
  for (const status of ['OPEN', 'DONE']) {
    const r = await api.get(`business/tasks?clientId=${APPT}&status=${status}&limit=100`);
    if (r.ok())
      for (const t of items<{ id: string; title: string }>(await r.json()))
        if (has(t.title)) tasks.add(t.id);
  }
  for (const id of tasks)
    record(await api.post(`business/tasks/${id}/archive`, { data: {} }), `task ${id} archive`);

  // Opportunities (no delete): closed, or dismissed when Close does not fit.
  const opps = new Set(run.opportunities);
  const listed = await api.get(
    `business/tax-planning/opportunities?clientId=${APPT}&search=${encodeURIComponent(stamp)}&pageSize=100`,
  );
  if (listed.ok())
    for (const o of items<Named>(await listed.json())) if (has(o.name)) opps.add(o.id);
  for (const id of opps) {
    const d = await api.get(`business/tax-planning/opportunities/${id}`);
    if (!d.ok()) {
      record(d, `opportunity ${id}`);
      continue;
    }
    const status = ((await d.json()) as { status: string }).status;
    if (['CLOSED', 'DISMISSED', 'NOT_APPLICABLE', 'IMPLEMENTED'].includes(status)) {
      done.push(`opportunity ${id}: already ${status}`);
      continue;
    }
    const closed = await api.post(`business/tax-planning/opportunities/${id}/actions`, {
      data: { action: 'CLOSE', note: 'Live check cleanup (synthetic)' },
    });
    if (closed.ok()) done.push(`opportunity ${id}: closed`);
    else
      record(
        await api.post(`business/tax-planning/opportunities/${id}/actions`, {
          data: { action: 'DISMISS', reason: 'Live check cleanup (synthetic)' },
        }),
        `opportunity ${id} dismiss (close ${closed.status()})`,
        [404],
      );
  }

  // Plans (no delete): archived.
  const plans = new Set(run.plans);
  const planList = await api.get(
    `business/tax-planning/plans?clientId=${APPT}&search=${encodeURIComponent(stamp)}&pageSize=100`,
  );
  if (planList.ok())
    for (const p of items<Named>(await planList.json())) if (has(p.name)) plans.add(p.id);
  for (const id of plans)
    record(
      await api.post(`business/tax-planning/plans/${id}/archive`, { data: {} }),
      `plan ${id} archive`,
    );

  // Library strategies (no delete): archived.
  const strategies = new Set(run.strategies);
  const lib = await api.get(
    `business/tax-planning/strategies?search=${encodeURIComponent(stamp)}&includeArchived=true&pageSize=100`,
  );
  if (lib.ok())
    for (const s of items<Named & { archived?: boolean }>(await lib.json()))
      if (has(s.name) && !s.archived) strategies.add(s.id);
  for (const id of strategies)
    record(
      await api.post(`business/tax-planning/strategies/${id}/archive`, { data: {} }),
      `strategy ${id} archive`,
    );

  // Project deadlines: deleted.
  const deadlines = new Set(run.deadlines);
  const dl = await api.get('business/tax-planning/project-deadlines?status=all&scope=mine');
  if (dl.ok()) for (const d of items<Named>(await dl.json())) if (has(d.name)) deadlines.add(d.id);
  for (const id of deadlines)
    record(
      await api.delete(`business/tax-planning/project-deadlines/${id}`),
      `deadline ${id} delete`,
      [404],
    );

  // Scenarios have no delete: kept, on the archived plan.
  for (const id of run.scenarios)
    done.push(`scenario ${id}: kept on its archived plan (no delete)`);

  // The service (after the deadlines that name it), then the category the run made.
  if (run.service) {
    const del = await api.delete(`business/catalog/services/${run.service}`);
    if (del.ok() || del.status() === 404)
      done.push(`service ${run.service}: delete ${del.status()}`);
    else
      record(
        await api.post(`business/catalog/services/${run.service}/archive`, { data: {} }),
        `service ${run.service} archive (delete ${del.status()})`,
        [409],
      );
  }
  if (run.category)
    record(
      await api.delete(`business/catalog/categories/${run.category}`),
      `category ${CATEGORY} delete`,
      [404],
    );
}

test.describe('Tax Planning cleanup', () => {
  test.use(as('owner'));
  test.skip(() => !hasLogin('owner'), 'no owner login');

  // eslint-disable-next-line no-empty-pattern
  test('zz cleanup @narrow: archive the run plans, tasks, strategies and threads; close its opportunities; delete its deadlines and service', async ({}, info) => {
    const runs = readRuns().filter((r) => r.tag === runTag || !r.cleaned);
    if (!runs.length) return;
    const done: string[] = [];
    const left: string[] = [];
    const api = await apiAs('owner');
    try {
      for (const run of runs) {
        const d: string[] = [];
        const l: string[] = [];
        await cleanRun(api, run, d, l);
        done.push(...d.map((x) => `[${run.tag}] ${x}`));
        left.push(...l.map((x) => `[${run.tag}] ${x}`));
        if (!l.length) {
          // Cleaned: the next width (or run) starts its own fixture; scenarios stay listed.
          saveRun({ ...blankRun(run.tag), scenarios: run.scenarios, cleaned: true });
        }
      }
    } finally {
      await api.dispose();
    }
    console.warn(`CLEANUP done:\n${done.join('\n')}\nCLEANUP left:\n${left.join('\n')}`);
    info.annotations.push({ type: 'left-behind', description: left.join('; ') || 'none' });
    expect(left, 'everything the run made is archived, closed or deleted').toEqual([]);
  });
});
