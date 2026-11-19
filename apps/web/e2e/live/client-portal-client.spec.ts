import { randomUUID } from 'node:crypto';
import {
  expect,
  request,
  test,
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { firmSlug, portalUrl } from './env';
import {
  apiAs,
  app,
  as,
  expectNoSideScroll,
  portal,
  portalApi,
  portalClient,
  runTag,
  settled,
  shot,
} from './helpers';

/**
 * The client portal as the client sees it, live on dev (Test Firm B), signed in as the harness's
 * own portal client (portalClient(): an Individual client on the SES simulator, lead Nov 19). One
 * test per row of the Client Portal Review One check, which is kept outside the repo: rows by ID.
 *
 * Writes (lead, Nov 19): only on the harness portal client, set up by the Owner, named with the
 * run's tag (LIVE-CHECK yyyymmddhhmm) and removed, archived or reset in the same test. A setting
 * that changes what other clients see (the firm's announcement switches, the tab names and order,
 * the landing page's button text) is changed only with the exact old value put back in a finally
 * block, within seconds. Nothing here pays, signs, uploads a file or emails anyone but the SES
 * simulator (the harness client's address).
 *
 * - A row not built on origin/main fails with "NOT BUILT" (the lead wants the gaps visible).
 * - A built row whose check needs a write this harness should not make is skipped: "NOT LIVE" and
 *   the reason in its title (records without a delete that would stay on the harness client).
 * - A firm-side row with nothing a client can see is skipped: "firm side" in its title.
 * - A row whose data this client lacks is skipped at run time: "NO DATA" and why.
 * - client-portal.spec.ts already covers the firm's module and CP-PT-01 to 03, including the
 *   @narrow layout of twelve portal pages; the @narrow tests here cover the other pages.
 */
const TAB = 'client-portal-client';
/** The origin/main commit the rows were read from (Review One batches #1619 to #1645). */
const MAIN = 'e8610db8b';

type Json = Record<string, unknown>;
interface Answer<T> {
  status: number;
  code: string | undefined;
  body: T;
}
interface LayoutItem {
  tab: string;
  label: string;
  renamed: boolean;
}
interface Tabs {
  tabs: Record<string, boolean>;
  /** CP-5b, CP-5c (#1628): the six tabs in the firm's order, under the firm's names. */
  layout: LayoutItem[];
  /** CP-5d, CP-5e (#1634): the custom tabs this client sees. */
  custom?: { id: string; label: string; module: string }[];
  more?: Record<string, boolean>;
  businessPortal?: boolean;
}
interface AnnouncementSettings {
  enabled: boolean;
  onDashboard: boolean;
  emailPolicy: 'CLIENT_CHOICE' | 'REQUIRED' | 'OFF';
  smsPolicy: 'CLIENT_CHOICE' | 'OFF';
}
interface Office {
  id: string | null;
  name: string;
  addressLines: string[];
  phone?: string | null;
  email?: string | null;
}
interface Contact {
  corporate: Office | null;
  local: Office | null;
  methods: {
    phone: boolean;
    sms: boolean;
    email: boolean;
    secureMessage: boolean;
    appointment: boolean;
  };
}
interface Pref {
  category: string;
  email: boolean;
  sms: boolean;
  locked: boolean;
  emailLocked: boolean;
  smsLocked?: boolean;
}
interface Prefs {
  channels: string[];
  smsStopped: boolean;
  items: Pref[];
}
interface Announcement {
  id: string;
  title: string | null;
  body: string;
  html: string;
  where: string;
  publishedAt: string;
  endsAt: string | null;
}
interface Info {
  business: { slug: string; name: string };
  branding: { primaryColor: string; signInLabel?: string | null; signUpLabel?: string | null };
  signUpOpen: boolean;
  timezone: string;
}
interface Notice {
  id: string;
  category: string;
  title: string;
  body: string;
  createdAt: string;
  target?: { kind?: string; id?: string } | null;
}
interface Invoice {
  id: string;
  number: string;
  canPay: boolean;
}

/** The six built-in tabs: the page each opens, and its default name (PORTAL_TAB_LABELS). */
const FOLDERS: [tab: string, path: string, label: string][] = [
  ['INTAKE_FORMS', 'intake', 'Intake Form'],
  ['BUSINESS_RESOURCES', 'business', 'Business Documents & Resources'], // business portals only
  ['DOCUMENTS', 'documents', 'My Uploaded Documents'],
  ['TAX_RETURNS', 'taxes', 'Tax Returns'],
  ['INVOICES_PAYMENTS', 'invoices', 'Receipts & Invoices'],
  ['MESSAGES', 'messages', 'Messages and Notes'],
];
/** Side-menu lines that follow an area's switch. */
const MENU: [label: RegExp, area: string][] = [
  [/^\s*My Documents/, 'DOCUMENTS'],
  [/^\s*Intake Forms/, 'INTAKE_FORMS'],
  [/^\s*Messages/, 'MESSAGES'],
  [/^\s*Appointments/, 'APPOINTMENTS'],
  [/^\s*Invoices & Payments/, 'INVOICES_PAYMENTS'],
];
/** A read route of each area the API guards (403 MODULE_OFF while the area is off). */
const GUARDED: [area: string, path: string][] = [
  ['INTAKE_FORMS', 'me/intakes'],
  ['TAX_RETURNS', 'me/tax-returns'],
  ['INVOICES_PAYMENTS', 'me/invoices'],
  ['MESSAGES', 'me/messages'],
  ['APPOINTMENTS', 'me/appointments'],
  ['TASKS_REQUESTS', 'me/request-packets'],
];
/** Each notification category's row name on My Profile (NOTIFICATION_CATEGORY_LABELS). */
const CATEGORY_LABELS: Record<string, string> = {
  ACCOUNT: 'Account and security',
  DOCUMENTS: 'Documents',
  INTAKE: 'Intake forms',
  SERVICES: 'Services',
  MESSAGES: 'Messages and notes',
  APPOINTMENTS: 'Appointments',
  BILLING: 'Invoices and payments',
  ANNOUNCEMENTS: 'Announcements', // CP-3d (#1637)
};
/** What Settings' Live Preview says of each channel policy (CP-3h, #1631). */
const POLICY_SHOWS: Record<string, string> = {
  CLIENT_CHOICE: 'Client can turn on or off',
  REQUIRED: 'Always on (required)',
  OFF: 'Off',
};
/** Portal pages that client-portal.spec.ts (CP-PT-02) does not open at 390 px. */
const NARROW_PAGES = [
  'home',
  'calculator',
  'calculator/quarterly-estimate',
  'calculator/tax-bracket',
  'calculator/tax-return',
  'resources/startup-guide',
  'resources/tax-deductions',
  'resources/record-keeping',
  'resources/payroll',
  'resources/external-links',
  'tax-plans',
];
/** Detail pages, opened on the client's first item (read-only: none writes on open). */
const DETAIL_PAGES: [path: string, list: string][] = [
  ['invoices', 'me/invoices'],
  ['tax-plans', 'me/tax-plans'],
  ['requests', 'me/request-packets'],
];
const ANNOUNCEMENT_SETTINGS = 'business/settings/portal-announcements';
const PORTAL_TABS = 'business/settings/portal-tabs';
const COMMS = 'business/communications';

/** A row not built on origin/main: the test fails with the row and what is missing. */
function notBuilt(row: string, what: string): never {
  throw new Error(`${row} NOT BUILT (origin/main ${MAIN}): ${what}`);
}

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

/** Whether an area is on for this client (a tab, or one of the module's other areas). */
const isOn = (t: Tabs, area: string) => (t.tabs[area] ?? t.more?.[area]) !== false;
/** A tab's name as the client sees it (CP-5b): the firm's, else its default. */
const labelOf = (t: Tabs, tab: string) =>
  t.layout.find((i) => i.tab === tab)?.label ?? FOLDERS.find(([x]) => x === tab)?.[2] ?? tab;
/**
 * The folder row the client should see (#1628, #1634): the firm's order and names, the tabs on for
 * this client (Business only in a business portal), then the client's custom tabs.
 */
const folderRow = (t: Tabs) => [
  ...t.layout
    .filter((i) => isOn(t, i.tab) && (i.tab !== 'BUSINESS_RESOURCES' || t.businessPortal === true))
    .map((i) => i.label),
  ...(t.custom ?? []).map((c) => c.label),
];
/** The layout as PUT takes it back: each tab once, its own name or null for the default. */
const asSent = (layout: LayoutItem[]) =>
  layout.map((i) => ({ tab: i.tab, label: i.renamed ? i.label : null }));
/** The answer a signed-in client gets from a staff-only route. */
const refused = (status: number) => status === 401 || status === 403;
const firstId = (body: unknown): string | undefined => {
  const list = Array.isArray(body) ? body : (body as { items?: unknown[] } | null)?.items;
  const first = list?.[0] as { id?: unknown } | undefined;
  return typeof first?.id === 'string' ? first.id : undefined;
};
/** Every key of a JSON value, at any depth. */
function keysOf(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) keysOf(v, out);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysOf(v, out);
    }
  }
  return out;
}
/** The Need Help card's column on a My Client Portal page. */
const needHelp = (page: Page): Locator =>
  page.locator('aside').filter({ hasText: 'Need Help?' }).first();
const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const exactly = (label: string) => new RegExp(`^\\s*${escaped(label)}\\s*$`);
const folderLinks = (page: Page) =>
  page.getByRole('navigation', { name: 'Portal folders' }).locator('a');
/** YYYY-MM-DD, `days` from today (UTC). */
const day = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

/** A 2xx JSON answer; a failure names the status and the error code only (never the body). */
async function okJson<T = Json>(res: APIResponse, what: string): Promise<T> {
  const body: unknown = await res.json().catch(() => null);
  const code = (body as { error?: { code?: string } } | null)?.error?.code;
  expect(res.ok(), `${what}: ${res.status()} ${code ?? ''}`).toBe(true);
  return body as T;
}
async function statusOf(res: APIResponse): Promise<[number, string | undefined]> {
  const body: unknown = await res.json().catch(() => null);
  return [res.status(), (body as { error?: { code?: string } } | null)?.error?.code];
}

/** The Owner's API (setup and same-test cleanup only). */
async function asOwner<T>(fn: (o: APIRequestContext) => Promise<T>): Promise<T> {
  const o = await apiAs('owner');
  try {
    return await fn(o);
  } finally {
    await o.dispose();
  }
}

/** A firm page as the Owner, in its own browser context (the describe's pages are the client's). */
async function asOwnerPage<T>(browser: Browser, fn: (page: Page) => Promise<T>): Promise<T> {
  await (await apiAs('owner')).dispose(); // refreshes the saved session first
  const ctx = await browser.newContext(as('owner'));
  try {
    return await fn(await ctx.newPage());
  } finally {
    await ctx.close();
  }
}

/** Polls until `fn` gives a value, every `every` ms, for at most `ms`. */
async function waitFor<T>(
  what: string,
  fn: () => Promise<T | undefined>,
  ms: number,
  every = 10_000,
) {
  const until = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error(`${what}: nothing within ${ms / 1000} s`);
    await new Promise((r) => setTimeout(r, every));
  }
}

/**
 * A LIVE-CHECK announcement (#1134, Communications) published to the harness portal client alone,
 * at `place`. The caller removes it (removeAnnouncement) in a finally block.
 */
async function publishAnnouncement(o: APIRequestContext, place: string, what: string) {
  const me = await portalClient();
  const title = `${runTag} ${what}`;
  const d = await okJson<{ id: string }>(
    await o.post(COMMS, { data: { channel: 'ANNOUNCEMENT', name: title } }),
    'new announcement',
  );
  const etag = async () =>
    (await okJson<{ etag: string }>(await o.get(`${COMMS}/${d.id}`), 'announcement')).etag;
  try {
    await okJson(
      await o.patch(`${COMMS}/${d.id}`, {
        data: {
          etag: await etag(),
          subject: title,
          body: `<p>${runTag}: a synthetic announcement for the live-check client only.</p>`,
          visibility: place,
        },
      }),
      'announcement text',
    );
    const audience = await okJson<{ finalCount: number }>(
      await o.put(`${COMMS}/${d.id}/audience`, {
        data: { etag: await etag(), clientIds: [me.id] },
      }),
      'announcement audience',
    );
    expect(audience.finalCount, 'the harness client alone').toBe(1);
    await okJson(
      await o.post(`${COMMS}/${d.id}/send`, {
        data: { idempotencyKey: randomUUID(), etag: await etag() },
      }),
      'publish the announcement',
    );
  } catch (error) {
    await removeAnnouncement(o, d.id);
    throw error;
  }
  return { id: d.id, title };
}

/** Ends and archives one of the run's announcements; returns what could not be done. */
async function removeAnnouncement(o: APIRequestContext, id: string): Promise<string> {
  const ended = await o.post(`${COMMS}/${id}/expire`);
  const archived = await o.post(`${COMMS}/${id}/archive`);
  return archived.ok()
    ? ''
    : `announcement ${id}: expire ${ended.status()}, archive ${archived.status()}`;
}

/** Books an appointment for the harness client with the Owner (outside hours: with a reason). */
async function schedule(
  o: APIRequestContext,
  x: { typeId: string; ownerId: string; start: Date; timezone: string; reminders?: Json[] },
): Promise<string> {
  const me = await portalClient();
  const body = {
    idempotencyKey: randomUUID(),
    contact: { kind: 'CLIENT', id: me.id },
    typeId: x.typeId,
    startsAt: x.start.toISOString(),
    endsAt: new Date(x.start.getTime() + 30 * 60_000).toISOString(),
    timezone: x.timezone,
    allDay: false,
    method: 'IN_PERSON',
    staffUserIds: [x.ownerId],
    status: 'CONFIRMED',
    sendConfirmation: false,
    reminders: x.reminders ?? [],
  };
  let res = await o.post('business/appointments/schedule', { data: body });
  if (res.status() === 409) {
    res = await o.post('business/appointments/schedule', {
      data: {
        ...body,
        idempotencyKey: randomUUID(),
        overrideConflicts: { reason: `${runTag} live check` },
      },
    });
  }
  const out = await okJson<{ id?: string; appointments?: { id: string }[] }>(res, 'schedule');
  const id = out.id ?? out.appointments?.[0]?.id ?? '';
  expect(id, 'the new appointment').not.toBe('');
  return id;
}

/** A LIVE-CHECK appointment type no client can book online. */
async function newType(o: APIRequestContext, what: string): Promise<string> {
  const t = await okJson<{ id: string }>(
    await o.post('business/appointment-types', {
      data: {
        name: `${runTag} ${what}`,
        durationMinutes: 30,
        methods: ['IN_PERSON'],
        clientBookable: false,
        sortOrder: 0,
      },
    }),
    'appointment type',
  );
  return t.id;
}

test.describe('the portal as the client: Review One rows', () => {
  test.use(as('client'));
  let api: APIRequestContext;
  test.beforeAll(async () => {
    api = await apiAs('client');
  });
  test.afterAll(async () => {
    await api?.dispose();
  });

  /** GET as the client: a portal path ("me/tabs"), or a staff path ("business/..."). */
  async function get<T = Json>(path: string): Promise<Answer<T>> {
    const url = path.startsWith('business/') ? path : portalApi(path);
    let res = await api.get(url);
    if (res.status() === 401 && !path.startsWith('business/')) {
      // The access token ran out during a long run: a fresh, refreshed context.
      await api.dispose();
      api = await apiAs('client');
      res = await api.get(url);
    }
    const body: unknown = await res.json().catch(() => null);
    const code = (body as { error?: { code?: string } } | null)?.error?.code;
    return { status: res.status(), code, body: body as T };
  }
  async function ok<T = Json>(path: string): Promise<T> {
    const answer = await get<T>(path);
    expect(answer.status, `GET ${path}`).toBe(200);
    return answer.body;
  }
  /** A write as the client (the harness login's own choices only). */
  async function clientSend(method: 'patch' | 'post', path: string, data: unknown) {
    return api[method](portalApi(path), { data });
  }
  const notLive = (title: string, reason: string) =>
    test(`${title}: NOT LIVE (${reason})`, () => test.skip(true, `NOT LIVE: ${reason}`));
  const firmSide = (title: string, reason: string) =>
    test(`${title}: firm side (${reason})`, () => test.skip(true, `firm side only: ${reason}`));

  // ---------- Settings > Client Portal, as far as the client can tell ----------

  test('CP-1 the staff preview of this client is refused to the client (Settings is firm side)', async () => {
    const { id } = await portalClient();
    const res = await get(`business/client-portal/clients/${id}/preview`);
    expect(refused(res.status), `the staff preview answered ${res.status}`).toBe(true);
  });

  test("CP-1s the firm's portal settings refuse the client's session", async () => {
    for (const path of [PORTAL_TABS, 'business/settings/portal-contact', ANNOUNCEMENT_SETTINGS]) {
      const res = await get(path);
      expect(refused(res.status), `${path} answered ${res.status}`).toBe(true);
    }
  });

  test("CP-1g the landing page's Sign In and Create an Account buttons carry the firm's words", async ({
    browser,
  }, info) => {
    /** The signed-out landing page (no form on it): the two buttons and where they go. */
    const landing = async (signIn: string, signUp: string | null, name: string) => {
      const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      try {
        const p = await ctx.newPage();
        await open(p, portal(''), info);
        // The button under "Sign In to Your Account" (a header link may say Sign In too).
        const button = (href: string, text: string) =>
          p.locator(`a[href="/${firmSlug}/${href}"]`).filter({ hasText: exactly(text) });
        await expect(button('sign-in', signIn).first()).toBeVisible();
        if (signUp) await expect(button('sign-up', signUp).first()).toBeVisible();
        await shot(p, TAB, name, info);
      } finally {
        await ctx.close();
      }
    };
    const firm = await ok<Info>('info');
    expect(Object.keys(firm.branding), 'portal info carries both labels').toEqual(
      expect.arrayContaining(['signInLabel', 'signUpLabel']),
    );
    await asOwner(async (o) => {
      type Labels = { portalSignInLabel: string | null; portalSignUpLabel: string | null };
      const saved = await okJson<Labels>(await o.get('business/settings'), 'settings');
      expect(
        [firm.branding.signInLabel, firm.branding.signUpLabel],
        'info follows Settings',
      ).toEqual([saved.portalSignInLabel, saved.portalSignUpLabel]);
      const signUp = firm.signUpOpen ? (saved.portalSignUpLabel ?? 'Create an Account') : null;
      await landing(saved.portalSignInLabel ?? 'Sign In', signUp, 'CP-1g-landing');
      // The firm's own words, on the public landing page: put back in the finally block.
      const words = runTag.slice(0, 30);
      try {
        await okJson(
          await o.patch('business/settings', { data: { portalSignInLabel: words } }),
          'set the Sign In text',
        );
        expect((await ok<Info>('info')).branding.signInLabel).toBe(words);
        await landing(words, signUp, 'CP-1g-firm-words');
      } finally {
        await okJson(
          await o.patch('business/settings', {
            data: { portalSignInLabel: saved.portalSignInLabel },
          }),
          'restore the Sign In text',
        );
        const back = await okJson<Labels>(await o.get('business/settings'), 'settings');
        expect(back.portalSignInLabel, 'the Sign In text is back').toBe(saved.portalSignInLabel);
      }
    });
  });

  // ---------- Registration and access ----------

  test('CP-2a the existing portal login still opens the portal', async ({ page }, info) => {
    expect((await get('me')).status, 'GET me').toBe(200);
    await open(page, portal('/home'), info);
    await expect(page).not.toHaveURL(/\/sign-in/);
    await expect(page.getByRole('navigation', { name: 'Portal folders' })).toBeVisible();
    await shot(page, TAB, 'CP-2a', info);
  });

  test("CP-2b the public sign-up page follows the firm's sign-up switch", async ({ browser }) => {
    const firm = await ok<Info>('info');
    expect(typeof firm.signUpOpen, 'info.signUpOpen').toBe('boolean');
    // Signed out, as a new client arrives. No screenshot: the form asks for a password.
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const p = await ctx.newPage();
      await p.goto(portal('/sign-up'));
      await settled(p);
      if (firm.signUpOpen) {
        await expect(p.getByText('Account Type *')).toBeVisible();
        await expect(p.getByTestId('sign-up-closed')).toHaveCount(0);
      } else {
        await expect(p.getByTestId('sign-up-closed')).toBeVisible();
      }
    } finally {
      await ctx.close();
    }
  });

  test('CP-2c sign-up offers the active offices, each with its name and address', async ({
    browser,
  }) => {
    const { offices } = await ok<{ offices: Office[] }>('offices');
    if (!offices.length) {
      test.skip(true, 'NO DATA: Test Firm B has no active office');
      return;
    }
    for (const o of offices) {
      expect(o.name.trim(), 'office name').not.toBe('');
      expect(o.addressLines.length, `${o.name}: address`).toBeGreaterThan(0);
    }
    const firm = await ok<Info>('info');
    if (!firm.signUpOpen) return; // CP-2b checks the closed page
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const p = await ctx.newPage();
      await p.goto(portal('/sign-up'));
      await settled(p);
      const box = p.getByTestId('sign-up-offices');
      for (const o of offices) {
        await expect(box).toContainText(o.name);
        await expect(box).toContainText(o.addressLines[0] ?? '');
      }
    } finally {
      await ctx.close();
    }
  });

  test("CP-2d the server checks the session: no login, another's document, staff routes", async () => {
    // Truly signed out: Playwright fills request.newContext() from the test's `use`, so without an
    // empty storageState this context would carry the client's cookies (test.use(as('client'))).
    const anon = await request.newContext({
      baseURL: `${portalUrl}/api/v1/`,
      storageState: { cookies: [], origins: [] },
    });
    try {
      const res = await anon.get(portalApi('me'));
      // On a failure, name the answer's keys only (never its values).
      const keys = await res
        .json()
        .then((b: object) => Object.keys(b).join(','))
        .catch(() => 'not JSON');
      expect(res.status(), `signed out (${res.url()} answered with keys ${keys})`).toBe(401);
    } finally {
      await anon.dispose();
    }
    for (const path of [`me/documents/${randomUUID()}`, `me/documents/${randomUUID()}/download`]) {
      expect((await get(path)).status, path).toBe(404);
    }
    const staff = await get('business/clients');
    expect(refused(staff.status), `business/clients answered ${staff.status}`).toBe(true);
  });

  // ---------- Announcements and notifications ----------

  firmSide('CP-3a no announcement editor in Settings', 'nothing for a client to see');
  firmSide('CP-3b Settings links to the Communications composer', 'nothing for a client to see');

  test("CP-3c the firm's Enable announcements switch: off, the client sees none and nothing is deleted", async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    const listed = async () =>
      (await ok<{ items: Announcement[] }>('me/announcements')).items.map((a) => a.id);
    const hasChoice = async () =>
      (await ok<Prefs>('me/notification-preferences')).items.some(
        (i) => i.category === 'ANNOUNCEMENTS',
      );
    await asOwner(async (o) => {
      const before = await okJson<AnnouncementSettings>(
        await o.get(ANNOUNCEMENT_SETTINGS),
        'announcement settings',
      );
      // A Documents one: the dashboard switch (CP-3i) does not touch it.
      const mine = await publishAnnouncement(o, 'documents', 'CP-3c announcement');
      try {
        /** What the client sees with announcements on or off. */
        const sees = async (on: boolean, name: string) => {
          const ids = await listed();
          if (on) expect(ids, 'listed while on').toContain(mine.id);
          else expect(ids, 'none at all while off').toEqual([]);
          expect(await hasChoice(), 'the Announcements notification choice').toBe(on);
          await open(page, portal('/documents'), info);
          const card = page.getByTestId('announcement-card');
          if (on) await expect(card).toContainText(mine.title);
          else await expect(card).toHaveCount(0);
          await shot(page, TAB, name, info);
        };
        await sees(before.enabled, `CP-3c-${before.enabled ? 'on' : 'off'}`);
        // Firm-wide (every client of Test Firm B): back to the old value within seconds.
        try {
          await okJson(
            await o.put(ANNOUNCEMENT_SETTINGS, { data: { enabled: !before.enabled } }),
            'switch announcements',
          );
          await sees(!before.enabled, `CP-3c-${before.enabled ? 'off' : 'on'}`);
        } finally {
          await okJson(
            await o.put(ANNOUNCEMENT_SETTINGS, { data: { enabled: before.enabled } }),
            'restore the switch',
          );
        }
        const after = await okJson<AnnouncementSettings>(
          await o.get(ANNOUNCEMENT_SETTINGS),
          'announcement settings',
        );
        expect(after.enabled, 'the switch is back').toBe(before.enabled);
        // Nothing was deleted: with the old value back, the announcement is listed as before.
        if (before.enabled) expect(await listed(), 'still there').toContain(mine.id);
      } finally {
        const left = await removeAnnouncement(o, mine.id);
        if (left) info.annotations.push({ type: 'left-behind', description: left });
      }
    });
  });

  test("CP-3d the Announcements notification choice follows the firm's policy, and the client chooses where it lets them", async ({
    page,
  }, info) => {
    const policy = await asOwner(async (o) =>
      okJson<AnnouncementSettings>(await o.get(ANNOUNCEMENT_SETTINGS), 'announcement settings'),
    );
    const prefs = await ok<Prefs>('me/notification-preferences');
    const row = prefs.items.find((i) => i.category === 'ANNOUNCEMENTS');
    if (!policy.enabled) {
      expect(row, 'no Announcements choice while the firm has them off').toBeUndefined();
      return;
    }
    expect(row, 'an Announcements row').toBeTruthy();
    const r = row!;
    expect(r.emailLocked, `email locked under ${policy.emailPolicy}`).toBe(
      policy.emailPolicy !== 'CLIENT_CHOICE',
    );
    if (policy.emailPolicy === 'REQUIRED') expect(r.email, 'always sent').toBe(true);
    if (policy.emailPolicy === 'OFF') expect(r.email, 'never sent').toBe(false);
    expect(r.smsLocked ?? false, `texts locked under ${policy.smsPolicy}`).toBe(
      policy.smsPolicy === 'OFF',
    );
    if (policy.smsPolicy === 'OFF') expect(r.sms, 'no texts').toBe(false);
    // Every other category's email stays on and locked (CP-3e): a change is refused.
    const [status, code] = await statusOf(
      await clientSend('patch', 'me/notification-preferences', {
        items: [{ category: 'DOCUMENTS', email: false }],
      }),
    );
    expect([status, code], 'Documents email off').toEqual([400, 'EMAIL_ALWAYS_ON']);
    await open(page, portal('/profile'), info);
    await page.locator('summary').filter({ hasText: 'Notification Preferences' }).click();
    const box = page.getByRole('checkbox', { name: 'Announcements by email' });
    if (r.email) await expect(box).toBeChecked();
    else await expect(box).not.toBeChecked();
    if (r.emailLocked) {
      await expect(box).toBeDisabled();
      await expect(
        page.getByText(/sets the (email|email and text) choice for announcements/),
      ).toBeVisible();
    } else await expect(box).toBeEnabled();
    await shot(page, TAB, 'CP-3d-preferences', info);
    if (r.emailLocked) {
      // The firm sets it: the client's change is refused, and nothing changes.
      const [s, c] = await statusOf(
        await clientSend('patch', 'me/notification-preferences', {
          items: [{ category: 'ANNOUNCEMENTS', email: !r.email }],
        }),
      );
      expect([s, c], 'a locked announcement email').toEqual([400, 'CHANNEL_LOCKED']);
      return;
    }
    // The client's own choice (the harness login): flipped on the page, then put back.
    try {
      await box.click();
      await expect(box).toBeChecked({ checked: !r.email });
      await settled(page);
      const now = (await ok<Prefs>('me/notification-preferences')).items.find(
        (i) => i.category === 'ANNOUNCEMENTS',
      );
      expect(now?.email, 'the choice is saved').toBe(!r.email);
    } finally {
      await okJson(
        await clientSend('patch', 'me/notification-preferences', {
          items: [{ category: 'ANNOUNCEMENTS', email: r.email }],
        }),
        'restore the announcement email choice',
      );
    }
    const back = (await ok<Prefs>('me/notification-preferences')).items.find(
      (i) => i.category === 'ANNOUNCEMENTS',
    );
    expect(back?.email, 'the choice is back').toBe(r.email);
  });

  test('CP-3d an announcement published to the client reaches them once as a notice: its title, never its text', async ({
    page,
  }, info) => {
    test.setTimeout(300_000);
    await asOwner(async (o) => {
      const policy = await okJson<AnnouncementSettings>(
        await o.get(ANNOUNCEMENT_SETTINGS),
        'announcement settings',
      );
      if (!policy.enabled) {
        test.skip(true, 'NO DATA: Test Firm B has announcements off (CP-3c checks the switch)');
        return;
      }
      const mine = await publishAnnouncement(o, 'documents', 'CP-3d notice');
      try {
        // The Communications tick (every minute) sends it.
        const notices = await waitFor(
          'the announcement notice',
          async () => {
            const { items } = await ok<{ items: Notice[] }>('me/notifications?limit=50');
            const found = items.filter((n) => n.target?.id === mine.id);
            return found.length ? found : undefined;
          },
          180_000,
        );
        expect(notices, 'one notice (CP-7.5)').toHaveLength(1);
        expect(notices[0]).toMatchObject({
          category: 'ANNOUNCEMENTS',
          title: 'New announcement',
          body: mine.title,
          target: { kind: 'announcement', id: mine.id },
        });
        expect(JSON.stringify(notices[0]), 'never the text').not.toContain(
          'synthetic announcement',
        );
        await open(page, portal('/notifications'), info);
        await expect(page.locator('main').first()).toContainText(mine.title);
        await shot(page, TAB, 'CP-3d-notice', info);
      } finally {
        const left = await removeAnnouncement(o, mine.id);
        if (left) info.annotations.push({ type: 'left-behind', description: left });
      }
    });
  });

  test('CP-3e email notices are always on, and the client cannot turn them off', async ({
    page,
  }, info) => {
    const prefs = await ok<Prefs>('me/notification-preferences');
    // ANNOUNCEMENTS is left out on purpose: #1637 (CP-3d, the lead's decision 3a) makes the email
    // copy of general announcements follow the firm's policy, by default the client's choice
    // (emailLocked false). Guide 9.2's "always on" is for notices about the client's own account
    // and services; CP-3d checks the announcement row against the firm's policy.
    const personal = prefs.items.filter((i) => i.category !== 'ANNOUNCEMENTS');
    for (const item of personal) {
      expect([item.email, item.emailLocked], item.category).toEqual([true, true]);
    }
    await open(page, portal('/profile'), info);
    await page.locator('summary').filter({ hasText: 'Notification Preferences' }).click();
    for (const item of personal) {
      const label = CATEGORY_LABELS[item.category];
      if (!label) continue;
      const box = page.getByRole('checkbox', { name: `${label} by email` });
      await expect(box).toBeChecked();
      await expect(box).toBeDisabled();
    }
    await shot(page, TAB, 'CP-3e', info);
  });

  test('CP-3f text is a choice per category, with consent wording, and a STOP holds', async ({
    page,
  }, info) => {
    const prefs = await ok<Prefs>('me/notification-preferences');
    const hasSms = prefs.channels.includes('SMS');
    if (!hasSms || prefs.smsStopped) {
      expect(
        prefs.items.filter((i) => i.sms).map((i) => i.category),
        'no text choice is on while texts are not offered or stopped',
      ).toEqual([]);
    }
    await open(page, portal('/profile'), info);
    await page.locator('summary').filter({ hasText: 'Notification Preferences' }).click();
    for (const item of prefs.items) {
      const label = CATEGORY_LABELS[item.category];
      if (!label) continue;
      const box = page.getByRole('checkbox', { name: `${label} by text` });
      if (!hasSms) {
        await expect(box).toHaveCount(0);
        continue;
      }
      if (item.sms) await expect(box).toBeChecked();
      else await expect(box).not.toBeChecked();
      // CP-3d: the firm's text policy can lock the Announcements box too (smsLocked).
      if (item.locked || item.smsLocked) await expect(box).toBeDisabled();
      else await expect(box).toBeEnabled();
    }
    await expect(page.getByTestId('sms-consent')).toHaveCount(hasSms ? 1 : 0);
    if (hasSms) await expect(page.getByTestId('sms-consent')).toContainText('STOP');
    await expect(page.getByTestId('sms-stopped')).toHaveCount(prefs.smsStopped ? 1 : 0);
    await shot(page, TAB, 'CP-3f', info);
  });

  test('CP-3g live announcements, newest first; the dashboard card shows the newest', async ({
    page,
  }, info) => {
    const { items } = await ok<{ items: Announcement[] }>('me/announcements');
    const times = items.map((a) => Date.parse(a.publishedAt));
    expect(times, 'newest first').toEqual([...times].sort((a, b) => b - a));
    const now = Date.now();
    for (const a of items) {
      expect(Date.parse(a.publishedAt), `${a.id} published`).toBeLessThanOrEqual(now + 60_000);
      if (a.endsAt) expect(Date.parse(a.endsAt), `${a.id} not ended`).toBeGreaterThan(now - 60_000);
    }
    await open(page, portal('/home'), info);
    const card = page.getByTestId('announcement-card');
    const first = items.find((a) => a.where === 'dashboard');
    if (!first) await expect(card).toHaveCount(0);
    else {
      await expect(card).toBeVisible();
      if (first.title) await expect(card).toContainText(first.title);
    }
    await shot(page, TAB, 'CP-3g', info);
  });

  test("CP-3h Settings' Live Preview shows the client's announcement choices and locks as saved", async ({
    browser,
  }, info) => {
    const policy = await asOwner(async (o) =>
      okJson<AnnouncementSettings>(await o.get(ANNOUNCEMENT_SETTINGS), 'announcement settings'),
    );
    // What the client really gets under this policy (CP-3d checks the row in detail).
    const row = (await ok<Prefs>('me/notification-preferences')).items.find(
      (i) => i.category === 'ANNOUNCEMENTS',
    );
    expect(Boolean(row), 'the client has the choice exactly while announcements are on').toBe(
      policy.enabled,
    );
    await asOwnerPage(browser, async (page) => {
      await open(page, app('/settings/portal?panel=announcements'), info);
      const preview = page.getByTestId('announcements-preview');
      await expect(preview).toBeVisible();
      /** The value the preview gives one line ("Announcement email": "Client can turn on or off"). */
      const option = (name: string) =>
        preview
          .getByTestId('announcements-preview-options')
          .locator('div')
          .filter({ has: page.locator('dt', { hasText: exactly(name) }) })
          .locator('dd');
      await expect(option('Account and service email')).toHaveText('Always on (required)');
      await expect(option('Announcement email')).toHaveText(
        policy.enabled ? POLICY_SHOWS[policy.emailPolicy]! : 'Off',
      );
      await expect(option('Announcement texts')).toHaveText(
        policy.enabled ? POLICY_SHOWS[policy.smsPolicy]! : 'Off',
      );
      if (policy.enabled) {
        await expect(preview).toContainText(
          policy.onDashboard ? 'Shown on the dashboard.' : 'Not shown on the dashboard.',
        );
      } else {
        await expect(preview).toContainText('Announcements are off');
      }
      await shot(page, TAB, 'CP-3h-preview', info);
      // An unsaved change shows at once; Cancel puts the saved settings back (nothing is saved).
      const toggle = page.getByRole('switch', { name: 'Enable announcements' });
      await toggle.click();
      await expect(preview).toContainText(
        policy.enabled ? 'Announcements are off' : 'Extended Office Hours',
      );
      await shot(page, TAB, 'CP-3h-unsaved', info);
      await page
        .getByTestId('portal-announcements')
        .getByRole('button', { name: 'Cancel', exact: true })
        .click();
      await expect(toggle).toHaveAttribute('aria-checked', String(policy.enabled));
    });
    const after = await asOwner(async (o) =>
      okJson<AnnouncementSettings>(await o.get(ANNOUNCEMENT_SETTINGS), 'announcement settings'),
    );
    expect(after, 'nothing saved').toEqual(policy);
  });

  test("CP-3i Show announcements on client dashboard: off, the dashboard's leave the client's list and the others stay", async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    await asOwner(async (o) => {
      const before = await okJson<AnnouncementSettings>(
        await o.get(ANNOUNCEMENT_SETTINGS),
        'announcement settings',
      );
      if (!before.enabled) {
        test.skip(true, 'NO DATA: Test Firm B has announcements off (CP-3c checks the switch)');
        return;
      }
      const dash = await publishAnnouncement(o, 'dashboard', 'CP-3i dashboard announcement');
      const docs = await publishAnnouncement(o, 'documents', 'CP-3i documents announcement');
      const left: string[] = [];
      try {
        const sees = async (onDashboard: boolean, name: string) => {
          const ids = (await ok<{ items: Announcement[] }>('me/announcements')).items.map(
            (a) => a.id,
          );
          expect(ids, 'the Documents one stays').toContain(docs.id);
          if (onDashboard) expect(ids, 'the dashboard one').toContain(dash.id);
          else expect(ids, 'no dashboard one').not.toContain(dash.id);
          await open(page, portal('/home'), info);
          const card = page.getByTestId('announcement-card');
          if (onDashboard) await expect(card).toContainText(dash.title);
          else await expect(card).toHaveCount(0);
          await shot(page, TAB, name, info);
        };
        await sees(before.onDashboard, `CP-3i-${before.onDashboard ? 'on' : 'off'}`);
        // Firm-wide: back to the old value within seconds.
        try {
          await okJson(
            await o.put(ANNOUNCEMENT_SETTINGS, { data: { onDashboard: !before.onDashboard } }),
            'switch the dashboard',
          );
          await sees(!before.onDashboard, `CP-3i-${before.onDashboard ? 'off' : 'on'}`);
        } finally {
          await okJson(
            await o.put(ANNOUNCEMENT_SETTINGS, { data: { onDashboard: before.onDashboard } }),
            'restore the dashboard switch',
          );
        }
        const after = await okJson<AnnouncementSettings>(
          await o.get(ANNOUNCEMENT_SETTINGS),
          'announcement settings',
        );
        expect(after.onDashboard, 'the switch is back').toBe(before.onDashboard);
      } finally {
        for (const id of [dash.id, docs.id]) {
          const l = await removeAnnouncement(o, id);
          if (l) left.push(l);
        }
        if (left.length)
          info.annotations.push({ type: 'left-behind', description: left.join('; ') });
      }
    });
  });

  // ---------- Contact information (the Need Help card) ----------

  test('CP-4a Need Help shows the corporate and the local office as the firm set them', async ({
    page,
  }, info) => {
    const c = await ok<Contact>('me/contact');
    await open(page, portal('/home'), info);
    const help = needHelp(page);
    await expect(help).toBeVisible();
    await expect(help.locator('section[aria-label="Corporate Office"]')).toHaveCount(
      c.corporate ? 1 : 0,
    );
    await expect(help.locator('section[aria-label="Your Local Office"]')).toHaveCount(
      c.local ? 1 : 0,
    );
    if (c.corporate) {
      await expect(help.locator('section[aria-label="Corporate Office"]')).toContainText(
        c.corporate.name,
      );
    }
    await shot(page, TAB, 'CP-4a', info);
  });

  test("CP-4b the local office is one of the firm's active offices", async ({ page }, info) => {
    const c = await ok<Contact>('me/contact');
    if (!c.local) {
      test.skip(true, 'NO DATA: no local office shown to this client (off, or none assigned)');
      return;
    }
    const { offices } = await ok<{ offices: Office[] }>('offices');
    expect(
      offices.map((o) => o.id),
      'an active office',
    ).toContain(c.local.id);
    await open(page, portal('/home'), info);
    await expect(needHelp(page).locator('section[aria-label="Your Local Office"]')).toContainText(
      c.local.name,
    );
  });

  test('CP-4c Need Help offers only the contact methods the firm allows', async ({
    page,
  }, info) => {
    const c = await ok<Contact>('me/contact');
    const offices = [c.corporate, c.local].filter((o): o is Office => o !== null);
    const phones = offices.filter((o) => o.phone).length;
    const emails = offices.filter((o) => o.email).length;
    await open(page, portal('/home'), info);
    const details = needHelp(page).getByTestId('portal-contact-details');
    await expect(details.locator('a[href^="tel:"]')).toHaveCount(c.methods.phone ? phones : 0);
    await expect(details.locator('a[href^="sms:"]')).toHaveCount(c.methods.sms ? phones : 0);
    await expect(details.locator('a[href^="mailto:"]')).toHaveCount(c.methods.email ? emails : 0);
    await shot(page, TAB, 'CP-4c', info);
  });

  test("CP-4d the offices' details are the firm's Locations, not copies", async ({
    page,
  }, info) => {
    const c = await ok<Contact>('me/contact');
    if (!c.local) {
      test.skip(true, 'NO DATA: no local office shown to this client (off, or none assigned)');
      return;
    }
    const { offices } = await ok<{ offices: Office[] }>('offices');
    const office = offices.find((o) => o.id === c.local?.id);
    expect(office, 'the local office in Locations').toBeTruthy();
    expect([c.local.name, c.local.addressLines]).toEqual([office?.name, office?.addressLines]);
    await open(page, portal('/home'), info);
    const card = needHelp(page).locator('section[aria-label="Your Local Office"]');
    for (const line of c.local.addressLines) await expect(card).toContainText(line);
  });

  test('CP-4e Call and Text are separate lines', async ({ page }, info) => {
    const c = await ok<Contact>('me/contact');
    await open(page, portal('/home'), info);
    const details = needHelp(page).getByTestId('portal-contact-details');
    for (const text of await details.locator('a[href^="tel:"]').allInnerTexts()) {
      expect(text.trim(), 'a Call line').not.toMatch(/^Text\b/);
    }
    for (const text of await details.locator('a[href^="sms:"]').allInnerTexts()) {
      expect(text.trim(), 'a Text line').toMatch(/^Text\b/);
    }
    if (!c.methods.sms) await expect(details.getByText(/^Text\s/)).toHaveCount(0);
  });

  test("CP-4f Send a Message and Book follow the firm's switches; booking follows the client's", async ({
    page,
  }, info) => {
    const t = await ok<Tabs>('me/tabs');
    const c = await ok<Contact>('me/contact');
    const types = await get('me/appointments/types');
    if (isOn(t, 'APPOINTMENTS')) expect(types.status, 'booking types').toBe(200);
    else expect([types.status, types.code], 'booking types').toEqual([403, 'MODULE_OFF']);
    const messages = isOn(t, 'MESSAGES') && c.methods.secureMessage;
    await open(page, portal('/home'), info);
    const help = needHelp(page);
    await expect(help.getByRole('link', { name: 'Send a Message' })).toHaveCount(messages ? 1 : 0);
    await expect(help.getByRole('link', { name: 'Book Appointment' })).toHaveCount(
      c.methods.appointment ? 1 : 0,
    );
    await shot(page, TAB, 'CP-4f-home', info);
    if (isOn(t, 'MESSAGES')) {
      // The list only: no thread is opened, so nothing is marked read.
      await open(page, portal('/messages'), info);
      const send = page
        .locator('main')
        .first()
        .getByRole('button', { name: /Send a Message/ });
      if (messages) await expect(send.first()).toBeVisible();
      else await expect(send).toHaveCount(0);
    }
  });

  // ---------- Features (the portal's tabs) ----------

  test('CP-5a Business Documents & Resources has its own switch, in Settings and for the client', async ({
    browser,
  }, info) => {
    const t = await ok<Tabs>('me/tabs');
    expect(Object.keys(t.tabs), "the client's switches").toContain('BUSINESS_RESOURCES');
    expect(
      t.layout.map((i) => i.tab),
      'in the tab layout',
    ).toContain('BUSINESS_RESOURCES');
    const firm = await asOwner(async (o) => okJson<Tabs>(await o.get(PORTAL_TABS), 'firm tabs'));
    expect(typeof firm.tabs['BUSINESS_RESOURCES'], "the firm's switch").toBe('boolean');
    await asOwnerPage(browser, async (page) => {
      await open(page, app('/settings/portal?panel=features'), info);
      const row = page.getByTestId('portal-tab-BUSINESS_RESOURCES');
      const name = labelOf(firm, 'BUSINESS_RESOURCES');
      const toggle = row.getByRole('switch', { name: `Show ${name}` });
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-checked', String(firm.tabs['BUSINESS_RESOURCES']));
      await expect(row).not.toContainText('Always shown');
      await shot(page, TAB, 'CP-5a-features', info);
    });
  });

  test("CP-5b the firm renames a tab: the client's folder row shows the name; a shared name is refused", async ({
    page,
  }, info) => {
    const t = await ok<Tabs>('me/tabs');
    // A tab this client sees: its folder shows the new name.
    const target = t.layout.find((i) => isOn(t, i.tab) && i.tab !== 'BUSINESS_RESOURCES');
    if (!target) {
      test.skip(true, 'NO DATA: no built-in tab is on for this client');
      return;
    }
    await asOwner(async (o) => {
      const before = await okJson<Tabs>(await o.get(PORTAL_TABS), 'firm tabs');
      const keep = asSent(before.layout);
      // Two tabs never share a name, ignoring case: refused, and nothing changes.
      const other = before.layout.find((i) => i.tab !== target.tab)!;
      const clash = keep.map((i) =>
        i.tab === target.tab ? { ...i, label: other.label.toUpperCase() } : i,
      );
      expect(
        await statusOf(await o.put(PORTAL_TABS, { data: { layout: clash } })),
        'a shared name',
      ).toEqual([409, 'DUPLICATE_LABEL']);
      const name = `${runTag} tab`;
      // Firm-wide (every client's tab row): the old names go back in the finally block.
      try {
        await okJson(
          await o.put(PORTAL_TABS, {
            data: { layout: keep.map((i) => (i.tab === target.tab ? { ...i, label: name } : i)) },
          }),
          'rename a tab',
        );
        const mine = await ok<Tabs>('me/tabs');
        expect(mine.layout.find((i) => i.tab === target.tab)).toEqual({
          tab: target.tab,
          label: name,
          renamed: true,
        });
        await open(page, portal('/home'), info);
        await expect(folderLinks(page)).toHaveText(folderRow(mine));
        await expect(folderLinks(page).filter({ hasText: exactly(name) })).toHaveCount(1);
        await shot(page, TAB, 'CP-5b-renamed', info);
      } finally {
        await okJson(await o.put(PORTAL_TABS, { data: { layout: keep } }), 'restore the names');
      }
      const after = await okJson<Tabs>(await o.get(PORTAL_TABS), 'firm tabs');
      expect(after.layout, 'the names are back').toEqual(before.layout);
    });
  });

  test("CP-5c the firm reorders the tabs: the client's folder row follows the order", async ({
    page,
  }, info) => {
    const t = await ok<Tabs>('me/tabs');
    // The current row first (read-only): the firm's order and names.
    await open(page, portal('/home'), info);
    await expect(folderLinks(page)).toHaveText(folderRow(t));
    const shown = t.layout.filter((i) => isOn(t, i.tab) && i.tab !== 'BUSINESS_RESOURCES');
    if (shown.length < 2) {
      test.skip(true, 'NO DATA: fewer than two built-in tabs are on for this client');
      return;
    }
    await asOwner(async (o) => {
      const before = await okJson<Tabs>(await o.get(PORTAL_TABS), 'firm tabs');
      const keep = asSent(before.layout);
      // The first two tabs this client sees change places.
      const [a, b] = [shown[0]!.tab, shown[1]!.tab];
      const ia = keep.findIndex((i) => i.tab === a);
      const ib = keep.findIndex((i) => i.tab === b);
      const moved = [...keep];
      [moved[ia], moved[ib]] = [keep[ib]!, keep[ia]!];
      // Firm-wide (every client's tab row): the old order goes back in the finally block.
      try {
        await okJson(await o.put(PORTAL_TABS, { data: { layout: moved } }), 'reorder');
        const mine = await ok<Tabs>('me/tabs');
        expect(
          mine.layout.map((i) => i.tab),
          'the new order',
        ).toEqual(moved.map((i) => i.tab));
        await open(page, portal('/home'), info);
        await expect(folderLinks(page)).toHaveText(folderRow(mine));
        await shot(page, TAB, 'CP-5c-reordered', info);
      } finally {
        await okJson(await o.put(PORTAL_TABS, { data: { layout: keep } }), 'restore the order');
      }
      const after = await okJson<Tabs>(await o.get(PORTAL_TABS), 'firm tabs');
      expect(after.layout, 'the order is back').toEqual(before.layout);
    });
  });

  test('CP-5d a custom tab for this client shows in their Business portal, after the built-in tabs, and opens its own page', async ({
    page,
  }, info) => {
    test.setTimeout(180_000);
    const me = await portalClient();
    await asOwner(async (o) => {
      const label = `${runTag} custom tab`;
      const tab = await okJson<{ id: string; label: string; clients: { id: string }[] }>(
        await o.post(`${PORTAL_TABS}/custom`, {
          data: { label, module: 'DOCUMENTS', audience: 'CLIENTS', clientIds: [me.id] },
        }),
        'custom tab',
      );
      const client = await okJson<{ accountType: string }>(
        await o.get(`business/clients/${me.id}`),
        'the harness client',
      );
      let flipped = false;
      const left: string[] = [];
      try {
        expect(
          tab.clients.map((c) => c.id),
          'for the harness client only',
        ).toEqual([me.id]);
        // Custom tabs show only in business portals (guide 9.3): the harness client becomes a
        // Business client for the check, and is an Individual again in the finally block.
        if (client.accountType !== 'BUSINESS') {
          await okJson(
            await o.patch(`business/clients/${me.id}`, { data: { accountType: 'BUSINESS' } }),
            'a Business portal',
          );
          flipped = true;
        }
        const t = await ok<Tabs>('me/tabs');
        expect(t.businessPortal, 'a business portal').toBe(true);
        expect(t.custom, 'the custom tab').toContainEqual({
          id: tab.id,
          label,
          module: 'DOCUMENTS',
        });
        await open(page, portal('/home'), info);
        await expect(folderLinks(page)).toHaveText(folderRow(t));
        await expect(folderLinks(page).last(), 'after the built-in tabs').toHaveText(label);
        await shot(page, TAB, 'CP-5d-folders', info);
        await folderLinks(page).last().click();
        await expect(page).toHaveURL(new RegExp(`/${firmSlug}/tab/${tab.id}$`));
        await settled(page);
        const main = page.locator('main').first();
        await expect(main.getByRole('heading', { name: label })).toBeVisible();
        await expect(main.getByRole('button', { name: /Upload Documents/ })).toBeVisible();
        await shot(page, TAB, 'CP-5d-tab', info);
        expect((await get(`me/documents?portalTabId=${tab.id}`)).status, "the tab's files").toBe(
          200,
        );
        // Switched off: it leaves the row, and its files route is refused.
        await okJson(
          await o.patch(`${PORTAL_TABS}/custom/${tab.id}`, { data: { enabled: false } }),
          'switch the tab off',
        );
        expect((await ok<Tabs>('me/tabs')).custom?.map((c) => c.id) ?? []).not.toContain(tab.id);
        expect((await get(`me/documents?portalTabId=${tab.id}`)).status, 'off').toBe(404);
      } finally {
        if (flipped) {
          const back = await o.patch(`business/clients/${me.id}`, {
            data: { accountType: client.accountType },
          });
          if (!back.ok()) left.push(`harness client type (${back.status()})`);
        }
        const archived = await o.post(`${PORTAL_TABS}/custom/${tab.id}/archive`, { data: {} });
        if (!archived.ok()) left.push(`custom tab ${tab.id} (${archived.status()})`);
        info.annotations.push({ type: 'left-behind', description: left.join('; ') || 'none' });
      }
      expect(left, 'restored and archived').toEqual([]);
      const restored = await okJson<{ accountType: string }>(
        await o.get(`business/clients/${me.id}`),
        'the harness client',
      );
      expect(restored.accountType, 'the client type is back').toBe(client.accountType);
    });
  });

  test('CP-5e custom tabs reach only the clients they target, checked by the API: never an Individual portal', async ({
    page,
  }, info) => {
    const me = await portalClient();
    const t0 = await ok<Tabs>('me/tabs');
    if (t0.businessPortal !== false) {
      test.skip(true, 'NO DATA: the harness client is not an Individual client');
      return;
    }
    await asOwner(async (o) => {
      // Refused, and nothing made: a targeted audience naming nobody, or an unknown client.
      const label = `${runTag} targeted tab`;
      const none = await o.post(`${PORTAL_TABS}/custom`, {
        data: { label, module: 'DOCUMENTS', audience: 'CLIENTS', clientIds: [] },
      });
      expect(none.status(), 'CLIENTS with no client').toBe(400);
      expect(
        (
          await statusOf(
            await o.post(`${PORTAL_TABS}/custom`, {
              data: { label, module: 'DOCUMENTS', audience: 'CLIENTS', clientIds: [randomUUID()] },
            }),
          )
        )[0],
        'an unknown client',
      ).toBe(404);
      const tab = await okJson<{ id: string }>(
        await o.post(`${PORTAL_TABS}/custom`, {
          data: { label, module: 'DOCUMENTS', audience: 'CLIENTS', clientIds: [me.id] },
        }),
        'custom tab',
      );
      try {
        // Targeted at this client, who has a Personal (Individual) portal: never shown.
        const t = await ok<Tabs>('me/tabs');
        expect(t.custom ?? [], 'no custom tab in an Individual portal').toEqual([]);
        expect((await get(`me/documents?portalTabId=${tab.id}`)).status, 'by API').toBe(404);
        await open(page, portal(`/tab/${tab.id}`), info);
        await expect(page.locator('main').first()).toContainText("This tab isn't available");
        await expect(folderLinks(page).filter({ hasText: exactly(label) })).toHaveCount(0);
        await shot(page, TAB, 'CP-5e-individual', info);
      } finally {
        const archived = await o.post(`${PORTAL_TABS}/custom/${tab.id}/archive`, { data: {} });
        if (!archived.ok()) {
          info.annotations.push({
            type: 'left-behind',
            description: `custom tab ${tab.id} (${archived.status()})`,
          });
        }
      }
      const live = await okJson<{ items: { id: string }[] }>(
        await o.get(`${PORTAL_TABS}/custom`),
        'custom tabs',
      );
      expect(
        live.items.map((i) => i.id),
        'archived',
      ).not.toContain(tab.id);
    });
  });

  test('CP-5f a tab the firm turned off says nothing the client shared is removed', async ({
    page,
  }, info) => {
    const t = await ok<Tabs>('me/tabs');
    const off = FOLDERS.find(([tab]) => tab !== 'BUSINESS_RESOURCES' && !isOn(t, tab));
    if (!off) {
      test.skip(true, 'NOT LIVE: every tab is on for this client; turning one off is a firm write');
      return;
    }
    await open(page, portal(`/${off[1]}`), info);
    const main = page.locator('main').first();
    await expect(main).toContainText(`${labelOf(t, off[0])} isn't available`);
    await expect(main).toContainText('Nothing you shared with them is removed');
    await shot(page, TAB, 'CP-5f', info);
  });

  test('CP-5g the folders and the side menu list only the tabs that are on; an off tab is refused', async ({
    page,
  }, info) => {
    const t = await ok<Tabs>('me/tabs');
    for (const [area, path] of GUARDED) {
      const a = await get(path);
      if (isOn(t, area)) expect(a.status, `${path} while ${area} is on`).toBe(200);
      else expect([a.status, a.code], `${path} while ${area} is off`).toEqual([403, 'MODULE_OFF']);
    }
    await open(page, portal('/home'), info);
    // The firm's order and names (CP-5b, CP-5c), only the tabs on for this client.
    await expect(folderLinks(page)).toHaveText(folderRow(t));
    const menu = page.getByRole('navigation', { name: 'Main' }).first();
    for (const [label, area] of MENU) {
      await expect(menu.locator('a').filter({ hasText: label }), String(label)).toHaveCount(
        isOn(t, area) ? 1 : 0,
      );
    }
    await shot(page, TAB, 'CP-5g', info);
    for (const [tab, path] of FOLDERS) {
      if (tab === 'BUSINESS_RESOURCES' || isOn(t, tab)) continue;
      await open(page, portal(`/${path}`), info);
      await expect(page.locator('main').first()).toContainText(
        `${labelOf(t, tab)} isn't available`,
      );
    }
  });

  test("CP-5h Settings' Features preview shows a client's tab names, order and visibility", async ({
    browser,
    page,
  }, info) => {
    const t = await ok<Tabs>('me/tabs');
    const firm = await asOwner(async (o) => okJson<Tabs>(await o.get(PORTAL_TABS), 'firm tabs'));
    const firmOn = firm.layout.filter((i) => firm.tabs[i.tab] !== false);
    await asOwnerPage(browser, async (p) => {
      await open(p, app('/settings/portal?panel=features'), info);
      const preview = p.getByTestId('tabs-preview');
      const list = preview.getByTestId('tabs-preview-list').locator('li');
      await expect(list, 'Business: every tab on, in order').toHaveText(firmOn.map((i) => i.label));
      await preview.getByRole('button', { name: 'Personal' }).click();
      const personal = firmOn.filter((i) => i.tab !== 'BUSINESS_RESOURCES').map((i) => i.label);
      await expect(list, 'Personal: no Business tab').toHaveText(personal);
      await shot(p, TAB, 'CP-5h-preview', info);
      // An unsaved move shows at once; Cancel puts the saved order back (nothing is saved).
      const first = firm.layout[0]!;
      await p.getByRole('button', { name: `Move ${first.label} down` }).click();
      const moved = [firm.layout[1]!, first, ...firm.layout.slice(2)]
        .filter((i) => firm.tabs[i.tab] !== false && i.tab !== 'BUSINESS_RESOURCES')
        .map((i) => i.label);
      await expect(list, 'the unsaved order').toHaveText(moved);
      await shot(p, TAB, 'CP-5h-unsaved', info);
      await p.getByRole('button', { name: 'Cancel', exact: true }).first().click();
      await expect(list, 'Cancel').toHaveText(personal);
    });
    // The client's own row is the Personal preview less the areas switched off for them alone.
    await open(page, portal('/home'), info);
    await expect(folderLinks(page)).toHaveText(folderRow(t));
    const after = await asOwner(async (o) => okJson<Tabs>(await o.get(PORTAL_TABS), 'firm tabs'));
    expect(after.layout, 'nothing saved').toEqual(firm.layout);
  });

  // ---------- Quality, delivery and rollout ----------

  firmSide('CP-6.6 Settings > Client Portal at phone width', 'a firm page');
  firmSide('CP-7.1 Settings cards warn before unsaved changes are lost', 'a firm page');

  // eslint-disable-next-line no-empty-pattern
  test('CP-7.5 the client never gets the same notice twice', async ({}, info) => {
    const { items } = await ok<{ items: Notice[] }>('me/notifications?limit=50');
    info.annotations.push({ type: 'note', description: `${items.length} notices read` });
    const seen = new Map<string, number>();
    const twice: string[] = [];
    for (const n of items) {
      const key = `${n.category}|${n.title}|${n.target?.kind ?? ''}|${n.target?.id ?? ''}`;
      const at = Date.parse(n.createdAt);
      const before = seen.get(key);
      if (before !== undefined && Math.abs(before - at) < 60_000) {
        twice.push(`${n.title} (${n.createdAt})`);
      }
      seen.set(key, at);
    }
    expect(twice, 'the same notice within a minute').toEqual([]);
  });

  test('CP-7.6 backups and rollback for the release: firm side (H: a person confirms it)', () =>
    test.skip(true, 'H row: Rasel confirms backups and rollback; nothing in the portal to check'));
  test('CP-7.7 sign-off pack: firm side (H: a person builds it)', () =>
    test.skip(true, "H row: a person builds the pack; this spec's @narrow screenshots feed it"));

  // ---------- Portal type, clock, branding ----------

  test('CP-9.3 an Individual portal has no Business tab; a Business one has it', async ({
    page,
  }, info) => {
    const t = await ok<Tabs>('me/tabs');
    const content = await get('me/content?kind=RESOURCE');
    await open(page, portal('/home'), info);
    const tab = folderLinks(page).filter({ hasText: exactly(labelOf(t, 'BUSINESS_RESOURCES')) });
    if (t.businessPortal === false) {
      expect([content.status, content.code], 'business resources').toEqual([403, 'BUSINESS_ONLY']);
      await expect(tab).toHaveCount(0);
      await shot(page, TAB, 'CP-9.3-home', info);
      await open(page, portal('/business'), info);
      await expect(page.getByTestId('business-only')).toBeVisible();
      await shot(page, TAB, 'CP-9.3-business', info);
    } else {
      expect(content.status, 'business resources').toBe(200);
      await expect(tab).toHaveCount(1);
      await shot(page, TAB, 'CP-9.3-home', info);
    }
  });

  test('CP-9.3a sign-up asks Individual or Business', async ({ browser }) => {
    const firm = await ok<Info>('info');
    if (!firm.signUpOpen) {
      test.skip(true, 'NO DATA: sign-up is closed for Test Firm B');
      return;
    }
    // Signed out. No screenshot: the form asks for a password.
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      const p = await ctx.newPage();
      await p.goto(portal('/sign-up'));
      await settled(p);
      await expect(p.getByRole('radio', { name: /Individual/ })).toBeVisible();
      await expect(p.getByRole('radio', { name: /Business/ })).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test("SM10 every portal page shows the date and time in the firm's time zone", async ({
    page,
  }, info) => {
    const firm = await ok<Info>('info');
    for (const path of ['/home', '/documents', '/appointments', '/services', '/profile']) {
      await open(page, portal(path), info);
      const clock = page.getByTestId('header-clock');
      await expect(clock, path).toBeVisible();
      await expect(clock, path).toHaveAttribute('title', `Time zone: ${firm.timezone}`);
    }
    await shot(page, TAB, 'SM10', info);
  });

  test("CC-5 the portal wears the firm's colour", async ({ page }, info) => {
    const firm = await ok<Info>('info');
    await open(page, portal('/home'), info);
    const color = await page
      .locator('[data-theme="portal"]')
      .first()
      .evaluate((el) => getComputedStyle(el).getPropertyValue('--color-firm-primary').trim());
    expect(color.toLowerCase()).toBe(firm.branding.primaryColor.toLowerCase());
    await shot(page, TAB, 'CC-5', info);
  });

  // ---------- Appointments and intake ----------

  test('A7 a Portal reminder the firm set on an appointment reaches the client when it is due', async ({
    page,
  }, info) => {
    test.setTimeout(480_000);
    const firm = await ok<Info>('info');
    await asOwner(async (o) => {
      const ownerId = (await okJson<{ user: { id: string } }>(await o.get('me'), 'me')).user.id;
      const typeId = await newType(o, 'A7 type');
      let apptId = '';
      const left: string[] = [];
      try {
        // Eight minutes from now, with a Portal reminder five minutes before: due in about three.
        const start = new Date(Math.ceil((Date.now() + 8 * 60_000) / 60_000) * 60_000);
        apptId = await schedule(o, {
          typeId,
          ownerId,
          start,
          timezone: firm.timezone,
          reminders: [
            { channel: 'PORTAL', amount: 5, unit: 'MINUTES', note: `${runTag} A7 reminder` },
          ],
        });
        // The reminder job runs every minute and sends up to a minute early.
        const reminder = await waitFor(
          'the Portal reminder',
          async () => {
            const { items } = await ok<{ items: Notice[] }>('me/notifications?limit=50');
            const found = items.filter(
              (n) => n.target?.id === apptId && n.title === 'Appointment reminder',
            );
            return found.length ? found : undefined;
          },
          330_000,
          15_000,
        );
        expect(reminder, 'one reminder').toHaveLength(1);
        expect(reminder[0]).toMatchObject({
          category: 'APPOINTMENTS',
          target: { kind: 'appointment', id: apptId },
        });
        expect(Date.now(), 'before the appointment starts').toBeLessThan(start.getTime());
        await open(page, portal('/notifications'), info);
        await expect(page.locator('main').first()).toContainText('Appointment reminder');
        await shot(page, TAB, 'A7-reminder', info);
      } finally {
        if (apptId) {
          const c = await o.post(`business/appointments/${apptId}/cancel`, {
            data: { reason: `${runTag} cleanup` },
          });
          if (!c.ok()) left.push(`appointment ${apptId} (${c.status()})`);
        }
        const a = await o.post(`business/appointment-types/${typeId}/archive`);
        if (!a.ok() && a.status() !== 409) left.push(`type ${typeId} (${a.status()})`);
        info.annotations.push({ type: 'left-behind', description: left.join('; ') || 'none' });
      }
    });
  });

  notLive(
    'A8 the client confirms an appointment the firm booked',
    'confirming is a write on this login',
  );

  // A9 (#1629): the booking paths call IntakeSendService.sendForAppointment. Test Firm B has no
  // intake form, and a form sent to a client opens a REQUESTED engagement for the form's service
  // when the client has none (intake-send.service.ts recipient(), requestedEngagement), which would
  // stay on the harness client: no delete, and it would show in their My Services.
  notLive(
    "A9 booking a service sends the client that service's intake form",
    'Test Firm B has no intake form, and sending one opens an engagement for its service on the harness client (no delete)',
  );

  test("A10 the client's booking choices never carry the staff-only description", async () => {
    const t = await ok<Tabs>('me/tabs');
    const types = await get<{ items: Json[] }>('me/appointments/types');
    if (!isOn(t, 'APPOINTMENTS')) {
      expect([types.status, types.code]).toEqual([403, 'MODULE_OFF']);
      return;
    }
    expect(types.status).toBe(200);
    expect([...keysOf(types.body)], 'no description key').not.toContain('description');
  });

  test("IF-D3 the forms the firm sent are in the client's Intake tab", async ({ page }, info) => {
    const t = await ok<Tabs>('me/tabs');
    const list = await get<{ items: { id: string; title: string }[] }>('me/intakes');
    if (!isOn(t, 'INTAKE_FORMS')) {
      expect([list.status, list.code]).toEqual([403, 'MODULE_OFF']);
      return;
    }
    expect(list.status).toBe(200);
    info.annotations.push({ type: 'note', description: `${list.body.items.length} forms sent` });
    await open(page, portal('/intake'), info);
    const sent = page.getByTestId('sent-intakes');
    if (!list.body.items.length) await expect(sent).toHaveCount(0);
    for (const item of list.body.items) await expect(sent).toContainText(item.title);
    await shot(page, TAB, 'IF-D3', info);
  });

  notLive(
    'I13 the client fills, saves, signs and submits a form',
    'filling and submitting is a write on this login',
  );

  // ---------- Other modules' items in the portal ----------

  test("SP-1 a package's link page: the live package for anyone, with Not Included and never its internal notes; any other state shows nothing of it", async ({
    browser,
  }, info) => {
    test.setTimeout(180_000);
    // Test Firm B has no package: the run makes its own (two services and a package, in the
    // LIVE-CHECK SP-1 category), reached only by its link, and removes them in the finally block.
    // The category stays, inactive (the archived package still names it); the next run reuses it.
    const secret = `${runTag} SP-1 internal note, staff only`;
    const made = { categoryId: '', categoryName: '', serviceIds: [] as string[], packageId: '' };
    const anon = await request.newContext({
      baseURL: `${portalUrl}/api/v1/`,
      storageState: { cookies: [], origins: [] },
    });
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    await asOwner(async (o) => {
      const left: string[] = [];
      try {
        const { items: cats } = await okJson<{ items: { id: string; name: string }[] }>(
          await o.get('business/catalog/categories'),
          'categories',
        );
        const earlier = cats.find((c) => /^LIVE-CHECK \d{12} SP-1 category$/.test(c.name));
        made.categoryName = earlier?.name ?? `${runTag} SP-1 category`;
        made.categoryId = earlier
          ? (
              await okJson<{ id: string }>(
                await o.put(`business/catalog/categories/${earlier.id}`, {
                  data: { name: earlier.name, status: 'ACTIVE' },
                }),
                'reactivate the category',
              )
            ).id
          : (
              await okJson<{ id: string }>(
                await o.post('business/catalog/categories', {
                  data: { name: made.categoryName, status: 'ACTIVE' },
                }),
                'category',
              )
            ).id;
        const names = [`${runTag} SP-1 included`, `${runTag} SP-1 not included`];
        for (const name of names) {
          const s = await okJson<{ id: string }>(
            await o.post('business/catalog/services', {
              data: {
                name,
                categoryId: made.categoryId,
                shortDescription: 'Live check (synthetic), removed by the run',
                kind: 'TAX_PLANNING',
                pricingType: 'FIXED',
                basePriceCents: 10_000,
                activate: true,
                allowDuplicateName: true,
              },
            }),
            'service',
          );
          made.serviceIds.push(s.id);
        }
        const name = `${runTag} SP-1 package`;
        made.packageId = (
          await okJson<{ id: string }>(
            await o.post('business/catalog/packages', {
              data: {
                name,
                categoryId: made.categoryId,
                shortDescription: 'Live check package (synthetic).',
                services: [
                  { serviceId: made.serviceIds[0], included: true },
                  { serviceId: made.serviceIds[1], included: false },
                ],
                packagePriceCents: 9_000,
                visibleToClients: true,
                displayOnWebsite: true,
                internalNotes: secret,
                activate: true,
              },
            }),
            'package',
          )
        ).id;
        const id = made.packageId;
        const link = await okJson<{ state: string; url: string }>(
          await o.get(`business/catalog/packages/${id}/public-link`),
          'package link',
        );
        expect(link, 'Copy Booking Link').toEqual(
          expect.objectContaining({ state: 'LIVE', url: portal(`/packages/${id}`) }),
        );
        // Signed out, as anyone with the link.
        type Pub = {
          state: string;
          details: {
            name: string;
            included: { name: string }[];
            notIncluded: { name: string }[];
            bookingTypeId: string | null;
          } | null;
        };
        const pub = await okJson<Pub>(await anon.get(`portal/${firmSlug}/packages/${id}`), 'live');
        expect(pub.state).toBe('LIVE');
        expect(pub.details?.name).toBe(name);
        expect(pub.details?.included.map((s) => s.name)).toEqual([names[0]]);
        expect(
          pub.details?.notIncluded.map((s) => s.name),
          'Not Included (S7)',
        ).toEqual([names[1]]);
        expect(
          [...keysOf(pub)].filter((k) => /internal/i.test(k)),
          'no internal field',
        ).toEqual([]);
        expect(JSON.stringify(pub), 'never the internal notes').not.toContain(secret);
        const p = await ctx.newPage();
        await open(p, portal(`/packages/${id}`), info);
        await expect(p.getByTestId('package-link')).toContainText(name);
        await expect(p.getByTestId('package-included')).toContainText(names[0]!);
        await expect(p.getByTestId('package-not-included')).toContainText(names[1]!);
        // No Booking type (S12): sign in and contact instead of Book This Package.
        await expect(p.getByRole('link', { name: 'Book This Package' })).toHaveCount(0);
        await expect(p.locator('body')).not.toContainText(secret);
        await shot(p, TAB, 'SP-1-live', info);
        // Inactive: the same link refuses it and shows nothing of it.
        await okJson(await o.post(`business/catalog/packages/${id}/deactivate`), 'deactivate');
        const off = await okJson<Pub>(await anon.get(`portal/${firmSlug}/packages/${id}`), 'off');
        expect([off.state, off.details], 'inactive').toEqual(['INACTIVE', null]);
        await open(p, portal(`/packages/${id}`), info);
        await expect(p.getByTestId('package-link-refused')).toBeVisible();
        // `package-link` wraps both states: nothing of the package is inside it now.
        for (const part of ['package-price', 'package-included', 'package-not-included']) {
          await expect(p.getByTestId(part), part).toHaveCount(0);
        }
        for (const text of [name, ...names])
          await expect(p.locator('body')).not.toContainText(text);
        await shot(p, TAB, 'SP-1-refused', info);
        expect(
          (await anon.get(`portal/${firmSlug}/packages/${randomUUID()}`)).status(),
          'an unknown package',
        ).toBe(404);
      } finally {
        if (made.packageId) {
          const a = await o.post(`business/catalog/packages/${made.packageId}/archive`);
          if (!a.ok()) left.push(`package ${made.packageId} (${a.status()})`);
        }
        for (const sid of made.serviceIds) {
          // Delete is refused once anything used the service; then it is archived.
          if ((await o.delete(`business/catalog/services/${sid}`)).ok()) continue;
          await o.post(`business/catalog/services/${sid}/deactivate`);
          const a = await o.post(`business/catalog/services/${sid}/archive`);
          if (!a.ok()) left.push(`service ${sid} (${a.status()})`);
        }
        const cat = made.categoryId;
        if (cat && !(await o.delete(`business/catalog/categories/${cat}`)).ok()) {
          const off = await o.put(`business/catalog/categories/${cat}`, {
            data: { name: made.categoryName, status: 'INACTIVE' },
          });
          left.push(
            off.ok()
              ? `category ${cat} inactive (in use by the archived records)`
              : `category ${cat} (${off.status()})`,
          );
        }
        info.annotations.push({ type: 'left-behind', description: left.join('; ') || 'none' });
        await ctx.close();
        await anon.dispose();
      }
    });
  });

  test('T16 a task the firm made visible: in Your Next Steps with its approved fields only, never its internal note', async ({
    page,
  }, info) => {
    const t = await ok<Tabs>('me/tabs');
    if (!isOn(t, 'TASKS_REQUESTS')) {
      expect([(await get('me/tasks')).status, (await get('me/tasks')).code]).toEqual([
        403,
        'MODULE_OFF',
      ]);
      return;
    }
    const me = await portalClient();
    const title = `${runTag} T16 task`;
    const secret = `${runTag} internal note, staff only`;
    await asOwner(async (o) => {
      const task = await okJson<{ id: string }>(
        await o.post('business/tasks', {
          data: {
            clientId: me.id,
            title,
            details: 'Live check (synthetic): nothing to do.',
            dueOn: day(7),
            clientVisible: true,
            internalNotes: secret,
            checklist: [{ label: 'LIVE-CHECK step one' }],
            idempotencyKey: randomUUID(),
          },
        }),
        'client-visible task',
      );
      const left: string[] = [];
      try {
        const { items } = await ok<{ items: { id: string; title: string; status: string }[] }>(
          'me/tasks',
        );
        expect(items.find((i) => i.id === task.id)).toMatchObject({ title, status: 'TO_DO' });
        const one = await ok<Json>(`me/tasks/${task.id}`);
        expect(one).toMatchObject({
          title,
          details: 'Live check (synthetic): nothing to do.',
          checklist: { done: 0, total: 1 },
          attachments: [],
        });
        const keys = [...keysOf(one)];
        for (const k of [
          'internalNotes',
          'assignee',
          'assignedUserId',
          'priority',
          'blockedReason',
        ]) {
          expect(keys, `no ${k}`).not.toContain(k);
        }
        expect(JSON.stringify(one), 'never the internal note').not.toContain(secret);
        await open(page, portal('/documents'), info);
        const row = page.getByTestId('task-row').filter({ hasText: title });
        await expect(row).toBeVisible();
        await shot(page, TAB, 'T16-next-steps', info);
        await row.getByRole('link', { name: 'View task' }).click();
        await expect(page).toHaveURL(new RegExp(`/requests/tasks/${task.id}$`));
        await settled(page);
        await expect(page.getByTestId('client-task')).toContainText(title);
        await expect(page.getByTestId('task-checklist')).toContainText('LIVE-CHECK step one');
        await expect(page.locator('body')).not.toContainText(secret);
        await shot(page, TAB, 'T16-task', info);
        // No longer visible to the client: gone from the list and refused as one.
        await okJson(
          await o.patch(`business/tasks/${task.id}`, { data: { clientVisible: false } }),
          'hide the task',
        );
        const after = await ok<{ items: { id: string }[] }>('me/tasks');
        expect(after.items.map((i) => i.id)).not.toContain(task.id);
        expect((await get(`me/tasks/${task.id}`)).status, 'hidden').toBe(404);
      } finally {
        const c = await o.post(`business/tasks/${task.id}/cancel`);
        const a = await o.post(`business/tasks/${task.id}/archive`);
        if (!a.ok()) left.push(`task ${task.id} (cancel ${c.status()}, archive ${a.status()})`);
        info.annotations.push({ type: 'left-behind', description: left.join('; ') || 'none' });
      }
    });
  });

  notLive(
    'B3/E10 a portal invitation link leads to sign-up',
    'it needs the firm to send an invitation (a write and an email)',
  );

  test("B10, BA-CP the client's Business Advisory view: only what the firm marked, and only their own plans", async ({
    page,
  }, info) => {
    const a = await ok<Json>('me/advisory');
    for (const k of [
      'enrolled',
      'services',
      'plans',
      'recommendations',
      'tasks',
      'resources',
      'files',
    ]) {
      expect(Object.keys(a), `the view has ${k}`).toContain(k);
    }
    expect(
      [...keysOf(a)].filter((k) => /health|score|assessment|figure|note/i.test(k)),
      "never the firm's figures, score, assessment or notes",
    ).toEqual([]);
    if (a['enrolled'] === false) {
      for (const k of ['plans', 'recommendations', 'tasks', 'resources', 'files']) {
        expect(a[k], `${k} while not enrolled`).toEqual([]);
      }
    }
    // Another client's (or no) plan: 404, and approving it changes nothing (B10).
    const other = randomUUID();
    expect((await get(`me/advisory/plans/${other}`)).status, 'a plan not theirs').toBe(404);
    const [s] = await statusOf(
      await clientSend('post', `me/advisory/plans/${other}/approve`, { version: 1 }),
    );
    expect(s, 'approving a plan not theirs').toBe(404);
    await open(page, portal('/services/advisory'), info);
    await expect(page.locator('main').first()).toBeVisible();
    await expect(page.getByText(/Something went wrong|Page not found/i)).toHaveCount(0);
    if (a['enrolled'] === false) await expect(page.getByTestId('advisory-none')).toBeVisible();
    else await expect(page.getByTestId('advisory-disclaimer')).toBeVisible();
    await shot(page, TAB, 'BA-CP', info);
    info.annotations.push({
      type: 'NOT LIVE',
      description:
        'the marked items and the approval itself: they need the harness client in Business Advisory with a delivered plan (advisory clients and plans have no delete)',
    });
  });
  notLive(
    'B10 the client approves the plan sent for approval, again after a revision',
    'needs an advisory plan for the harness client that passes the finalize checks; plans and advisory clients have no delete',
  );

  test('B28 advisory resources in the portal: each with its format, a PDF only behind its own link', async () => {
    const a = await ok<{ enrolled: boolean; resources: { key: string; format: string }[] }>(
      'me/advisory',
    );
    for (const r of a.resources) expect(['SECURE_LINK', 'PDF'], r.key).toContain(r.format);
    // A PDF the firm never sent this client is 404.
    const [s] = await statusOf(
      await api.get(portalApi('me/advisory/resources/live-check-none/pdf')),
    );
    expect([400, 404], 'a resource never sent').toContain(s);
  });
  notLive(
    'B28 the firm sends a resource by portal as a Secure Link or PDF, after a preview',
    'the send and its preview name an advisory client; enrolling the harness client in Business Advisory leaves a record with no delete',
  );

  test('B32 a note the firm shares reaches the client as a portal message; the note stays internal', async ({
    page,
  }, info) => {
    const t = await ok<Tabs>('me/tabs');
    if (!isOn(t, 'MESSAGES')) {
      test.skip(true, 'NO DATA: Messages is off for this client');
      return;
    }
    const me = await portalClient();
    const text = `${runTag} B32 note shared with the client (synthetic).`;
    await asOwner(async (o) => {
      const note = await okJson<{ id: string; updatedAt: string }>(
        await o.post(`business/clients/${me.id}/notes`, { data: { body: text } }),
        'internal note',
      );
      let threadId = '';
      const left: string[] = [];
      try {
        // Shared as previewed: a new portal message with the note's text.
        const shared = await okJson<{ threadId: string }>(
          await o.post(`business/notes/${note.id}/share`, { data: { updatedAt: note.updatedAt } }),
          'share the note',
        );
        threadId = shared.threadId;
        const { items } = await ok<{ items: { id: string; subject: string }[] }>('me/messages');
        expect(items.find((i) => i.id === threadId)?.subject).toBe('A note from your firm');
        const thread = await ok<{ messages: { body: string }[] }>(`me/messages/${threadId}`);
        expect(thread.messages.map((m) => m.body).join('\n')).toContain(text);
        await open(page, portal('/messages'), info);
        await expect(page.locator('main').first()).toContainText('A note from your firm');
        await shot(page, TAB, 'B32-message', info);
        // A note changed since the preview is refused (preview it again).
        await okJson(
          await o.patch(`business/notes/${note.id}`, { data: { body: `${text} Edited.` } }),
          'edit the note',
        );
        expect(
          await statusOf(
            await o.post(`business/notes/${note.id}/share`, {
              data: { updatedAt: note.updatedAt },
            }),
          ),
          'a stale preview',
        ).toEqual([409, 'NOTE_CHANGED']);
      } finally {
        const d = await o.delete(`business/notes/${note.id}`);
        if (!d.ok()) left.push(`note ${note.id} (${d.status()})`);
        if (threadId) {
          const a = await o.post(`business/message-threads/${threadId}/archive`);
          if (!a.ok()) left.push(`thread ${threadId} (${a.status()})`);
          else left.push(`thread ${threadId} archived by the firm (messages have no delete)`);
        }
        info.annotations.push({ type: 'left-behind', description: left.join('; ') || 'none' });
      }
    });
  });

  notLive(
    'SU-D3a a pending applicant sees the waiting page',
    "it needs a pending applicant's login; making one is a sign-up",
  );
  firmSide('SU-D3b a decline emails the applicant unless staff untick it', 'an email');

  test('BK-CP1 only published reports reach the client', async () => {
    const t = await ok<Tabs>('me/tabs');
    const services = await ok<{ items: { id: string }[] }>('me/services');
    if (!services.items.length) {
      test.skip(true, 'NO DATA: the client has no service');
      return;
    }
    const allowed = ['id', 'kind', 'title', 'periodLabel', 'data', 'documentId', 'publishedAt'];
    for (const s of services.items.slice(0, 10)) {
      const r = await get<{ items: Json[] }>(`me/services/${s.id}/reports`);
      if (!isOn(t, 'REPORTS')) {
        expect([r.status, r.code], s.id).toEqual([403, 'MODULE_OFF']);
        continue;
      }
      expect(r.status, s.id).toBe(200);
      for (const report of r.body.items) {
        expect(report['publishedAt'], `${String(report['id'])} published`).toBeTruthy();
        expect(
          Object.keys(report).filter((k) => !allowed.includes(k)),
          'only the client fields',
        ).toEqual([]);
      }
    }
  });

  notLive(
    'BK-CP2 the client hears of a newly published report, as their Report Delivery says',
    'needs a Bookkeeping service on the harness client and a report taken through review to publish; reports and engagements have no delete',
  );

  test('BK-CP3 the bookkeeping terms page: only versions sent to this client, the portal version only', async ({
    page,
  }, info) => {
    const list = await ok<{ items: Json[] }>('me/bookkeeping-terms');
    expect(
      [...keysOf(list)].filter((k) => /internal|reason|history|staff/i.test(k)),
      'no internal field',
    ).toEqual([]);
    const other = randomUUID();
    expect((await get(`me/bookkeeping-terms/${other}`)).status, 'terms not theirs').toBe(404);
    const [s] = await statusOf(
      await clientSend('post', `me/bookkeeping-terms/${other}/decline`, {
        sentAt: new Date().toISOString(),
      }),
    );
    expect(s, 'answering terms not theirs').toBe(404);
    await open(page, portal('/services/bookkeeping-terms'), info);
    if (list.items.length)
      await expect(page.getByTestId('terms-row')).toHaveCount(list.items.length);
    else await expect(page.locator('main').first()).toContainText('No terms yet.');
    await shot(page, TAB, 'BK-CP3', info);
  });
  notLive(
    'BK-CP3 the client answers the terms the firm sent',
    'sending terms needs a Bookkeeping service on the harness client; engagements and terms versions have no delete',
  );
  notLive(
    "BK-CP4 each client's Portal Defaults decide what the portal shows",
    'needs a Bookkeeping service on the harness client (the defaults are per Bookkeeping client); engagements have no delete',
  );
  notLive(
    'TX-CP1 the firm asks for information and the portal tells the client',
    'it needs the firm to make a request (a write that emails and texts the client)',
  );

  // ---------- Invoices ----------

  test('IP-F02 an invoice shows the client its terms and notes, never the internal note', async ({
    page,
  }, info) => {
    const list = await get<{ items: Invoice[] }>('me/invoices');
    const id = list.status === 200 ? list.body.items[0]?.id : undefined;
    if (!id) {
      test.skip(true, `NO DATA: no invoice for this client (answer ${list.status})`);
      return;
    }
    const detail = await ok<{ notesToClient: string | null }>(`me/invoices/${id}`);
    expect(
      [...keysOf(detail)].filter((k) => /internal/i.test(k)),
      'no internal field',
    ).toEqual([]);
    await open(page, portal(`/invoices/${id}`), info);
    if (detail.notesToClient) {
      await expect(page.getByTestId('notes-to-client')).toContainText(detail.notesToClient);
    } else {
      await expect(page.getByTestId('notes-to-client')).toHaveCount(0);
    }
    await shot(page, TAB, 'IP-F02', info);
  });

  test('IP-041 the client can pay by every method the firm takes (paying itself is NOT LIVE)', async ({
    page,
  }, info) => {
    const list = await ok<{ items: Invoice[]; paymentsEnabled: boolean }>('me/invoices');
    await open(page, portal('/invoices'), info);
    const main = page.locator('main').first();
    if (!list.paymentsEnabled) {
      await expect(main.getByRole('button', { name: /^Pay .+ now$/ })).toHaveCount(0);
    }
    for (const invoice of list.items.filter((i) => i.canPay).slice(0, 3)) {
      await expect(
        main.getByRole('button', { name: `Pay ${invoice.number} now` }).first(),
      ).toBeVisible();
    }
    await shot(page, TAB, 'IP-041', info);
    notBuilt(
      'IP-041',
      'cards only (Stripe checkout); bank transfer (ACH) and PayPal are not offered',
    );
  });

  // ---------- Communications and automations ----------

  test('CM-F05 each page shows the announcement placed for it, or a dashboard one', async ({
    page,
  }, info) => {
    const t = await ok<Tabs>('me/tabs');
    const { items } = await ok<{ items: Announcement[] }>('me/announcements');
    const places: [path: string, place: string, area: string][] = [
      ['documents', 'documents', 'DOCUMENTS'],
      ['invoices', 'billing', 'INVOICES_PAYMENTS'],
    ];
    for (const [path, place, area] of places) {
      if (!isOn(t, area)) continue;
      await open(page, portal(`/${path}`), info);
      const card = page.getByTestId('announcement-card');
      const first = items.find((a) => a.where === place || a.where === 'dashboard');
      if (!first) await expect(card, path).toHaveCount(0);
      else {
        await expect(card, path).toBeVisible();
        if (first.title) await expect(card, path).toContainText(first.title);
      }
      await shot(page, TAB, `CM-F05-${path}`, info);
    }
  });

  test("CM-F08 an announcement's HTML is clean: no script, handlers or outside images", async () => {
    const { items } = await ok<{ items: Announcement[] }>('me/announcements');
    if (!items.length) {
      test.skip(true, 'NO DATA: no live announcement for this client');
      return;
    }
    const own = `/portal/${firmSlug}/email-images/`;
    for (const a of items) {
      expect(a.html, a.id).not.toMatch(/<(script|iframe|object|embed)\b/i);
      expect(a.html, a.id).not.toMatch(/\son[a-z]+\s*=/i);
      expect(a.html, a.id).not.toMatch(/javascript:/i);
      for (const [, src] of a.html.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/gi)) {
        const url = new URL(src ?? '', portalUrl);
        expect([url.origin, url.pathname.includes(own)], `${a.id} image ${src}`).toEqual([
          new URL(portalUrl).origin,
          true,
        ]);
      }
      for (const [, href] of a.html.matchAll(/\bhref="([^"]*)"/gi)) {
        expect(href ?? '', `${a.id} link`).not.toMatch(/^(http:|data:|javascript:)/i);
      }
    }
  });

  notLive(
    'AU-F26 an automation sends the client a portal message',
    'it needs the firm to run an automation (a write that messages the client)',
  );

  // ---------- Layout at 1165 and 390 px (pages CP-PT-02 does not open) ----------

  for (const path of NARROW_PAGES) {
    test(`@narrow page /${path} opens, reads well, no sideways scroll`, async ({ page }, info) => {
      await open(page, portal(`/${path}`), info);
      await expect(page).not.toHaveURL(/\/sign-in/);
      await expect(page.locator('main').first()).toBeVisible();
      await expect(page.getByText(/Something went wrong|Page not found/i)).toHaveCount(0);
      await expectNoSideScroll(page);
      await shot(page, TAB, `narrow-${path}`, info);
    });
  }

  for (const [path, list] of DETAIL_PAGES) {
    test(`@narrow page /${path}/<first item> opens, reads well, no sideways scroll`, async ({
      page,
    }, info) => {
      const answer = await get<unknown>(list);
      const id = answer.status === 200 ? firstId(answer.body) : undefined;
      if (!id) {
        test.skip(true, `NO DATA: no ${path} item for this client (answer ${answer.status})`);
        return;
      }
      await open(page, portal(`/${path}/${id}`), info);
      await expect(page).not.toHaveURL(/\/sign-in/);
      await expect(page.locator('main').first()).toBeVisible();
      await expect(page.getByText(/Something went wrong|Page not found/i)).toHaveCount(0);
      await expectNoSideScroll(page);
      await shot(page, TAB, `narrow-${path}-detail`, info);
    });
  }
});
