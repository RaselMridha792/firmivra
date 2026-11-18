import { randomUUID } from 'node:crypto';
import {
  expect,
  request,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { firmSlug, portalUrl } from './env';
import { apiAs, as, expectNoSideScroll, portal, portalApi, settled, shot } from './helpers';

/**
 * The client portal as the client sees it, live on dev (Test Firm B), signed in as qa-client-b
 * (QA Fixture Client 1, an Individual client). One test per row of the Client Portal Review One
 * check, which is kept outside the repo: rows by ID only.
 *
 * This login is also Octavia's, so every check is read-only: pages, menus and GET requests.
 * Nothing here submits, uploads, sends, books, pays, signs, changes a setting or marks anything
 * read. The Announcements page is never opened here (it counts each announcement as opened).
 *
 * - A row not built on origin/main fails with "NOT BUILT" (the lead wants the gaps visible).
 * - A built row whose check needs a write is skipped: "NOT LIVE" and the reason in its title.
 * - A firm-side row with nothing a client can see is skipped: "firm side" in its title.
 * - A row whose data this client lacks is skipped at run time: "NO DATA" and why.
 * - client-portal.spec.ts already covers the firm's module and CP-PT-01 to 03, including the
 *   @narrow layout of twelve portal pages; the @narrow tests here cover the other pages.
 */
const TAB = 'client-portal-client';
/** The origin/main commit the NOT BUILT rows were read from. */
const MAIN = 'c1740860a';
const C1 = '00000000-0000-4a28-8001-000000000002'; // QA Fixture Client 1, this login's client

type Json = Record<string, unknown>;
interface Answer<T> {
  status: number;
  code: string | undefined;
  body: T;
}
interface Tabs {
  tabs: Record<string, boolean>;
  more?: Record<string, boolean>;
  businessPortal?: boolean;
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
interface Prefs {
  channels: string[];
  smsStopped: boolean;
  items: {
    category: string;
    email: boolean;
    sms: boolean;
    locked: boolean;
    emailLocked: boolean;
  }[];
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
  branding: { primaryColor: string };
  signUpOpen: boolean;
  timezone: string;
}
interface Notice {
  category: string;
  title: string;
  createdAt: string;
  target?: { kind?: string; id?: string } | null;
}
interface Invoice {
  id: string;
  number: string;
  canPay: boolean;
}

/** The six folder tabs of My Client Portal: label, page, and the area that switches it. */
const FOLDERS: [label: string, path: string, area: string | null][] = [
  ['Intake Form', 'intake', 'INTAKE_FORMS'],
  ['Business Documents & Resources', 'business', null], // business clients only
  ['My Uploaded Documents', 'documents', 'DOCUMENTS'],
  ['Tax Returns', 'taxes', 'TAX_RETURNS'],
  ['Receipts & Invoices', 'invoices', 'INVOICES_PAYMENTS'],
  ['Messages and Notes', 'messages', 'MESSAGES'],
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
/** Each notification category's row name on My Profile. */
const CATEGORY_LABELS: Record<string, string> = {
  ACCOUNT: 'Account and security',
  DOCUMENTS: 'Documents',
  INTAKE: 'Intake forms',
  SERVICES: 'Services',
  MESSAGES: 'Messages and notes',
  APPOINTMENTS: 'Appointments',
  BILLING: 'Invoices and payments',
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

/** A row that is not built: the test fails with the row and what is missing. */
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
const exactly = (label: string) => new RegExp(`^\\s*${label}\\s*$`);

test.describe('the portal as the client: Review One rows', () => {
  test.use(as('client'));
  let api: APIRequestContext;
  test.beforeAll(async () => {
    api = await apiAs('client');
  });
  test.afterAll(async () => {
    await api.dispose();
  });

  /** GET as the client: a portal path ("me/tabs"), or a staff path ("business/..."). */
  async function get<T = Json>(path: string): Promise<Answer<T>> {
    const res = await api.get(path.startsWith('business/') ? path : portalApi(path));
    const body: unknown = await res.json().catch(() => null);
    const code = (body as { error?: { code?: string } } | null)?.error?.code;
    return { status: res.status(), code, body: body as T };
  }
  async function ok<T = Json>(path: string): Promise<T> {
    const answer = await get<T>(path);
    expect(answer.status, `GET ${path}`).toBe(200);
    return answer.body;
  }
  const notLive = (title: string, reason: string) =>
    test(`${title}: NOT LIVE (${reason})`, () => test.skip(true, `NOT LIVE: ${reason}`));
  const firmSide = (title: string, reason: string) =>
    test(`${title}: firm side (${reason})`, () => test.skip(true, `firm side only: ${reason}`));
  const gap = (row: string, title: string, what: string) =>
    test(`${row} NOT BUILT: ${title}`, () => notBuilt(row, what));

  // ---------- Settings > Client Portal, as far as the client can tell ----------

  test('CP-1 the staff preview of this client is refused to the client (Settings is firm side)', async () => {
    const res = await get(`business/client-portal/clients/${C1}/preview`);
    expect(refused(res.status), `the staff preview answered ${res.status}`).toBe(true);
  });

  test("CP-1s the firm's portal settings refuse the client's session", async () => {
    for (const path of ['business/settings/portal-tabs', 'business/settings/portal-contact']) {
      const res = await get(path);
      expect(refused(res.status), `${path} answered ${res.status}`).toBe(true);
    }
  });

  gap(
    'CP-1g',
    "the firm's own words on the portal's sign-in and sign-up buttons",
    'the portal info carries no firm text for its two buttons, so they keep the built-in words',
  );

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
    const anon = await request.newContext({ baseURL: `${portalUrl}/api/v1/` });
    try {
      expect((await anon.get(portalApi('me'))).status(), 'signed out').toBe(401);
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
  gap(
    'CP-3c',
    'a firm switch that turns portal announcements on and off',
    'the portal is not told of any such switch, and its announcement list never checks one',
  );

  test('CP-3d the client chooses email and text for announcements', async () => {
    const prefs = await ok<Prefs>('me/notification-preferences');
    expect(
      prefs.items.map((i) => i.category),
      `CP-3d NOT BUILT (origin/main ${MAIN}): no ANNOUNCEMENTS category in the client's notification preferences`,
    ).toContain('ANNOUNCEMENTS');
  });

  test('CP-3e email notices are always on, and the client cannot turn them off', async ({
    page,
  }, info) => {
    const prefs = await ok<Prefs>('me/notification-preferences');
    for (const item of prefs.items) {
      expect([item.email, item.emailLocked], item.category).toEqual([true, true]);
    }
    await open(page, portal('/profile'), info);
    await page.locator('summary').filter({ hasText: 'Notification Preferences' }).click();
    for (const item of prefs.items) {
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
      if (item.locked) await expect(box).toBeDisabled();
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

  gap(
    'CP-3h',
    "the Settings preview of a client's announcement choices and locks",
    'no preview exists, and it needs CP-1, CP-3c and CP-3d first',
  );
  gap(
    'CP-3i',
    'a firm switch for announcements on the client dashboard',
    'the dashboard card shows every live dashboard announcement; no firm switch exists',
  );

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

  test('CP-5a Business Documents & Resources has its own switch', async () => {
    const t = await ok<Tabs>('me/tabs');
    expect(
      Object.keys(t.tabs),
      `CP-5a NOT BUILT (origin/main ${MAIN}): the portal's tabs have no switch for Business Documents & Resources`,
    ).toContain('BUSINESS_RESOURCES');
  });
  gap('CP-5b', "the firm's own names for the tabs", "the tab names are fixed in the portal's code");
  gap('CP-5c', "the firm's order of the tabs", "the tab order is fixed in the portal's code");
  gap(
    'CP-5d',
    "the firm's custom tabs",
    'the portal has no custom tab, and no table or route for one',
  );
  gap(
    'CP-5e',
    'custom tabs only for the clients they target, checked by the API',
    'needs CP-5d first',
  );

  test('CP-5f a tab the firm turned off says nothing the client shared is removed', async ({
    page,
  }, info) => {
    const t = await ok<Tabs>('me/tabs');
    const off = FOLDERS.find(([, , area]) => area !== null && !isOn(t, area));
    if (!off) {
      test.skip(true, 'NOT LIVE: every tab is on for this client; turning one off is a firm write');
      return;
    }
    await open(page, portal(`/${off[1]}`), info);
    const main = page.locator('main').first();
    await expect(main).toContainText(`${off[0]} isn't available`);
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
    const folders = page.getByRole('navigation', { name: 'Portal folders' });
    for (const [label, , area] of FOLDERS) {
      const on = area ? isOn(t, area) : t.businessPortal !== false;
      await expect(folders.locator('a').filter({ hasText: exactly(label) }), label).toHaveCount(
        on ? 1 : 0,
      );
    }
    const menu = page.getByRole('navigation', { name: 'Main' }).first();
    for (const [label, area] of MENU) {
      await expect(menu.locator('a').filter({ hasText: label }), String(label)).toHaveCount(
        isOn(t, area) ? 1 : 0,
      );
    }
    await shot(page, TAB, 'CP-5g', info);
    for (const [label, path, area] of FOLDERS) {
      if (!area || isOn(t, area)) continue;
      await open(page, portal(`/${path}`), info);
      await expect(page.locator('main').first()).toContainText(`${label} isn't available`);
    }
  });

  gap(
    'CP-5h',
    "the Settings preview of a client's tab names, order and visibility",
    'the staff preview lists the menu without names or order, and Settings does not open it; needs CP-5b and CP-5c',
  );

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
    const tab = page
      .getByRole('navigation', { name: 'Portal folders' })
      .locator('a')
      .filter({ hasText: exactly('Business Documents & Resources') });
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

  gap(
    'A7',
    'each reminder the firm set on an appointment reaches the client by its channel',
    'the reminders are saved, but the job still sends one reminder per appointment',
  );
  notLive(
    'A8 the client confirms an appointment the firm booked',
    'confirming is a write on this login',
  );
  gap(
    'A9',
    "booking a service sends the client that service's intake form",
    'the required form is saved on the appointment type but never sent on booking',
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

  gap(
    'SP-1',
    "a package's page for clients, behind its link",
    'no public-link route for packages and no portal page for one',
  );
  gap(
    'T16',
    'the tasks the firm made visible, in the portal',
    'the portal has no task list and the API no client task route',
  );
  notLive(
    'B3/E10 a portal invitation link leads to sign-up',
    'it needs the firm to send an invitation (a write and an email)',
  );
  gap(
    'B10',
    'the client approves a business plan, again after each revision',
    'no client approval state and no portal route for advisory plans',
  );
  gap(
    'B28',
    'advisory resources sent to the portal as a secure link or PDF, with a preview',
    'resources go as a portal message or email, with no format choice or preview',
  );
  gap(
    'B32',
    'a note the firm shares reaches the client after a preview',
    "no way to share a note; the portal's Notes are the client's own notepad",
  );
  gap(
    'BA-CP',
    'the advisory items the firm marked visible, in the portal',
    'the client-visible flags are kept, but no portal route shows them',
  );
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

  gap(
    'BK-CP2',
    'the client hears of a newly published report, as their Report Delivery says',
    'publishing a report writes an audit entry only',
  );
  gap(
    'BK-CP3',
    'the client sees and answers the bookkeeping terms the firm sent',
    'sending the terms only changes their status; no portal route',
  );
  gap(
    'BK-CP4',
    "each client's portal defaults decide what the portal shows",
    'the defaults are stored, but nothing in the portal reads them',
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
