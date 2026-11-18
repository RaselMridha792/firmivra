import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { appUrl, firmSlug, portalUrl, shotsDir, statePath, type Role } from './env';
import {
  apiAs,
  app,
  as,
  expectNoSideScroll,
  hasLogin,
  portal,
  portalApi,
  settled,
  shot,
} from './helpers';

/**
 * Intake Forms, Review Two (Octavia, Nov 10) and its itemized checklist: one test per row, the
 * green ones too, live on dev as Test Firm B's Owner, Admin and Staff and the portal Client. Rows
 * are named by their IDs only. Screens as on origin/main (ae765f484): Require e-signature always on,
 * Make a New Link, Restore, notes, the portal list of published forms only.
 *
 * What a run makes, each named with the run tag ("LIVE-CHECK yyyymmddhhmm"):
 * - an active Custom Quote Tax Planning service (nothing bills) in the "LIVE-CHECK" category (found,
 *   or made once);
 * - one intake form for it, made by the API as a draft, then built, published and shared on the
 *   screens; the blank form of 17c; the copies of 18a and USABILITY-03;
 * - one lead with an SES simulator address, and one sent form: that form sent to that lead by Email.
 * "zz cleanup" archives the sent form, the forms and the lead (none has a delete), deletes the
 * service (archives it when it was used) and the category if the run made it.
 *
 * Sends go only to SES simulator addresses, read on the screen and on the lead's record just before
 * each click: the form's email to the lead (19a) and one follow-up (19b-i); Test Reminder Email only
 * when the Owner's own address is a simulator one (16a). Nothing is sent to QA Fixture Client 1
 * (Octavia's login): the portal rows only read what that login can already see.
 *
 * Firm-wide settings a row changes are put back in the same test (on the screen, then by the API in
 * a finally block). Publish in client portal (02b) is on only inside its own test.
 *
 * The run's tag and ids live in a file outside the repo (LIVE_SHOTS_DIR/intake-forms/.runs.json),
 * so a failed test that restarts the worker keeps them, and a run that stopped before its cleanup
 * is cleaned by the next run's first fixture call.
 */
test.describe.configure({ timeout: 180_000 });

const TAB = 'intake-forms';
const TZ = 'America/New_York';
const SIMULATOR = /@simulator\.amazonses\.com$/i;
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+*-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const LATER = 'Choose an expiration date and time later than now.';

/** One tag per run, kept across worker restarts (keyed by the runner's process id). */
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
const CATEGORY = 'LIVE-CHECK';
const SERVICE = `${runTag} Intake Service`;
const FORM = `${runTag} Intake`;
const BLANK = `${runTag} Blank`;
const COPY = `Copy of ${FORM}`;
const COPY_EDITED = `${runTag} Copy edited`;
const SECTION = `${runTag} Section`;
const SECTION_V2 = `${runTag} Section v2`;
const QUESTION = `${runTag} question`;
const SUCCESS = `${runTag} thank you (synthetic)`;
const LEAD_LAST = `${STAMP} Lead`;
const LEAD_NAME = `LIVE-CHECK ${LEAD_LAST}`;
const LEAD_EMAIL = `success+intake-${STAMP}@simulator.amazonses.com`;
const NOTIFY_EMAIL = `success+intake-${STAMP}-notify@simulator.amazonses.com`;
const NOTE = `${runTag} note (synthetic)`;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------------------------------------------------------------- the run's records

interface Ctx {
  tag: string;
  ownerId: string;
  ownerName: string;
  staffId: string;
  staffName: string;
  serviceId: string;
  /** Set when this run made the "LIVE-CHECK" category (other tabs' runs reuse it). */
  categoryMade: string;
  /** The run's form: made by the API, built, published and shared on the screens. */
  formId: string;
  /** The blank form 17c makes from the dashboard. */
  blankId: string;
  /** The copies 18a, 24c-i and USABILITY-03 make. */
  copyIds: string[];
  leadId: string;
  /** The form sent to the lead (19a). */
  recordId: string;
  /** Set on an earlier run's entry once its cleanup left nothing. */
  cleaned?: boolean;
}
const blankCtx = (tag = runTag): Ctx => ({
  tag,
  ownerId: '',
  ownerName: '',
  staffId: '',
  staffName: '',
  serviceId: '',
  categoryMade: '',
  formId: '',
  blankId: '',
  copyIds: [],
  leadId: '',
  recordId: '',
});
const registryFile = () => join(shotsDir(TAB), '.runs.json');
function readRegistry(): Ctx[] {
  try {
    return (JSON.parse(readFileSync(registryFile(), 'utf8')) as Partial<Ctx>[]).map((x) => ({
      ...blankCtx(x.tag ?? ''),
      ...x,
    }));
  } catch {
    return [];
  }
}
function saveCtx(c: Ctx) {
  const all = readRegistry();
  const i = all.findIndex((x) => x.tag === c.tag);
  if (i >= 0) all[i] = c;
  else all.push(c);
  writeFileSync(registryFile(), JSON.stringify(all, null, 2));
}
const readCtx = (): Ctx => readRegistry().find((x) => x.tag === runTag) ?? blankCtx();
function addCopy(id: string) {
  const c = readCtx();
  if (!c.copyIds.includes(id)) saveCtx({ ...c, copyIds: [...c.copyIds, id] });
}

// ---------------------------------------------------------------- the API (setup and cleanup)

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- API JSON in a live check; each use reads only the fields it needs
type Json = any;
interface Res {
  ok(): boolean;
  status(): number;
  json(): Promise<Json>;
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
type Member = Exclude<Role, 'client'>;

/**
 * Refreshes the member's saved session when its access token has expired (as the app does on a
 * 401) and saves the new cookies back, so a page test starts signed in.
 */
async function freshSession(browser: Browser, role: Member): Promise<void> {
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
    if (!r.ok()) throw new Error(`${role} session refresh failed (${r.status()})`);
    const cookies = (await ctx.storageState()).cookies;
    const saved = JSON.parse(readFileSync(statePath(role), 'utf8')) as Record<string, unknown>;
    writeFileSync(statePath(role), JSON.stringify({ ...saved, cookies }, null, 2));
  } finally {
    await ctx.close();
  }
}

/** The member's API through a browser context; a call that answers 401 refreshes and retries. */
async function roleApi(browser: Browser, role: Member): Promise<Api> {
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

async function ok(res: Res, what: string): Promise<Json> {
  if (!res.ok()) throw new Error(`${what}: ${res.status()} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
const itemsOf = (body: Json): Json[] => (Array.isArray(body) ? body : (body?.items ?? []));

async function withOwner<T>(browser: Browser, run: (api: Api) => Promise<T>): Promise<T> {
  const api = await roleApi(browser, 'owner');
  try {
    return await run(api);
  } finally {
    await api.dispose();
  }
}

/**
 * Finds the run's records, or makes them: who is who, the category and service, the run's form (a
 * draft with one section and one question) and the lead. Saved after each, so a restarted worker
 * resumes. An earlier run that stopped before its cleanup is cleaned first. Owner tests only.
 */
async function fixture(browser: Browser): Promise<Ctx> {
  const c = readCtx();
  if (c.ownerId && c.serviceId && c.formId && c.leadId) return c;
  return withOwner(browser, async (api) => {
    let freshService = false;
    if (!c.ownerId) {
      for (const run of readRegistry().filter((r) => r.tag !== runTag && !r.cleaned)) {
        const left: string[] = [];
        await cleanRun(api, run, [], left);
        if (!left.length) saveCtx({ ...run, cleaned: true });
        else console.warn(`EARLIER RUN ${run.tag} left: ${left.join('; ')}`);
      }
      const me = await ok(await api.get('me'), 'me');
      c.ownerId = me.user.id as string;
      c.ownerName = me.user.name as string;
      if (hasLogin('staff')) {
        const s = await roleApi(browser, 'staff');
        try {
          const sm = await ok(await s.get('me'), 'staff me');
          c.staffId = sm.user.id as string;
          c.staffName = sm.user.name as string;
        } finally {
          await s.dispose();
        }
      }
      saveCtx(c);
    }
    if (!c.serviceId) {
      const cats = itemsOf(await ok(await api.get('business/catalog/categories'), 'categories'));
      let categoryId = cats.find((x: Json) => x.name === CATEGORY)?.id as string | undefined;
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
      const found = itemsOf(
        await ok(
          await api.get(`business/catalog/services?search=${encodeURIComponent(STAMP)}`),
          'services',
        ),
      ).find((s: Json) => s.name === SERVICE);
      c.serviceId = (found?.id as string | undefined) ?? '';
      if (!c.serviceId) {
        // Active (a shared link and the portal list need it); Custom Quote, so nothing bills.
        const made = await ok(
          await api.post('business/catalog/services', {
            name: SERVICE,
            categoryId,
            shortDescription: 'Live check fixture (synthetic), removed by the run',
            kind: 'TAX_PLANNING',
            pricingType: 'CUSTOM_QUOTE',
            activate: true,
            allowDuplicateName: true,
          }),
          'service',
        );
        c.serviceId = made.id as string;
        freshService = true;
      }
      saveCtx(c);
    }
    if (!c.formId) {
      // The form is made before anything lists the library: a listing gives a service with no
      // form its built-in one (ensureBuiltIns), which the run would then have to archive too.
      const tagged = freshService
        ? null
        : await api.get(`business/intake-forms?templates=all&search=${encodeURIComponent(FORM)}`);
      const found = tagged?.ok()
        ? itemsOf(await tagged.json()).find((f: Json) => f.name === FORM)
        : undefined;
      c.formId = (found?.id as string | undefined) ?? '';
      if (!c.formId) {
        const made = await ok(
          await api.post('business/intake-forms', {
            name: FORM,
            category: 'TAX_PLANNING',
            serviceId: c.serviceId,
            description: 'Live check form (synthetic): nothing to fill in.',
            internalNotes: `${runTag} internal note (synthetic)`,
            isTemplate: false,
            startFrom: { kind: 'SCRATCH' },
            sections: [
              {
                key: 'liveSection',
                title: SECTION,
                description: null,
                questions: [
                  {
                    key: 'liveAnswer',
                    type: 'SHORT_ANSWER',
                    label: QUESTION,
                    help: null,
                    required: false,
                  },
                ],
              },
            ],
            settings: {
              requireAllQuestions: false,
              allowFileUploads: true,
              showProgressBar: true,
              expiresAfterDays: null,
              successMessage: null,
            },
          }),
          'form',
        );
        c.formId = made.id as string;
      }
      saveCtx(c);
    }
    if (!c.leadId) {
      if (!SIMULATOR.test(LEAD_EMAIL)) throw new Error('the lead address is not a simulator one');
      const made = await api.post('business/leads', {
        firstName: 'LIVE-CHECK',
        lastName: LEAD_LAST,
        email: LEAD_EMAIL,
        source: 'OTHER',
        sourceDetail: `${runTag} synthetic`,
        priority: 'WARM',
        serviceIds: [c.serviceId],
        // The Owner's, so Staff reach the sent form only once it is assigned to them (23-i).
        assignedUserId: c.ownerId,
        allowDuplicate: true,
      });
      if (made.ok()) {
        c.leadId = (await made.json()).id as string;
      } else {
        const found = itemsOf(
          await ok(
            await api.get(
              `business/leads/pipeline?search=${encodeURIComponent(STAMP)}&pageSize=100`,
            ),
            'find lead',
          ),
        ).find((l: Json) => l.lastName === LEAD_LAST);
        if (!found) await ok(made, 'create lead');
        c.leadId = found.id as string;
      }
      saveCtx(c);
    }
    return c;
  });
}

/** Removes one run's records (by its tag). Returns what it did and what it could not do. */
async function cleanRun(api: Api, c: Ctx, done: string[], left: string[]) {
  const stamp = c.tag.slice('LIVE-CHECK '.length);
  if (!/^\d{12}$/.test(stamp)) {
    left.push(`"${c.tag}" is not a run tag`);
    return;
  }
  const mine = (s: unknown) => typeof s === 'string' && s.includes(stamp);
  const q = encodeURIComponent(stamp);
  // The sent forms: archived (they have no delete); an archived form takes no reminder.
  const recIds = new Set<string>(c.recordId ? [c.recordId] : []);
  const recs = await api.get(`business/intakes?tab=all&search=${q}&pageSize=100`);
  if (recs.ok()) {
    for (const r of itemsOf(await recs.json())) {
      if (mine(r.form?.name) || mine(r.recipient?.name)) recIds.add(r.id as string);
    }
  } else {
    left.push(`sent forms: list ${recs.status()}`);
  }
  for (const id of recIds) {
    const r = await api.post(`business/intakes/${id}/archive`);
    (r.ok() || r.status() === 409 ? done : left).push(`sent form ${id}: archive ${r.status()}`);
  }
  // The forms: archived (no delete); archiving turns the share link and the portal off. The
  // search also matches the service's name, so a built-in form the library gave the run's
  // service (ensureBuiltIns) is archived too.
  const formIds = new Set<string>([c.formId, c.blankId, ...c.copyIds].filter(Boolean));
  const forms = await api.get(`business/intake-forms?templates=all&search=${q}`);
  if (forms.ok()) {
    for (const f of itemsOf(await forms.json())) {
      if (mine(f.name) || mine(f.service?.name)) formIds.add(f.id as string);
    }
  } else {
    left.push(`forms: list ${forms.status()}`);
  }
  for (const id of formIds) {
    const r = await api.post(`business/intake-forms/${id}/archive`);
    (r.ok() || r.status() === 409 || r.status() === 404 ? done : left).push(
      `form ${id}: archive ${r.status()}`,
    );
  }
  // The lead: archived (no delete).
  const leadIds = new Set<string>(c.leadId ? [c.leadId] : []);
  const leads = await api.get(`business/leads/pipeline?search=${q}&pageSize=100`);
  if (leads.ok()) {
    for (const l of itemsOf(await leads.json())) {
      if (mine(l.lastName) || mine(l.firstName)) leadIds.add(l.id as string);
    }
  } else {
    left.push(`leads: list ${leads.status()}`);
  }
  if (leadIds.size) {
    const r = await api.post('business/leads/bulk', { action: 'ARCHIVE', ids: [...leadIds] });
    (r.ok() ? done : left).push(`lead archive ${[...leadIds].join(', ')} (${r.status()})`);
  }
  // The service: deleted, or archived when its forms or the lead still name it.
  const svcIds = new Set<string>(c.serviceId ? [c.serviceId] : []);
  const svcs = await api.get(`business/catalog/services?search=${q}`);
  if (svcs.ok()) {
    for (const s of itemsOf(await svcs.json())) if (mine(s.name)) svcIds.add(s.id as string);
  }
  for (const id of svcIds) {
    const del = await api.delete(`business/catalog/services/${id}`);
    if (del.ok() || del.status() === 404) {
      done.push(`service ${id}: delete ${del.status()}`);
    } else {
      const ar = await api.post(`business/catalog/services/${id}/archive`);
      (ar.ok() || ar.status() === 409 ? done : left).push(
        `service ${id}: delete ${del.status()}, archive ${ar.status()}`,
      );
    }
  }
  if (c.categoryMade) {
    const r = await api.delete(`business/catalog/categories/${c.categoryMade}`);
    (r.ok() || r.status() === 404 ? done : left).push(`category ${CATEGORY}: delete ${r.status()}`);
  }
  // Anything of the run still open.
  const formsAfter = await api.get(`business/intake-forms?templates=all&search=${q}`);
  if (formsAfter.ok()) {
    for (const f of itemsOf(await formsAfter.json())) {
      if (mine(f.name) || mine(f.service?.name)) {
        left.push(`form "${f.name}" (${f.id}) still in the library`);
      }
    }
  }
  const recsAfter = await api.get(`business/intakes?tab=all&search=${q}&pageSize=100`);
  if (recsAfter.ok()) {
    for (const r of itemsOf(await recsAfter.json())) {
      if (mine(r.form?.name) || mine(r.recipient?.name)) left.push(`sent form ${r.id} still open`);
    }
  }
}

// ---------------------------------------------------------------- settings by the API

/** Puts firm-wide intake settings back (only when they differ), with the current version. */
async function restoreSettings(
  api: Api,
  differs: (s: Json) => boolean,
  patch: Record<string, unknown>,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const now = await ok(await api.get('business/intake-settings'), 'intake settings');
    if (!differs(now)) return;
    const res = await api.put('business/intake-settings', { version: now.version, ...patch });
    if (res.ok()) return;
    if (res.status() !== 409) {
      throw new Error(
        `put the intake settings back: ${res.status()} ${(await res.text()).slice(0, 200)}`,
      );
    }
  }
  throw new Error('put the intake settings back: version conflict twice');
}

// ---------------------------------------------------------------- page helpers

const note = (info: TestInfo, type: string, description: string) => {
  info.annotations.push({ type, description });
  console.warn(`${type}: ${info.title}: ${description}`);
};

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
  await expect(page).not.toHaveURL(/\/sign-in/);
  await settled(page);
}

/** YYYY-MM-DD in the firm's zone, `days` from today. */
const firmDay = (days: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(
    new Date(Date.now() + days * 86_400_000),
  );

/** Every address in a text must be an SES simulator one (and there must be one). */
function expectSimulatorOnly(addresses: (string | null | undefined)[], what: string) {
  const list = addresses.filter((a): a is string => Boolean(a));
  expect(list.length, `${what}: no address to check`).toBeGreaterThan(0);
  for (const a of list) {
    expect(SIMULATOR.test(a.trim()), `${what}: an address is not an SES simulator one`).toBe(true);
  }
}

/** The lead's record: its email and every other email saved on it, all simulator addresses. */
async function checkLeadRecord(browser: Browser, c: Ctx) {
  await withOwner(browser, async (api) => {
    const p = await ok(await api.get(`business/leads/${c.leadId}/profile`), 'lead profile');
    const others = ((p.otherContacts ?? []) as { kind: string; value: string }[])
      .filter((x) => x.kind === 'EMAIL')
      .map((x) => x.value);
    expectSimulatorOnly([p.email as string, ...others], 'the lead record');
  });
}

async function formStatus(browser: Browser, id: string): Promise<string> {
  if (!id) return '';
  return withOwner(browser, async (api) => {
    const r = await api.get(`business/intake-forms/${id}`);
    return r.ok() ? ((await r.json()).status as string) : '';
  });
}

/**
 * Setup for a row run on its own (a -g rerun): the run's form, published by the API when 17b did
 * not publish it on the screen. Owner API; publishing sends nothing.
 */
async function publishedFixture(browser: Browser): Promise<Ctx> {
  const c = await fixture(browser);
  if ((await formStatus(browser, c.formId)) === 'DRAFT') {
    await withOwner(browser, async (api) =>
      ok(await api.post(`business/intake-forms/${c.formId}/publish`), 'publish the run form'),
    );
  }
  return readCtx();
}

/**
 * Setup for a row run on its own: the run's form sent to the run's lead, by the API when 19a did
 * not send it on the screen (a form sent earlier in the run is found, never sent twice). The one
 * send: the form's email to the lead's SES simulator address, checked on its record first;
 * assigned to the Owner, reminders off, no copy to the member.
 */
async function sentFixture(browser: Browser): Promise<Ctx> {
  const c = await publishedFixture(browser);
  if (c.recordId) return c;
  const recordId = await withOwner(browser, async (api) => {
    const q = encodeURIComponent(STAMP);
    const rows = itemsOf(
      await ok(await api.get(`business/intakes?tab=all&search=${q}&pageSize=100`), 'sent forms'),
    );
    const earlier = rows.find((r: Json) => r.recipient?.id === c.leadId)?.id as string | undefined;
    if (earlier) return earlier;
    const p = await ok(await api.get(`business/leads/${c.leadId}/profile`), 'lead profile');
    const others = ((p.otherContacts ?? []) as { kind: string; value: string }[])
      .filter((x) => x.kind === 'EMAIL')
      .map((x) => x.value);
    expectSimulatorOnly([p.email as string, ...others], 'the lead record');
    const sent = await ok(
      await api.post('business/intakes/send', {
        idempotencyKey: randomUUID(),
        recipient: { kind: 'LEAD', id: c.leadId },
        formId: c.formId,
        channel: 'EMAIL',
        subject: `${runTag} intake form`,
        message: 'Live check (synthetic): nothing needs filling in.',
        // 5:00 PM in the firm's zone (EST until March), two days on.
        expiresAt: new Date(`${firmDay(2)}T17:00:00-05:00`).toISOString(),
        assignedUserId: c.ownerId,
        reminders: { enabled: false },
        allowSaveAndContinue: true,
        sendMeCopy: false,
      }),
      'send the run form to the lead',
    );
    expectSimulatorOnly([sent.delivery?.to as string], 'the address the send names');
    return sent.form.id as string;
  });
  saveCtx({ ...readCtx(), recordId });
  return readCtx();
}

/** A browser of someone with no session (a website visitor). */
async function visitor(browser: Browser, width = 1165) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
  return { ctx, page: await ctx.newPage() };
}

/** The portal client's browser (QA Fixture Client 1's login: read only). */
async function clientBrowser(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const a = await apiAs('client'); // refreshes the saved session
  await a.dispose();
  const ctx = await browser.newContext({
    storageState: statePath('client'),
    viewport: { width: 1165, height: 900 },
  });
  return { ctx, page: await ctx.newPage() };
}

/** Client 1's intake notices, newest first (read only: listing marks nothing read). */
async function clientIntakeNotices(): Promise<
  { title: string; readAt: string | null; target: { kind: string; id: string } }[]
> {
  const api = await apiAs('client');
  try {
    const body = await ok(await api.get(portalApi('me/notifications?limit=50')), 'notices');
    return itemsOf(body).filter((n: Json) => n.target?.kind === 'intake');
  } finally {
    await api.dispose();
  }
}

/** Sets a switch (role switch, aria-checked) to on or off. */
async function setSwitch(sw: Locator, on: boolean) {
  if ((await sw.getAttribute('aria-checked')) !== String(on)) await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', String(on));
}

// Intake Form Settings
const HIDE_OWN_EMAIL = '[data-testid="test-reminder-destination"]{visibility:hidden}';
async function settingsReady(page: Page) {
  await expect(page.getByRole('switch', { name: 'Allow save and resume' })).toBeVisible({
    timeout: 60_000,
  });
  // The member's own sign-in address shows under Test Reminder Email: kept out of screenshots.
  await page.addStyleTag({ content: HIDE_OWN_EMAIL });
}
async function openSettings(page: Page, info: TestInfo) {
  await open(page, app('/intake-forms/settings'), info);
  await settingsReady(page);
}
async function reloadSettings(page: Page) {
  await page.reload();
  await settled(page);
  await settingsReady(page);
}
async function saveSettings(page: Page) {
  await page.getByRole('button', { name: 'Save Changes' }).first().click();
  await expect(page.getByText('Your intake settings were saved.')).toBeVisible();
}
/** A settings row by its label (the label and what sits beside it). */
const settingRow = (page: Page, label: string) =>
  page.locator('span, label').filter({ hasText: label }).first();

// Dashboard
async function openList(page: Page, info: TestInfo) {
  await open(page, app('/intake-forms'), info);
  await expect(page.getByTestId('page-title')).toHaveText('Intake Forms', { timeout: 60_000 });
}
const searchBox = (page: Page) => page.getByPlaceholder('Search forms...');
const listTable = (page: Page) => page.getByRole('table', { name: 'Client intake forms' });
/** The list's total as the screen says it ("Showing 1 – 8 of 17 forms"), 0 when empty, -1 while loading. */
async function shownTotal(page: Page): Promise<number> {
  if (await page.getByRole('status', { name: /^Loading Client intake forms/ }).count()) return -1;
  if (
    await page
      .getByText(/^(No matching forms|No intake forms yet)$/)
      .first()
      .isVisible()
  )
    return 0;
  const s = page.getByText(/^Showing \d+ – \d+ of \d+ forms$/).first();
  if (!(await s.isVisible())) return -1;
  return Number(/of (\d+) forms/.exec(await s.innerText())?.[1] ?? -1);
}
async function expectTotal(page: Page, n: number, what: string) {
  await expect.poll(() => shownTotal(page), { message: what, timeout: 30_000 }).toBe(n);
}
async function searchList(page: Page, text: string) {
  await searchBox(page).fill(text);
  await page.waitForLoadState('networkidle').catch(() => {});
}

// Library (Form Templates)
async function openLibrary(page: Page, info: TestInfo, search = '') {
  await open(page, app('/intake-forms/templates'), info);
  await expect(page.getByRole('heading', { level: 1, name: 'Form Templates' })).toBeVisible({
    timeout: 60_000,
  });
  if (search) await page.getByRole('searchbox', { name: 'Search templates' }).fill(search);
  await expect(page.getByTestId('template-grid').locator('[aria-busy="true"]')).toHaveCount(0);
}
const cardOf = (page: Page, name: string) =>
  page
    .getByTestId('template-card')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });
async function cardAction(page: Page, name: string, item: string) {
  await cardOf(page, name)
    .getByRole('button', { name: `Actions for ${name}` })
    .click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}
/** Share & Publish for a form, from its library card. */
async function openShare(page: Page, name: string) {
  await cardAction(page, name, 'Share & Publish');
  const share = page.getByRole('dialog', { name }).getByTestId('form-share');
  await expect(share).toBeVisible();
  return share;
}
async function closeShare(page: Page, name: string) {
  await page.getByRole('dialog', { name }).getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog', { name })).toBeHidden();
}

// Builder
const builderUrl = (id: string, sub = '') => app(`/intake-forms/builder/${id}${sub}`);
const formNameField = (page: Page) => page.getByLabel(/^Form Name/);
async function openBuilder(page: Page, id: string, info: TestInfo) {
  await open(page, builderUrl(id), info);
  await expect(formNameField(page)).toBeVisible({ timeout: 60_000 });
}
const builderStatus = (page: Page) => page.getByTestId('builder-status');
/** The form id in a builder address (/intake-forms/builder/{id}[/tab]). */
const builderId = (url: string) =>
  new RegExp(`/intake-forms/builder/(${UUID})`).exec(new URL(url).pathname)?.[1] ?? '';

// Send Intake Form
const summaryRow = (page: Page, label: string) =>
  page.getByTestId('send-summary').locator('div').filter({ hasText: label }).first();
async function openSend(page: Page, c: Ctx, info: TestInfo) {
  await open(page, app(`/intake-forms/send?formId=${c.formId}&leadId=${c.leadId}`), info);
  await expect(page.getByRole('heading', { level: 1, name: 'Send Intake Form' })).toBeVisible({
    timeout: 60_000,
  });
  await expect(summaryRow(page, 'Recipient')).toContainText(LEAD_NAME, { timeout: 60_000 });
  await expect(summaryRow(page, 'Form Name')).toContainText(FORM);
}
/** Every address the send can reach: the Delivery Method on the screen and the lead's record. */
async function checkRecipients(page: Page, browser: Browser, c: Ctx) {
  const onScreen = (await page.getByTestId('send-delivery').innerText()).match(EMAIL_IN_TEXT);
  expectSimulatorOnly(onScreen ?? [], 'Delivery Method on the screen');
  await checkLeadRecord(browser, c);
  const copy = page.getByRole('checkbox', { name: 'Send me a copy of the email' });
  if (await copy.count()) await copy.setChecked(false);
}

// The sent form
const recordUrl = (id: string, sub = '') => app(`/intake-forms/${id}${sub}`);
async function openRecord(page: Page, id: string, info: TestInfo, sub = '') {
  await open(page, recordUrl(id, sub), info);
  await expect(page.getByTestId('client-card')).toContainText(LEAD_NAME, { timeout: 60_000 });
}
async function moreAction(page: Page, item: string) {
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

const inView = async (locator: Locator) => {
  const box = await locator.boundingBox();
  const width = locator.page().viewportSize()!.width;
  return !!box && box.x >= 0 && box.x + box.width <= width + 1;
};

// ================================================================ Intake Form Settings (Owner)

test.describe('Intake Form Settings (Owner)', () => {
  test.use(as('owner'));
  test.skip(() => !hasLogin('owner'), 'no owner login');

  test('8 the five Edit links each open their own panel', async ({ page }, info) => {
    await openSettings(page, info);
    for (const title of [
      'Edit General Settings',
      'Edit Client Experience',
      'Edit Notifications & Reminders',
      'Edit Automation Rules',
      'Edit Security & Compliance',
    ]) {
      await page.getByRole('button', { name: title, exact: true }).click();
      const panel = page.getByRole('dialog', { name: title });
      await expect(panel).toBeVisible();
      await shot(page, TAB, `8-${title}`, info);
      await panel.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(panel).toBeHidden();
    }
  });

  test('15a Submission Rules opens its own panel with its rules', async ({ page }, info) => {
    await openSettings(page, info);
    await page
      .getByRole('navigation', { name: 'Settings categories' })
      .getByRole('button', { name: 'Submission Rules', exact: true })
      .click();
    const panel = page.getByRole('dialog', { name: 'Submission Rules' });
    await expect(panel).toBeVisible();
    for (const name of ['Consent checkbox required', 'Allow save and resume'])
      await expect(panel.getByRole('switch', { name })).toBeVisible();
    await expect(panel.getByRole('combobox', { name: 'Default form expiration' })).toBeVisible();
    await expect(panel).toContainText('Require e-signature');
    await expect(panel.getByTestId('submission-rules')).toContainText(
      'After a client submits, the answers are locked for them.',
    );
    await expect(page.getByText('Go to General Settings')).toHaveCount(0);
    await shot(page, TAB, '15a-submission-rules', info);
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
  });

  test('2 Notify assigned staff member saves, survives a reload and shows in Recent Changes; put back', async ({
    page,
    browser,
  }, info) => {
    const api = await roleApi(browser, 'owner');
    const before = (await ok(await api.get('business/intake-settings'), 'settings')).notifications
      .notifyAssignedStaff as boolean;
    try {
      await openSettings(page, info);
      const sw = page.getByRole('switch', { name: 'Notify assigned staff member' });
      await expect(sw).toHaveAttribute('aria-checked', String(before));
      await sw.click();
      await expect(page.getByTestId('unsaved')).toBeVisible();
      await saveSettings(page);
      await reloadSettings(page);
      await expect(sw).toHaveAttribute('aria-checked', String(!before));
      await expect(page.getByTestId('recent-changes')).toContainText('Changed notifications');
      await shot(page, TAB, '2-notifications-saved', info);
      await sw.click();
      await saveSettings(page);
      await expect(sw).toHaveAttribute('aria-checked', String(before));
    } finally {
      await restoreSettings(api, (s) => s.notifications.notifyAssignedStaff !== before, {
        notifications: { notifyAssignedStaff: before },
      });
      await api.dispose();
    }
  });

  test('3 Route by service type saves and survives a reload; put back', async ({
    page,
    browser,
  }, info) => {
    const api = await roleApi(browser, 'owner');
    const before = (await ok(await api.get('business/intake-settings'), 'settings')).automation
      .routeByServiceType as boolean;
    try {
      await openSettings(page, info);
      const sw = page.getByRole('switch', { name: 'Route by service type' });
      await expect(sw).toHaveAttribute('aria-checked', String(before));
      await sw.click();
      await saveSettings(page);
      await reloadSettings(page);
      await expect(sw).toHaveAttribute('aria-checked', String(!before));
      await expect(page.getByTestId('recent-changes')).toContainText('Changed automation');
      await shot(page, TAB, '3-automation-saved', info);
      await sw.click();
      await saveSettings(page);
      await expect(sw).toHaveAttribute('aria-checked', String(before));
    } finally {
      await restoreSettings(api, (s) => s.automation.routeByServiceType !== before, {
        automation: { routeByServiceType: before },
      });
      await api.dispose();
    }
  });

  test('5 Consent checkbox required saves and survives a reload; the accepted types show; put back', async ({
    page,
    browser,
  }, info) => {
    const api = await roleApi(browser, 'owner');
    const s0 = await ok(await api.get('business/intake-settings'), 'settings');
    const before = s0.security.consentRequired as boolean;
    try {
      await openSettings(page, info);
      const types = page.getByRole('button', { name: /^Accepted file types/ }).first();
      for (const type of s0.security.acceptedFileTypes as string[])
        await expect(types).toContainText(type);
      await types.click();
      const picker = page.getByRole('dialog', { name: 'Accepted file types' });
      for (const type of s0.security.acceptedFileTypes as string[])
        await expect(picker.getByRole('checkbox', { name: type, exact: true })).toBeChecked();
      await picker.getByRole('button', { name: 'Done' }).click();
      await expect(page.getByTestId('unsaved')).toHaveCount(0);
      const sw = page.getByRole('switch', { name: 'Consent checkbox required' });
      await expect(sw).toHaveAttribute('aria-checked', String(before));
      await sw.click();
      await saveSettings(page);
      await reloadSettings(page);
      await expect(sw).toHaveAttribute('aria-checked', String(!before));
      await expect(page.getByTestId('recent-changes')).toContainText('Changed security');
      await shot(page, TAB, '5-security-saved', info);
      await sw.click();
      await saveSettings(page);
      await expect(sw).toHaveAttribute('aria-checked', String(before));
    } finally {
      await restoreSettings(api, (s) => s.security.consentRequired !== before, {
        security: { consentRequired: before },
      });
      await api.dispose();
    }
  });

  test('10a 10b 10c reminders: First up to 30 days after sending, Final from 5 minutes before expiry; both save and survive a reload; put back', async ({
    page,
    browser,
  }, info) => {
    const api = await roleApi(browser, 'owner');
    const n0 = (await ok(await api.get('business/intake-settings'), 'settings')).notifications;
    const first0 = n0.firstReminderAfterMinutes as number | null;
    const final0 = n0.finalReminderAfterMinutes as number | null;
    try {
      await openSettings(page, info);
      const first = page.getByRole('combobox', { name: 'First reminder' });
      const final = page.getByRole('combobox', { name: 'Final reminder' });
      await expect(page.getByTestId('reminder-rule')).toContainText(
        'the final one back from when it expires',
      );
      const firsts = await first.locator('option').allInnerTexts();
      for (const want of [
        'No reminders',
        '5 minutes after sending',
        '12 hours after sending',
        '21 days after sending',
        '30 days after sending',
      ])
        expect(firsts, `First reminder offers "${want}"`).toContain(want);
      await first.selectOption('43200');
      await expect(final).toBeEnabled();
      const finals = await final.locator('option').allInnerTexts();
      expect(finals[0], 'the Final list starts at 5 minutes').toBe('5 minutes before expiry');
      expect(finals).toContain('60 days before expiry');
      await final.selectOption('5');
      await saveSettings(page);
      await reloadSettings(page);
      await expect(first).toHaveValue('43200');
      await expect(final).toHaveValue('5');
      await shot(page, TAB, '10-reminders-saved', info);
    } finally {
      await restoreSettings(
        api,
        (s) =>
          s.notifications.firstReminderAfterMinutes !== first0 ||
          s.notifications.finalReminderAfterMinutes !== final0,
        {
          notifications: {
            firstReminderAfterMinutes: first0,
            finalReminderAfterMinutes: final0,
          },
        },
      );
      await api.dispose();
    }
  });

  test('11 expiration alert: No alert, 30 minutes and 1, 2, 3, 5, 6, 10, 12, 24, 42 and 72 hours before expiry', async ({
    page,
  }, info) => {
    await openSettings(page, info);
    const options = await page
      .getByRole('combobox', { name: 'Expiration alert' })
      .locator('option')
      .allInnerTexts();
    const hours = [1, 2, 3, 5, 6, 10, 12, 24, 42, 72].map(
      (h) => `${h} hour${h === 1 ? '' : 's'} before expiry`,
    );
    for (const want of ['No alert', '30 minutes before expiry', ...hours])
      expect(options, `Expiration alert offers "${want}"`).toContain(want);
    expect(options).not.toContain('48 hours before expiry');
    await shot(page, TAB, '11-alert-options', info);
  });

  test('12a intake file size: 50 MB and 100 MB save and survive a reload; put back', async ({
    page,
    browser,
  }, info) => {
    const api = await roleApi(browser, 'owner');
    const before = (await ok(await api.get('business/intake-settings'), 'settings')).security
      .maxFileSizeMb as number;
    try {
      await openSettings(page, info);
      const size = page.getByRole('combobox', { name: 'Max file size per file' });
      const offered = await size.locator('option').allInnerTexts();
      for (const mb of [2, 5, 10, 50, 100]) expect(offered).toContain(`${mb} MB`);
      for (const mb of [50, 100]) {
        await size.selectOption(String(mb));
        await saveSettings(page);
        await reloadSettings(page);
        await expect(size).toHaveValue(String(mb));
        await shot(page, TAB, `12a-${mb}-mb`, info);
      }
    } finally {
      await restoreSettings(api, (s) => s.security.maxFileSizeMb !== before, {
        security: { maxFileSizeMb: before },
      });
      await api.dispose();
    }
  });

  test('13a 23-h encryption and e-signature both read "Always on", and neither is a switch', async ({
    page,
  }, info) => {
    await openSettings(page, info);
    await expect(page.getByText('Encrypted file uploads', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Always on', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('switch', { name: /encrypted/i })).toHaveCount(0);
    await expect(page.getByRole('switch', { name: 'Require e-signature' })).toHaveCount(0);
    await expect(
      page.getByText(/each submission signs your firm.s agreements/).first(),
    ).toBeVisible();
    await shot(page, TAB, '13a-always-on', info);
  });

  test('14a Apply to all saves whole years and survives a reload; 0 is refused on its field; put back', async ({
    page,
    browser,
  }, info) => {
    const api = await roleApi(browser, 'owner');
    const before = (await ok(await api.get('business/intake-settings'), 'settings')).security
      .dataRetentionYears as number | null;
    if (before !== null && before > 30) {
      await api.dispose();
      test.skip(
        true,
        'Apply to all holds a value over 30 saved before 14b: it could not be put back as it is',
      );
    }
    const target = before === 7 ? 8 : 7;
    try {
      await openSettings(page, info);
      const box = page.getByTestId('data-retention');
      await expect(box).toContainText('nothing is deleted or archived');
      const years = box.getByLabel('Apply to all (years)');
      await years.fill(String(target));
      await saveSettings(page);
      await reloadSettings(page);
      await expect(years).toHaveValue(String(target));
      await shot(page, TAB, '14a-retention-saved', info);
      await years.fill('0');
      await page.getByRole('button', { name: 'Save Changes' }).first().click();
      await expect(box).toContainText('Enter 1 to 30 years');
    } finally {
      await restoreSettings(api, (s) => s.security.dataRetentionYears !== before, {
        security: { dataRetentionYears: before },
      });
      await api.dispose();
    }
  });

  test('14b six retention categories, each with when it starts; one on its own saves and survives a reload; put back', async ({
    page,
    browser,
  }, info) => {
    const api = await roleApi(browser, 'owner');
    const before = (await ok(await api.get('business/intake-settings'), 'settings')).security
      .retention.taxReturnDocuments as number | null;
    const target = before === 10 ? 11 : 10;
    try {
      await openSettings(page, info);
      const box = page.getByTestId('data-retention');
      await expect(
        box.getByRole('list', { name: 'Retention by category' }).getByRole('listitem'),
      ).toHaveCount(6);
      for (const label of [
        'Client-sent documents',
        'Company-sent documents',
        'Submitted intake forms',
        'Portal messages',
        'System-sent emails',
        'Tax return documents',
      ])
        await expect(box.getByLabel(label)).toBeVisible();
      await expect(page.getByTestId('retention-taxReturnDocuments')).toContainText(
        /Starts: when the tax return.s service \(job\) is completed/,
      );
      const field = box.getByLabel('Tax return documents');
      await field.fill(String(target));
      await saveSettings(page);
      await reloadSettings(page);
      await expect(field).toHaveValue(String(target));
      await expect(page.getByTestId('retention-taxReturnDocuments')).toContainText(
        `In effect: ${target} years`,
      );
      await expect(page.getByTestId('retention-kept-taxReturnDocuments')).toContainText(
        `Kept until ${target} years after its job is completed`,
      );
      await shot(page, TAB, '14b-retention-saved', info);
    } finally {
      await restoreSettings(api, (s) => s.security.retention.taxReturnDocuments !== before, {
        security: { retention: { taxReturnDocuments: before } },
      });
      await api.dispose();
    }
  });

  test('16a Test Reminder Email names where it goes before the click; clicked only for a simulator address', async ({
    page,
  }, info) => {
    await openSettings(page, info);
    const dest = page.getByTestId('test-reminder-destination');
    await expect(dest).toHaveText(/^Sends to \S+@\S+$/);
    const to = ((await dest.textContent()) ?? '').replace(/^Sends to /, '').trim();
    await shot(page, TAB, '16a-destination', info);
    if (!SIMULATOR.test(to)) {
      note(
        info,
        'NOT LIVE',
        '16a click: the Owner login address is not an SES simulator address, so Test Reminder Email was not clicked',
      );
      return;
    }
    await page.getByRole('button', { name: 'Test Reminder Email' }).click();
    await expect(
      page.getByText(
        /A test reminder email was sent to \S+@simulator\.amazonses\.com\. No client was contacted/,
      ),
    ).toBeVisible();
  });

  test('4 Branding: the colours and logos from Settings; Preview Client View; Edit opens Settings > Branding', async ({
    page,
  }, info) => {
    await openSettings(page, info);
    for (const label of ['Primary button color', 'Accent color'])
      await expect(page.getByText(label).first()).toBeVisible();
    await expect(
      page.getByRole('switch', { name: 'Use this branding on client-facing forms' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Preview Client View' }).click();
    const preview = page.getByRole('dialog', { name: 'Client Preview' });
    await expect(preview.getByTestId('client-preview-full')).toBeVisible();
    await shot(page, TAB, '4-client-preview', info);
    await preview.getByRole('button', { name: 'Close Preview' }).click();
    const edit = page.getByRole('link', { name: 'Edit branding in Settings' });
    await expect(edit).toHaveAttribute('href', '/settings/branding');
    await edit.click();
    await expect(page).toHaveURL(/\/settings\/branding$/);
    await settled(page);
    await shot(page, TAB, '4-settings-branding', info);
  });

  test('23-c to 23-f automation rules: none says "Not active yet", and the card says what they do', async ({
    page,
  }, info) => {
    await openSettings(page, info);
    for (const label of [
      'Auto-create client record',
      'Auto-create follow-up task',
      'Route by service type',
      'Default follow-up owner',
      'Send confirmation email to client',
      'Notify assigned staff member',
    ])
      await expect(settingRow(page, label), label).not.toContainText('Not active yet');
    await expect(page.getByTestId('automation-rules-help')).toContainText(
      'a lead becomes a client',
    );
    await shot(page, TAB, '23cf-automation', info);
    note(info, 'NOT LIVE', '23-c to 23-f running: needs a form submitted (see the NOT LIVE rows)');
  });

  test('6 Integrations in the settings menu opens Integrations; Manage Templates opens the library', async ({
    page,
  }, info) => {
    await openSettings(page, info);
    await page
      .getByRole('navigation', { name: 'Settings categories' })
      .getByRole('button', { name: 'Integrations', exact: true })
      .click();
    const link = page.getByTestId('section-note').getByRole('link', { name: 'Open Integrations' });
    await expect(link).toHaveAttribute('href', '/integrations');
    await link.click();
    await expect(page).toHaveURL(/\/integrations$/);
    await settled(page);
    await shot(page, TAB, '6-integrations', info);
    await openSettings(page, info);
    await page
      .getByTestId('settings-quick-actions')
      .getByRole('link', { name: 'Manage Templates' })
      .click();
    await expect(page).toHaveURL(/\/intake-forms\/templates$/);
  });

  test('24c-i Reset Defaults asks first; Cancel changes nothing', async ({ page }, info) => {
    await openSettings(page, info);
    await page.getByRole('button', { name: 'Reset Defaults' }).click();
    const dialog = page.getByRole('dialog', { name: 'Reset to the defaults?' });
    await expect(dialog).toContainText('Forms already sent keep their own settings');
    await shot(page, TAB, '24ci-reset-asks', info);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('unsaved')).toHaveCount(0);
  });

  test('DOCUMENTS-LIMIT-01 the largest document is 5 to 100 MB; a change saves and survives a reload; Allowed Files names both limits; put back', async ({
    page,
    browser,
  }, info) => {
    const api = await roleApi(browser, 'owner');
    const before = (await ok(await api.get('business/document-settings'), 'document settings'))
      .maxFileSizeMb as number;
    const target = before === 20 ? 30 : 20;
    try {
      await open(page, app('/documents/settings'), info);
      await expect(page.getByTestId('document-settings')).toBeVisible({ timeout: 60_000 });
      await page.getByRole('tab', { name: 'File Settings' }).click();
      const size = page.getByLabel('Largest file');
      await expect(size.locator('option')).toHaveText([
        '5 MB',
        '10 MB',
        '20 MB',
        '30 MB',
        '50 MB',
        '100 MB',
      ]);
      await expect(page.getByTestId('file-size-scope')).toContainText(
        'Intake forms have their own limit',
      );
      await size.selectOption(String(target));
      await page.getByRole('button', { name: 'Save Changes' }).first().click();
      await expect(page.getByText('Document settings were saved.')).toBeVisible();
      await page.reload();
      await settled(page);
      await page.getByRole('tab', { name: 'File Settings' }).click();
      await expect(page.getByLabel('Largest file')).toHaveValue(String(target));
      await shot(page, TAB, 'DOCUMENTS-LIMIT-01-saved', info);
      await open(page, app('/settings/forms-documents'), info);
      const files = page.getByTestId('allowed-files');
      await expect(files).toContainText('Largest document', { timeout: 60_000 });
      await expect(files).toContainText(`${target} MB`);
      await expect(files).toContainText('Largest intake form file');
      await expect(files.getByRole('link', { name: 'File Settings' })).toHaveAttribute(
        'href',
        '/documents/settings',
      );
      await shot(page, TAB, 'DOCUMENTS-LIMIT-01-allowed-files', info);
    } finally {
      const now = await ok(await api.get('business/document-settings'), 'document settings');
      if (now.maxFileSizeMb !== before) {
        await ok(
          await api.patch('business/document-settings', { maxFileSizeMb: before }),
          'put the document limit back',
        );
      }
      await api.dispose();
    }
  });
});

// ================================================================ Admin

test.describe('Intake Forms (Admin)', () => {
  test.use(as('admin'));
  test.skip(() => !hasLogin('admin'), 'no admin login');

  test('9a additional emails: a simulator address is added, saved and kept after a reload; removed, the list is as it was', async ({
    page,
    browser,
  }, info) => {
    const api = await roleApi(browser, 'owner');
    const before = (await ok(await api.get('business/intake-settings'), 'settings')).notifications
      .additionalEmails as string[];
    if (before.length >= 10) {
      await api.dispose();
      test.skip(true, 'the firm already lists 10 additional emails');
    }
    const same = (list: string[]) =>
      list.length === before.length && list.every((x, i) => x === before[i]);
    try {
      await openSettings(page, info);
      const list = page.getByTestId('additional-emails');
      await list.getByLabel('Add an email to notify').fill(NOTIFY_EMAIL);
      await list.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(list.getByRole('listitem').filter({ hasText: NOTIFY_EMAIL })).toHaveCount(1);
      await saveSettings(page);
      await reloadSettings(page);
      await expect(list.getByRole('listitem').filter({ hasText: NOTIFY_EMAIL })).toHaveCount(1);
      await shot(page, TAB, '9a-added', info);
      await list.getByRole('button', { name: `Remove ${NOTIFY_EMAIL}` }).click();
      await saveSettings(page);
      await reloadSettings(page);
      await expect(list.getByRole('listitem').filter({ hasText: NOTIFY_EMAIL })).toHaveCount(0);
      for (const e of before)
        await expect(list.getByRole('listitem').filter({ hasText: e })).toHaveCount(1);
    } finally {
      await restoreSettings(api, (s) => !same(s.notifications.additionalEmails as string[]), {
        notifications: { additionalEmails: before },
      });
      await api.dispose();
    }
  });
});

// ================================================================ Builder and library (Owner)

test.describe('Builder and Form Templates (Owner)', () => {
  test.use(as('owner'));
  test.skip(() => !hasLogin('owner'), 'no owner login');

  test('17c Create Intake Form, Create New Form and Create Form Template each ask for the service first; Create Intake Form opens the builder', async ({
    page,
    browser,
  }, info) => {
    const c = await fixture(browser);
    await openList(page, info);
    const asks = async (button: Locator, title: string) => {
      await button.click();
      const dialog = page.getByRole('dialog', { name: title });
      await expect(dialog).toContainText('Choose the service this');
      await expect(dialog.getByRole('button', { name: title, exact: true })).toBeDisabled();
      return dialog;
    };
    for (const [button, title] of [
      [
        page.getByRole('button', { name: 'Create New Form', exact: true }).first(),
        'Create Intake Form',
      ],
      [
        page
          .getByTestId('intake-form-quick-actions')
          .getByRole('button', { name: 'Create Form Template' }),
        'Create Template',
      ],
    ] as const) {
      const dialog = await asks(button, title);
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toBeHidden();
    }
    const dialog = await asks(
      page.getByRole('button', { name: 'Create Intake Form', exact: true }).first(),
      'Create Intake Form',
    );
    await expect(dialog).toContainText('It starts as a blank draft.');
    await shot(page, TAB, '17c-asks-service', info);
    if (c.blankId) {
      note(info, 'rerun', 'the blank form was made earlier in this run: not made again');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      return;
    }
    await dialog.getByLabel('Service').selectOption({ label: `${SERVICE} (Tax Planning)` });
    await dialog.getByRole('button', { name: 'Create Intake Form', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/intake-forms/builder/${UUID}$`), { timeout: 60_000 });
    saveCtx({ ...readCtx(), blankId: builderId(page.url()) });
    await expect(formNameField(page)).toBeVisible({ timeout: 60_000 });
    await shot(page, TAB, '17c-builder', info);
  });

  test('17c-ii a form made from scratch opens blank: no section, no question', async ({
    page,
  }, info) => {
    const c = readCtx();
    test.skip(!c.blankId, '17c made no blank form');
    await openBuilder(page, c.blankId, info);
    await expect(
      page.getByText('No sections yet. Add a section, then add questions from Add Questions.'),
    ).toBeVisible();
    await expect(page.getByTestId('form-section')).toHaveCount(0);
    await shot(page, TAB, '17c-ii-blank', info);
    // Named with the run tag, so its cleanup finds it.
    await formNameField(page).fill(BLANK);
    await page.getByRole('button', { name: 'Save as Draft' }).click();
    await expect(builderStatus(page)).toContainText('Draft saved.');
  });

  test('1 23-h builder Form Settings on a draft: uploads off, expiry days and a success message save and survive a reload; e-signature always on', async ({
    page,
    browser,
  }, info) => {
    const c = await fixture(browser);
    await openBuilder(page, c.formId, info);
    const settings = page.getByTestId('form-settings');
    await expect(settings.getByTestId('signature-always-on')).toContainText(
      'Require e-signature: Always on',
    );
    await expect(settings.getByRole('switch', { name: 'Require e-signature' })).toHaveCount(0);
    await expect(settings.getByRole('switch', { name: 'Show progress bar' })).toBeVisible();
    await setSwitch(settings.getByRole('switch', { name: 'Allow file uploads' }), false);
    await setSwitch(settings.getByRole('switch', { name: 'Set expiration date' }), true);
    await settings.getByLabel('Days after sending').fill('10');
    await settings.getByLabel('Custom Success Message').fill(SUCCESS);
    await page.getByRole('button', { name: 'Save as Draft' }).click();
    await expect(builderStatus(page)).toContainText(/Draft saved\.|Saved as a new draft/);
    await page.reload();
    await expect(formNameField(page)).toHaveValue(FORM, { timeout: 60_000 });
    const after = page.getByTestId('form-settings');
    await expect(after.getByRole('switch', { name: 'Allow file uploads' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await expect(after.getByRole('switch', { name: 'Set expiration date' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(after.getByLabel('Days after sending')).toHaveValue('10');
    await expect(after.getByLabel('Custom Success Message')).toHaveValue(SUCCESS);
    await shot(page, TAB, '1-builder-settings', info);
  });

  test('17a a blank Form Name blocks Publish Form: the summary, the field error and the focus; nothing else is lost', async ({
    page,
    browser,
  }, info) => {
    const c = await fixture(browser);
    await openBuilder(page, c.formId, info);
    const name = formNameField(page);
    await expect(name).toHaveValue(FORM);
    await name.fill('');
    await page.getByRole('button', { name: 'Publish Form' }).click();
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('form-details').getByText('Enter a form name')).toBeVisible();
    const problems = page.getByTestId('builder-problems');
    await expect(problems).toContainText('Fix these to publish (1):');
    await expect(problems).toContainText('Form name: Enter a form name');
    await expect(name).toBeFocused();
    await expect(page.getByTestId('form-section').filter({ hasText: SECTION })).toHaveCount(1);
    await shot(page, TAB, '17a-blank-name', info);
    await name.fill(FORM);
    await expect(name).not.toHaveAttribute('aria-invalid', 'true');
    await expect(problems).toHaveCount(0);
  });

  test('17b Publish Form publishes; the share window opens; the library shows it ready to send', async ({
    page,
    browser,
  }, info) => {
    const c = await fixture(browser);
    if ((await formStatus(browser, c.formId)) === 'DRAFT') {
      await openBuilder(page, c.formId, info);
      await expect(formNameField(page)).toHaveValue(FORM);
      await page.getByRole('button', { name: 'Publish Form' }).click();
      await expect(builderStatus(page)).toContainText(
        /Form published\. It can now be sent\.|Published as a new version/,
        { timeout: 60_000 },
      );
      const dialog = page.getByRole('dialog', { name: FORM });
      await expect(dialog.getByTestId('form-share')).toBeVisible();
      await shot(page, TAB, '17b-published', info);
      await dialog.getByRole('button', { name: 'Done' }).click();
    } else {
      note(info, 'rerun', 'the form was published earlier in this run: not published again');
    }
    await openLibrary(page, info, STAMP);
    const card = cardOf(page, FORM);
    await expect(card).toBeVisible();
    await expect(card).not.toContainText('Draft');
    await expect(card.getByRole('button', { name: 'Use Template' })).toBeEnabled();
    await shot(page, TAB, '17b-library', info);
  });

  test('6 previews: the library Preview shows the form and sends nothing; the builder Preview shows it as the client sees it', async ({
    page,
    browser,
  }, info) => {
    const c = await fixture(browser);
    await openLibrary(page, info, STAMP);
    await cardOf(page, FORM).getByRole('button', { name: 'Preview' }).click();
    const dialog = page.getByRole('dialog', { name: FORM });
    await expect(dialog.getByTestId('template-preview')).toContainText(SECTION);
    await expect(dialog.getByTestId('template-preview')).toContainText(QUESTION);
    await shot(page, TAB, '6-library-preview', info);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await open(page, builderUrl(c.formId, '/preview'), info);
    const preview = page.getByTestId('form-preview');
    await expect(
      preview.getByText('This is how your client sees the form. Nothing is sent from the preview.'),
    ).toBeVisible({ timeout: 60_000 });
    await expect(preview.getByRole('heading', { name: FORM })).toBeVisible();
    await expect(preview).toContainText(QUESTION);
    await shot(page, TAB, '6-builder-preview', info);
  });

  test('20 INTAKE-ACCESS-02a share link: a copyable link and website button; anyone opens it; off, it refuses at once; a draft has none', async ({
    page,
    browser,
  }, info) => {
    const c = await fixture(browser);
    test.skip((await formStatus(browser, c.formId)) === 'DRAFT', '17b did not publish the form');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: appUrl,
    });
    await openLibrary(page, info, STAMP);
    let share = await openShare(page, FORM);
    const byLink = share.getByRole('switch', { name: 'Share by link' });
    await setSwitch(byLink, true);
    const link = share.getByLabel('Link', { exact: true });
    await expect(link).toHaveValue(
      new RegExp(`^${esc(portalUrl)}/${firmSlug}/start/[A-Za-z0-9_-]{43}$`),
    );
    await expect(share.getByLabel('Embed code', { exact: true })).toHaveValue(/^<a href=/);
    await expect(share.getByRole('switch', { name: 'Publish in client portal' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    await share.getByTestId('public-link').getByRole('button', { name: /Copy/ }).first().click();
    await expect(share.getByRole('button', { name: 'Copied' })).toBeVisible();
    const url = await link.inputValue();
    await shot(page, TAB, '02a-share-dialog', info);
    for (const width of [1165, 390]) {
      const v = await visitor(browser, width);
      try {
        await v.page.goto(url);
        await expect(v.page.getByRole('button', { name: 'Start My Form' })).toBeVisible({
          timeout: 60_000,
        });
        await expect(v.page.getByTestId('intake-page')).toContainText(FORM);
        await shot(v.page, TAB, `02a-link-opens-${width}`, info);
        if (width === 390) await expectNoSideScroll(v.page);
      } finally {
        await v.ctx.close();
      }
    }
    await byLink.click();
    await expect(byLink).toHaveAttribute('aria-checked', 'false');
    await expect(share.getByTestId('public-link-empty')).toContainText('Sharing by link is off');
    const v = await visitor(browser);
    try {
      await v.page.goto(url);
      await expect(v.page.getByTestId('share-invalid')).toContainText(
        'This form link is not available any more.',
        { timeout: 60_000 },
      );
      await shot(v.page, TAB, '02a-link-off', info);
    } finally {
      await v.ctx.close();
    }
    await byLink.click();
    await expect(link).toHaveValue(/\/start\//);
    await closeShare(page, FORM);
    // A draft has no link: the blank form of 17c, from its builder.
    if (c.blankId) {
      await openBuilder(page, c.blankId, info);
      await page.getByRole('button', { name: 'More save options' }).click();
      await page.getByRole('menuitem', { name: 'Share & Publish' }).click();
      share = page.getByTestId('form-share');
      await expect(share).toContainText(
        'Publish the form to share it. A draft or an archived form has no link.',
      );
      await expect(share.getByRole('switch', { name: 'Publish in client portal' })).toBeDisabled();
      await shot(page, TAB, '02a-draft-no-link', info);
    } else {
      note(info, 'skipped part', 'a draft has no link: 17c made no blank form');
    }
  });

  test('INTAKE-ACCESS-02d Make a New Link asks first; the old link stops at once, the new one opens', async ({
    page,
    browser,
  }, info) => {
    await publishedFixture(browser);
    await openLibrary(page, info, STAMP);
    const share = await openShare(page, FORM);
    const byLink = share.getByRole('switch', { name: 'Share by link' });
    await setSwitch(byLink, true);
    const link = share.getByLabel('Link', { exact: true });
    const old = await link.inputValue();
    const rotate = share.getByTestId('rotate-link');
    await rotate.getByRole('button', { name: 'Make a New Link' }).click();
    await expect(rotate.getByRole('alertdialog', { name: 'Make a new link?' })).toContainText(
      'The current link stops working at once',
    );
    await shot(page, TAB, '02d-asks', info);
    await rotate.getByRole('button', { name: 'Make New Link' }).click();
    await expect(rotate).toContainText('A new link is ready. The old one no longer works.');
    await expect(link).not.toHaveValue(old);
    const fresh = await link.inputValue();
    const v = await visitor(browser);
    try {
      await v.page.goto(old);
      await expect(v.page.getByTestId('share-invalid')).toBeVisible({ timeout: 60_000 });
      await v.page.goto(fresh);
      await expect(v.page.getByRole('button', { name: 'Start My Form' })).toBeVisible({
        timeout: 60_000,
      });
      await shot(v.page, TAB, '02d-new-link-opens', info);
    } finally {
      await v.ctx.close();
    }
    // Off again: no public link of the run stays open on dev. After Make a New Link the window
    // must show the switch's new state too (checked softly, then on a fresh window).
    await byLink.click();
    await expect
      .soft(byLink, 'after a new link, Share by link shows off once turned off')
      .toHaveAttribute('aria-checked', 'false', { timeout: 10_000 });
    await shot(page, TAB, '02d-after-off-click', info);
    await closeShare(page, FORM);
    const again = await openShare(page, FORM);
    const byLinkAgain = again.getByRole('switch', { name: 'Share by link' });
    note(
      info,
      'reopened',
      `Share by link on reopening: ${await byLinkAgain.getAttribute('aria-checked')}`,
    );
    await shot(page, TAB, '02d-reopened', info);
    await setSwitch(byLinkAgain, false);
    await closeShare(page, FORM);
  });

  test('INTAKE-ACCESS-02b Publish in client portal: on, the client sees it to start; off, it is gone (the client only reads)', async ({
    page,
    browser,
  }, info) => {
    test.skip(!hasLogin('client'), 'no client login');
    const c = await fixture(browser);
    test.skip((await formStatus(browser, c.formId)) === 'DRAFT', '17b did not publish the form');
    await openLibrary(page, info, STAMP);
    const share = await openShare(page, FORM);
    const inPortal = share.getByRole('switch', { name: 'Publish in client portal' });
    try {
      await setSwitch(inPortal, true);
      const cl = await clientBrowser(browser);
      try {
        await cl.page.goto(portal('/intake'));
        await settled(cl.page);
        const card = cl.page.getByTestId('portal-form').filter({ hasText: FORM });
        await expect(card).toBeVisible({ timeout: 60_000 });
        // Never clicked: starting it would make a form on Client 1.
        await expect(card.getByRole('button', { name: `Start ${FORM}` })).toBeVisible();
        await shot(cl.page, TAB, '02b-portal-on', info);
        await setSwitch(inPortal, false);
        await cl.page.reload();
        await settled(cl.page);
        await expect(cl.page.getByTestId('portal-form').filter({ hasText: FORM })).toHaveCount(0, {
          timeout: 30_000,
        });
        await shot(cl.page, TAB, '02b-portal-off', info);
      } finally {
        await cl.ctx.close();
      }
      await closeShare(page, FORM);
    } finally {
      await withOwner(browser, async (api) => {
        const s = await ok(await api.get(`business/intake-forms/${c.formId}/share`), 'share');
        if (s.portalPublished) {
          await ok(
            await api.put(`business/intake-forms/${c.formId}/share`, {
              sharing: s.sharing,
              portalPublished: false,
            }),
            'Publish in client portal off',
          );
        }
      });
    }
  });

  test('7 library search finds the form; Use Template opens Send with it; the summary follows each choice (nothing is sent)', async ({
    page,
    browser,
  }, info) => {
    const c = await fixture(browser);
    test.skip((await formStatus(browser, c.formId)) === 'DRAFT', '17b did not publish the form');
    await openLibrary(page, info);
    const cards = page.getByTestId('template-card');
    await page.getByRole('searchbox', { name: 'Search templates' }).fill(STAMP);
    await expect(cardOf(page, FORM)).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search templates' }).fill(`${STAMP}-no-such-form`);
    await expect(cards).toHaveCount(0);
    await expect(page.getByText('No templates match this search or category.')).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search templates' }).fill(STAMP);
    await cardOf(page, FORM).getByRole('button', { name: 'Use Template' }).click();
    await expect(page).toHaveURL(new RegExp(`/intake-forms/send\\?formId=${c.formId}$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Send Intake Form' })).toBeVisible();
    await expect(summaryRow(page, 'Form Name')).toContainText(FORM, { timeout: 60_000 });
    await page.getByRole('radio', { name: 'Lead', exact: true }).click();
    await page.getByRole('button', { name: /^Lead/ }).click();
    await page.getByLabel('Search leads').fill(STAMP);
    await page.getByRole('option', { name: new RegExp(esc(LEAD_NAME)) }).click();
    await expect(summaryRow(page, 'Recipient')).toContainText(LEAD_NAME);
    await expect(summaryRow(page, 'Delivery Method')).toContainText('Email');
    await expect(page.getByRole('radio', { name: /^SMS/ })).toBeDisabled();
    await expect(page.getByRole('radio', { name: /^Client Portal/ })).toBeDisabled();
    await expect(page.getByText('Ready to Send')).toBeVisible();
    const save = page.getByRole('switch', { name: 'Allow client to save and continue' });
    await save.click();
    await expect(summaryRow(page, 'Client Can Save')).toContainText('No');
    await save.click();
    await expect(summaryRow(page, 'Client Can Save')).toContainText('Yes');
    await shot(page, TAB, '7-send-setup', info);
    // Nothing sent: leave the screen.
    await page.goto(app('/intake-forms'));
  });

  test('18a a duplicate shows as a Draft; Use Template stays off until it is published', async ({
    page,
    browser,
  }, info) => {
    await fixture(browser);
    await openLibrary(page, info, STAMP);
    if (
      (await cardOf(page, COPY).count()) === 0 &&
      (await cardOf(page, COPY_EDITED).count()) === 0
    ) {
      await cardAction(page, FORM, 'Duplicate');
      await expect(page.getByText(`"${COPY}" was added as a draft template.`)).toBeVisible();
    } else {
      note(info, 'rerun', 'the copy was made earlier in this run: not made again');
    }
    const name = (await cardOf(page, COPY).count()) ? COPY : COPY_EDITED;
    const copy = cardOf(page, name);
    await expect(copy).toContainText('Draft');
    await expect(copy.getByRole('button', { name: 'Use Template' })).toBeDisabled();
    await expect(copy).toContainText('Publish this template before sending it');
    await shot(page, TAB, '18a-copy-draft', info);
    await withOwner(browser, async (api) => {
      const forms = itemsOf(
        await ok(
          await api.get(`business/intake-forms?templates=all&search=${encodeURIComponent(STAMP)}`),
          'forms',
        ),
      );
      for (const f of forms) if (f.name === COPY || f.name === COPY_EDITED) addCopy(f.id as string);
    });
  });

  test('18d the copy keeps every question and setting of its source, and stays its own form', async ({
    page,
    browser,
  }, info) => {
    const c = await fixture(browser);
    const copyId = await withOwner(browser, async (api) => {
      const forms = itemsOf(
        await ok(
          await api.get(`business/intake-forms?templates=all&search=${encodeURIComponent(STAMP)}`),
          'forms',
        ),
      );
      return (forms.find((f: Json) => f.name === COPY)?.id as string | undefined) ?? '';
    });
    test.skip(!copyId, '18a made no copy (or it was renamed earlier in this run)');
    const read = async (id: string) => {
      await openBuilder(page, id, info);
      const s = page.getByTestId('form-settings');
      await expect(page.getByTestId('form-section').first()).toBeVisible();
      const sw = (name: string) => s.getByRole('switch', { name }).getAttribute('aria-checked');
      const days = s.getByLabel('Days after sending');
      return {
        // Each section's title and question count (its header, open or closed).
        sections: (
          await page.getByTestId('form-section').locator('button[aria-pressed]').allInnerTexts()
        ).map((t) => t.replace(/\s+/g, ' ').trim()),
        uploads: await sw('Allow file uploads'),
        progress: await sw('Show progress bar'),
        all: await sw('Require all questions to be completed'),
        expires: await sw('Set expiration date'),
        days: (await days.count()) ? await days.inputValue() : '',
        success: await s.getByLabel('Custom Success Message').inputValue(),
      };
    };
    const source = await read(c.formId);
    const copy = await read(copyId);
    await expect(page.getByTestId('form-section').filter({ hasText: SECTION })).toHaveCount(1);
    expect(copy, 'the copy has the same sections, questions and settings').toEqual(source);
    await shot(page, TAB, '18d-copy', info);
    await formNameField(page).fill(COPY_EDITED);
    await page.getByRole('button', { name: 'Save as Draft' }).click();
    await expect(builderStatus(page)).toContainText('Draft saved.');
    await openBuilder(page, c.formId, info);
    await expect(formNameField(page)).toHaveValue(FORM);
  });

  test('24c-i an archived template is under Archived, and Restore brings it back as a draft', async ({
    page,
  }, info) => {
    await openLibrary(page, info, STAMP);
    const name = (await cardOf(page, COPY_EDITED).count()) ? COPY_EDITED : COPY;
    test.skip((await cardOf(page, name).count()) === 0, '18a made no copy');
    await cardAction(page, name, 'Archive');
    await page
      .getByRole('dialog', { name: 'Archive template?' })
      .getByRole('button', { name: 'Archive Template' })
      .click();
    await expect(page.getByText(`"${name}" was archived.`)).toBeVisible();
    await expect(cardOf(page, name)).toHaveCount(0);
    const status = async (value: string) => {
      await page.getByRole('button', { name: /More Filters/ }).click();
      await page.getByLabel('Template status').selectOption(value);
      await page.getByRole('button', { name: 'Apply Filters' }).click();
    };
    await status('ARCHIVED');
    const archived = cardOf(page, name);
    await expect(archived).toContainText('Archived');
    await shot(page, TAB, '24ci-archived-view', info);
    await archived.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText(`"${name}" was restored as a draft.`)).toBeVisible();
    await status('');
    await expect(cardOf(page, name)).toContainText('Draft');
    await shot(page, TAB, '24ci-restored', info);
  });

  test('18b library numbers: Total Templates equals the cards; each category count equals its cards', async ({
    page,
  }, info) => {
    await openLibrary(page, info);
    const cards = page.getByTestId('template-card');
    const total = Number(/\b(\d+)\b/.exec(await page.getByTestId('kpi-total').innerText())?.[1]);
    await expect(cards).toHaveCount(total);
    const categories = page.getByTestId('template-categories').locator('button[aria-pressed]');
    const rows = await categories.allInnerTexts();
    expect(rows.length, 'the side list shows the categories in use').toBeGreaterThan(0);
    for (const text of rows) {
      const lines = text
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const count = Number(lines.at(-1));
      const label = lines.at(-2) ?? lines[0] ?? '';
      await categories.filter({ hasText: label }).first().click();
      await expect(cards, `${label}: its count equals its cards`).toHaveCount(count);
    }
    await shot(page, TAB, '18b-categories', info);
    await page.getByRole('tab', { name: 'All Templates' }).click();
    await expect(cards).toHaveCount(total);
  });

  test('24c-ii Import Template says it is not available yet, and why', async ({ page }, info) => {
    await openLibrary(page, info);
    await page.getByRole('button', { name: 'Import Template' }).click();
    const dialog = page.getByRole('dialog', { name: 'Import Template' });
    await expect(dialog).toContainText('not available yet');
    await shot(page, TAB, '24cii-import', info);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toBeHidden();
  });
});

// ================================================================ Admin, once the form is published

test.describe('Intake Forms sharing (Admin)', () => {
  test.use(as('admin'));
  test.skip(() => !hasLogin('admin'), 'no admin login');

  test('23-i an Admin may change the settings and the sharing switches', async ({
    page,
    browser,
  }, info) => {
    await publishedFixture(browser);
    await openSettings(page, info);
    await expect(page.getByText('Only an owner or admin can change these settings.')).toHaveCount(
      0,
    );
    await expect(page.getByRole('switch', { name: 'Allow save and resume' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Save Changes' }).first()).toBeEnabled();
    await openLibrary(page, info, STAMP);
    const share = await openShare(page, FORM);
    await expect(share.getByText('Only an Owner or Admin can change these.')).toHaveCount(0);
    await expect(share.getByRole('switch', { name: 'Publish in client portal' })).toBeEnabled();
    await shot(page, TAB, '23i-admin-share', info);
    await closeShare(page, FORM);
  });
});

// ================================================================ Send and the sent form (Owner)

test.describe('Send and the sent form (Owner)', () => {
  test.use(as('owner'));
  test.skip(() => !hasLogin('owner'), 'no owner login');

  test('INTAKE-EXPIRY-01 Send Form offers the default, a date and time, or never, in the firm zone; a past time is refused on its field (nothing sent)', async ({
    page,
    browser,
  }, info) => {
    const c = await fixture(browser);
    test.skip((await formStatus(browser, c.formId)) === 'DRAFT', '17b did not publish the form');
    await openSend(page, c, info);
    await checkRecipients(page, browser, c);
    const field = page.getByTestId('expiry-field');
    const choice = field.getByLabel('Expiration', { exact: true });
    await expect(choice.locator('option')).toHaveCount(3);
    await expect(choice.locator('option').first()).toHaveText(/^Default \(/);
    await choice.selectOption('AT');
    await field.getByLabel('Expiration date').fill(firmDay(-1));
    await field.getByLabel('Expiration time').fill('12:00');
    await expect(field).toContainText('Times are in');
    await page.getByRole('button', { name: 'Send Form', exact: true }).click();
    await expect(field).toContainText(LATER);
    await expect(page.getByTestId('send-result')).toHaveCount(0);
    await shot(page, TAB, 'EXPIRY-01-past-refused', info);
    await choice.selectOption('NONE');
    await expect(field).toContainText('The form stays open until it is submitted or archived.');
    await page.goto(app('/intake-forms'));
  });

  test('19a send to the run lead by Email: Ready to Send, then Form Sent and what the mail service did; the sent form and its History', async ({
    page,
    browser,
  }, info) => {
    const c = await fixture(browser);
    test.skip((await formStatus(browser, c.formId)) === 'DRAFT', '17b did not publish the form');
    const earlier = await withOwner(browser, async (api) => {
      const rows = itemsOf(
        await ok(
          await api.get(
            `business/intakes?tab=all&search=${encodeURIComponent(STAMP)}&pageSize=100`,
          ),
          'sent forms',
        ),
      );
      return rows.find((r: Json) => r.recipient?.id === c.leadId)?.id as string | undefined;
    });
    if (earlier) {
      saveCtx({ ...readCtx(), recordId: earlier });
      test.skip(true, 'the form was sent earlier in this run: not sent again');
    }
    await openSend(page, c, info);
    await page.getByRole('radio', { name: /^Email/ }).check();
    await checkRecipients(page, browser, c);
    await page.getByRole('textbox', { name: /^Subject/ }).fill(`${runTag} intake form`);
    await page
      .getByRole('textbox', { name: /^Message/ })
      .fill('Live check (synthetic): nothing needs filling in.');
    const field = page.getByTestId('expiry-field');
    await field.getByLabel('Expiration', { exact: true }).selectOption('AT');
    await field.getByLabel('Expiration date').fill(firmDay(2));
    await field.getByLabel('Expiration time').fill('17:00');
    if (c.ownerName) {
      await page.getByRole('button', { name: /^Assign To/ }).click();
      await page.getByRole('option', { name: c.ownerName }).first().click();
      await expect(summaryRow(page, 'Assigned To')).toContainText(c.ownerName);
    }
    const reminders = page.getByRole('switch', { name: 'Send reminders' });
    if ((await reminders.getAttribute('aria-checked')) === 'true' && (await reminders.isEnabled()))
      await reminders.click();
    await expect(summaryRow(page, 'Reminders')).toContainText('Off');
    await expect(page.getByText('Ready to Send')).toBeVisible();
    await shot(page, TAB, '19a-ready', info);
    await checkRecipients(page, browser, c);
    await page.getByRole('button', { name: 'Send Form', exact: true }).click();
    const result = page.getByTestId('send-result');
    await expect(result).toContainText(/Form Sent|Email Retrying/, { timeout: 60_000 });
    await expect(result).not.toContainText('Delivery Failed');
    const masked = /Email to (\S+@\S+?):/.exec(await result.innerText())?.[1] ?? '';
    expectSimulatorOnly([masked], 'the address the result names');
    const href = await result.getByRole('link', { name: 'View sent form' }).getAttribute('href');
    const id = new RegExp(`/intake-forms/(${UUID})$`).exec(href ?? '')?.[1];
    expect(id, 'the result links the sent form').toBeTruthy();
    saveCtx({ ...readCtx(), recordId: id! });
    await shot(page, TAB, '19a-result', info);
    await openRecord(page, id!, info, '/history');
    await expect(page.getByTestId('history')).toContainText('Form sent');
    await shot(page, TAB, '19a-history', info);
  });

  test('19b-i Send Follow-Up says what really happened, and History keeps it', async ({
    page,
    browser,
  }, info) => {
    const c = readCtx();
    test.skip(!c.recordId, '19a sent nothing');
    await checkLeadRecord(browser, c);
    await openRecord(page, c.recordId, info);
    await page.getByRole('button', { name: 'Send Follow-Up' }).click();
    await expect(
      page.getByText(/Follow-up sent\.|The mail service has not accepted the email yet/).first(),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Nothing reached the recipient')).toHaveCount(0);
    await shot(page, TAB, '19bi-follow-up', info);
    await openRecord(page, c.recordId, info, '/history');
    await expect(page.getByTestId('history')).toContainText(/Reminder sent|Form resent/);
  });

  test('23-g the sent form shows its Submission ID when the firm numbers its forms', async ({
    page,
    browser,
  }, info) => {
    const c = readCtx();
    test.skip(!c.recordId, '19a sent nothing');
    const numbered = await withOwner(
      browser,
      async (api) =>
        (await ok(await api.get('business/intake-settings'), 'settings')).general
          .autoSubmissionId as boolean,
    );
    await openRecord(page, c.recordId, info);
    if (numbered) {
      await expect(page.getByTestId('submission-id')).toHaveText(/^Submission ID SUB-\d{5}$/);
    } else {
      await expect(page.getByTestId('submission-id')).toHaveCount(0);
      note(info, 'firm setting', 'Auto-generate submission ID is off at Test Firm B: no ID shown');
    }
    await shot(page, TAB, '23g-submission-id', info);
  });

  test('24a dashboard: the chart and the status tabs agree; the search finds the run form; 8, 12 and 24 per page', async ({
    page,
  }, info) => {
    test.skip(!readCtx().recordId, '19a sent nothing');
    await openList(page, info);
    const chart = page.getByTestId('intake-form-status-chart');
    await expect(chart).toBeVisible();
    const legend = async (label: string) => {
      const li = chart.getByRole('listitem').filter({ hasText: label });
      if (!(await li.count())) return 0;
      return Number(/(\d+)\s*\(/.exec(await li.first().innerText())?.[1] ?? 0);
    };
    const tabs: [string, string][] = [
      ['Sent', 'Not Started'],
      ['In Progress', 'In Progress'],
      ['Submitted', 'Submitted'],
      ['Completed', 'Completed'],
      ['Expired', 'Expired'],
    ];
    const counts = new Map<string, number>();
    for (const [, label] of tabs) counts.set(label, await legend(label));
    const sum = [...counts.values()].reduce((a, b) => a + b, 0);
    await expectTotal(page, sum, 'All Forms equals the chart');
    await shot(page, TAB, '24a-dashboard', info);
    const tablist = page.getByRole('tablist', { name: 'Filter intake forms by status' });
    for (const [tab, label] of tabs) {
      await tablist.getByRole('tab', { name: tab, exact: true }).click();
      await expectTotal(page, counts.get(label)!, `${tab} equals the chart's ${label}`);
    }
    await tablist.getByRole('tab', { name: 'All Forms', exact: true }).click();
    await searchList(page, STAMP);
    await expectTotal(page, 1, 'the search finds the run form only');
    await expect(listTable(page).getByRole('row').filter({ hasText: FORM })).toHaveCount(1);
    await searchList(page, `${STAMP}-no-such-form`);
    await expectTotal(page, 0, 'a search with no match');
    await searchList(page, '');
    const perPage = page.getByRole('navigation', { name: 'Pagination' }).getByRole('combobox');
    await expect(perPage.getByRole('option')).toHaveText(['8', '12', '24']);
    for (const size of ['12', '24', '8']) {
      await perPage.selectOption(size);
      const max = Math.min(Number(size), sum);
      await expect(
        page.getByText(new RegExp(`^Showing 1 – ${max} of ${sum} forms$`)),
      ).toBeVisible();
    }
  });

  test('INTAKE-USABILITY-01 More Filters shows "Date Sent: From" and "To", visibly', async ({
    page,
  }, info) => {
    await openList(page, info);
    await page.getByRole('button', { name: /More Filters/ }).click();
    await expect(page.getByText('Date Sent: From', { exact: true })).toBeVisible();
    await expect(page.getByText('To', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Date Sent: From')).toHaveAttribute('type', 'date');
    await expect(page.getByLabel('To', { exact: true })).toHaveAttribute('type', 'date');
    await shot(page, TAB, 'USABILITY-01-dates', info);
  });

  test('INTAKE-USABILITY-02 the search and its result come back after opening a form and the breadcrumb', async ({
    page,
  }, info) => {
    const c = readCtx();
    test.skip(!c.recordId, '19a sent nothing');
    await openList(page, info);
    await searchList(page, STAMP);
    await expectTotal(page, 1, 'the search finds the run form');
    await listTable(page).getByRole('link', { name: FORM }).click();
    await expect(page).toHaveURL(new RegExp(`/intake-forms/${c.recordId}$`), { timeout: 60_000 });
    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: 'Intake Forms' })
      .click();
    await expect(page).toHaveURL(/\/intake-forms$/);
    await expect(searchBox(page)).toHaveValue(STAMP);
    await expectTotal(page, 1, 'the same result after coming back');
    await shot(page, TAB, 'USABILITY-02-kept', info);
    await searchList(page, '');
  });

  test('INTAKE-DESIGN-02 and 03 at 1165 px the list fits its rows, keeps 8/12/24 and its Actions in view at both scroll ends', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165', 'the reviewer width only');
    test.skip(!readCtx().recordId, '19a sent nothing');
    await openList(page, info);
    await searchList(page, STAMP);
    await expectTotal(page, 1, 'one row');
    const perPage = page.getByRole('navigation', { name: 'Pagination' }).getByRole('combobox');
    await expect(perPage).toBeVisible();
    await expect(perPage.getByRole('option')).toHaveText(['8', '12', '24']);
    const card = page.locator('section[aria-label="Intake form submissions"] > div').first();
    expect((await card.boundingBox())!.height, 'a one-row list stays short').toBeLessThan(420);
    const chart = (await page.getByTestId('intake-form-status-chart').boundingBox())!;
    expect(chart.height).toBeLessThan(330);
    const header = page.getByRole('columnheader', { name: 'Actions' });
    const actions = listTable(page).getByRole('button', { name: `Actions for ${LEAD_NAME}` });
    expect(await inView(header), 'the Actions header is in view').toBeTruthy();
    expect(await inView(actions), 'the row actions are in view').toBeTruthy();
    const scroller = listTable(page).locator('xpath=..');
    if (await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)) {
      await scroller.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
      expect(await inView(actions), 'in view scrolled to the end').toBeTruthy();
      await scroller.evaluate((el) => el.scrollTo({ left: 0 }));
      expect(await inView(actions), 'in view scrolled back').toBeTruthy();
    } else {
      note(info, 'layout', 'the table did not need to scroll sideways at 1165 px');
    }
    await shot(page, TAB, 'DESIGN-02-03-list', info);
    await searchList(page, '');
  });

  test('INTAKE-DESIGN-01 the client summary is compact and every detail reads in full', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165', 'the reviewer width only');
    const c = readCtx();
    test.skip(!c.recordId, '19a sent nothing');
    await openRecord(page, c.recordId, info);
    const card = page.getByTestId('client-card');
    for (const label of [
      'Form Name',
      'Service',
      'Status',
      'Date Sent',
      'Due Date',
      'Expires',
      'Submitted',
      'Assigned To',
    ])
      await expect(card).toContainText(label);
    // Two rows of facts; the run's long synthetic names wrap inside them (200 px in the mock,
    // whose names are short).
    expect((await card.boundingBox())!.height, 'the summary is compact').toBeLessThan(260);
    for (const text of [LEAD_NAME, LEAD_EMAIL]) {
      const el = card.getByText(text, { exact: true }).first();
      await expect(el).toBeVisible();
      expect(
        await el.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
        `"${text}" is not cut short`,
      ).toBeTruthy();
    }
    await shot(page, TAB, 'DESIGN-01-summary', info);
  });

  test('18d the Overview shows the sections of the form as it was sent, no tax sections', async ({
    page,
  }, info) => {
    const c = readCtx();
    test.skip(!c.recordId, '19a sent nothing');
    await openRecord(page, c.recordId, info);
    await expect(page.getByTestId('card-unanswered')).toContainText(SECTION);
    for (const tax of ['card-personal', 'card-dependents', 'card-income', 'card-deductions'])
      await expect(page.getByTestId(tax)).toHaveCount(0);
    await shot(page, TAB, '18d-overview', info);
  });

  test('INTAKE-EXPIRY-01 the sent form shows its exact expiration; Extend Expiration takes a later time only, and it stays after a reload', async ({
    page,
  }, info) => {
    const c = readCtx();
    test.skip(!c.recordId, '19a sent nothing');
    await openRecord(page, c.recordId, info);
    const card = page.getByTestId('client-card');
    await expect(card).toContainText(/Expires[\s\S]*\d{1,2}:\d{2}\s?[AP]M/);
    await moreAction(page, 'Extend Expiration');
    const dialog = page.getByTestId('extend-dialog');
    await expect(dialog.getByLabel('Expiration', { exact: true })).toHaveValue('AT');
    await expect(dialog).toContainText('Times are in');
    await dialog.getByLabel('Expiration date').fill(firmDay(-1));
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toContainText(LATER);
    await shot(page, TAB, 'EXPIRY-01-extend-refused', info);
    await dialog.getByLabel('Expiration date').fill(firmDay(3));
    await dialog.getByLabel('Expiration time').fill('17:30');
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Expiration saved.')).toBeVisible();
    await expect(card).toContainText(/5:30\s?PM/);
    await page.reload();
    await expect(page.getByTestId('client-card')).toContainText(/5:30\s?PM/, { timeout: 60_000 });
    await shot(page, TAB, 'EXPIRY-01-extended', info);
  });

  test('24b-i Notes: a note saves with its author and time, for the firm only, and stays after a reload', async ({
    page,
  }, info) => {
    const c = readCtx();
    test.skip(!c.recordId, '19a sent nothing');
    await openRecord(page, c.recordId, info, '/notes');
    const text = page.getByLabel('Add a note (only your firm sees it)');
    await expect(text).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Note' })).toBeDisabled();
    const list = page.getByTestId('note-list');
    if (!(await list.filter({ hasText: NOTE }).count())) {
      await text.fill(NOTE);
      await page.getByRole('button', { name: 'Save Note' }).click();
    }
    await expect(list).toContainText(NOTE);
    if (c.ownerName) await expect(list).toContainText(c.ownerName);
    await page.reload();
    await expect(page.getByTestId('note-list')).toContainText(NOTE, { timeout: 60_000 });
    await shot(page, TAB, '24bi-note', info);
  });

  test('24b-ii Export PDF opens a readable PDF in its own tab; the review stays where it is', async ({
    page,
  }, info) => {
    const c = readCtx();
    test.skip(!c.recordId, '19a sent nothing');
    await openRecord(page, c.recordId, info, '/responses');
    const [popup, res] = await Promise.all([
      page.waitForEvent('popup'),
      page.waitForResponse((r) => /\/api\/v1\/business\/intakes\/[^/]+\/pdf/.test(r.url())),
      page.getByRole('button', { name: 'Export PDF' }).click(),
    ]);
    expect(res.status(), 'the PDF link is made').toBe(200);
    const link = (await res.json()) as { url: string };
    const file = await page.request.get(new URL(link.url, appUrl).toString());
    expect(file.ok(), 'the PDF downloads').toBe(true);
    expect((await file.body()).subarray(0, 5).toString(), 'it is a PDF').toBe('%PDF-');
    await popup.close();
    await expect(page).toHaveURL(new RegExp(`/intake-forms/${c.recordId}/responses$`));
    await expect(page.getByTestId('intake-tab-responses')).toBeVisible();
    await shot(page, TAB, '24bii-pdf', info);
  });

  test('INTAKE-USABILITY-04 a failed Export PDF says why and keeps the review where it is (failure simulated in the browser)', async ({
    page,
  }, info) => {
    const c = readCtx();
    test.skip(!c.recordId, '19a sent nothing');
    // Only this browser sees the failure: the request never reaches the API.
    await page.route(/\/api\/v1\/business\/intakes\/[^/]+\/pdf/, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'INTERNAL', message: 'Simulated by the live check' }),
      }),
    );
    await openRecord(page, c.recordId, info, '/responses');
    await page.getByRole('button', { name: 'Export PDF' }).click();
    await expect(page.getByText(/The PDF couldn.t be made/)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/intake-forms/${c.recordId}/responses$`));
    await expect(page.getByTestId('intake-tab-responses')).toBeVisible();
    await shot(page, TAB, 'USABILITY-04-failed', info);
    note(info, 'simulated', 'the PDF request answered 500 in this browser only');
  });

  test('24c-i a change to the published form is saved as its next draft version and published; the published one is unchanged meanwhile', async ({
    page,
    browser,
  }, info) => {
    const c = await fixture(browser);
    test.skip(!c.recordId, '19a sent nothing');
    await openBuilder(page, c.formId, info);
    if (await page.getByRole('button', { name: `Edit ${SECTION_V2}`, exact: true }).count()) {
      note(info, 'rerun', 'the new version was made earlier in this run');
    } else {
      await page.getByRole('button', { name: `Edit ${SECTION}`, exact: true }).click();
      const edit = page.getByRole('dialog', { name: 'Edit Section' });
      await edit.getByLabel('Section title').fill(SECTION_V2);
      await edit.getByRole('button', { name: 'Save Section' }).click();
      await page.getByRole('button', { name: 'Save as Draft' }).click();
      await expect(builderStatus(page)).toContainText(
        'Saved as a new draft. The published form is unchanged.',
        { timeout: 60_000 },
      );
      const id = builderId(page.url());
      if (id && id !== c.formId) addCopy(id);
      await page.getByRole('button', { name: 'Publish Form' }).click();
      // The words depend on what the builder holds (a draft over the published version reads as
      // a first publish): either says the form is published.
      await expect(builderStatus(page)).toContainText(
        /Published as a new version\. Forms already sent keep the earlier one\.|Form published\. It can now be sent\./,
        { timeout: 60_000 },
      );
      await shot(page, TAB, '24ci-new-version', info);
      // Publishing opens Share & Publish; closed when it shows.
      await page
        .getByRole('dialog', { name: FORM })
        .getByRole('button', { name: 'Done' })
        .click({ timeout: 10_000 })
        .catch(() => {});
    }
    await openBuilder(page, c.formId, info);
    await expect(page.getByTestId('form-section').filter({ hasText: SECTION_V2 })).toHaveCount(1);
    // That the sent form keeps v1 is checked by INTAKE-USABILITY-03 (Duplicate copies the version
    // sent): its Overview shows nothing for a lead's form (18d).
  });
});

// ================================================================ Staff, before the form is theirs

test.describe('Staff before assignment', () => {
  test.use(as('staff'));
  test.skip(() => !hasLogin('staff'), 'no staff login');

  test('23-i Staff: the settings are read only; the sharing switches are off for Staff; a form not theirs is neither listed nor opened', async ({
    page,
    browser,
  }, info) => {
    // The form sent to the run's lead, whose staff member is the Owner (not this Staff member).
    const c = await sentFixture(browser);
    await openSettings(page, info);
    await expect(
      page.getByText('Only an owner or admin can change these settings.').first(),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save Changes' }).first()).toBeDisabled();
    await expect(page.getByRole('switch', { name: 'Allow save and resume' })).toBeDisabled();
    await shot(page, TAB, '23i-staff-settings', info);
    await openLibrary(page, info, STAMP);
    const share = await openShare(page, FORM);
    await expect(share.getByText('Only an Owner or Admin can change these.')).toBeVisible();
    await expect(share.getByRole('switch', { name: 'Publish in client portal' })).toBeDisabled();
    await shot(page, TAB, '23i-staff-share', info);
    await closeShare(page, FORM);
    await openList(page, info);
    await searchList(page, STAMP);
    await expectTotal(page, 0, 'Staff do not see a form that is not theirs');
    await open(page, recordUrl(c.recordId), info);
    await expect(page.getByTestId('detail-state')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('client-card')).not.toContainText(LEAD_NAME);
    await shot(page, TAB, '23i-staff-refused', info);
  });
});

// ================================================================ Direct management (Owner)

test.describe('Direct management (Owner)', () => {
  test.use(as('owner'));
  test.skip(() => !hasLogin('owner'), 'no owner login');

  test('INTAKE-USABILITY-03 Assign Staff, Extend Expiration, Duplicate and Archive on the form and its row; Assign Staff saves; Duplicate copies the version sent', async ({
    page,
    browser,
  }, info) => {
    const c = await sentFixture(browser);
    await openList(page, info);
    await searchList(page, STAMP);
    await expectTotal(page, 1, 'the run form');
    await listTable(page)
      .getByRole('button', { name: `Actions for ${LEAD_NAME}` })
      .click();
    for (const name of [
      'View form',
      'Open send workflow',
      'Resend form',
      'Send reminder',
      'Assign Staff',
      'Extend Expiration',
      'Duplicate',
      'Archive',
    ])
      await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible();
    await shot(page, TAB, 'USABILITY-03-row-menu', info);
    await page.keyboard.press('Escape');
    await openRecord(page, c.recordId, info);
    await page.getByRole('button', { name: 'More actions' }).click();
    for (const name of ['Assign Staff', 'Extend Expiration', 'Duplicate', 'Archive'])
      await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    if (c.staffId) {
      // #1613: Assign Staff offers the Owner and Admins, the lead's (or client's) own staff member
      // and whoever has the form now, and says so. The harness Staff member is not the lead's
      // yet (the lead is the Owner's): not offered.
      const dialog = page.getByRole('dialog', { name: 'Assign Staff' });
      const who = page.getByTestId('assign-dialog').getByLabel('Assigned to');
      const option = (userId: string) => who.locator(`option[value="${userId}"]`);
      await moreAction(page, 'Assign Staff');
      await expect(page.getByTestId('assign-hint')).toHaveText(
        'Only staff who work with this client can be assigned.',
      );
      await expect(option(c.ownerId), 'the Owner is offered').toHaveCount(1);
      await expect(option(c.staffId), 'a Staff member not the lead’s is not offered').toHaveCount(
        0,
      );
      await shot(page, TAB, 'USABILITY-03-not-offered', info);
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toBeHidden();
      // The product's way to make them eligible (setup): the lead becomes theirs, as Leads >
      // Assign Staff does (the same bulk route).
      await withOwner(browser, async (api) =>
        ok(
          await api.post('business/leads/bulk', {
            action: 'ASSIGN',
            ids: [c.leadId],
            assignedUserId: c.staffId,
          }),
          'the lead to Staff',
        ),
      );
      await page.reload();
      await expect(page.getByTestId('client-card')).toContainText(LEAD_NAME, { timeout: 60_000 });
      await moreAction(page, 'Assign Staff');
      await expect(option(c.staffId), 'the lead’s own staff member is offered').toHaveCount(1);
      await who.selectOption(c.staffId);
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByText('Staff assigned.')).toBeVisible();
      await page.reload();
      // The card shortens the first name ("QA Perf Staff B" reads "Q. Perf Staff B").
      const parts = c.staffName.split(' ');
      const shown = parts.length > 1 ? parts.slice(1).join(' ') : c.staffName;
      await expect(page.getByTestId('client-card')).toContainText(shown, { timeout: 60_000 });
      await shot(page, TAB, 'USABILITY-03-assigned', info);
    } else {
      note(info, 'skipped part', 'Assign Staff: no staff login to assign');
    }
    await moreAction(page, 'Duplicate');
    await expect(page.getByTestId('duplicate-dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Duplicate', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/intake-forms/builder/${UUID}$`), { timeout: 60_000 });
    addCopy(builderId(page.url()));
    await expect(formNameField(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('form-section').filter({ hasText: SECTION })).toHaveCount(1);
    await expect(page.getByTestId('form-section').filter({ hasText: SECTION_V2 })).toHaveCount(0);
    await shot(page, TAB, 'USABILITY-03-duplicate', info);
  });
});

// ================================================================ Staff, once the form is theirs

test.describe('Staff after assignment', () => {
  test.use(as('staff'));
  test.skip(() => !hasLogin('staff'), 'no staff login');

  test('23-i Staff: a form assigned to them is listed and opens; Assign Staff and Duplicate are not offered', async ({
    page,
  }, info) => {
    const c = readCtx();
    test.skip(!c.recordId || !c.staffId, 'no sent form assigned to Staff');
    await openList(page, info);
    await searchList(page, STAMP);
    await expectTotal(page, 1, 'Staff see the form assigned to them');
    await openRecord(page, c.recordId, info);
    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(
      page.getByRole('menuitem', { name: 'Extend Expiration', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Assign Staff', exact: true })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Duplicate', exact: true })).toHaveCount(0);
    await shot(page, TAB, '23i-staff-assigned', info);
    await page.keyboard.press('Escape');
  });
});

// ================================================================ The portal, as the client (read only)

test.describe('Portal (Client 1, read only)', () => {
  test.use(as('client'));
  test.skip(() => !hasLogin('client'), 'no client login');

  test('INTAKE-ACCESS-01 the client opens their own form by its own address; another form is refused', async ({
    page,
  }, info) => {
    const c = readCtx();
    await open(page, portal('/intake'), info);
    const sent = page.getByTestId('sent-intakes');
    if (await sent.count()) {
      const first = sent.getByRole('listitem').first();
      // The row reads: its title, its service and status, then Open form or View.
      const title =
        (await first.innerText())
          .split('\n')
          .find((s) => s.trim())
          ?.trim() ?? '';
      const link = first.getByRole('link');
      const href = (await link.getAttribute('href')) ?? '';
      expect(href).toMatch(new RegExp(`^/${firmSlug}/intake/${UUID}$`));
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${esc(href)}$`), { timeout: 60_000 });
      const form = page.getByTestId('assigned-intake');
      await expect(form).toBeVisible({ timeout: 60_000 });
      await expect(form.getByRole('heading', { level: 1 }).first()).toContainText(title);
      await shot(page, TAB, 'ACCESS-01-own-form', info);
    } else {
      note(info, 'NOT LIVE', 'ACCESS-01 own form: Client 1 has no form from the firm to open');
    }
    test.skip(!c.recordId, '19a sent nothing: no other form to try');
    await open(page, portal(`/intake/${c.recordId}`), info);
    await expect(page.getByText(/couldn.t find this|not found/i).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByRole('heading', { name: FORM })).toHaveCount(0);
    await expect(page.getByTestId('intake-next')).toHaveCount(0);
    await shot(page, TAB, 'ACCESS-01-other-refused', info);
  });

  test('19c a portal notice of a sent form opens that exact form (only a notice already read is opened)', async ({
    page,
  }, info) => {
    const intakeNotices = await clientIntakeNotices();
    test.skip(
      !intakeNotices.length,
      'Client 1 has no intake notice (a new one needs a send to Client 1)',
    );
    test.skip(
      intakeNotices.some((n) => !n.readAt),
      'an intake notice of Client 1 is unread: opening one would mark it read, so none is opened',
    );
    await open(page, portal('/notifications'), info);
    const title = intakeNotices[0]!.title;
    await page
      .getByRole('button', { name: new RegExp(esc(title)) })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/${firmSlug}/intake/(${UUID})$`), { timeout: 60_000 });
    const opened = new URL(page.url()).pathname.split('/').pop()!;
    expect(intakeNotices.map((n) => n.target.id)).toContain(opened);
    await expect(page.getByTestId('assigned-intake')).toBeVisible({ timeout: 60_000 });
    await shot(page, TAB, '19c-notice-opens-form', info);
  });

  test('INTAKE-ACCESS-02e the portal lists only the forms the firm published there: no fixed cards, no dead button', async ({
    page,
  }, info) => {
    await open(page, portal('/intake'), info);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Select an Intake Form' }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Other Tax Services Intake Form')).toHaveCount(0);
    await expect(page.getByText('Go to Intake Form')).toHaveCount(0);
    const cards = page.getByTestId('portal-form');
    if (await cards.count()) {
      for (const card of await cards.all())
        await expect(
          card
            .getByRole('button', { name: /^Start / })
            .or(card.getByRole('link', { name: /^Continue / })),
        ).toHaveCount(1);
    } else {
      await expect(page.getByTestId('no-portal-forms')).toContainText(
        /Your firm hasn.t published any forms yet/,
      );
    }
    await shot(page, TAB, '02e-portal-list', info);
  });
});

test.describe('Portal, signed out', () => {
  test('INTAKE-ACCESS-01 signed out, a form address goes to sign-in and keeps the way back to it', async ({
    browser,
  }) => {
    const id = readCtx().recordId || '00000000-0000-4000-8000-000000000000';
    const want = new RegExp(
      `/${firmSlug}/sign-in\\?next=${esc(encodeURIComponent(`/${firmSlug}/intake/${id}`))}`,
    );
    // A browser of its own, closed before any check can fail: a sign-in screen is never captured.
    const v = await visitor(browser);
    const reached = await (async () => {
      try {
        await v.page.goto(portal(`/intake/${id}`));
        await v.page.waitForURL(want, { timeout: 60_000 }).catch(() => {});
        return v.page.url();
      } finally {
        // Away from the sign-in screen before closing: a closing page may be captured.
        await v.page.goto('about:blank').catch(() => {});
        await v.ctx.close();
      }
    })();
    expect(reached, 'signed out, the form address goes to sign-in with the way back').toMatch(want);
  });
});

// ================================================================ Archive (Owner)

test.describe('Archive (Owner)', () => {
  test.use(as('owner'));
  test.skip(() => !hasLogin('owner'), 'no owner login');

  test('24c-i INTAKE-USABILITY-03 Archive from the form: asked first; it leaves the open lists and its actions go', async ({
    page,
  }, info) => {
    const c = readCtx();
    test.skip(!c.recordId, '19a sent nothing');
    await openRecord(page, c.recordId, info);
    await moreAction(page, 'Archive');
    const dialog = page.getByRole('dialog', { name: 'Archive this form?' });
    await expect(dialog).toContainText('It is kept, with its answers and history.');
    await shot(page, TAB, '24ci-archive-asks', info);
    await dialog.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(page.getByText('Form archived.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'More actions' })).toHaveCount(0);
    await openList(page, info);
    await searchList(page, STAMP);
    await expectTotal(page, 0, 'an archived form leaves the open lists');
    await shot(page, TAB, '24ci-archived', info);
  });
});

// ================================================================ Layout at 1165 and 390 px

interface LayoutIds {
  formId: string;
  recordId: string;
  shareUrl: string;
}
/** The run's form and sent form (archived after cleanup), else any of the firm's; never makes one. */
async function layoutIds(browser: Browser): Promise<LayoutIds> {
  const c = readCtx();
  return withOwner(browser, async (api) => {
    let formId = c.formId;
    let recordId = c.recordId;
    if (!formId) {
      const r = await api.get('business/intake-forms?templates=all');
      if (r.ok()) formId = (itemsOf(await r.json())[0]?.id as string | undefined) ?? '';
    }
    if (!recordId) {
      const r = await api.get('business/intakes?tab=all&pageSize=1');
      if (r.ok()) recordId = (itemsOf(await r.json())[0]?.id as string | undefined) ?? '';
    }
    let shareUrl = '';
    if (formId) {
      const r = await api.get(`business/intake-forms/${formId}/share`);
      if (r.ok()) shareUrl = ((await r.json()).link?.url as string | undefined) ?? '';
    }
    return { formId, recordId, shareUrl };
  });
}

async function layoutCheck(page: Page, url: string, name: string, info: TestInfo) {
  await page.goto(url);
  await expect(page).not.toHaveURL(/\/sign-in/);
  await settled(page);
  await page.waitForTimeout(1000);
  if (name === 'settings') await page.addStyleTag({ content: HIDE_OWN_EMAIL });
  await shot(page, TAB, `layout-${name}`, info);
  await expectNoSideScroll(page);
}

const FIRM_PAGES: [string, (x: LayoutIds) => string][] = [
  ['list', () => '/intake-forms'],
  ['templates', () => '/intake-forms/templates'],
  ['settings', () => '/intake-forms/settings'],
  ['send', () => '/intake-forms/send'],
  ['builder', (x) => (x.formId ? `/intake-forms/builder/${x.formId}` : '')],
  ['builder-logic', (x) => (x.formId ? `/intake-forms/builder/${x.formId}/logic` : '')],
  ['builder-preview', (x) => (x.formId ? `/intake-forms/builder/${x.formId}/preview` : '')],
  ['detail-overview', (x) => (x.recordId ? `/intake-forms/${x.recordId}` : '')],
  ['detail-responses', (x) => (x.recordId ? `/intake-forms/${x.recordId}/responses` : '')],
  ['detail-documents', (x) => (x.recordId ? `/intake-forms/${x.recordId}/documents` : '')],
  ['detail-notes', (x) => (x.recordId ? `/intake-forms/${x.recordId}/notes` : '')],
  ['detail-communication', (x) => (x.recordId ? `/intake-forms/${x.recordId}/communication` : '')],
  ['detail-history', (x) => (x.recordId ? `/intake-forms/${x.recordId}/history` : '')],
];

test.describe('Layout (Owner)', () => {
  test.use(as('owner'));
  test.skip(() => !hasLogin('owner'), 'no owner login');
  test.beforeAll(async ({ browser }) => {
    await freshSession(browser, 'owner');
  });

  for (const [name, path] of FIRM_PAGES) {
    test(`@narrow layout ${name}: no sideways scroll`, async ({ page, browser }, info) => {
      const p = path(await layoutIds(browser));
      test.skip(!p, 'no form or sent form to open');
      await layoutCheck(page, app(p), name, info);
    });
  }

  test('@narrow layout Create Intake Form dialog: no sideways scroll', async ({ page }, info) => {
    await openList(page, info);
    await page.getByRole('button', { name: 'Create Intake Form', exact: true }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Create Intake Form' });
    await expect(dialog).toBeVisible();
    await shot(page, TAB, 'layout-create-dialog', info);
    await expectNoSideScroll(page);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
  });

  test('@narrow layout a settings panel: no sideways scroll', async ({ page }, info) => {
    await openSettings(page, info);
    await page.getByRole('button', { name: 'Edit Notifications & Reminders', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'Edit Notifications & Reminders' }),
    ).toBeVisible();
    await shot(page, TAB, 'layout-settings-panel', info);
    await expectNoSideScroll(page);
  });

  test('@narrow layout Share & Publish: no sideways scroll', async ({ page, browser }, info) => {
    const { formId } = await layoutIds(browser);
    test.skip(!formId, 'no form to open');
    await open(page, builderUrl(formId), info);
    await page.getByRole('button', { name: 'More save options' }).click({ timeout: 60_000 });
    await page.getByRole('menuitem', { name: 'Share & Publish' }).click();
    await expect(page.getByTestId('form-share')).toBeVisible();
    await page.waitForTimeout(500);
    await shot(page, TAB, 'layout-share-dialog', info);
    await expectNoSideScroll(page);
  });
});

test.describe('Layout (portal, Client 1 read only)', () => {
  test.use(as('client'));
  test.skip(() => !hasLogin('client'), 'no client login');

  test('@narrow layout portal intake list: no sideways scroll', async ({ page }, info) => {
    await layoutCheck(page, portal('/intake'), 'portal-intake', info);
  });

  test('@narrow layout portal sent form: no sideways scroll', async ({ page }, info) => {
    await open(page, portal('/intake'), info);
    const link = page.getByTestId('sent-intakes').getByRole('link').first();
    test.skip(!(await link.count()), 'Client 1 has no form from the firm');
    const href = (await link.getAttribute('href')) ?? '';
    await layoutCheck(page, `${portalUrl}${href}`, 'portal-sent-form', info);
  });
});

test.describe('Layout (visitor, no session)', () => {
  test('@narrow layout share link page: no sideways scroll', async ({ page, browser }, info) => {
    const { shareUrl } = hasLogin('owner') ? await layoutIds(browser) : { shareUrl: '' };
    // A live link when the run's form is shared, else the page a closed link shows.
    await layoutCheck(page, shareUrl || portal(`/start/${'x'.repeat(43)}`), 'share-link', info);
  });

  test('@narrow layout lead link (a made-up token): no sideways scroll', async ({ page }, info) => {
    await layoutCheck(page, portal(`/form#token=${'x'.repeat(43)}`), 'lead-link', info);
  });
});

// ================================================================ Rows not checked live

const NOT_LIVE: [string, string][] = [
  [
    '9b submission notifications delivered',
    'needs a form submitted: Client 1 cannot receive, QA Appointments Client has no portal login, and a lead submits through the token emailed to a simulator inbox no test can read',
  ],
  [
    '9b-ii the submitted notice after a lead-link submit',
    'needs the secure link from the lead email (simulator inbox)',
  ],
  [
    '12b intake uploads at the size limits',
    'needs a recipient who opens an assigned form and uploads (same as 9b)',
  ],
  [
    '13b encryption in transit and at rest',
    'infrastructure evidence (bucket SSE-KMS, HTTPS only), not on a screen',
  ],
  [
    '14b-ii a record with no job or task',
    'the guard date is server side and nothing is ever removed: nothing to see live',
  ],
  ['15b the old Go to Settings shortcut', 'that control no longer exists; her retest'],
  ['16b the test email reaches an inbox', 'needs a real inbox: her production Review Three'],
  [
    '16c the Owner edits their own Work Email',
    'deferred by her to production Review Three (Staff Management)',
  ],
  ['18c historical record audit', 'her audit of historic records'],
  [
    '19b-ii the Nov 10 email not received',
    'outside action on LVP: SES event history and the dev SES sandbox',
  ],
  [
    '21 the recipient journey (start, save, upload, sign, submit, review)',
    'needs a recipient who can receive and fill the form (same as 9b)',
  ],
  ['22 reminders and the expiration alert delivered', 'timed jobs and a readable inbox'],
  [
    '22-ii no reminder after a submit or completion',
    'needs a submitted or completed form with a reminder due',
  ],
  ['23-a only the accepted file types are taken', 'needs an upload into an open form'],
  ['23-b the staff notice and the client confirmation on submit', 'needs a submit'],
  [
    '23-c to 23-f the automations run',
    'they run on a submit (the settings are checked live above)',
  ],
  [
    '23-g branding off on lead and share links',
    'turning the firm branding off changes every client-facing form; her visual retest',
  ],
  [
    '23-h Allow file uploads off and Show progress bar off on the client page',
    'needs the client page of an open form sent to someone who can open it',
  ],
  ['23-i another firm cannot reach the forms', 'needs a second firm login (never LVP)'],
  ['24b-i the client never sees a note', 'the run form belongs to a lead with no portal'],
  [
    'INTAKE-ACCESS-01 a new send opens from its email and portal notice',
    'needs a send to Client 1, who cannot receive (only her existing forms and notices are read)',
  ],
  [
    'INTAKE-ACCESS-02b a client fills a portal-published form without a send',
    'Start would make a form on Client 1 (Octavia login): only the listing is checked',
  ],
  [
    'INTAKE-ACCESS-02c website embed in an iframe',
    'infrastructure (CloudFront frame-ancestors); the button snippet is checked in 02a',
  ],
  [
    'Checklist: mobile layout on a real device',
    'her real-device check; the @narrow tests are the developer check at 390 px',
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

// ================================================================ Cleanup (after every role's rows)

test.describe('Intake Forms cleanup', () => {
  test.use(as('owner'));
  test.skip(() => !hasLogin('owner'), 'no owner login');

  test('zz cleanup @narrow: archive the run sent form, forms and lead; delete or archive its service and category', async ({
    browser,
  }, info) => {
    const runs = readRegistry().filter((r) => r.tag === runTag || !r.cleaned);
    if (!runs.length) return;
    const done: string[] = [];
    const left: string[] = [];
    await withOwner(browser, async (api) => {
      for (const run of runs) {
        const d: string[] = [];
        const l: string[] = [];
        await cleanRun(api, run, d, l);
        done.push(...d.map((x) => `[${run.tag}] ${x}`));
        left.push(...l.map((x) => `[${run.tag}] ${x}`));
        if (!l.length) saveCtx({ ...run, cleaned: true });
      }
    });
    console.warn(`CLEANUP done:\n${done.join('\n')}\nCLEANUP left:\n${left.join('\n') || 'none'}`);
    info.annotations.push({ type: 'left-behind', description: left.join('; ') || 'none' });
  });
});
