import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type Locator,
  type Page,
} from '@playwright/test';
import { firmSlug, shotsDir, statePath } from './env';
import { apiAs, app, as, hasLogin, settled, shot } from './helpers';

/**
 * Audit Log, Review 2 batch 1 (ca5d0786d: R01, R02a, R03c, M01a, M01b, M04, T10a; #1644: M02b,
 * M03, R03a, R03b, R04a): one test per row, live on dev as Test Firm B's Owner (Staff for the
 * refusals). Rows are named by their IDs (R61's map, F:/firmivra-private/checks/audit-log.md).
 *
 * Records: the run makes its own, each named "LIVE-CHECK yyyymmddhhmm Audit ...": one client (SES
 * simulator email, a fictional 555-01xx phone, a synthetic 9xx SSN for M03), renamed once (M01a);
 * one recurring deadline definition, changed once as its Edit screen saves it (R03a); one
 * applicability rule on it, switched off with its liability floor set to 0 (R03b, R03c); one
 * compliance deadline for the client (no reminders, not client visible), completed with a filed-on
 * day and a confirmation number, then reopened (R04a); one task draft, discarded (M01a "Deleted
 * task"). The checks read those records' rows on the Audit Log page as the Owner sees them; the API
 * only makes and removes the records. "zz cleanup" discards the draft, archives the deadline and
 * the definition, leaves the rule inactive (rules have no delete), clears the SSN and archives the
 * client, and sweeps earlier unfinished runs through the ledger (.runs.json).
 *
 * Exports are saved under LIVE_SHOTS_DIR/audit-log/, read, and deleted in the same test. Nothing
 * here changes a firm setting, sends a message, or touches a record the run did not make.
 */
test.describe.configure({ timeout: 180_000 });

const TAB = 'audit-log';
/** The browser's own zone: far from any US firm zone, so a time shown in it would not match. */
const BROWSER_TZ = 'Asia/Tokyo';
/** #1644 (M02b, M03) on dev: its Deploy dev run finished at 23:21Z; rows after this are its. */
const PART2_LIVE = Date.parse('2026-11-18T23:30:00.000Z');

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
/** yyyymmddhhmm */
const STAMP = runTag.slice('LIVE-CHECK '.length);
const SIMULATOR = /@simulator\.amazonses\.com$/i;
/** The audit tab's numbers (71+): never the same address as another tab's run in the same minute. */
const email = (n: number) => `success+live-check-${STAMP}-${n}@simulator.amazonses.com`;
const CLIENT = `${runTag} Audit Client`;
const CLIENT_RENAMED = `${runTag} Audit Client Renamed`;
const RECURRENCE = `${runTag} Audit Recurrence`;
const RULE = `${runTag} Audit Rule`;
const DEADLINE = `${runTag} Audit Deadline`;
const DRAFT = `${runTag} Audit Draft`;
/** Synthetic: area 9xx is never issued as an SSN. Only its last 4 may ever show. */
const SSN = `9${STAMP.slice(4, 12)}`;
const CONFIRMATION = `LC-${STAMP}`;
const AGENCY = 'LIVE-CHECK Agency';
const SECRET_TEXT = `first description ${STAMP}`;

// ---------------------------------------------------------------- the run's records

interface Ctx {
  tag: string;
  zone: string;
  ownerUserId: string;
  clientId: string;
  renamed: boolean;
  ssnSet: boolean;
  recurrenceId: string;
  recurrenceUpdated: boolean;
  ruleId: string;
  ruleUpdated: boolean;
  deadlineId: string;
  filedOn: string;
  completed: boolean;
  reopened: boolean;
  draftId: string;
  draftDiscarded: boolean;
  /** Set on an earlier run's entry once its cleanup left nothing. */
  cleaned?: boolean;
}
const blankCtx = (): Ctx => ({
  tag: runTag,
  zone: '',
  ownerUserId: '',
  clientId: '',
  renamed: false,
  ssnSet: false,
  recurrenceId: '',
  recurrenceUpdated: false,
  ruleId: '',
  ruleUpdated: false,
  deadlineId: '',
  filedOn: '',
  completed: false,
  reopened: false,
  draftId: '',
  draftDiscarded: false,
});
const ctxFile = () => join(process.env['LIVE_OUT_DIR']!, 'audit-log-ctx.json');
function readCtx(): Ctx {
  try {
    const saved = JSON.parse(readFileSync(ctxFile(), 'utf8')) as Partial<Ctx>;
    return saved.tag === runTag ? { ...blankCtx(), ...saved } : blankCtx();
  } catch {
    return blankCtx();
  }
}
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
function saveCtx(c: Ctx) {
  writeFileSync(ctxFile(), JSON.stringify(c, null, 2));
  register(c);
}

async function ok<T>(res: APIResponse, what: string): Promise<T> {
  if (!res.ok()) throw new Error(`${what}: ${res.status()} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

interface Me {
  user: { id: string; name: string; email: string };
  memberships: { business: { slug: string }; role: string; status: string }[];
}

/** The firm's calendar day, `days` from today, in its zone. */
const firmDay = (days: number, zone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(
    new Date(Date.now() + days * 86_400_000),
  );

/** The run's client; if an earlier attempt of this run made it (409 email), that one. */
async function ensureClient(api: APIRequestContext): Promise<string> {
  const body = {
    accountType: 'INDIVIDUAL',
    displayName: CLIENT,
    email: email(71),
    phone: `(2${STAMP.slice(6, 8)}) 555-01${STAMP.slice(10, 12)}`,
    allowDuplicatePhone: true,
    profile: {
      address: {
        line1: `71 ${STAMP} Fake Street`,
        city: 'Atlanta',
        state: 'GA',
        postalCode: '30301',
        country: 'US',
      },
    },
  };
  if (!SIMULATOR.test(body.email)) throw new Error('not a simulator address');
  const res = await api.post('business/clients', { data: body });
  if (res.ok()) return ((await res.json()) as { id: string }).id;
  if (res.status() !== 409) throw new Error(`create client: ${res.status()} ${await res.text()}`);
  const found = await ok<{ items?: { id: string; displayName: string }[] }>(
    await api.get(`business/clients?search=${encodeURIComponent(body.email)}&status=all&limit=10`),
    'find client',
  );
  const hit = (found.items ?? []).find((x) => x.displayName.startsWith(CLIENT));
  if (!hit) throw new Error('create client: 409 and not found');
  return hit.id;
}

/** The definition as the run makes it: a dated annual one with no reminders and no task. */
const recurrenceBody = (startOn: string) => ({
  name: RECURRENCE,
  type: 'OTHER',
  description: SECRET_TEXT,
  agency: AGENCY,
  relatedForm: 'LC-1',
  jurisdiction: 'INTERNAL',
  frequency: 'ANNUAL',
  repeatRule: { month: 4, day: 15 },
  startOn,
  endMode: 'NEVER',
  holidayRule: 'NEXT_BUSINESS_DAY',
  isTemplate: false,
  createTask: false,
  clientVisible: false,
  remindClient: false,
  addToTaxCalendar: false,
  notifyTeam: false,
  reminders: [],
  sendPastDueNotice: false,
  escalateToManager: false,
});

/**
 * Makes (or, on a worker restart, finds in the run's file) every record the checks read, and the
 * changes whose audit rows they read. Each step is saved as it is done, so nothing is made twice.
 */
async function fixture(): Promise<Ctx> {
  const c = readCtx();
  const save = () => saveCtx(c);
  const api = await apiAs('owner');
  try {
    // Test Firm B only: the Owner login is a member of no other firm.
    const me = await ok<Me>(await api.get('me'), 'me');
    const firms = me.memberships.filter((m) => m.status === 'ACTIVE').map((m) => m.business.slug);
    expect(firms, 'the Owner login is in Test Firm B only').toEqual([firmSlug]);
    c.ownerUserId = me.user.id;
    c.zone = (
      await ok<{ timezone: string }>(await api.get('business/availability'), 'zone')
    ).timezone;
    save();
    if (!c.clientId) {
      c.clientId = await ensureClient(api);
      save();
    }
    if (!c.renamed) {
      await ok(
        await api.patch(`business/clients/${c.clientId}`, {
          data: { displayName: CLIENT_RENAMED },
        }),
        'rename client',
      );
      c.renamed = true;
      save();
    }
    if (!c.ssnSet) {
      await ok(
        await api.put(`business/clients/${c.clientId}/profile`, { data: { ssn: SSN } }),
        'client SSN',
      );
      c.ssnSet = true;
      save();
    }
    const startOn = `${Number(firmDay(0, c.zone).slice(0, 4)) + 1}-01-01`;
    if (!c.recurrenceId) {
      c.recurrenceId = (
        await ok<{ id: string }>(
          await api.post('business/compliance/recurrences', { data: recurrenceBody(startOn) }),
          'recurrence',
        )
      ).id;
      save();
    }
    if (!c.recurrenceUpdated) {
      // R03a: what the Edit screen sends (recurring-setup.tsx `body`, without isTemplate): every
      // field of the form, four of them changed.
      const { isTemplate: _kind, ...form } = recurrenceBody(startOn);
      void _kind;
      await ok(
        await api.patch(`business/compliance/recurrences/${c.recurrenceId}`, {
          data: {
            ...form,
            description: `second description ${STAMP}`,
            agency: `${AGENCY} 2`,
            holidayRule: 'NONE',
            addToTaxCalendar: true,
          },
        }),
        'recurrence update',
      );
      c.recurrenceUpdated = true;
      save();
    }
    if (!c.ruleId) {
      c.ruleId = (
        await ok<{ id: string }>(
          await api.post('business/compliance/applicability-rules', {
            data: {
              name: RULE,
              target: { kind: 'RECURRENCE', id: c.recurrenceId },
              outcome: 'SUGGEST',
              states: ['WY'],
              active: true,
            },
          }),
          'rule',
        )
      ).id;
      save();
    }
    if (!c.ruleUpdated) {
      // R03b and R03c: switched off (true to false) and its floor set from none to 0.
      await ok(
        await api.patch(`business/compliance/applicability-rules/${c.ruleId}`, {
          data: { active: false, priorYearLiabilityOverCents: 0 },
        }),
        'rule update',
      );
      c.ruleUpdated = true;
      save();
    }
    if (!c.deadlineId) {
      c.deadlineId = (
        await ok<{ id: string }>(
          await api.post('business/compliance/deadlines', {
            data: {
              clientId: c.clientId,
              name: DEADLINE,
              type: 'OTHER',
              dueOn: firmDay(30, c.zone),
              clientVisible: false,
              reminders: [],
              createTask: false,
            },
          }),
          'deadline',
        )
      ).id;
      save();
    }
    if (!c.completed) {
      c.filedOn = firmDay(-1, c.zone);
      await ok(
        await api.post(`business/compliance/deadlines/${c.deadlineId}/complete`, {
          data: { filedOn: c.filedOn, confirmationNumber: CONFIRMATION },
        }),
        'complete',
      );
      c.completed = true;
      save();
    }
    if (!c.reopened) {
      await ok(
        await api.post(`business/compliance/deadlines/${c.deadlineId}/reopen`, { data: {} }),
        'reopen',
      );
      c.reopened = true;
      save();
    }
    if (!c.draftId) {
      c.draftId = (
        await ok<{ id: string }>(
          await api.post('business/tasks/drafts', {
            data: { title: DRAFT, clientId: c.clientId, idempotencyKey: randomUUID() },
          }),
          'task draft',
        )
      ).id;
      save();
    }
    if (!c.draftDiscarded) {
      const gone = await api.delete(`business/tasks/drafts/${c.draftId}`);
      if (!gone.ok() && gone.status() !== 404) {
        throw new Error(`discard draft: ${gone.status()} ${(await gone.text()).slice(0, 300)}`);
      }
      c.draftDiscarded = true;
      save();
    }
    return c;
  } finally {
    await api.dispose();
  }
}

// ---------------------------------------------------------------- times

const norm = (s: string) => s.replace(/[\s\u202f\u00a0]+/g, ' ').trim();

/** The screen's form: "Nov 15, 2026, 2:50 PM CST" (audit-time.ts `when`). */
const shownTime = (iso: string, zone: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso));

function partsIn(at: number, zone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).formatToParts(new Date(at));
  const p = (type: Intl.DateTimeFormatPartTypes) => parts.find((x) => x.type === type)?.value ?? '';
  return {
    y: p('year'),
    mo: p('month'),
    d: p('day'),
    h: p('hour'),
    mi: p('minute'),
    s: p('second'),
    tz: p('timeZoneName'),
  };
}

/** The export's form: "2026-11-15 14:50:22 CST". */
const csvTime = (iso: string, zone: string) => {
  const p = partsIn(Date.parse(iso), zone);
  return `${p.y}-${p.mo}-${p.d} ${p.h}:${p.mi}:${p.s} ${p.tz}`;
};

/** The zone's offset from UTC at `at`, in ms. */
function offsetAt(at: number, zone: string): number {
  const p = partsIn(at, zone);
  const local = Date.UTC(+p.y, +p.mo - 1, +p.d, +p.h % 24, +p.mi, +p.s);
  return local - (at - (((at % 1000) + 1000) % 1000));
}

/** The first moment of `day` in the zone, worked out here (not with the app's helper). */
function zonedMidnight(day: string, zone: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - offsetAt(guess, zone);
  return guess - offsetAt(first, zone);
}
const nextDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};
/** A firm day from its first to its last moment, as the API's instants. */
const dayBounds = (day: string, zone: string) => ({
  from: new Date(zonedMidnight(day, zone)).toISOString(),
  to: new Date(zonedMidnight(nextDay(day), zone) - 1).toISOString(),
});

// ---------------------------------------------------------------- the page

/** Opens the log, optionally with the filters a link may carry (action, entityType, entityId). */
async function openLog(page: Page, filters: Record<string, string> = {}) {
  const qs = new URLSearchParams(filters).toString();
  await page.goto(app(`/audit-log${qs ? `?${qs}` : ''}`));
  await expect(page.getByTestId('page-title')).toHaveText('Audit log', { timeout: 60_000 });
  await settled(page);
}

/** The log's entries as shown: cards below 1280 px (both widths under test), the table above. */
const entries = (page: Page) =>
  page.locator('[data-testid="audit-mobile-entry"]:visible, table tbody tr:visible');

/** The one shown entry of `action` (its code is printed under its words). */
async function oneEntry(page: Page, action: string): Promise<Locator> {
  const hits = entries(page).filter({ hasText: action });
  await expect(hits, `one ${action} entry`).toHaveCount(1, { timeout: 30_000 });
  return hits.first();
}

/** An entry's Details, opened as a reader opens them: key → value (the Request line too). */
async function detailsOf(entry: Locator): Promise<Map<string, string>> {
  const box = entry.getByTestId('audit-details');
  if ((await box.getAttribute('open')) === null) await box.locator('summary').click();
  await expect(box.locator('dl')).toBeVisible();
  const pairs = (await box.evaluate((el) =>
    [...el.querySelectorAll('dl > div')].map((d) => [
      d.querySelector('dt')?.textContent ?? '',
      d.querySelector('dd')?.textContent ?? '',
    ]),
  )) as [string, string][];
  return new Map(pairs.map(([k, v]) => [k.trim().replace(/:$/, ''), v.trim()]));
}

const filterForm = (page: Page) => page.getByRole('form', { name: 'Filter the log' });

/** Parses the export (RFC 4180, CRLF, byte order mark). */
function parseCsv(text: string): string[][] {
  const s = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

interface Export {
  text: string;
  header: string[];
  rows: Record<string, string>[];
  url: URL;
}

/**
 * Clicks Export, saves the file under LIVE_SHOTS_DIR/audit-log/, reads it and deletes it. Returns
 * its header, its rows by column, and the address the page asked for.
 */
async function exportCsv(page: Page, name: string): Promise<Export> {
  const asked = page.waitForRequest((r) => r.url().includes('/api/v1/business/audit-log/export'));
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60_000 }),
    page.getByTestId('audit-export').click(),
  ]);
  const url = new URL((await asked).url());
  const path = join(shotsDir(TAB), `${name}-${STAMP}.csv`);
  await download.saveAs(path);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } finally {
    unlinkSync(path);
  }
  const [header = [], ...body] = parseCsv(text);
  const rows = body
    .filter((r) => r.some((x) => x !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
  return { text, header, rows, url };
}

/** A browser of the role's own (Staff for the refusals), in the same zone as the Owner's. */
async function roleContext(browser: Browser, role: 'staff') {
  const api = await apiAs(role);
  let me: Me;
  try {
    me = await ok<Me>(await api.get('me'), `${role} me`);
  } finally {
    await api.dispose();
  }
  const firms = me.memberships.filter((m) => m.status === 'ACTIVE').map((m) => m.business.slug);
  expect(firms, `the ${role} login is in Test Firm B only`).toEqual([firmSlug]);
  const context = await browser.newContext({
    storageState: statePath(role),
    timezoneId: BROWSER_TZ,
  });
  return { context, page: await context.newPage(), me };
}

// ---------------------------------------------------------------- M03's rules (audit-values.ts)

const wordsOf = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\-.\s]+/g, ' ')
    .toLowerCase()
    .trim()
    .split(' ')
    .filter(Boolean);
const SECRET_NOUNS = new Set([
  'password',
  'passwords',
  'passcode',
  'passphrase',
  'secret',
  'secrets',
  'token',
  'tokens',
  'otp',
  'cvv',
  'cvc',
  'pin',
  'apikey',
  'iban',
]);
const CODE_KINDS = new Set([
  'mfa',
  'reset',
  'verification',
  'auth',
  'otp',
  'recovery',
  'security',
  'time',
  'login',
  'sms',
  'email',
  'backup',
]);
const KEY_KINDS = new Set([
  'api',
  'private',
  'access',
  'secret',
  'signing',
  'encryption',
  'license',
]);
const NUMBER_KINDS = new Set(['card', 'account', 'routing', 'iban', 'pan']);
function isSecretKey(key: string): boolean {
  const w = wordsOf(key);
  const last = w.at(-1);
  if (!last) return false;
  const before = w.slice(0, -1);
  if (SECRET_NOUNS.has(last)) return true;
  if (last === 'code' || last === 'codes') return before.some((x) => CODE_KINDS.has(x));
  if (last === 'key' || last === 'keys') return before.some((x) => KEY_KINDS.has(x));
  if (last === 'number' || last === 'numbers') return before.some((x) => NUMBER_KINDS.has(x));
  return false;
}
function isTaxIdKey(key: string): boolean {
  const w = wordsOf(key);
  const last = w.at(-1);
  if (!last) return false;
  if (['ssn', 'ein', 'itin', 'tin', 'taxid'].includes(last)) return true;
  return last === 'id' && w.at(-2) === 'tax';
}

/** Where a row's metadata holds a secret's value or a whole tax id: "path (why)", never the value. */
function unredacted(value: unknown, path: string, guard: 'secret' | 'tax' | null): string[] {
  if (value === null || value === undefined || typeof value === 'boolean') return [];
  if (Array.isArray(value)) return value.flatMap((v, i) => unredacted(v, `${path}[${i}]`, guard));
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      unredacted(
        v,
        `${path}.${k}`,
        guard ?? (isSecretKey(k) ? 'secret' : isTaxIdKey(k) ? 'tax' : null),
      ),
    );
  }
  if (guard === 'secret' && value !== '[redacted]') return [`${path} (a secret's value)`];
  if (guard === 'tax' && value !== '[redacted]' && !/^•••\d{4}$/.test(String(value))) {
    return [`${path} (a tax id beyond its last 4)`];
  }
  return [];
}

// ================================================================ Owner (Staff where a row needs it)

test.describe('Audit Log (Owner)', () => {
  test.use({ ...as('owner'), timezoneId: BROWSER_TZ });
  test.skip(() => !hasLogin('owner'), 'no owner login');
  let c: Ctx;
  test.beforeAll(async () => {
    c = await fixture();
  });

  test("R01a times on screen are in the firm's time zone with the zone named, whatever the browser's zone", async ({
    page,
  }, info) => {
    expect(
      c.zone,
      "the firm's zone differs from the browser's, so the check tells them apart",
    ).not.toBe(BROWSER_TZ);
    await openLog(page, { entityType: 'client', entityId: c.clientId, action: 'client.created' });
    const entry = await oneEntry(page, 'client.created');
    const time = entry.locator('time').first();
    const iso = (await time.getAttribute('datetime'))!;
    const text = norm(await time.innerText());
    expect(text, 'the time in the firm zone').toBe(norm(shownTime(iso, c.zone)));
    expect(text, "never the browser's zone").not.toBe(norm(shownTime(iso, BROWSER_TZ)));
    expect(text, 'the zone is named').toMatch(
      new RegExp(`${partsIn(Date.parse(iso), c.zone).tz}$`),
    );
    await shot(page, TAB, 'R01a-client', info);
    // Every entry of the unfiltered first page, too.
    await openLog(page);
    const times = entries(page).locator('time');
    await expect(times.first()).toBeVisible();
    const all = await times.evaluateAll((els) =>
      els.map((e) => [e.getAttribute('datetime') ?? '', e.textContent ?? '']),
    );
    expect(all.length).toBeGreaterThan(0);
    for (const [at, shown] of all) {
      expect(norm(shown!), `entry at ${at}`).toBe(norm(shownTime(at!, c.zone)));
    }
    await shot(page, TAB, 'R01a', info);
  });

  test("R01b the date filter's days are the firm's: today, a daylight-saving day, and yesterday excluding today's rows", async ({
    page,
  }, info) => {
    await openLog(page);
    const form = filterForm(page);
    await expect(form).toContainText(`time zone (${c.zone})`);
    const listAsked = () =>
      page.waitForRequest(
        (r) =>
          /\/api\/v1\/business\/audit-log\?/.test(r.url()) &&
          new URL(r.url()).searchParams.has('from'),
      );
    const apply = async (from: string, to: string) => {
      await form.getByLabel('From', { exact: true }).fill(from);
      await form.getByLabel('To', { exact: true }).fill(to);
      const asked = listAsked();
      await form.getByRole('button', { name: 'Apply filters' }).click();
      const url = new URL((await asked).url());
      await settled(page);
      return { from: url.searchParams.get('from'), to: url.searchParams.get('to') };
    };
    await form.getByLabel('Record id').fill(c.clientId);
    const today = firmDay(0, c.zone);
    expect(await apply(today, today), `today (${today}) in ${c.zone}`).toEqual(
      dayBounds(today, c.zone),
    );
    await expect(entries(page).filter({ hasText: 'client.created' })).toHaveCount(1);
    await shot(page, TAB, 'R01b-today', info);
    // Nov 1, 2026: US daylight saving ends (a 25-hour day in a US zone).
    const dst = '2026-11-01';
    const asked = await apply(dst, dst);
    expect(asked, `${dst} in ${c.zone}`).toEqual(dayBounds(dst, c.zone));
    // Yesterday ends before any of today's rows: the client's row is not listed.
    const yesterday = firmDay(-1, c.zone);
    expect(await apply(yesterday, yesterday)).toEqual(dayBounds(yesterday, c.zone));
    await expect(page.getByText('No entries')).toBeVisible();
    await shot(page, TAB, 'R01b-yesterday', info);
  });

  test("R01c the export's times are in the firm's zone, named, beside UTC; filters carried", async ({
    page,
  }, info) => {
    await openLog(page, { entityType: 'client', entityId: c.clientId });
    const created = await oneEntry(page, 'client.created');
    const shown = norm(await created.locator('time').first().innerText());
    const csv = await exportCsv(page, 'R01c');
    expect(csv.url.searchParams.get('entityId'), 'the filter is sent').toBe(c.clientId);
    expect(csv.url.searchParams.get('entityType')).toBe('client');
    expect(csv.header.slice(0, 2)).toEqual(['Time (UTC)', `Time (${c.zone})`]);
    expect(csv.rows.length).toBeGreaterThan(0);
    for (const r of csv.rows) {
      expect(r['Record id'], 'only the filtered record').toBe(c.clientId);
      expect(r['Record type']).toBe('client');
      expect(r['Time (UTC)']).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(r[`Time (${c.zone})`], `row at ${r['Time (UTC)']}`).toBe(
        csvTime(r['Time (UTC)']!, c.zone),
      );
    }
    const row = csv.rows.filter((r) => r['Action'] === 'client.created');
    expect(row).toHaveLength(1);
    expect(shown, 'the screen and the file give the same time').toBe(
      norm(shownTime(row[0]!['Time (UTC)']!, c.zone)),
    );
    await shot(page, TAB, 'R01c', info);
  });

  test('R02a the export downloads after the access cookie has expired; a failure says why and is never a success', async ({
    page,
  }, info) => {
    await openLog(page, { entityType: 'client', entityId: c.clientId });
    await expect(entries(page).first()).toBeVisible();
    // The access cookie lives only as long as its token (15 minutes): as when it has run out.
    await page.context().clearCookies({ name: 'fv_access' });
    await page.context().clearCookies({ name: 'fv_id' });
    const csv = await exportCsv(page, 'R02a');
    expect(csv.text.replace(/^\uFEFF/, '').startsWith('Time (UTC),'), 'a CSV, not an error').toBe(
      true,
    );
    const n = csv.rows.length;
    expect(n).toBeGreaterThan(0);
    const result = page.getByTestId('audit-export-result');
    await expect(result).toHaveAttribute('role', 'status');
    await expect(result).toHaveText(`Downloaded ${n} ${n === 1 ? 'entry' : 'entries'}.`);
    // The refreshed session, for the next contexts.
    await page.context().storageState({ path: statePath('owner') });
    await shot(page, TAB, 'R02a-downloaded', info);
    // The export's request never reaches Firmivra (the connection drops on the way; the browser
    // stays "online", so the page does send it): it says it did not download, and why.
    let downloaded = false;
    page.on('download', () => {
      downloaded = true;
    });
    const exportUrl = '**/api/v1/business/audit-log/export**';
    await page.route(exportUrl, (route) => route.abort('internetdisconnected'));
    try {
      await page.getByTestId('audit-export').click();
      await expect(result).toHaveAttribute('role', 'alert');
      await expect(result).toContainText('The export did not download.');
      await expect(result).toContainText("We can't reach Firmivra");
      await expect(page.getByText(/Downloaded \d+ entr/)).toHaveCount(0);
      await expect(page.getByTestId('audit-export')).toHaveText('Export');
      await shot(page, TAB, 'R02a-failed', info);
    } finally {
      await page.unroute(exportUrl);
    }
    expect(downloaded, 'no file on a failure').toBe(false);
    // With the connection back, Export works again and the message is the new result.
    const again = await exportCsv(page, 'R02a-again');
    await expect(result).toHaveAttribute('role', 'status');
    await expect(result).toHaveText(
      `Downloaded ${again.rows.length} ${again.rows.length === 1 ? 'entry' : 'entries'}.`,
    );
  });

  test('R03a a recurrence update lists each changed field old → new; unchanged fields the form sent are not listed', async ({
    page,
  }, info) => {
    await openLog(page, {
      entityType: 'compliance_recurrence',
      entityId: c.recurrenceId,
      action: 'compliance.recurrence.updated',
    });
    const entry = await oneEntry(page, 'compliance.recurrence.updated');
    await expect(entry.getByTestId('audit-record-name')).toHaveText(RECURRENCE);
    const d = await detailsOf(entry);
    await shot(page, TAB, 'R03a', info);
    expect([...d.keys()].sort()).toEqual(
      ['Request', 'addToTaxCalendar', 'agency', 'description', 'fields', 'holidayRule'].sort(),
    );
    expect(d.get('fields')).toBe(
      JSON.stringify(['addToTaxCalendar', 'agency', 'description', 'holidayRule']),
    );
    expect(d.get('agency')).toBe(`${AGENCY} → ${AGENCY} 2`);
    expect(d.get('holidayRule')).toBe('NEXT_BUSINESS_DAY → NONE');
    expect(d.get('addToTaxCalendar')).toBe('false → true');
    // Free text is "changed", never its words.
    expect(d.get('description')).toBe('changed');
    expect(await entry.textContent(), 'never the old text').not.toContain(SECRET_TEXT);
    expect(await entry.textContent(), 'never the new text').not.toContain(
      `second description ${STAMP}`,
    );
  });

  test('R03b an applicability rule update shows active from and to, with the version', async ({
    page,
  }, info) => {
    await openLog(page, {
      entityType: 'compliance_rule',
      entityId: c.ruleId,
      action: 'compliance.rule.updated',
    });
    const entry = await oneEntry(page, 'compliance.rule.updated');
    await expect(entry.getByTestId('audit-record-name')).toHaveText(RULE);
    const d = await detailsOf(entry);
    await shot(page, TAB, 'R03b', info);
    expect(d.get('active')).toBe('true → false');
    expect(d.get('version'), 'the rule version').toMatch(/^\d+$/);
    expect(JSON.parse(d.get('fields') ?? '[]')).toContain('active');
  });

  test('R03c before/after values are readable; none, 0 and false stay distinct, after a reload and in the export', async ({
    page,
  }, info) => {
    const filters = {
      entityType: 'compliance_rule',
      entityId: c.ruleId,
      action: 'compliance.rule.updated',
    };
    await openLog(page, filters);
    for (const pass of ['first', 'after a reload']) {
      const d = await detailsOf(await oneEntry(page, 'compliance.rule.updated'));
      expect(d.get('priorYearLiabilityOverCents'), pass).toBe('(none) → 0');
      expect(d.get('active'), pass).toBe('true → false');
      if (pass === 'first') {
        await shot(page, TAB, 'R03c', info);
        await page.reload();
        await expect(page.getByTestId('page-title')).toHaveText('Audit log', { timeout: 60_000 });
        await settled(page);
      }
    }
    const csv = await exportCsv(page, 'R03c');
    const rows = csv.rows.filter((r) => r['Action'] === 'compliance.rule.updated');
    expect(rows).toHaveLength(1);
    const meta = JSON.parse(rows[0]!['Details']!) as {
      changes: Record<string, { from: unknown; to: unknown }>;
    };
    expect(meta.changes['priorYearLiabilityOverCents']).toEqual({ from: null, to: 0 });
    expect(meta.changes['active']).toEqual({ from: true, to: false });
    // A cleared value reads "(none)" too: the reopened deadline's completion time.
    await openLog(page, {
      entityType: 'compliance_deadline',
      entityId: c.deadlineId,
      action: 'compliance.deadline.reopened',
    });
    const reopened = await detailsOf(await oneEntry(page, 'compliance.deadline.reopened'));
    expect(reopened.get('completedAt')).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z → \(none\)$/);
    test.info().annotations.push({
      type: 'note',
      description:
        'empty text ("(empty)") not checked live: no firm form keeps an empty string (text fields store "" as none)',
    });
  });

  test('R04a complete and reopen: status before and after, filed-on from and to, the confirmation number as set (never its value), reopen keeps both', async ({
    page,
  }, info) => {
    await openLog(page, { entityType: 'compliance_deadline', entityId: c.deadlineId });
    const done = await oneEntry(page, 'compliance.deadline.completed');
    await expect(done.getByTestId('audit-record-name')).toContainText(DEADLINE);
    const dc = await detailsOf(done);
    expect(dc.get('from')).toBe('UPCOMING');
    expect(dc.get('to')).toBe('COMPLETED');
    expect(dc.get('filedOn')).toMatch(new RegExp(`^\\(none\\) → ${c.filedOn}T00:00:00\\.000Z$`));
    expect(dc.get('confirmationNumber')).toBe('set');
    expect(dc.get('completedAt')).toMatch(/^\(none\) → \d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    expect(dc.get('completedByUserId')).toBe(`(none) → ${c.ownerUserId}`);
    expect(await done.textContent(), 'never the confirmation number').not.toContain(CONFIRMATION);
    const back = await oneEntry(page, 'compliance.deadline.reopened');
    const dr = await detailsOf(back);
    await shot(page, TAB, 'R04a', info);
    expect(dr.get('from')).toBe('COMPLETED');
    expect(dr.get('to')).toBe('UPCOMING');
    expect(dr.get('completedByUserId')).toBe(`${c.ownerUserId} → (none)`);
    expect(dr.get('completedAt')).toMatch(/ → \(none\)$/);
    expect(JSON.parse(dr.get('kept') ?? '[]'), 'reopen keeps the filed-on day and number').toEqual([
      'filedOn',
      'confirmationNumber',
    ]);
    expect(await back.textContent()).not.toContain(CONFIRMATION);
  });

  test('M01a records show their current name; a deleted record shows as "Deleted <type>"', async ({
    page,
  }, info) => {
    await openLog(page, { entityType: 'client', entityId: c.clientId, action: 'client.created' });
    const created = await oneEntry(page, 'client.created');
    const name = created.getByTestId('audit-record-name');
    await expect(name, 'the name as it is now (renamed after the row)').toHaveText(CLIENT_RENAMED);
    await expect(name).not.toHaveClass(/italic/);
    await shot(page, TAB, 'M01a-renamed', info);
    await openLog(page, { entityType: 'task', entityId: c.draftId });
    const rows = entries(page);
    await expect(rows.filter({ hasText: 'task.draft_discarded' })).toHaveCount(1);
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < count; i++) {
      const label = rows.nth(i).getByTestId('audit-record-name');
      await expect(label).toHaveText('Deleted task');
      await expect(label).toHaveClass(/italic/);
      await expect(rows.nth(i).getByTestId('audit-record-link')).toHaveCount(0);
    }
    await expect(page.getByText(DRAFT)).toHaveCount(0);
    await shot(page, TAB, 'M01a-deleted', info);
  });

  test("M01b a record's link opens it for the Owner; Staff without access get no record (and no log)", async ({
    page,
    browser,
  }, info) => {
    await openLog(page, { entityType: 'client', entityId: c.clientId, action: 'client.created' });
    const link = (await oneEntry(page, 'client.created')).getByTestId('audit-record-link');
    await expect(link).toHaveText('Open client');
    await expect(link).toHaveAttribute('href', `/clients/${c.clientId}`);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/clients/${c.clientId}`));
    await expect(page.getByText(CLIENT_RENAMED).first()).toBeVisible({ timeout: 60_000 });
    await shot(page, TAB, 'M01b-owner', info);
    // A compliance deadline's row opens the deadline.
    await openLog(page, {
      entityType: 'compliance_deadline',
      entityId: c.deadlineId,
      action: 'compliance.deadline.completed',
    });
    const toDeadline = (await oneEntry(page, 'compliance.deadline.completed')).getByTestId(
      'audit-record-link',
    );
    await expect(toDeadline).toHaveText('Open compliance deadline');
    await expect(toDeadline).toHaveAttribute('href', `/compliance/${c.deadlineId}`);
    await toDeadline.click();
    await expect(page).toHaveURL(new RegExp(`/compliance/${c.deadlineId}`));
    await expect(page.getByText(DEADLINE).first()).toBeVisible({ timeout: 60_000 });
    await shot(page, TAB, 'M01b-owner-deadline', info);
    test.skip(!hasLogin('staff'), 'no staff login in this run (the Staff half)');
    const staff = await roleContext(browser, 'staff');
    try {
      // The run's client is assigned to no one: Staff do not reach it, by the same address.
      await staff.page.goto(app(`/clients/${c.clientId}`));
      await expect(
        staff.page.getByTestId('page-not-found').or(staff.page.getByTestId('page-forbidden')),
      ).toBeVisible({ timeout: 60_000 });
      await expect(staff.page.getByText(CLIENT_RENAMED)).toHaveCount(0);
      await shot(staff.page, TAB, 'M01b-staff-record', info);
      await staff.page.goto(app(`/compliance/${c.deadlineId}`));
      // The deadline screen's own words for a deadline the reader does not reach.
      await expect(
        staff.page.getByText('This deadline is not available right now.').first(),
      ).toBeVisible({ timeout: 60_000 });
      await expect(staff.page.getByText(DEADLINE)).toHaveCount(0);
      await shot(staff.page, TAB, 'M01b-staff-deadline', info);
      await staff.page.goto(app('/audit-log'));
      await expect(staff.page.getByTestId('page-forbidden')).toBeVisible({ timeout: 60_000 });
      await expect(staff.page.getByTestId('audit-record-link')).toHaveCount(0);
    } finally {
      await staff.context.close();
    }
  });

  test("M02b a Staff member's refused export is in the Owner's log as Denied, with the route and code (never the query)", async ({
    page,
    browser,
  }, info) => {
    test.skip(!hasLogin('staff'), 'no staff login in this run');
    const staff = await roleContext(browser, 'staff');
    const tried = await (async () => {
      try {
        await staff.page.goto(app('/audit-log'));
        await expect(staff.page.getByTestId('page-forbidden')).toBeVisible({ timeout: 60_000 });
        await expect(staff.page.getByTestId('audit-export'), 'no Export for Staff').toHaveCount(0);
        await shot(staff.page, TAB, 'M02b-staff', info);
        // The export's own address, as a Staff member could type it.
        const at = Date.now();
        const answer = await staff.page.evaluate(async () => {
          const r = await fetch('/api/v1/business/audit-log/export?action=client.', {
            credentials: 'include',
          });
          const body = (await r.json().catch(() => ({}))) as { error?: { code?: string } };
          return { status: r.status, code: body.error?.code ?? null };
        });
        expect(answer).toEqual({ status: 403, code: 'FORBIDDEN' });
        return at;
      } finally {
        await staff.context.close();
      }
    })();
    // The Owner: the Staff member's entries, then the Denied access view.
    await openLog(page);
    const form = filterForm(page);
    await form.getByLabel('Person').selectOption({ label: staff.me.user.name });
    await form.getByRole('button', { name: 'Apply filters' }).click();
    await settled(page);
    const area = page
      .getByRole('navigation', { name: 'Audit log areas' })
      .getByRole('button', { name: 'Denied access' });
    await area.click();
    await expect(area).toHaveAttribute('aria-pressed', 'true');
    await settled(page);
    const denied = entries(page).filter({ hasText: 'access.denied' });
    await expect(denied.first()).toBeVisible({ timeout: 30_000 });
    // One row per person and route every 10 minutes: this attempt's, or one within its window.
    let found: Locator | undefined;
    for (let i = 0; i < (await denied.count()); i++) {
      const row = denied.nth(i);
      const at = Date.parse((await row.locator('time').first().getAttribute('datetime')) ?? '');
      const d = await detailsOf(row);
      if (d.get('route') === '/business/audit-log/export' && at >= tried - 10.5 * 60_000) {
        found = row;
        break;
      }
    }
    expect(
      found,
      'an access.denied row for the export, from this attempt or its window',
    ).toBeTruthy();
    const row = found!;
    await expect(row).toContainText(staff.me.user.name);
    await expect(row.getByText('Denied', { exact: true })).toBeVisible();
    const d = await detailsOf(row);
    expect(d.get('code')).toBe('FORBIDDEN');
    expect(d.get('category')).toBe('export');
    expect(d.get('method')).toBe('GET');
    expect(d.get('role')).toBe('STAFF');
    expect([...d.keys()].sort(), 'who, the route and the code only').toEqual(
      ['Request', 'category', 'code', 'method', 'role', 'route'].sort(),
    );
    expect(await row.textContent(), 'never the query').not.toContain('client.');
    await shot(page, TAB, 'M02b', info);
  });

  test('M03 secrets and tax ids are redacted the same way in every row since #1644; the typed SSN shows nowhere', async ({
    page,
  }, info) => {
    await openLog(page, {
      entityType: 'client',
      entityId: c.clientId,
      action: 'client.profile_updated',
    });
    const entry = await oneEntry(page, 'client.profile_updated');
    const d = await detailsOf(entry);
    expect(JSON.parse(d.get('fields') ?? '[]')).toContain('ssn');
    const text = (await entry.textContent()) ?? '';
    for (const form of [SSN, `${SSN.slice(0, 3)}-${SSN.slice(3, 5)}-${SSN.slice(5)}`]) {
      expect(text, 'never the SSN').not.toContain(form);
    }
    await shot(page, TAB, 'M03-row', info);
    // Every row the firm's log holds since #1644 went live, as the Owner exports it.
    await openLog(page);
    const form = filterForm(page);
    const since = new Intl.DateTimeFormat('en-CA', { timeZone: c.zone }).format(PART2_LIVE);
    await form.getByLabel('From', { exact: true }).fill(since);
    await form.getByLabel('To', { exact: true }).fill(firmDay(0, c.zone));
    await form.getByRole('button', { name: 'Apply filters' }).click();
    await settled(page);
    const csv = await exportCsv(page, 'M03');
    expect(csv.text, 'the SSN is in no row').not.toContain(SSN);
    const rows = csv.rows.filter((r) => Date.parse(r['Time (UTC)'] ?? '') >= PART2_LIVE);
    expect(rows.length).toBeGreaterThan(0);
    const bad: string[] = [];
    for (const r of rows) {
      if (!r['Details']) continue;
      const meta = JSON.parse(r['Details']) as unknown;
      for (const where of unredacted(meta, 'metadata', null)) {
        bad.push(`${r['Action']} ${r['Time (UTC)']} ${where}`);
      }
    }
    test.info().annotations.push({
      type: 'note',
      description: `M03 swept ${rows.length} rows since ${new Date(PART2_LIVE).toISOString()}`,
    });
    expect(bad, 'secret or tax-id values written in full').toEqual([]);
  });

  test('M04 a failed audit write is detected and alerts an admin', async () => {
    test.skip(
      true,
      'NOT LIVE: needs a forced audit insert failure on the server (and the alarm is infra); covered by unit/audit-service',
    );
  });

  test('T10a reversed dates say "The To date is before the From date" and ask for nothing', async ({
    page,
  }, info) => {
    await openLog(page);
    const form = filterForm(page);
    let asked = 0;
    page.on('request', (r) => {
      if (/\/api\/v1\/business\/audit-log\?/.test(r.url()) && r.url().includes('from=')) asked++;
    });
    await form.getByLabel('From', { exact: true }).fill(firmDay(0, c.zone));
    await form.getByLabel('To', { exact: true }).fill(firmDay(-1, c.zone));
    await form.getByRole('button', { name: 'Apply filters' }).click();
    await expect(form).toContainText('The To date is before the From date');
    await expect(form).not.toContainText('Use a range of at most 366 days');
    await shot(page, TAB, 'T10a', info);
    // A range that is too long still has its own words.
    await form.getByLabel('From', { exact: true }).fill('2025-01-01');
    await form.getByLabel('To', { exact: true }).fill(firmDay(0, c.zone));
    await form.getByRole('button', { name: 'Apply filters' }).click();
    await expect(form).toContainText('Use a range of at most 366 days');
    await expect(form).not.toContainText('The To date is before the From date');
    expect(asked, 'nothing is asked of the API').toBe(0);
  });
});

// ================================================================ cleanup

/** Removes what one run made (and only that); returns what is left. */
async function cleanRun(api: APIRequestContext, run: Ctx, done: string[], left: string[]) {
  const status = async (res: APIResponse, what: string, fine: number[] = []) => {
    if (res.ok() || fine.includes(res.status())) done.push(what);
    else left.push(`${what}: ${res.status()} ${(await res.text()).slice(0, 200)}`);
  };
  if (run.draftId && !run.draftDiscarded) {
    await status(
      await api.delete(`business/tasks/drafts/${run.draftId}`),
      'draft discarded',
      [404],
    );
  }
  if (run.deadlineId) {
    await status(
      await api.post(`business/compliance/deadlines/${run.deadlineId}/archive`, { data: {} }),
      'deadline archived',
      [409],
    );
  }
  if (run.ruleId) {
    const rule = await api.get(`business/compliance/applicability-rules/${run.ruleId}`);
    if (rule.ok() && ((await rule.json()) as { active: boolean }).active) {
      await status(
        await api.patch(`business/compliance/applicability-rules/${run.ruleId}`, {
          data: { active: false },
        }),
        'rule made inactive',
      );
    } else if (rule.ok()) done.push('rule inactive (kept: rules have no delete)');
    else left.push(`rule: ${rule.status()}`);
  }
  if (run.recurrenceId) {
    await status(
      await api.post(`business/compliance/recurrences/${run.recurrenceId}/archive`, { data: {} }),
      'recurrence archived',
      [409],
    );
  }
  if (run.clientId) {
    const rec = await api.get(`business/clients/${run.clientId}`);
    if (!rec.ok()) {
      left.push(`client: ${rec.status()}`);
      return;
    }
    const client = (await rec.json()) as { archivedAt?: string | null; displayName: string };
    if (!client.displayName.startsWith(run.tag)) {
      left.push('client: not this run (name), left alone');
      return;
    }
    if (!client.archivedAt) {
      if (run.ssnSet) {
        await status(
          await api.put(`business/clients/${run.clientId}/profile`, { data: { ssn: null } }),
          'client SSN cleared',
        );
      }
      await status(
        await api.post(`business/clients/${run.clientId}/archive`, { data: {} }),
        'client archived',
      );
    } else done.push('client already archived');
  }
}

test.describe('Audit Log cleanup', () => {
  test('zz cleanup: discard the draft, archive the deadline, recurrence and client, leave the rule inactive', async () => {
    const info = test.info();
    test.skip(!hasLogin('owner'), 'no owner login');
    if (existsSync(ctxFile())) {
      const c = readCtx();
      if (c.tag === runTag && (c.clientId || c.recurrenceId)) register(c);
    }
    const runs = readRegistry().filter((r) => r.tag === runTag || !r.cleaned);
    if (!runs.length) return;
    const api = await apiAs('owner');
    const done: string[] = [];
    const left: string[] = [];
    try {
      for (const run of runs) {
        const d: string[] = [];
        const l: string[] = [];
        await cleanRun(api, run, d, l);
        done.push(...d.map((x) => `[${run.tag}] ${x}`));
        left.push(...l.map((x) => `[${run.tag}] ${x}`));
        if (!l.length) register({ ...run, cleaned: true });
      }
    } finally {
      await api.dispose();
    }
    info.annotations.push({ type: 'cleaned', description: done.join('; ') || 'nothing' });
    info.annotations.push({ type: 'left-behind', description: left.join('; ') || 'none' });
    expect(left, 'everything the run made is archived or removed').toEqual([]);
  });
});
