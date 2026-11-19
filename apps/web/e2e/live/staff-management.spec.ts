import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import { appUrl, login, shotsDir, statePath, type Role } from './env';
import { app, as, hasLogin, settled, shot } from './helpers';

/**
 * Staff Management, Review Two batch 1 (R60: #1621, #1630, #1636, #1642, #1647): one test per row
 * of the row map (F:/firmivra-private/checks/staff-management.md), live on dev as Test Firm B's
 * Owner, and its Admin for SM02. SM12 is sessions.spec.ts; the PURPLE rows are Octavia's own.
 *
 * Records: the run makes one department with two teams in it ("LIVE-CHECK yyyymmddhhmm Dept",
 * "... Team A", "... Team B") and up to three staff members, each on an SES simulator address
 * (success+live-check-<stamp>-<n>@simulator.amazonses.com): one through the API (the fixture,
 * invited), one through Create Staff (SM04, invited) and one through Bulk Upload Staff (SM20, its
 * invitation not sent). Every member setting this spec changes (work schedule, teams, security)
 * is on those. Drafts (SM16, SM17 with a file, SM18) are the Owner's own; SM02 makes one custom
 * role as the Admin. "zz cleanup" deactivates the run's members, deletes its drafts (and their
 * files), archives its custom role, teams and department, and sweeps earlier unfinished runs.
 *
 * Read only: every other member, role, team and department, the harness logins, and the company
 * security policy (SM05 opens Apply to Existing Accounts' preview and cancels it, never applies).
 */
test.describe.configure({ timeout: 180_000 });

const TAB = 'staff-management';
const TZ_PROBE = 'Asia/Dhaka';

/** One tag per runner process: a worker restarted after a failure keeps the run's tag. */
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
const STAMP = runTag.slice('LIVE-CHECK '.length);
const email = (n: number) => `success+live-check-${STAMP}-${n}@simulator.amazonses.com`;
/** Any run's address: the only members cleanup ever deactivates. */
const OURS = /^success\+live-check-\d{12}-\d+@simulator\.amazonses\.com$/i;
const DEPT = `${runTag} Dept`;
const TEAM_A = `${runTag} Team A`;
const TEAM_B = `${runTag} Team B`;
const ROLE = `${runTag} Role`;
const TITLE = 'Live Check Associate';
/** The fixture member: a first name with a space in it (SM20 keeps it whole). */
const M1_FIRST = runTag;
const M1_LAST = 'Alpha';
/** The imported member (SM20): a compound first name. */
const M3_FIRST = `${runTag} Mary Ann`;
const M3_LAST = 'Import';
const IMPORT_FILE = `live-check-${STAMP}-staff.csv`;
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

// ---------------------------------------------------------------- the run's records

interface Ctx {
  tag: string;
  deptId: string;
  teamA: string;
  teamB: string;
  /** The fixture member (API, invited). */
  m1: string;
  /** Create Staff's member (SM04). */
  m2: string;
  /** The imported member (SM20, invitation not sent). */
  m3: string;
  /** Every member this run made. */
  members: string[];
  /** Every draft this run made (the Owner's). */
  drafts: string[];
  /** Custom roles this run made (SM02). */
  roles: string[];
  cleaned?: boolean;
}
const blankCtx = (): Ctx => ({
  tag: runTag,
  deptId: '',
  teamA: '',
  teamB: '',
  m1: '',
  m2: '',
  m3: '',
  members: [],
  drafts: [],
  roles: [],
});
const ctxFile = () => join(process.env['LIVE_OUT_DIR']!, 'staff-management-ctx.json');
const readCtx = (): Ctx => ({
  ...blankCtx(),
  ...(JSON.parse(readFileSync(ctxFile(), 'utf8')) as Partial<Ctx>),
});
/** Every run's records, by tag (outside the repo): a run that stopped early is cleaned by the next. */
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
function current(): Ctx {
  if (!existsSync(ctxFile())) return blankCtx();
  const c = readCtx();
  if (c.tag === runTag) return c;
  register(c);
  return blankCtx();
}
const saveCtx = (c: Ctx) => {
  writeFileSync(ctxFile(), JSON.stringify(c, null, 2));
  register(c);
};
/** Adds to the run's records (lists are merged, never replaced). */
function remember(patch: Partial<Ctx>) {
  const c = current();
  const merge = (a: string[], b?: string[]) => [...new Set([...a, ...(b ?? [])])];
  saveCtx({
    ...c,
    ...patch,
    members: merge(c.members, patch.members),
    drafts: merge(c.drafts, patch.drafts),
    roles: merge(c.roles, patch.roles),
  });
}

// ---------------------------------------------------------------- the API (setup and cleanup)

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
  put(path: string, data: unknown): Promise<Res>;
  patch(path: string, data: unknown): Promise<Res>;
  delete(path: string): Promise<Res>;
  dispose(): Promise<void>;
}

/** Refreshes the role's saved session when its access token has expired, as the app does. */
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

/** The role's API through a browser context (setup, cleanup and what the page cannot show). */
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
    put: (p, data) => retry(() => ctx.request.put(url(p), { headers, data })),
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
const itemsOf = <T>(body: unknown): T[] =>
  Array.isArray(body) ? (body as T[]) : ((body as { items?: T[] } | null)?.items ?? []);

/** Runs `fn` with the Owner's API, disposed after. */
async function asOwner<T>(browser: Browser, fn: (api: Api) => Promise<T>): Promise<T> {
  const api = await roleApi(browser, 'owner');
  try {
    return await fn(api);
  } finally {
    await api.dispose();
  }
}

type Member = { id: string; name: string; email: string; status: string };
/** The run's member with this address (any status), if one exists. */
async function memberByEmail(api: Api, address: string): Promise<Member | undefined> {
  const res = await ok(
    await api.get(`business/staff?search=${encodeURIComponent(address)}&status=all&pageSize=10`),
    'staff search',
  );
  return itemsOf<Member>(res).find((m) => m.email.toLowerCase() === address.toLowerCase());
}

/** Our department or team: found by its exact name (live), or made once. */
async function ensureGroup(api: Api, kind: 'departments' | 'teams', name: string, deptId = '') {
  const listed = await ok(
    await api.get(`business/${kind}?search=${encodeURIComponent(name)}&status=active`),
    `${kind} search`,
  );
  const own = itemsOf<{ id: string; name: string }>(listed).find((x) => x.name === name);
  if (own) return own.id;
  const body =
    kind === 'departments'
      ? { name, description: 'Live check fixture (synthetic)' }
      : { name, departmentId: deptId, description: 'Live check fixture (synthetic)' };
  return (await ok(await api.post(`business/${kind}`, body), `make ${name}`)).id as string;
}

/**
 * The run's department, its two teams and the fixture member (invited by email, to a simulator
 * address, Team A as its primary team). Saved after each, so a restarted worker resumes.
 */
async function fixture(browser: Browser): Promise<Ctx> {
  let c = current();
  if (c.deptId && c.teamA && c.teamB && c.m1) return c;
  return asOwner(browser, async (api) => {
    if (!c.deptId) {
      // Earlier runs that stopped before their cleanup: cleaned first.
      for (const run of readRegistry().filter((r) => r.tag !== runTag && !r.cleaned)) {
        const left: string[] = [];
        await cleanRun(api, run, [], left).catch((e: Error) => left.push(e.message));
        if (!left.length) register({ ...run, cleaned: true });
        else console.warn(`EARLIER RUN ${run.tag} left: ${left.join('; ')}`);
      }
      remember({ deptId: await ensureGroup(api, 'departments', DEPT) });
      c = current();
    }
    if (!c.teamA) remember({ teamA: await ensureGroup(api, 'teams', TEAM_A, c.deptId) });
    if (!current().teamB) remember({ teamB: await ensureGroup(api, 'teams', TEAM_B, c.deptId) });
    c = current();
    if (!c.m1) {
      let id = (await memberByEmail(api, email(1)))?.id;
      if (!id) {
        const made = await ok(
          await api.post('business/staff', {
            idempotencyKey: randomUUID(),
            account: {
              firstName: M1_FIRST,
              lastName: M1_LAST,
              email: email(1),
              departmentIds: [c.deptId],
              jobTitle: TITLE,
              role: 'STAFF',
            },
            details: { primaryTeamId: c.teamA },
            sendWelcomeEmail: true,
          }),
          'make the fixture member',
        );
        id = made.staff.id as string;
      }
      remember({ m1: id, members: [id] });
    }
    return current();
  });
}

/** The run's imported member; imported through the API when SM20's page import has not run. */
async function imported(browser: Browser): Promise<string> {
  const c = await fixture(browser);
  if (c.m3) return c.m3;
  return asOwner(browser, async (api) => {
    let id = (await memberByEmail(api, email(3)))?.id;
    if (!id) {
      const head = ['firstName', 'lastName', 'email', 'jobTitle', 'role', 'department'];
      const preview = await ok(
        await api.post('business/staff/import/preview', {
          fileName: IMPORT_FILE,
          columnMap: Object.fromEntries(head.map((h) => [h, h])),
          rows: [
            {
              firstName: M3_FIRST,
              lastName: M3_LAST,
              email: email(3),
              jobTitle: TITLE,
              role: 'STAFF',
              department: DEPT,
            },
          ],
        }),
        'import preview',
      );
      await ok(
        await api.post('business/staff/import', {
          previewToken: preview.previewToken,
          sendInvitations: false,
        }),
        'import',
      );
      id = (await memberByEmail(api, email(3)))?.id;
    }
    if (!id) throw new Error('the imported member was not found');
    remember({ m3: id, members: [id] });
    return id;
  });
}

/** A cell a built-in role's grid lacks while it has View in that module ("Clients: Export"). */
async function extraCell(api: Api, role: string, skip: string[] = []) {
  const grid = await ok(await api.get(`business/roles/${role}/permissions`), `${role} grid`);
  const mods = await ok(await api.get('business/permission-modules'), 'modules');
  type Cell = { module: string; capability: string; granted: boolean };
  type Mod = { module: string; label: string; capabilities: string[] };
  const cells = grid.cells as Cell[];
  const has = (m: string, c: string) =>
    cells.some((x) => x.module === m && x.capability === c && x.granted);
  const order = ['CLIENTS', ...(mods.modules as Mod[]).map((m) => m.module)];
  for (const id of order) {
    const m = (mods.modules as Mod[]).find((x) => x.module === id);
    if (!m || !has(id, 'VIEW') || skip.includes(id)) continue;
    for (const capability of ['EXPORT', 'DELETE', 'APPROVE', 'MANAGE', 'EDIT', 'CREATE']) {
      if (!m.capabilities.includes(capability) || has(id, capability)) continue;
      const cap = (mods.capabilities as { capability: string; label: string }[]).find(
        (x) => x.capability === capability,
      );
      return { module: id, capability, name: `${m.label}: ${cap?.label ?? capability}` };
    }
  }
  throw new Error(`${role} has every cell where it has View`);
}

// ---------------------------------------------------------------- page helpers

/** Answers the browser's own leave-page question, so a navigation never stalls on a dirty form. */
const leaveFreely = (page: Page) =>
  page.on('dialog', (d) => void (d.type() === 'beforeunload' ? d.accept() : d.dismiss()));

async function open(page: Page, path: string) {
  await page.goto(app(path));
  await settled(page);
}

/** Create Staff step 1, filled for one of the run's people. */
async function fillAccount(page: Page, last: string, n: number) {
  await expect(page.getByLabel('First Name *')).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('First Name *').fill(runTag);
  await page.getByLabel('Last Name *').fill(last);
  await page.getByLabel('Work Email *').fill(email(n));
  await page.getByRole('button', { name: /Department\(s\) \*/ }).click();
  await page.getByRole('checkbox', { name: DEPT, exact: true }).check();
  await page.keyboard.press('Escape');
  await page.getByLabel('Job Title *').fill(TITLE);
  await page.getByLabel('Role *').selectOption({ label: 'Staff' });
}

const draftOf = (page: Page) => new URL(page.url()).searchParams.get('draft') ?? '';

/** Step 1 to step 4 with Next on each (the draft is saved at each step). Returns the draft id. */
async function toDetails(page: Page, last: string, n: number): Promise<string> {
  await open(page, '/team/new');
  await fillAccount(page, last, n);
  await page.getByRole('button', { name: 'Next: Role & Permissions' }).click();
  await expect(page).toHaveURL(/\/team\/new\/permissions\?draft=/, { timeout: 30_000 });
  const id = draftOf(page);
  remember({ drafts: [id] });
  await page.getByRole('button', { name: 'Next: Access & Security' }).click({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/team\/new\/security\?draft=/, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Next: Additional Details' }).click({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/team\/new\/details\?draft=/, { timeout: 30_000 });
  return id;
}

/** A member's Edit Staff page, loaded. */
async function editStaff(page: Page, id: string, first: string) {
  await open(page, `/team/${id}`);
  await expect(page.getByLabel('First Name *')).toHaveValue(first, { timeout: 30_000 });
}

/** YYYY-MM-DD, `days` from today in the firm's zone. */
const firmDay = (days: number, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(Date.now() + days * 86_400_000));

const note = (info: TestInfo, text: string) =>
  info.annotations.push({ type: 'not-live', description: text });

// ---------------------------------------------------------------- the rows

test.describe('Staff Management Review 2 batch 1', () => {
  test.use(as('owner'));

  test('SM01 the Reports tile opens Staff & Team with Back to Staff Management', async ({
    page,
  }, info) => {
    await open(page, '/team');
    await page
      .getByTestId('staff-links')
      .getByRole('link', { name: /^Reports/ })
      .click();
    await expect(page).toHaveURL(app('/reports/staff_team?from=%2Fteam'), { timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Staff & Team', level: 1 })).toBeVisible();
    await expect(page.getByTestId('report-table')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('report-back')).toHaveText('← Back to Staff Management');
    await shot(page, TAB, 'SM01', info);
    await page.getByTestId('report-back').click();
    await expect(page).toHaveURL(app('/team'), { timeout: 30_000 });
  });

  test('SM04 Create Staff gives Export like any other column, and the new member keeps it', async ({
    page,
    browser,
  }, info) => {
    leaveFreely(page);
    await fixture(browser);
    const cell = await asOwner(browser, (api) => extraCell(api, 'STAFF'));
    await open(page, '/team/new');
    await fillAccount(page, 'Wizard', 2);
    await page.getByRole('button', { name: 'Next: Role & Permissions' }).click();
    await expect(page).toHaveURL(/\/team\/new\/permissions\?draft=/, { timeout: 30_000 });
    remember({ drafts: [draftOf(page)] });
    // The Export column is in Create Staff's grid; any free Export cell (Clients first).
    await expect(page.getByRole('columnheader', { name: 'Export' })).toBeVisible({
      timeout: 30_000,
    });
    const box = page.getByRole('checkbox', { name: cell.name, exact: true });
    await box.check();
    await expect(box).toBeChecked();
    await shot(page, TAB, 'SM04-grid', info);
    await page.getByRole('button', { name: 'Next: Access & Security' }).click();
    await page.getByRole('button', { name: 'Next: Additional Details' }).click({ timeout: 30_000 });
    await expect(page).toHaveURL(/\/team\/new\/details\?draft=/, { timeout: 30_000 });
    await page.getByRole('button', { name: 'Submit & Send Invitation' }).click();
    await expect(page).toHaveURL(/\/team\/[0-9a-f-]{36}\/created/, { timeout: 60_000 });
    const id = /\/team\/([0-9a-f-]{36})\/created/.exec(page.url())![1]!;
    remember({ m2: id, members: [id] });
    // Kept: the member's Permissions tab shows the cell given.
    await open(page, `/team/${id}/security/permissions`);
    await expect(page.getByRole('checkbox', { name: cell.name, exact: true })).toBeChecked({
      timeout: 30_000,
    });
    await shot(page, TAB, 'SM04-kept', info);
  });

  test('SM05 Apply to Existing Accounts previews who changes and who is left out (cancelled, never applied)', async ({
    page,
    browser,
  }, info) => {
    const ownerEmail = login('owner')!.email.toLowerCase();
    const { before, me, inactive, listed } = await asOwner(browser, async (api) => {
      const all = itemsOf<Member>(
        await ok(await api.get('business/staff?status=all&pageSize=100'), 'staff'),
      );
      const gone = all.filter((m) => m.status === 'DEACTIVATED');
      // The preview by id (the page shows names only): never a deactivated account.
      const preview = await ok(
        await api.get('business/staff-security-defaults/apply-preview'),
        'preview',
      );
      return {
        before: await ok(await api.get('business/staff-security-defaults'), 'defaults'),
        me: all.find((m) => m.email.toLowerCase() === ownerEmail)!.name,
        // Names only the deactivated have (two people can share a name).
        inactive: gone
          .map((m) => m.name)
          .filter((n) => !all.some((m) => m.status !== 'DEACTIVATED' && m.name === n)),
        listed: (preview.accounts as { id: string }[]).filter((a) =>
          gone.some((m) => m.id === a.id),
        ),
      };
    });
    expect(listed, 'no deactivated account in the preview').toEqual([]);
    await open(page, '/team/settings/security');
    await page
      .getByRole('button', { name: 'Apply to Existing Accounts' })
      .click({ timeout: 30_000 });
    const dialog = page.getByRole('dialog', { name: 'Apply to existing accounts?' });
    await expect(dialog).toContainText('Deactivated accounts are not changed.', {
      timeout: 30_000,
    });
    // Yourself is left out, with where to change your own.
    await expect(dialog).toContainText(
      `${me}: you: change your own on your Access & Security page`,
      {
        timeout: 30_000,
      },
    );
    // Each account listed says what would change; the deactivated are never listed.
    const rows = dialog.getByTestId('apply-account');
    for (let i = 0; i < (await rows.count()); i++)
      await expect(rows.nth(i)).toContainText(/Changes: \S/);
    for (const name of inactive) await expect(rows.filter({ hasText: `${name} (` })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /^Apply to \d+ Accounts?$/ })).toBeVisible();
    await shot(page, TAB, 'SM05', info);
    // Cancel, never Apply: it would change everyone's accounts.
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('apply-result')).toHaveCount(0);
    const after = await asOwner(browser, async (api) =>
      ok(await api.get('business/staff-security-defaults'), 'defaults'),
    );
    expect(after.version, 'the defaults are unchanged').toBe(before.version);
  });

  test('SM06 Edit Staff keeps a company work schedule and a custom one', async ({
    page,
    browser,
  }, info) => {
    leaveFreely(page);
    const c = await fixture(browser);
    await editStaff(page, c.m1, M1_FIRST);
    const schedule = page.getByLabel('Work Schedule', { exact: true });
    const presets = (await schedule.locator('option').allTextContents()).filter(
      (t) => t !== 'No schedule' && t !== 'Custom…',
    );
    expect(presets.length, 'the company schedules are offered').toBeGreaterThan(0);
    await expect(schedule.locator('option', { hasText: 'Custom…' })).toHaveCount(1);
    // Custom: free text, kept on the member.
    const custom = `Mon-Thu 7-5 (live check ${STAMP})`;
    await schedule.selectOption({ label: 'Custom…' });
    await page.getByLabel('Custom work schedule').fill(custom);
    await page.getByLabel('Send notification of changes').uncheck();
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByTestId('edit-saved')).toContainText('Changes saved', {
      timeout: 30_000,
    });
    await editStaff(page, c.m1, M1_FIRST);
    await expect(page.getByLabel('Custom work schedule')).toHaveValue(custom);
    await shot(page, TAB, 'SM06-custom', info);
    // A company schedule.
    await page.getByLabel('Work Schedule', { exact: true }).selectOption({ label: presets[0]! });
    await page.getByLabel('Send notification of changes').uncheck();
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByTestId('edit-saved')).toContainText('Changes saved', {
      timeout: 30_000,
    });
    await editStaff(page, c.m1, M1_FIRST);
    await expect(
      page.getByLabel('Work Schedule', { exact: true }).locator('option:checked'),
    ).toHaveText(presets[0]!);
    await expect(page.getByLabel('Custom work schedule')).toHaveCount(0);
  });

  test('SM08 Additional Details says a maximum warns, and assigning under it warns of nothing', async ({
    page,
    browser,
  }, info) => {
    // NOT LIVE (the warning itself): Assign lists active members only, every active member of Test
    // Firm B takes new clients with no maximum, and this run may change only the members it makes,
    // who stay Invited (never active). Checked here: the help text, the team list's workload, and no
    // warning for someone under no maximum.
    note(
      info,
      'SM08 warning: needs an active member over their maximum or not taking clients; none in Test Firm B and the run may not change one',
    );
    leaveFreely(page);
    const staffEmail = login('staff')?.email?.toLowerCase();
    const team = await asOwner(browser, async (api) =>
      itemsOf<{
        status: string;
        user: { name: string; email: string };
        workload?: {
          activeClients: number;
          maxActiveClients: number | null;
          acceptsNewClients: boolean;
        };
      }>(await ok(await api.get('business/team'), 'team')),
    );
    expect(
      team.every((m) => m.workload !== undefined),
      'the team list carries each workload',
    ).toBe(true);
    await open(page, '/team/new/details');
    await expect(
      page.getByText(
        'The most active clients this person should carry. Assigning a client past it, or while they are not receiving new clients, shows a warning and still assigns.',
      ),
    ).toBeVisible({ timeout: 30_000 });
    // Add Client: an active member under no maximum gets no warning (nothing is saved).
    const free = team.find(
      (m) =>
        m.status === 'ACTIVE' &&
        m.user.email.toLowerCase() === staffEmail &&
        m.workload?.acceptsNewClients &&
        m.workload.maxActiveClients === null,
    );
    if (!free) return;
    await open(page, '/clients');
    await page.getByTestId('add-client').click({ timeout: 30_000 });
    const dialog = page.getByRole('dialog', { name: 'Add New Client' });
    await dialog.getByLabel('Assigned to').selectOption({ label: free.user.name });
    await expect(dialog.getByTestId('workload-warning')).toHaveCount(0);
    await shot(page, TAB, 'SM08', info);
    // Leave without adding: Cancel, then Discard what was chosen.
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    const discard = dialog.getByRole('button', { name: 'Discard', exact: true });
    if (await discard.isVisible().catch(() => false)) await discard.click();
    await expect(dialog).toBeHidden();
  });

  test('SM09 Bulk Upload Staff offers the template as Excel beside CSV', async ({ page }, info) => {
    await open(page, '/team/import');
    const card = page.getByTestId('import-template');
    await expect(card.getByRole('link', { name: 'Download CSV Template' })).toBeVisible({
      timeout: 30_000,
    });
    await shot(page, TAB, 'SM09', info);
    for (const [link, file, magic] of [
      ['Download Excel Template', 'staff-import-template.xlsx', 'PK'],
      ['Download CSV Template', 'staff-import-template.csv', '\ufefffirstName'],
    ] as const) {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        card.getByRole('link', { name: link }).click(),
      ]);
      expect(download.suggestedFilename()).toBe(file);
      const path = await download.path();
      const head = readFileSync(path).subarray(0, 32).toString('utf8');
      expect(head.startsWith(magic), `${file} starts with ${JSON.stringify(magic)}`).toBe(true);
    }
  });

  test('SM15 department and team counts name the active and the assigned staff, as the directory', async ({
    page,
    browser,
  }, info) => {
    await fixture(browser);
    // The directory's set: the department's members but the deactivated.
    await open(page, '/team/directory');
    const directory = page.getByTestId('staff-directory');
    await directory.getByLabel('Department', { exact: true }).selectOption({ label: DEPT });
    const rows = directory.getByRole('row').filter({ has: page.getByTestId('staff-name') });
    // Wait for the filtered list: every row in the run's department.
    await expect
      .poll(
        async () => {
          const texts = await rows.allTextContents();
          return texts.length > 0 && texts.every((t) => t.includes(DEPT));
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    const chips = await directory.getByTestId('staff-status').allTextContents();
    const assigned = chips.filter((s) => s.trim() !== 'Inactive').length;
    const active = chips.filter((s) => s.trim() === 'Active').length;
    expect(assigned, 'the run has a member in its department').toBeGreaterThan(0);
    const counts = `${active} active · ${assigned} assigned`;

    await open(page, '/team/departments');
    await page.getByLabel('Search departments').fill(DEPT);
    const name = page.getByTestId('department-row').filter({ hasText: new RegExp(`^${DEPT}$`) });
    await expect(page.getByRole('row').filter({ has: name })).toContainText(counts, {
      timeout: 30_000,
    });
    await name.click();
    await expect(page.getByTestId('department-details')).toContainText(counts);
    // Team A holds the fixture member (primary, or backup after SM25).
    await expect(page.getByTestId('department-team').filter({ hasText: TEAM_A })).toContainText(
      '0 active · 1 assigned',
    );
    await shot(page, TAB, 'SM15-department', info);

    await open(page, '/team/teams');
    await page.getByLabel('Search teams').fill(TEAM_A);
    const team = page.getByTestId('team-row').filter({ hasText: new RegExp(`^${TEAM_A}$`) });
    await expect(page.getByRole('row').filter({ has: team })).toContainText(
      '0 active · 1 assigned',
      { timeout: 30_000 },
    );
    await team.click();
    await expect(page.getByTestId('team-details')).toContainText('0 active · 1 assigned');
    await shot(page, TAB, 'SM15-team', info);
  });

  test('SM16 each Create Staff step says the draft is kept, and a draft keeps a changed grid and security settings', async ({
    page,
    browser,
  }, info) => {
    leaveFreely(page);
    await fixture(browser);
    const cell = await asOwner(browser, (api) => extraCell(api, 'STAFF', ['CLIENTS']));
    await open(page, '/team/new');
    await expect(page.getByTestId('autosave-note')).toHaveText(
      'Next saves your progress as a draft.',
      { timeout: 30_000 },
    );
    await fillAccount(page, 'Sixteen', 4);
    await page.getByRole('button', { name: 'Next: Role & Permissions' }).click();
    await expect(page).toHaveURL(/\/team\/new\/permissions\?draft=/, { timeout: 30_000 });
    const id = draftOf(page);
    remember({ drafts: [id] });
    await expect(page.getByTestId('autosave-note')).toHaveText(
      'Progress saved as a draft. Back and Next save this step too.',
    );
    await page.getByRole('checkbox', { name: cell.name, exact: true }).check({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Next: Access & Security' }).click();
    await expect(page).toHaveURL(/\/team\/new\/security\?draft=/, { timeout: 30_000 });
    await expect(page.getByTestId('autosave-note')).toHaveText(
      'Progress saved as a draft. Back and Next save this step too.',
    );
    // Custom security settings: three sessions and a 30-minute automatic logout.
    await page.getByLabel('Concurrent Sessions').selectOption('3');
    await page.getByLabel('Set automatic logout after inactivity').check();
    await page.getByLabel('Inactivity time').selectOption('30');
    await page.getByRole('button', { name: 'Next: Additional Details' }).click();
    await expect(page).toHaveURL(/\/team\/new\/details\?draft=/, { timeout: 30_000 });
    await expect(page.getByTestId('autosave-note')).toHaveText(
      'Progress saved as a draft. Back saves this step too; pay is never kept in a draft.',
    );
    await shot(page, TAB, 'SM16-step4', info);

    // The draft, opened again in a new tab: the grid and the settings as saved.
    const again = await page.context().newPage();
    leaveFreely(again);
    await again.goto(app(`/team/new/permissions?draft=${id}`));
    await expect(again.getByRole('checkbox', { name: cell.name, exact: true })).toBeChecked({
      timeout: 30_000,
    });
    await again.goto(app(`/team/new/security?draft=${id}`));
    await expect(again.getByLabel('Concurrent Sessions')).toHaveValue('3', { timeout: 30_000 });
    await expect(again.getByLabel('Set automatic logout after inactivity')).toBeChecked();
    await expect(again.getByLabel('Inactivity time')).toHaveValue('30');
    await shot(again, TAB, 'SM16-reopened', info);
    await again.close();
  });

  test('SM17 a file and its type are kept with the draft, pay never is, and a draft is its creator’s own', async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(420_000);
    leaveFreely(page);
    await fixture(browser);
    const id = await toDetails(page, 'Seventeen', 5);
    // Pay: said plainly, and never saved in the draft.
    await expect(page.getByText('Never saved in a draft.', { exact: false }).first()).toBeVisible();
    await page.getByLabel('Pay Rate / Salary').fill('52.50');
    // A file and its type, saved with the draft (Save under Remove).
    const file = `live-check-${STAMP}-nda.pdf`;
    await page
      .getByRole('region', { name: 'Staff Documents' })
      .locator('input[type=file]')
      .setInputFiles({ name: file, mimeType: 'application/pdf', buffer: PDF });
    await page.getByLabel(`Document type of ${file}`).selectOption({ label: 'NDA' });
    await page.getByRole('button', { name: `Save ${file} with this draft` }).click();
    const kept = page.getByTestId('kept-file');
    await expect(kept).toContainText(file, { timeout: 60_000 });
    await expect(kept).toContainText('NDA');
    await expect(kept).toContainText(/Saved with this draft|Saved · being checked/);
    await shot(page, TAB, 'SM17-saved', info);

    // The tab closed and opened again: the file and its type are there, the pay is not.
    const again = await page.context().newPage();
    leaveFreely(again);
    await again.goto(app(`/team/new/details?draft=${id}`));
    const keptAgain = again.getByTestId('kept-file');
    await expect(keptAgain).toContainText(file, { timeout: 30_000 });
    await expect(keptAgain).toContainText('NDA');
    await expect(again.getByLabel('Pay Rate / Salary')).toHaveValue('');
    await shot(again, TAB, 'SM17-reopened', info);
    await again.close();

    // Another Admin does not see it: not in their Drafts, not openable (404).
    if (hasLogin('admin')) {
      const admin = await roleApi(browser, 'admin');
      try {
        expect((await admin.get(`business/staff-drafts/${id}`)).status()).toBe(404);
        const theirs = itemsOf<{ id: string }>(
          await ok(await admin.get('business/staff-drafts'), 'drafts'),
        );
        expect(theirs.map((d) => d.id)).not.toContain(id);
      } finally {
        await admin.dispose();
      }
      const ctx = await browser.newContext({ storageState: statePath('admin') });
      const theirPage = await ctx.newPage();
      await theirPage.goto(app(`/team/new/details?draft=${id}`));
      await expect(theirPage.getByText('This draft was not found. Start a new one.')).toBeVisible({
        timeout: 30_000,
      });
      await expect(theirPage.getByTestId('kept-file')).toHaveCount(0);
      await shot(theirPage, TAB, 'SM17-admin', info);
      await ctx.close();
    }

    // The scan (GuardDuty, after the checks above): CLEAN, so Create Staff moves the file to the
    // member (it moves CLEAN files only). The draft never holds pay.
    let status = '';
    let waited = 0;
    await asOwner(browser, async (api) => {
      const began = Date.now();
      for (;;) {
        const d = await ok(await api.get(`business/staff-drafts/${id}`), 'draft');
        expect(JSON.stringify(d.data), 'no pay in the draft').not.toMatch(/compensation|rateCents/);
        const a = (d.attachments ?? []) as { fileName: string; type: string; scanStatus: string }[];
        expect(a.map((x) => [x.fileName, x.type])).toEqual([[file, 'NDA']]);
        status = a[0]!.scanStatus;
        waited = Math.round((Date.now() - began) / 1000);
        if (status !== 'PENDING' || waited > 150) break;
        await new Promise((r) => setTimeout(r, 10_000));
      }
    });
    await page.reload();
    if (status === 'CLEAN')
      await expect(page.getByTestId('kept-file')).toContainText('Saved with this draft', {
        timeout: 30_000,
      });
    await shot(page, TAB, 'SM17-scanned', info);

    // Remove takes the file away from the draft (before the scan verdict, so nothing is left).
    await page.getByTestId('kept-file').getByRole('button', { name: 'Remove' }).click({
      timeout: 30_000,
    });
    await expect(page.getByTestId('kept-file')).toHaveCount(0, { timeout: 30_000 });
    expect(
      status,
      `the saved file's scan result (still ${status} ${waited} s after the checks above)`,
    ).toBe('CLEAN');
  });

  test('SM18 Edit Staff and Create Staff ask before unsaved changes are lost', async ({
    page,
    browser,
  }, info) => {
    const c = await fixture(browser);
    const ask = page.getByRole('dialog', { name: 'Unsaved changes' });
    // Edit Staff (the run's member): Cancel asks, Keep Editing stays with the change.
    await editStaff(page, c.m1, M1_FIRST);
    const title = page.getByLabel('Job Title *');
    await title.fill(`${TITLE} changed`);
    await page.getByRole('link', { name: 'Cancel', exact: true }).click();
    await expect(ask).toBeVisible();
    await shot(page, TAB, 'SM18-edit', info);
    await ask.getByRole('button', { name: 'Keep Editing' }).click();
    await expect(page).toHaveURL(app(`/team/${c.m1}`));
    await expect(title).toHaveValue(`${TITLE} changed`);
    // The sidebar asks too; Discard Changes leaves without saving.
    await page
      .getByTestId('sidebar-menu')
      .getByRole('link', { name: 'Leads', exact: true })
      .click();
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Discard Changes' }).click();
    await expect(page).toHaveURL(/\/leads/, { timeout: 30_000 });
    await editStaff(page, c.m1, M1_FIRST);
    await expect(page.getByLabel('Job Title *')).toHaveValue(TITLE);
    // Closing the tab asks the browser's own question.
    const tab = await page.context().newPage();
    await tab.goto(app(`/team/${c.m1}`));
    await expect(tab.getByLabel('First Name *')).toHaveValue(M1_FIRST, { timeout: 30_000 });
    await tab.getByLabel('Job Title *').fill(`${TITLE} again`);
    const asked = Promise.race([
      new Promise<string>((resolve) =>
        tab.once('dialog', (d) => {
          resolve(d.type());
          void d.dismiss();
        }),
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve('no question'), 15_000)),
    ]);
    await tab.close({ runBeforeUnload: true });
    expect(await asked).toBe('beforeunload');
    if (!tab.isClosed()) await tab.close();

    // Create Staff: Cancel asks, and Save Draft keeps the work as one draft.
    leaveFreely(page);
    await open(page, '/team/new');
    await expect(page.getByLabel('First Name *')).toBeVisible({ timeout: 30_000 });
    await page.getByLabel('First Name *').fill(runTag);
    await page.getByLabel('Last Name *').fill('Guard');
    await page.getByLabel('Work Email *').fill(email(6));
    await page.getByRole('link', { name: 'Cancel', exact: true }).click();
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Keep Editing' }).click();
    await expect(page).toHaveURL(app('/team/new'));
    await page.getByRole('link', { name: 'Cancel', exact: true }).click();
    await ask.getByRole('button', { name: 'Save Draft' }).click();
    await expect(page).toHaveURL(app('/team'), { timeout: 30_000 });
    const drafts = await asOwner(browser, async (api) =>
      itemsOf<{ id: string; data: { account?: { email?: string } } }>(
        await ok(await api.get('business/staff-drafts'), 'drafts'),
      ).filter((d) => d.data.account?.email === email(6)),
    );
    remember({ drafts: drafts.map((d) => d.id) });
    expect(drafts, 'one draft, not two').toHaveLength(1);
    // In the directory's Drafts.
    const directory = page.getByTestId('staff-directory');
    await directory.getByLabel('Status', { exact: true }).selectOption({ label: 'Drafts' });
    await directory.getByLabel('Search staff').fill(email(6));
    await expect(page.getByRole('row').filter({ hasText: email(6) })).toHaveCount(1, {
      timeout: 30_000,
    });
    await shot(page, TAB, 'SM18-draft', info);
    // Nothing unsaved: Cancel leaves at once.
    await open(page, '/team/new');
    await expect(page.getByLabel('First Name *')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('link', { name: 'Cancel', exact: true }).click();
    await expect(page).toHaveURL(app('/team'), { timeout: 30_000 });
  });

  test('SM20 an imported compound first name stays whole', async ({ page, browser }, info) => {
    const c = await fixture(browser);
    if (!c.m3 && !(await asOwner(browser, (api) => memberByEmail(api, email(3))))) {
      await open(page, '/team/import');
      const csv =
        'firstName,lastName,email,jobTitle,role,department\r\n' +
        `${M3_FIRST},${M3_LAST},${email(3)},${TITLE},STAFF,${DEPT}\r\n`;
      await page
        .getByTestId('import-upload')
        .locator('input[type=file]')
        .setInputFiles({ name: IMPORT_FILE, mimeType: 'text/csv', buffer: Buffer.from(csv) });
      await expect(page.getByTestId('import-map')).toContainText(IMPORT_FILE, { timeout: 30_000 });
      await page.getByRole('button', { name: 'Validate & Preview' }).click();
      const preview = page.getByTestId('import-preview');
      await expect(preview).toContainText(/1\s*New staff to create/, { timeout: 30_000 });
      await expect(preview).toContainText(/0\s*Rows with errors/);
      // SM21's other half: imported without sending the invitation.
      await preview.getByLabel('Send invitations to the new staff now').uncheck();
      await shot(page, TAB, 'SM20-preview', info);
      await preview.getByRole('button', { name: 'Import 1 Staff' }).click();
      const results = page.getByTestId('import-results');
      await expect(results).toContainText('Import finished', { timeout: 60_000 });
      await expect(results).toContainText(/1\s*Created/);
    }
    const id = await imported(browser);
    // Edit Staff: the first and last name as typed in the file.
    await editStaff(page, id, M3_FIRST);
    await expect(page.getByLabel('Last Name *')).toHaveValue(M3_LAST);
    await shot(page, TAB, 'SM20-imported', info);
    // The fixture member (made with a two-word first name) keeps it apart too.
    await editStaff(page, c.m1, M1_FIRST);
    await expect(page.getByLabel('Last Name *')).toHaveValue(M1_LAST);
    // The directory shows the whole name.
    await open(page, '/team/directory');
    await page.getByTestId('staff-directory').getByLabel('Search staff').fill(email(3));
    await expect(page.getByTestId('staff-name')).toContainText(`${M3_FIRST} ${M3_LAST}`, {
      timeout: 30_000,
    });
  });

  test('SM21 a member reads as invited only once the email went out', async ({
    page,
    browser,
  }, info) => {
    const c = await fixture(browser);
    const m3 = await imported(browser);
    const sent = await asOwner(browser, async (api) => {
      const one = await ok(await api.get(`business/staff/${c.m1}`), 'fixture member');
      const other = await ok(await api.get(`business/staff/${m3}`), 'imported member');
      expect(other.invite?.sentAt ?? null, 'the import sent no invitation').toBeNull();
      return Boolean(one.invite?.sentAt);
    });
    expect(sent, 'the fixture member was emailed (SES simulator)').toBe(true);
    const INVITED = /Invited\s+[A-Z][a-z]{2} \d{1,2}, \d{4}/;
    const NOT_SENT = 'Account created · invitation not sent';
    // Staff directory.
    await open(page, '/team/directory');
    const search = page.getByTestId('staff-directory').getByLabel('Search staff');
    const row = (address: string) => page.getByRole('row').filter({ hasText: address });
    const named = (name: string) =>
      page
        .getByRole('row')
        .filter({ has: page.getByTestId('staff-name').filter({ hasText: name }) });
    await search.fill(email(1));
    await expect(named(`${M1_FIRST} ${M1_LAST}`)).toContainText(INVITED, { timeout: 30_000 });
    await expect(named(`${M1_FIRST} ${M1_LAST}`)).not.toContainText(NOT_SENT);
    await search.fill(email(3));
    await expect(named(`${M3_FIRST} ${M3_LAST}`)).toContainText(NOT_SENT, { timeout: 30_000 });
    await shot(page, TAB, 'SM21-directory', info);
    // Settings > Users.
    await open(page, '/settings/users');
    const users = page.getByLabel('Search users');
    await users.fill(email(1));
    await expect(row(email(1))).toContainText(INVITED, { timeout: 30_000 });
    await users.fill(email(3));
    await expect(row(email(3))).toContainText(NOT_SENT, { timeout: 30_000 });
    await shot(page, TAB, 'SM21-users', info);
    // The member's activity: "Invitation emailed" only for the one emailed.
    await open(page, `/team/${c.m1}/security/activity`);
    await expect(page.getByText('Invitation emailed', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await open(page, `/team/${m3}/security/activity`);
    await expect(page.getByText('Invitation created', { exact: true }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText('Invitation emailed', { exact: true })).toHaveCount(0);
    // The Created page says so too.
    await open(page, `/team/${m3}/created`);
    await expect(page.getByTestId('created-summary-line')).toContainText(
      'No welcome email was sent yet',
      { timeout: 30_000 },
    );
    await open(page, `/team/${c.m1}/created`);
    await expect(page.getByTestId('created-summary-line')).toContainText(
      'will receive a welcome email',
      { timeout: 30_000 },
    );
  });

  test('SM25 Edit Staff keeps a primary and a backup team', async ({ page, browser }, info) => {
    // NOT LIVE (supervisor loops): a supervisor must be an active member; this run's members stay
    // Invited and every other member is read-only, so no loop can be offered.
    note(info, 'SM25 supervisor loop: needs two active members the run may change; none');
    leaveFreely(page);
    const c = await fixture(browser);
    await editStaff(page, c.m1, M1_FIRST);
    await page.getByLabel('Primary Team').selectOption({ label: TEAM_B });
    await page.getByLabel('Backup Team').selectOption({ label: TEAM_A });
    // The backup list leaves out the primary team.
    await expect(page.getByLabel('Backup Team').locator('option', { hasText: TEAM_B })).toHaveCount(
      0,
    );
    await page.getByLabel('Send notification of changes').uncheck();
    await page.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByTestId('edit-saved')).toContainText('Changes saved', {
      timeout: 30_000,
    });
    await editStaff(page, c.m1, M1_FIRST);
    await expect(page.getByLabel('Primary Team').locator('option:checked')).toHaveText(TEAM_B);
    await expect(page.getByLabel('Backup Team').locator('option:checked')).toHaveText(TEAM_A);
    await shot(page, TAB, 'SM25', info);
  });

  test('SM33 device restriction is hidden, IP and country say not active yet, and auto-logout and a disable date are kept', async ({
    page,
    browser,
  }, info) => {
    // NOT LIVE: the MFA reset notice (Reset MFA is for a member who has signed in; the run's
    // members never do) and the enforcement of automatic logout and the disable date (a session of
    // that member). Checked here: the three screens and the settings saved on the run's member.
    note(
      info,
      'SM33 MFA reset notice, and auto-logout/disable-on enforcement: need the member to sign in',
    );
    leaveFreely(page);
    const c = await fixture(browser);
    const DEVICES = /Restrict login to specific devices/i;
    // Create Staff, step 3 (nothing saved).
    await open(page, '/team/new/security');
    await expect(page.getByText('Login Restrictions')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(DEVICES)).toHaveCount(0);
    await expect(
      page.getByLabel('Restrict login to specific IP addresses (not active yet)'),
    ).toBeVisible();
    await page.getByLabel('Specific Countries/Regions Only (not active yet)').check();
    await expect(page.getByTestId('location-not-active')).toContainText(
      'sign-in does not check IP addresses or countries yet',
    );
    await shot(page, TAB, 'SM33-create', info);
    // New Account Security (read only here).
    await open(page, '/team/settings/security');
    await expect(page.getByText('Login Restrictions')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(DEVICES)).toHaveCount(0);
    await expect(page.getByLabel('Specific IP Addresses Only (not active yet)')).toBeVisible();
    await expect(page.getByLabel('Specific Countries/Regions Only (not active yet)')).toBeVisible();
    // The run's member: Login & Security.
    await open(page, `/team/${c.m1}/security/login`);
    const form = page.getByRole('form', { name: 'Login and security settings' });
    await expect(form.getByLabel('Disable account on')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(DEVICES)).toHaveCount(0);
    await form.getByLabel('Specific IP Addresses Only (not active yet)').check();
    await expect(form.getByTestId('location-not-active')).toBeVisible();
    await form.getByLabel('Anywhere (recommended)').check();
    const day = firmDay(45, 'America/New_York');
    await form.getByLabel('Automatic logout after inactivity').check();
    await form.getByLabel('Inactivity time').selectOption('30');
    await form.getByLabel('Disable account on').check();
    await form.getByLabel('Disable date').fill(day);
    await form.getByRole('button', { name: 'Save Changes' }).click();
    await expect(page.getByTestId('login-saved')).toBeVisible({ timeout: 30_000 });
    await open(page, `/team/${c.m1}/security/login`);
    await expect(form.getByLabel('Automatic logout after inactivity')).toBeChecked({
      timeout: 30_000,
    });
    await expect(form.getByLabel('Inactivity time')).toHaveValue('30');
    await expect(form.getByLabel('Disable account on')).toBeChecked();
    await expect(form.getByLabel('Disable date')).toHaveValue(day);
    await shot(page, TAB, 'SM33-member', info);
  });

  test.describe('SM38 in another browser time zone', () => {
    test.use({ timezoneId: TZ_PROBE });

    test('SM38 the import is audited with its file name, and member times are the firm’s', async ({
      page,
      browser,
    }, info) => {
      const c = await fixture(browser);
      await imported(browser);
      const { zone, rows, invited } = await asOwner(browser, async (api) => {
        const tz = (await ok(await api.get('business/availability'), 'availability'))
          .timezone as string;
        const to = new Date(Date.now() + 60_000).toISOString();
        const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
        const audit = async (action: string) =>
          itemsOf<{ action: string; at: string; metadata: Record<string, unknown> }>(
            await ok(
              await api.get(
                `business/audit-log?action=${action}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=100`,
              ),
              action,
            ),
          );
        const activity = itemsOf<{ at: string; label: string }>(
          await ok(await api.get(`business/staff/${c.m1}/activity`), 'activity'),
        );
        return {
          zone: tz,
          rows: [...(await audit('staff.import_previewed')), ...(await audit('staff.imported'))],
          invited: activity.find((a) => a.label === 'Invitation created'),
        };
      });
      // The preview's and the import's audit rows name the file.
      const named = new Set(
        rows.filter((r) => r.metadata['fileName'] === IMPORT_FILE).map((r) => r.action),
      );
      expect([...named].sort()).toEqual(['staff.import_previewed', 'staff.imported']);
      // The member's activity in the firm's zone, not the browser's.
      expect(zone).not.toBe(TZ_PROBE);
      expect(invited, 'the fixture member has its "Invitation created" row').toBeTruthy();
      await open(page, `/team/${c.m1}/security/activity`);
      // Formatted in the browser (its own ICU), as the page does, in each zone.
      const [inFirm, inBrowser] = await page.evaluate(
        ([iso, firm]) =>
          [firm, undefined].map((timeZone) =>
            new Date(iso!).toLocaleString('en-US', {
              timeZone,
              month: 'short',
              day: 'numeric',
              year: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            }),
          ),
        [invited!.at, zone],
      );
      expect(inFirm).not.toBe(inBrowser);
      const line = page.getByRole('row').filter({ hasText: 'Invitation created' }).first();
      await expect(line).toContainText(inFirm!, { timeout: 30_000 });
      await expect(line).not.toContainText(inBrowser!);
      await shot(page, TAB, 'SM38', info);
    });
  });

  test('SM40 dialogs give focus back, Create Staff goes field to field, and pages fit 768 and 375 px', async ({
    page,
    browser,
  }, info) => {
    const c = await fixture(browser);
    // A dialog gives focus back to what opened it (nothing is done in it).
    await open(page, '/team');
    const tile = page.getByTestId('staff-links').getByRole('button', {
      name: /^Account Access & Security/,
    });
    await tile.click({ timeout: 30_000 });
    const pick = page.getByRole('dialog', { name: 'Account Access & Security' });
    await expect(pick).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pick).toBeHidden();
    await expect(tile).toBeFocused();
    await editStaff(page, c.m1, M1_FIRST);
    const deactivate = page.getByRole('button', { name: 'Deactivate Account' }).last();
    await deactivate.click();
    const ask = page.getByRole('dialog', { name: 'Deactivate Account' });
    await expect(ask).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(ask).toBeHidden();
    await expect(deactivate).toBeFocused();
    // Create Staff: Tab goes field to field, and a missing field is announced.
    await open(page, '/team/new');
    const first = page.getByLabel('First Name *');
    await first.focus({ timeout: 30_000 });
    for (const next of ['Last Name *', 'Work Email *', 'Phone Number (Optional)']) {
      await page.keyboard.press('Tab');
      await expect(page.getByLabel(next)).toBeFocused();
    }
    await page.getByRole('button', { name: 'Next: Role & Permissions' }).click();
    await expect(first).toHaveAttribute('aria-invalid', 'true');
    const described = (await first.getAttribute('aria-describedby')) ?? '';
    expect(described).not.toBe('');
    await expect(page.locator(`[id="${described.split(' ')[0]}"]`)).not.toBeEmpty();
    expect(draftOf(page), 'nothing saved').toBe('');
    // 768 and 375 px: no sideways scroll.
    for (const width of [768, 375]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ['/team', '/team/new', `/team/${c.m1}`, '/team/settings/security']) {
        await open(page, path);
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({
          timeout: 30_000,
        });
        const [scroll, inner] = await page.evaluate(() => [
          document.documentElement.scrollWidth,
          window.innerWidth,
        ]);
        expect(scroll, `${path} at ${width} px`).toBeLessThanOrEqual(inner);
      }
      await shot(page, TAB, `SM40-${width}`, info);
    }
  });
});

test.describe('Staff Management Review 2 batch 1 as the Admin', () => {
  test.use(as('admin'));

  test('SM02 an Admin gives a custom role nothing beyond their own grid', async ({
    page,
    browser,
  }, info) => {
    test.skip(!hasLogin('admin'), 'no Admin login in this run');
    leaveFreely(page);
    // The Admin's own grid (read as the Owner) and a cell the base role lacks.
    const plan = await asOwner(browser, async (api) => {
      const adminEmail = login('admin')!.email.toLowerCase();
      const team = itemsOf<{ id: string; user: { email: string } }>(
        await ok(await api.get('business/team'), 'team'),
      );
      const me = team.find((m) => m.user.email.toLowerCase() === adminEmail);
      if (!me) throw new Error('the Admin login is not in Test Firm B');
      type Cell = { module: string; capability: string; granted: boolean };
      const own = (await ok(await api.get(`business/staff/${me.id}/permissions`), 'admin grid'))
        .cells as Cell[];
      const base = (await ok(await api.get('business/roles/READ_ONLY/permissions'), 'base'))
        .cells as Cell[];
      const mods = await ok(await api.get('business/permission-modules'), 'modules');
      const label = (c: Cell) =>
        `${(mods.modules as { module: string; label: string }[]).find((m) => m.module === c.module)?.label}: ${
          (mods.capabilities as { capability: string; label: string }[]).find(
            (x) => x.capability === c.capability,
          )?.label
        }`;
      const baseHas = (module: string, capability: string) =>
        base.some((b) => b.module === module && b.capability === capability && b.granted);
      // A cell beyond Read Only that can be ticked alone (View, or another where it has View).
      const fits = (c: Cell) =>
        !baseHas(c.module, c.capability) && (c.capability === 'VIEW' || baseHas(c.module, 'VIEW'));
      const pick = (granted: boolean) => {
        const all = own.filter((c) => c.granted === granted && fits(c));
        const c = all.find((x) => x.capability === 'VIEW') ?? all[0];
        return c ? { ...c, name: label(c) } : null;
      };
      return { beyond: pick(false), within: pick(true) };
    });

    const create = async (name: string, cellName: string) => {
      await open(page, '/team/roles');
      await page.getByRole('button', { name: 'Create Custom Role' }).first().click({
        timeout: 30_000,
      });
      const start = page.getByRole('dialog', { name: 'Create Custom Role' });
      await start.getByLabel('Role Name *').fill(name);
      await start.getByLabel('Start From *').selectOption({ label: 'Read Only' });
      await start.getByRole('button', { name: 'Next: Set Permissions' }).click();
      const set = page.getByRole('dialog', { name: `Set Permissions: ${name}` });
      await set.getByRole('checkbox', { name: cellName, exact: true }).check({ timeout: 30_000 });
      await set.getByRole('button', { name: 'Save Role' }).click();
      return set;
    };

    if (plan.beyond) {
      // A cell the Admin lacks: refused (403 CANNOT_GRANT), and no role is made.
      const set = await create(ROLE, plan.beyond.name);
      await expect(set.getByRole('alert')).toHaveText(
        'You cannot change this role, or give what you do not have yourself.',
        { timeout: 30_000 },
      );
      await shot(page, TAB, 'SM02-refused', info);
      const admin = await roleApi(browser, 'admin');
      try {
        const res = await admin.post('business/roles/custom', {
          name: `${ROLE} API`,
          basedOn: 'READ_ONLY',
          grants: [
            { module: plan.beyond.module, capability: plan.beyond.capability, granted: true },
          ],
          acknowledgeEscalation: true,
        });
        if (res.ok()) remember({ roles: [(await res.json()).id as string] });
        expect(res.status()).toBe(403);
        expect((await res.json()).error?.code).toBe('CANNOT_GRANT');
      } finally {
        await admin.dispose();
      }
    } else {
      // NOT LIVE (the refusal): Test Firm B's Admin has every cell, so nothing is beyond their
      // grid; taking one away is a change to the Admin role or the harness Admin, which this run
      // may not make. Checked: a cell the Admin has is never refused (Save Anyway makes the role).
      note(
        info,
        'SM02 403: the Admin has every cell in Test Firm B; refusal needs a role change the run may not make',
      );
      expect(plan.within, 'a cell the Admin has beyond Read Only').toBeTruthy();
      const set = await create(ROLE, plan.within!.name);
      await expect(set.getByText(/more than Read Only has in this firm/)).toBeVisible({
        timeout: 30_000,
      });
      await set.getByRole('button', { name: 'Save Anyway' }).click();
      await expect(set).toBeHidden({ timeout: 30_000 });
      await shot(page, TAB, 'SM02-within', info);
    }
    const custom = await asOwner(
      browser,
      async (api) =>
        ((await ok(await api.get('business/roles'), 'roles')).custom ?? []) as {
          id: string;
          name: string;
        }[],
    );
    const made = custom.filter((r) => r.name.startsWith(runTag));
    remember({ roles: made.map((r) => r.id) });
    if (plan.beyond) expect(made, 'no role was made').toHaveLength(0);
    else expect(made.map((r) => r.name)).toEqual([ROLE]);
  });
});

// ---------------------------------------------------------------- cleanup

/** Deactivates, deletes and archives what run `c` made, and only that. */
async function cleanRun(api: Api, c: Ctx, done: string[], left: string[]) {
  const stamp = c.tag.slice('LIVE-CHECK '.length);
  // Members: the recorded ones and any with this run's addresses, each checked to be ours.
  const found = itemsOf<Member>(
    await ok(
      await api.get(
        `business/staff?search=${encodeURIComponent(`live-check-${stamp}`)}&status=all&pageSize=100`,
      ),
      'run members',
    ),
  );
  const ids = new Set([...c.members, ...found.map((m) => m.id)]);
  for (const id of ids) {
    const r = await api.get(`business/staff/${id}`);
    if (r.status() === 404) continue;
    const m = (await ok(r, `member ${id}`)) as Member;
    if (!OURS.test(m.email) || !m.email.includes(`-${stamp}-`)) {
      left.push(`member ${id} is not this run's (${m.email}): left alone`);
      continue;
    }
    if (m.status === 'DEACTIVATED') {
      done.push(`member ${m.name}: deactivated already`);
      continue;
    }
    const x = await api.post(`business/staff/${id}/deactivate`, {
      reason: `${c.tag} cleanup`,
      confirm: true,
    });
    (x.ok() ? done : left).push(`member ${m.name} deactivate (${x.status()})`);
  }
  // Drafts: the recorded ones and the Owner's drafts for this run's addresses or names.
  const drafts = itemsOf<{
    id: string;
    data: { account?: { email?: string; firstName?: string } };
  }>(await ok(await api.get('business/staff-drafts'), 'drafts'));
  const draftIds = new Set([
    ...c.drafts,
    ...drafts
      .filter(
        (d) =>
          (d.data.account?.email ?? '').includes(`live-check-${stamp}-`) ||
          (d.data.account?.firstName ?? '').startsWith(c.tag),
      )
      .map((d) => d.id),
  ]);
  for (const id of draftIds) {
    const x = await api.delete(`business/staff-drafts/${id}`);
    (x.ok() || x.status() === 404 ? done : left).push(`draft ${id} delete (${x.status()})`);
  }
  // Custom roles named for this run.
  const roles = ((await ok(await api.get('business/roles'), 'roles')).custom ?? []) as {
    id: string;
    name: string;
  }[];
  for (const r of roles.filter((x) => x.name.startsWith(c.tag) || c.roles.includes(x.id))) {
    if (!r.name.startsWith(c.tag)) {
      left.push(`role ${r.id} is not this run's: left alone`);
      continue;
    }
    const x = await api.post(`business/roles/custom/${r.id}/archive`);
    (x.ok() || x.status() === 409 ? done : left).push(`role ${r.name} archive (${x.status()})`);
  }
  // Teams, then the department (named for this run, checked before each change).
  for (const [kind, id] of [
    ['teams', c.teamA],
    ['teams', c.teamB],
    ['departments', c.deptId],
  ] as const) {
    if (!id) continue;
    const r = await api.get(`business/${kind}/${id}`);
    if (r.status() === 404) continue;
    const g = (await ok(r, `${kind} ${id}`)) as { name: string; status: string };
    if (!g.name.startsWith(c.tag)) {
      left.push(`${kind} ${id} is not this run's: left alone`);
      continue;
    }
    if (g.status === 'ARCHIVED') {
      done.push(`${g.name}: archived already`);
      continue;
    }
    const x = await api.patch(`business/${kind}/${id}`, { status: 'ARCHIVED' });
    (x.ok() ? done : left).push(
      `${g.name} archive (${x.status()} ${x.ok() ? '' : (await x.text()).slice(0, 120)})`,
    );
  }
}

test.describe('Staff Management cleanup', () => {
  test.use(as('owner'));
  test('zz cleanup', async ({ browser }, info) => {
    const c = current();
    if (c.deptId || c.members.length || c.drafts.length || c.roles.length) register(c);
    const runs = readRegistry().filter((r) => r.tag === runTag || !r.cleaned);
    if (!runs.length) return;
    const left: string[] = [];
    const done: string[] = [];
    await asOwner(browser, async (api) => {
      for (const run of runs) {
        const l: string[] = [];
        const d: string[] = [];
        await cleanRun(api, run, d, l);
        done.push(...d.map((x) => `[${run.tag}] ${x}`));
        left.push(...l.map((x) => `[${run.tag}] ${x}`));
        if (!l.length) register({ ...run, cleaned: true });
      }
    });
    console.warn(`CLEANUP done:\n${done.join('\n')}\nCLEANUP left:\n${left.join('\n')}`);
    info.annotations.push({ type: 'left-behind', description: left.join('; ') || 'none' });
    expect(left, 'everything the run made is cleaned').toEqual([]);
  });
});
