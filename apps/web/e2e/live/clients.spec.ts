import { randomUUID } from 'node:crypto';
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
import { app, as, expectNoSideScroll, hasLogin, portal, settled, shot } from './helpers';

/**
 * Clients, Review Two (Octavia, Nov 3 and her Nov 8 flow check): one test per row (the green ones
 * too), live on dev as Test Firm B's Owner, Admin and Staff, plus P4-7 (#1617): one heading row on
 * every client tab, and Convert (lead to client) offered only to a member who reaches the lead.
 * Rows are named by their IDs only (R55's map, F:/firmivra-private/checks/clients.md).
 *
 * Records: every client this run makes is named "LIVE-CHECK yyyymmddhhmm <name>" and has an SES
 * simulator email (success+live-check-<stamp>-<n>@simulator.amazonses.com), as do its responsible
 * party and the run's lead. The run reuses one catalog service, "LIVE-CHECK Clients" (restored if
 * archived, archived again by cleanup) and one draft service, "LIVE-CHECK Clients Draft" (deleted by
 * cleanup), the one fixed tag "LIVE-CHECK" (tags have no delete), and for the upload (Test Firm B
 * has no document types or folders of its own) one document type "LIVE-CHECK" (restored if
 * archived, archived again by cleanup: types have no delete) and one client folder "LIVE-CHECK"
 * (kept: a folder that holds a file, trashed or not, cannot be deleted). Zeta's started service
 * comes from a draft invoice (I-N01's pending request, which Start Service begins), never sent and
 * deleted at once (a deleted draft is archived). "zz cleanup" archives every
 * client of the run (clients have no delete), trashes its files, cancels its document requests,
 * revokes its portal invitations, archives the intake form it sent, cancels or leaves completed its
 * lead appointment (booked already started, so N8-18 can complete it), archives the lead and the
 * appointment type, and sweeps earlier unfinished runs through the ledger (.runs.json).
 *
 * Sends: only to the run's own clients and lead (simulator addresses), each checked on the record
 * (every address it holds, its portal logins included) right before the send. QA Fixture Client 1
 * (Octavia's portal login) is only read. The portal rows sign in as the harness's own portal client
 * (portalClient(), lead Nov 19); the rows that need a send to it are a later pass. Nothing here emails a staff member ("Send me a copy" is
 * switched off); rows that would are NOT LIVE.
 */
test.describe.configure({ timeout: 180_000 });

const TAB = 'clients';
const TZ = 'America/New_York';
const CLIENT1 = '00000000-0000-4a28-8001-000000000002'; // QA Fixture Client 1: read only

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
/** The tag's digits: one search word that finds this run's clients only. */
const STAMP = runTag.slice('LIVE-CHECK '.length);
const email = (n: number) => `success+live-check-${STAMP}-${n}@simulator.amazonses.com`;
const SIMULATOR = /@simulator\.amazonses\.com$/i;
const EMAILS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const full = (last: string) => `${runTag} ${last}`;
/** A run-unique US phone: (2dd) 5nn-hhmm from the stamp (day, client number, time). */
const phone = (n: number) =>
  `(2${STAMP.slice(6, 8)}) 5${String(n).padStart(2, '0')}-${STAMP.slice(8, 12)}`;
const digits = (n: number) => phone(n).replace(/\D/g, '');
const SERVICE = 'LIVE-CHECK Clients';
const DRAFT = 'LIVE-CHECK Clients Draft';
const CATEGORY = 'LIVE-CHECK';
const TAG = 'LIVE-CHECK';
/** The run's document type and client folder for the upload (reused by each run). */
const DOC_TYPE = 'LIVE-CHECK';
const FOLDER = 'LIVE-CHECK';
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

/** The run's clients (made in the fixture through the API). */
const N = {
  alpha: full('Alpha'),
  beta: full('Beta'),
  gamma: full('Gamma Holdings LLC'),
  delta: full('Delta'),
  epsilon: full('Epsilon'),
  zeta: full('Zeta'),
} as const;
type ClientKey = keyof typeof N;

// ---------------------------------------------------------------- the run's records

interface Ctx {
  tag: string;
  ownerId: string;
  ownerName: string;
  staffId: string;
  staffName: string;
  serviceId: string;
  draftId: string;
  alpha: string;
  beta: string;
  gamma: string;
  delta: string;
  epsilon: string;
  zeta: string;
  engagementId: string;
  /** Zeta's service, pending then started (N8-17's work start: Zeta becomes Active). */
  startedId: string;
  /** The draft invoice that made Zeta's pending service (deleted at once; cleanup again). */
  invoiceId: string;
  docTypeId: string;
  folderId: string;
  leadId: string;
  typeId: string;
  apptId: string;
  docId: string;
  docName: string;
  /** The client made past the duplicate warning (§5), for its audit row. */
  anyway: string;
  /** The intake form sent to Beta (N8-23): archived by cleanup, so it sends no reminder. */
  intakeId: string;
  /** Clients the page tests made. */
  made: string[];
  /** Set on an earlier run's entry once its cleanup left nothing. */
  cleaned?: boolean;
}
const blankCtx = (): Ctx => ({
  tag: runTag,
  ownerId: '',
  ownerName: '',
  staffId: '',
  staffName: '',
  serviceId: '',
  draftId: '',
  alpha: '',
  beta: '',
  gamma: '',
  delta: '',
  epsilon: '',
  zeta: '',
  engagementId: '',
  startedId: '',
  invoiceId: '',
  docTypeId: '',
  folderId: '',
  leadId: '',
  typeId: '',
  apptId: '',
  docId: '',
  docName: '',
  anyway: '',
  intakeId: '',
  made: [],
});
const ctxFile = () => join(process.env['LIVE_OUT_DIR']!, 'clients-ctx.json');
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
const saveCtx = (c: Ctx) => {
  writeFileSync(ctxFile(), JSON.stringify(c, null, 2));
  register(c);
};
const remember = (patch: Partial<Ctx>) => saveCtx({ ...readCtx(), ...patch });

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
 * Refreshes the role's saved session when its access token has expired, as the app does. `firm`
 * (the default) also requires the firm session to be live; false only needs who the person is.
 */
async function freshSession(browser: Browser, role: Role, firm = true): Promise<void> {
  if (!existsSync(statePath(role))) {
    throw new Error(`no saved ${role} session: run the setup project once (without -g)`);
  }
  const ctx = await browser.newContext({ storageState: statePath(role) });
  try {
    const url = (p: string) => `${appUrl}/api/v1/${p}`;
    // A firm route, not /me: only a firm route checks the staff session (SM4), so a session the
    // firm ended, or one past its 8-hour limit, answers 401 here while /me still answers 200.
    const probe = () => ctx.request.get(url(firm ? 'business/clients?limit=10' : 'me'));
    if ((await probe()).status() !== 401) return;
    const r = await ctx.request.post(url('auth/refresh'), {
      headers: { origin: appUrl },
      data: {},
    });
    if (!r.ok()) throw new Error(`${role} session refresh failed (${r.status()}): sign in again`);
    const again = await probe();
    if (firm && again.status() === 401) {
      const code = String(
        ((await again.json().catch(() => null)) as { error?: { code?: string } } | null)?.error
          ?.code ?? '401',
      );
      throw new Error(
        `${role} session ended (${code}): sign the role in again (harness, not a product finding)`,
      );
    }
    const cookies = (await ctx.storageState()).cookies;
    const saved = JSON.parse(readFileSync(statePath(role), 'utf8')) as Record<string, unknown>;
    writeFileSync(statePath(role), JSON.stringify({ ...saved, cookies }, null, 2));
  } finally {
    await ctx.close();
  }
}

/** The role's API through a browser context (setup and cleanup only); a 401 refreshes once. */
async function roleApi(browser: Browser, role: Role, firm = true): Promise<Api> {
  await freshSession(browser, role, firm);
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
const itemsOf = <T>(body: unknown): T[] =>
  Array.isArray(body) ? (body as T[]) : ((body as { items?: T[] } | null)?.items ?? []);

/** YYYY-MM-DD in the firm's zone, `days` from today. */
const firmDay = (days: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(
    new Date(Date.now() + days * 86_400_000),
  );
/** EST until March: every date this run books is in November or December. */
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00-05:00`;
/** The latest weekday at least `days` before today (firm zone). */
function pastWeekday(days: number): string {
  for (let d = days; ; d++) {
    const day = firmDay(-d);
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) return day;
  }
}

/** True when every address the record holds (its portal logins included) is a simulator one. */
async function recordSafe(api: Api, clientId: string): Promise<{ ok: boolean; why: string }> {
  const rec = await api.get(`business/clients/${clientId}`);
  if (!rec.ok()) return { ok: false, why: `record ${rec.status()}` };
  const access = await api.get(`business/clients/${clientId}/portal-access`);
  const text = (await rec.text()) + (access.ok() ? await access.text() : '');
  const unsafe = [...new Set(text.match(EMAILS) ?? [])].filter((e) => !SIMULATOR.test(e));
  return unsafe.length
    ? { ok: false, why: `non-simulator ${unsafe.join(', ')}` }
    : { ok: true, why: '' };
}

const individual = (name: string, n: number, extra: Record<string, unknown> = {}) => ({
  accountType: 'INDIVIDUAL',
  displayName: name,
  email: email(n),
  phone: phone(n),
  allowDuplicatePhone: true,
  profile: {
    address: {
      line1: `${n} ${STAMP} Fake Street`,
      city: 'Atlanta',
      state: 'GA',
      postalCode: '30301',
      country: 'US',
    },
  },
  ...extra,
});

/** Makes a client; if an earlier attempt of this run made it (409 email), finds that one. */
async function ensureClient(api: Api, body: { displayName: string; email: string }) {
  if (!SIMULATOR.test(body.email)) throw new Error(`${body.email} is not a simulator address`);
  const res = await api.post('business/clients', body);
  if (res.ok()) return (await res.json()).id as string;
  if (res.status() !== 409)
    throw new Error(`create ${body.displayName}: ${res.status()} ${await res.text()}`);
  const found = await ok(
    await api.get(`business/clients?search=${encodeURIComponent(body.email)}&status=all&limit=10`),
    'find client',
  );
  const hit = itemsOf<{ id: string; displayName: string }>(found).find(
    (x) => x.displayName === body.displayName,
  );
  if (!hit) throw new Error(`create ${body.displayName}: 409 and not found`);
  return hit.id;
}

/** Our own fixed-name service: found (restored when archived, if it should be live) or made once. */
async function ensureService(api: Api, name: string, live: boolean): Promise<string> {
  const listed = await ok(
    await api.get(`business/catalog/services?status=all&search=${encodeURIComponent(name)}`),
    'services',
  );
  const own = itemsOf<{ id: string; name: string; status: string; archivedAt?: string | null }>(
    listed,
  ).find((x) => x.name === name);
  if (own) {
    if (live && (own.status !== 'ACTIVE' || own.archivedAt))
      await ok(await api.post(`business/catalog/services/${own.id}/activate`), `restore ${name}`);
    return own.id;
  }
  const cats = itemsOf<{ id: string; name: string }>(
    await ok(await api.get('business/catalog/categories'), 'categories'),
  );
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
  }
  const made = await ok(
    await api.post('business/catalog/services', {
      name,
      categoryId,
      shortDescription: 'Live check fixture (synthetic), reused by each run',
      kind: 'OTHER',
      pricingType: 'CUSTOM_QUOTE',
      activate: live,
      allowDuplicateName: true,
    }),
    `service ${name}`,
  );
  return made.id as string;
}

/**
 * The upload's document type and client folder (Test Firm B has none, and Upload Document needs
 * both): ours by name, the type restored when an earlier cleanup archived it, else made once.
 */
async function ensureDocumentSetup(api: Api): Promise<{ typeId: string; folderId: string }> {
  const types = itemsOf<{ id: string; name: string; archivedAt: string | null }>(
    await ok(await api.get('business/document-categories'), 'document types'),
  );
  const type = types.find((x) => x.name === DOC_TYPE);
  if (type?.archivedAt)
    await ok(
      await api.patch(`business/document-categories/${type.id}`, { archived: false }),
      `restore document type ${DOC_TYPE}`,
    );
  const typeId =
    type?.id ??
    ((await ok(await api.post('business/document-categories', { name: DOC_TYPE }), 'document type'))
      .id as string);
  const folders = itemsOf<{ id: string; name: string; scope: string; parentId: string | null }>(
    await ok(await api.get('business/document-folders'), 'document folders'),
  );
  const folder = folders.find((f) => f.name === FOLDER && f.scope === 'CLIENT' && !f.parentId);
  const folderId =
    folder?.id ??
    ((
      await ok(
        await api.post('business/document-folders', {
          name: FOLDER,
          scope: 'CLIENT',
          // Internal: no client uploads, nothing shown to clients by default, no staff notices.
          allowClientUploads: false,
          notifyStaffOnUpload: false,
          defaultClientAccess: 'NONE',
        }),
        'document folder',
      )
    ).id as string);
  return { typeId, folderId };
}

/**
 * Finds the run's records, or makes them (saved after each, so a restarted worker resumes): who
 * is who, the reused service and draft service, the fixed tag, six clients, Alpha's engagement
 * (enrolled), Zeta's (pending, then started), the upload's document type and folder, and for P4-7
 * a lead of the Owner's with an appointment whose staff member is Staff.
 */
async function fixture(browser: Browser): Promise<Ctx> {
  let c = blankCtx();
  if (existsSync(ctxFile())) {
    const old = readCtx();
    if (old.tag === runTag) c = old;
    else register(old);
  }
  if (
    c.ownerId &&
    c.zeta &&
    c.engagementId &&
    c.startedId &&
    c.folderId &&
    c.leadId &&
    (c.apptId || !c.staffId)
  )
    return c;
  const api = await roleApi(browser, 'owner');
  try {
    if (!c.ownerId) {
      for (const run of readRegistry().filter((r) => r.tag !== runTag && !r.cleaned)) {
        const left: string[] = [];
        const swept: string[] = [];
        await cleanRun(api, run, swept, left, false);
        const files = swept.filter((x) => x.startsWith('file '));
        if (files.length) console.log(`EARLIER RUN ${run.tag} files: ${files.join('; ')}`);
        if (!left.length) register({ ...run, cleaned: true });
        else console.log(`EARLIER RUN ${run.tag} left: ${left.join('; ')}`);
      }
      c.ownerId = (await ok(await api.get('me'), 'me')).user.id as string;
      if (hasLogin('staff')) {
        // Only who Staff is (/me): the Staff rows check their own firm session.
        const s = await roleApi(browser, 'staff', false);
        c.staffId = (await ok(await s.get('me'), 'staff me')).user.id as string;
        await s.dispose();
      }
      const opts = await ok(await api.get('business/leads/options'), 'options');
      const staff = (opts.staff ?? []) as { userId: string; name: string }[];
      c.ownerName = staff.find((m) => m.userId === c.ownerId)?.name ?? '';
      c.staffName = staff.find((m) => m.userId === c.staffId)?.name ?? '';
      saveCtx(c);
    }
    if (!c.serviceId) {
      c.serviceId = await ensureService(api, SERVICE, true);
      saveCtx(c);
    }
    if (!c.draftId) {
      c.draftId = await ensureService(api, DRAFT, false);
      saveCtx(c);
    }
    const tags = itemsOf<{ name: string }>(await ok(await api.get('business/tags'), 'tags'));
    if (!tags.some((t) => t.name === TAG))
      await ok(await api.post('business/tags', { name: TAG }), 'tag');
    const make = async (key: ClientKey, body: { displayName: string; email: string }) => {
      if (c[key]) return;
      c[key] = await ensureClient(api, body);
      saveCtx(c);
    };
    const owner = { assignedUserId: c.ownerId };
    await make('alpha', individual(N.alpha, 1, owner));
    await make('beta', individual(N.beta, 2, c.staffId ? { assignedUserId: c.staffId } : {}));
    await make('gamma', {
      accountType: 'BUSINESS',
      displayName: N.gamma,
      email: email(3),
      phone: phone(3),
      allowDuplicatePhone: true,
      profile: {
        businessName: N.gamma,
        address: {
          line1: `3 ${STAMP} Dock Street`,
          city: 'Savannah',
          state: 'GA',
          postalCode: '31401',
          country: 'US',
        },
        responsibleParty: { name: full('Gamma Owner'), email: email(4), phone: phone(4) },
      },
    } as { displayName: string; email: string });
    await make('delta', individual(N.delta, 5, owner));
    await make('epsilon', individual(N.epsilon, 6, owner));
    await make('zeta', individual(N.zeta, 7, owner));
    if (!c.engagementId) {
      // Alpha's enrolled service (Enroll: an active service; the client stays New by design).
      const e = await ok(
        await api.post(`business/clients/${c.alpha}/engagements`, {
          serviceId: c.serviceId,
          title: `${runTag} engagement`,
        }),
        'enroll Alpha',
      );
      c.engagementId = e.id as string;
      saveCtx(c);
    }
    if (!c.startedId) {
      // N8-17's work start is Start Service on a pending (requested) service (enrolling leaves
      // the client New: api clients/client-activation.ts). The firm's way to a pending one is a
      // draft invoice for the service (I-N01): made with no email and deleted at once (a deleted
      // draft is archived), never sent. Zeta's started service makes Zeta an Active client.
      const inv = await ok(
        await api.post('business/invoices', {
          clientId: c.zeta,
          serviceId: c.serviceId,
          lines: [{ description: `${runTag} fixture line (synthetic)`, unitAmountCents: 100 }],
          dueOn: firmDay(30),
          emailClient: false,
        }),
        "draft invoice for Zeta's pending service",
      );
      c.invoiceId = inv.id as string;
      saveCtx(c);
      const del = await api.delete(`business/invoices/${c.invoiceId}`);
      if (!del.ok()) console.log(`delete the fixture draft invoice: ${del.status()}`);
      let startedId = (inv.service?.id as string | undefined) ?? '';
      if (!startedId) {
        const pending = itemsOf<{ id: string }>(
          await ok(
            await api.get(`business/clients/${c.zeta}/engagements?status=PENDING`),
            "Zeta's pending services",
          ),
        );
        startedId = pending[0]?.id ?? '';
      }
      if (!startedId) throw new Error('the draft invoice made no pending service for Zeta');
      c.startedId = startedId;
      saveCtx(c);
      const s = await api.post(`business/engagements/${c.startedId}/activate`);
      if (!s.ok())
        console.log(`start Zeta's service: ${s.status()} ${(await s.text()).slice(0, 200)}`);
    }
    if (!c.folderId) {
      const d = await ensureDocumentSetup(api);
      c.docTypeId = d.typeId;
      c.folderId = d.folderId;
      saveCtx(c);
    }
    if (!c.leadId) {
      if (!SIMULATOR.test(email(8))) throw new Error('lead email is not a simulator address');
      const lead = await ok(
        await api.post('business/leads', {
          firstName: runTag,
          lastName: 'Lead',
          email: email(8),
          phone: phone(8),
          source: 'OTHER',
          sourceDetail: `${runTag} synthetic`,
          priority: 'WARM',
          allowDuplicate: true,
          assignedUserId: c.ownerId,
          serviceIds: [c.serviceId],
        }),
        'lead',
      );
      c.leadId = lead.id as string;
      saveCtx(c);
    }
    if (!c.typeId) {
      const t = await ok(
        await api.post('business/appointment-types', {
          name: `${runTag} Clients 30m`,
          durationMinutes: 30,
          methods: ['PHONE'],
          clientBookable: false,
        }),
        'appointment type',
      );
      c.typeId = t.id as string;
      saveCtx(c);
    }
    if (!c.apptId && c.staffId) {
      // The lead is the Owner's; the appointment's staff member is Staff. It has already started
      // (a recent past weekday, as appointments.spec.ts books P4's): the API completes only a
      // started appointment (N8-18), and nothing is sent for a past one. No confirmation either
      // (sendConfirmation false); the lead's address is a simulator one all the same.
      // Every half hour of a working day on the last few weekdays: completed lead appointments of
      // earlier runs stay booked (a completed one is never cancelled), and the Appointments check
      // books past weekdays too, so a fixed slot or two is soon taken (a hard conflict).
      const hhmm = (m: number) =>
        `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      const slots: [string, string][] = [];
      for (let m = 9 * 60; m + 30 <= 17 * 60; m += 30) slots.push([hhmm(m), hhmm(m + 30)]);
      const days = [...new Set([1, 2, 3, 4, 5, 6, 7].map((d) => pastWeekday(d)))];
      const body = (day: string, s: [string, string], override = false) => ({
        idempotencyKey: randomUUID(),
        contact: { kind: 'LEAD', id: c.leadId },
        typeId: c.typeId,
        startsAt: at(day, s[0]),
        endsAt: at(day, s[1]),
        allDay: false,
        method: 'PHONE',
        staffUserIds: [c.staffId],
        status: 'CONFIRMED',
        sendConfirmation: false,
        reminders: [],
        details: `${runTag} lead appointment (synthetic)`,
        ...(override ? { overrideConflicts: { reason: `${runTag} live check fixture` } } : {}),
      });
      const book = async (day: string, s: [string, string], override = false) => {
        const r = await api.post('business/appointments/schedule', body(day, s, override));
        if (!r.ok()) return `${r.status()} ${(await r.text()).slice(0, 300)}`;
        const made = await r.json();
        c.apptId = (made.id ?? made.appointment?.id ?? made.items?.[0]?.id) as string;
        return '';
      };
      let last = '';
      outer: for (const day of days) {
        for (const s of slots) {
          last = await book(day, s);
          if (c.apptId) break outer;
        }
      }
      // Outside Staff's hours (a soft conflict): the Owner books it anyway, with a reason.
      for (const s of [
        ['07:00', '07:30'],
        ['07:30', '08:00'],
        ['18:00', '18:30'],
        ['18:30', '19:00'],
      ] as [string, string][]) {
        if (c.apptId) break;
        last = `${last}; override ${await book(days[0]!, s, true)}`;
      }
      if (!c.apptId) console.log(`lead appointment not booked: ${last.slice(-700)}`);
      saveCtx(c);
    }
    return c;
  } finally {
    await api.dispose();
  }
}

// ---------------------------------------------------------------- page helpers

const signIn = (page: Page) => page.getByRole('heading', { name: 'Welcome Back' });
async function failIfSignedOut(page: Page) {
  if (
    await signIn(page)
      .isVisible()
      .catch(() => false)
  ) {
    await page.goto('about:blank');
    throw new Error(
      'the page went to sign-in: the session was lost (harness, not a product finding)',
    );
  }
}
const title = (page: Page) => page.getByTestId('page-title');
const main = (page: Page) => page.getByRole('main');

async function openClients(page: Page, query = '') {
  await page.goto(app(`/clients${query}`));
  await expect(title(page).or(signIn(page))).toBeVisible({ timeout: 60_000 });
  await failIfSignedOut(page);
  await expect(title(page)).toHaveText('Clients');
  await settled(page);
}
async function openClient(page: Page, id: string, path = '') {
  await page.goto(app(`/clients/${id}${path}`));
  await expect(title(page).or(signIn(page))).toBeVisible({ timeout: 60_000 });
  await failIfSignedOut(page);
  await expect(title(page)).toContainText(STAMP, { timeout: 60_000 });
  await settled(page);
}
/** The list's entries: cards below 1440 px (her 1165 px too), table rows wider. */
const entries = (page: Page) =>
  page
    .locator('[data-testid="client-card"], [data-testid="clients-table"] tbody tr')
    .filter({ visible: true });
const entry = (page: Page, name: string) => entries(page).filter({ hasText: name });
const searchBox = (page: Page) => main(page).getByLabel('Search clients');
async function searchFor(page: Page, text: string) {
  await searchBox(page).fill(text);
  await expect(page).toHaveURL(/[?&]search=/);
  await settled(page);
}
const summaryLine = (page: Page) =>
  page
    .getByText(/Showing \d+ – \d+ of [\d,]+ clients/)
    .filter({ visible: true })
    .first();
const emptyLine = (page: Page) =>
  page
    .getByText(/^No (matching )?clients/)
    .filter({ visible: true })
    .first();
/** "Showing 1 – 8 of 12 clients": the 12; 0 when the list says none. */
async function listTotal(page: Page): Promise<number> {
  await expect(summaryLine(page).or(emptyLine(page))).toBeVisible({ timeout: 30_000 });
  if (
    await emptyLine(page)
      .isVisible()
      .catch(() => false)
  )
    return 0;
  const m = /of\s+([\d,]+)\s+clients/.exec(await summaryLine(page).innerText());
  return m ? Number(m[1]!.replace(/,/g, '')) : -1;
}
/** A summary card by its label, case-sensitive ("Active Clients" is not "Inactive Clients"). */
const kpi = (page: Page, label: string) =>
  page.getByTestId('kpi-card').filter({ hasText: new RegExp(label) });
async function kpiNumber(page: Page, label: string): Promise<number> {
  const card = kpi(page, label);
  await expect(card).toContainText(/\d/, { timeout: 60_000 });
  return Number(/(\d[\d,]*)/.exec(await card.innerText())![1]!.replace(/,/g, ''));
}
const viewTab = (page: Page, name: string) =>
  page
    .getByRole('tablist', { name: 'Client views' })
    .getByRole('tab', { name: new RegExp(`^${name}`) });
const tabHeader = (page: Page) => page.getByTestId('client-tab-header');
const assignedOnProfile = (page: Page) =>
  page
    .getByTestId('client-overview')
    .locator('dt', { hasText: /^Assigned to$/ })
    .locator('xpath=following-sibling::dd[1]');
/**
 * The member's name as the list shortens it: first initial and last word ("QA Perf Staff B" shows
 * as "Q. B"; list-parts.ts shortName).
 */
const tail = (name: string) => {
  const words = name.trim().split(/\s+/);
  return words.length > 1 ? `${words[0]!.charAt(0)}. ${words.at(-1)!}` : name;
};
/**
 * Firm Sign's state on a page behind its gate: true when it is off for the firm (Test Firm B's
 * today; Firm Sign is switched on by the platform, never here). Waits for the gate or `on`.
 */
async function firmSignOff(page: Page, on: Locator): Promise<boolean> {
  const off = page.getByText('Firm Sign is off', { exact: true });
  await expect(on.or(off).first()).toBeVisible({ timeout: 60_000 });
  return off.isVisible().catch(() => false);
}

async function addDialog(page: Page): Promise<Locator> {
  await page.getByTestId('add-client').click();
  const dialog = page.getByRole('dialog', { name: 'Add New Client' });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function fillIndividual(
  dialog: Locator,
  name: string,
  mail: string,
  ph: string,
  zip = '30301',
) {
  await dialog.getByLabel('Full name *').fill(name);
  await dialog.getByLabel('Email *').fill(mail);
  await dialog.getByLabel('Phone *').fill(ph);
  await dialog.getByLabel('Street address *').fill(`${STAMP} Fake Street`);
  await dialog.getByLabel('City *').fill('Atlanta');
  await dialog.getByLabel('State *').selectOption('GA');
  await dialog.getByLabel('ZIP code *').fill(zip);
}
/** Closes a filled Add New Client without adding it. */
async function discardAdd(page: Page, dialog: Locator) {
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  const leaving = dialog.getByRole('alertdialog');
  if (await leaving.isVisible().catch(() => false)) {
    await leaving.getByRole('button', { name: 'Discard' }).click();
  }
  await expect(dialog).toBeHidden();
}
async function editOpen(page: Page, name: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Edit details' }).click({ timeout: 60_000 });
  const dialog = page.getByRole('dialog', { name: `Edit ${name}` });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function discardEdit(dialog: Locator) {
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  const ask = dialog.getByTestId('unsaved-changes');
  if (await ask.isVisible().catch(() => false)) {
    await ask.getByRole('button', { name: 'Discard Changes' }).click();
  }
  await expect(dialog).toBeHidden();
}
const duplicateDialog = (page: Page) =>
  page.getByRole('dialog', { name: 'Possible duplicate client' });

async function select(page: Page, name: string) {
  await entry(page, name)
    .getByRole('checkbox', { name: `Select ${name}` })
    .check();
}
async function bulk(page: Page, item: string) {
  await page.getByRole('button', { name: 'Bulk Actions' }).click();
  await page.getByRole('menuitem', { name: item }).click();
}
async function bulkAssign(page: Page, names: string[], to: string) {
  for (const n of names) await select(page, n);
  await bulk(page, 'Assign Staff Member');
  const dialog = page.getByRole('dialog', { name: 'Assign Staff Member' });
  await dialog.getByLabel('Assign to').selectOption({ label: to });
  await dialog.getByRole('button', { name: 'Assign' }).click();
  // "2 clients updated." (any skipped client is named after it).
  await expect(
    page
      .getByText(
        new RegExp(`${names.length} ${names.length === 1 ? 'client' : 'clients'} updated\\.`),
      )
      .first(),
  ).toBeVisible();
}

/** The first real option of a select (skipping placeholders and the named ones). Returns its text. */
async function pickFirst(sel: Locator, skip: string[] = []): Promise<string> {
  const options = await sel.locator('option').evaluateAll((os) =>
    os.map((o) => ({
      value: (o as HTMLOptionElement).value,
      text: (o.textContent ?? '').trim(),
    })),
  );
  const hit = options.find((o) => o.value && !skip.includes(o.text));
  if (hit) await sel.selectOption(hit.value);
  return hit?.text ?? '';
}

/** An error the person reads: plain words, no codes, no programmer text. */
async function expectPlain(scope: Locator, what: string) {
  const text = await scope.innerText();
  expect(text, `${what} reads as plain words`).not.toMatch(
    /\b[A-Z]{2,}_[A-Z_]{2,}\b|undefined|\bnull\b|\[object|Error:|Exception|\{\s*"/,
  );
}

/**
 * Rule: before a send, every address the client's record holds (its portal logins included) is a
 * simulator one. Read through the page's own session (the same read the screen makes).
 */
async function expectSendable(page: Page, clientId: string, what: string) {
  const get = (p: string) => page.request.get(app(`/api/v1/business/clients/${clientId}${p}`));
  const rec = await get('');
  expect(rec.ok(), `${what}: the client's record is readable`).toBe(true);
  const access = await get('/portal-access');
  const text = (await rec.text()) + (access.ok() ? await access.text() : '');
  const found = [...new Set(text.match(EMAILS) ?? [])];
  expect(found.length, `${what}: the record has an address`).toBeGreaterThan(0);
  for (const a of found) expect(a, `${what}: ${a}`).toMatch(SIMULATOR);
}
/** Rule: every address the screen shows for a send is a simulator one (and one is shown). */
async function expectOnlySimulator(scope: Locator, what: string) {
  const found = (await scope.innerText()).match(EMAILS) ?? [];
  expect(found.length, `${what}: the recipient's address is shown`).toBeGreaterThan(0);
  for (const a of found) expect(a, `${what}: recipient ${a}`).toMatch(SIMULATOR);
}

const note = (info: TestInfo, type: string, description: string) => {
  info.annotations.push({ type, description });
  console.log(`${type}: ${info.title}: ${description}`);
};

/** The run's file on Alpha, through Upload Document (client chosen, not shown in the portal). */
async function uploadForClient(page: Page, clientId: string, file: string) {
  const form = page.getByTestId('upload-document');
  await expect(form).toBeVisible({ timeout: 60_000 });
  await failIfSignedOut(page);
  await form
    .locator('input[type=file]')
    .setInputFiles({ name: file, mimeType: 'application/pdf', buffer: PDF });
  // Upload Files: the type and folder for all the files come first (both required), the run's own.
  await form
    .getByLabel('Document Type *', { exact: true })
    .first()
    .selectOption({ label: DOC_TYPE });
  await form.getByLabel('Folder *', { exact: true }).first().selectOption({ label: FOLDER });
  const keepInternal = async () => {
    for (const label of [
      'Make visible to client in portal',
      'Notify client that a document has been uploaded',
    ]) {
      const box = form.getByLabel(label).first();
      if ((await box.count()) && (await box.isChecked())) await box.uncheck();
    }
  };
  await keepInternal();
  await page.getByRole('button', { name: /^Next: Document Details/ }).click();
  for (const label of ['Document Type *', 'Service *']) {
    const sel = form.getByLabel(label, { exact: true }).first();
    if ((await sel.count()) && (await sel.isEnabled()) && !(await sel.inputValue()))
      await pickFirst(sel);
  }
  await page.getByRole('button', { name: /^Next: Organize & Assign/ }).click();
  const folder = form.getByLabel('Folder *', { exact: true }).first();
  if ((await folder.count()) && !(await folder.inputValue()))
    await folder.selectOption({ label: FOLDER });
  await keepInternal();
  await page.getByRole('button', { name: /^Next: Review & Upload/ }).click();
  await expect(form).toContainText(file);
  await expect(form).toContainText(N.alpha);
  await page.getByRole('button', { name: 'Upload Document', exact: true }).click();
  // The file's own status in the review table ("Back to Documents" is always in the header).
  const status = form.getByRole('row').filter({ hasText: file });
  await expect(status.getByText(/^(Uploaded|Failed)$/)).toBeVisible({ timeout: 120_000 });
  await expect(status, 'the upload finished').toContainText('Uploaded');
  // Locate the file (a read for the later tests; every check is on the page).
  const res = await page.request.get(
    app(`/api/v1/business/documents?clientId=${clientId}&search=${encodeURIComponent(STAMP)}`),
  );
  const docs = res.ok()
    ? itemsOf<{ id: string; fileName?: string; name?: string }>(await res.json())
    : [];
  const doc = docs.find((d) => (d.fileName ?? d.name ?? '').includes(STAMP));
  expect(doc, "the uploaded file is in the client's documents").toBeTruthy();
  remember({ docId: doc!.id, docName: doc!.fileName ?? doc!.name ?? file });
}

/**
 * The run's file's Download on the profile (the shown copy: the phone cards are hidden at this
 * width), once its virus scan is clean: Download waits for it, and the list does not refresh.
 */
async function cleanDownload(page: Page): Promise<Locator> {
  const button = page
    .getByTestId('client-documents-list')
    .getByTestId('document-download')
    .filter({ visible: true })
    .first();
  await expect(async () => {
    if (!(await button.isEnabled().catch(() => false))) {
      await page.reload();
      await settled(page);
    }
    await expect(button).toBeEnabled({ timeout: 10_000 });
  }).toPass({ timeout: 150_000, intervals: [5_000] });
  return button;
}

/** The vertical overflow of an element (a strip with no vertical scrollbar has none). */
const verticalOverflow = (l: Locator) => l.evaluate((el) => el.scrollHeight - el.clientHeight);

async function inViewport(page: Page, l: Locator, what: string) {
  const box = await l.boundingBox();
  const vp = page.viewportSize()!;
  expect(box, `${what} is on the page`).not.toBeNull();
  if (!box) return;
  expect(box.x, `${what}: left edge in view`).toBeGreaterThanOrEqual(-1);
  expect(box.y, `${what}: top edge in view`).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width, `${what}: right edge in view`).toBeLessThanOrEqual(vp.width + 1);
  expect(box.y + box.height, `${what}: bottom edge in view`).toBeLessThanOrEqual(vp.height + 1);
}

/** The Last Activity panel. */
const lastTrigger = (page: Page) => page.getByRole('button', { name: /^Last activity: / });
const lastPanel = (page: Page) => page.getByRole('dialog', { name: 'Last activity', exact: true });

/** P4-7: each client tab, its title and its primary action (none on Overview, Notes, Activity). */
const TABS: { path: string; title: string; primary?: { role: 'button' | 'link'; name: string } }[] =
  [
    { path: '', title: 'Overview' },
    {
      path: '/services',
      title: 'Services',
      primary: { role: 'button', name: 'Enroll in Service' },
    },
    {
      path: '/documents',
      title: 'Documents',
      primary: { role: 'button', name: 'Request a document' },
    },
    {
      path: '/intake-forms',
      title: 'Intake Forms',
      primary: { role: 'link', name: 'Send an Intake Form' },
    },
    { path: '/invoices', title: 'Invoices', primary: { role: 'button', name: 'New invoice' } },
    {
      path: '/messages',
      title: 'Messages and Notes',
      primary: { role: 'button', name: 'New Message' },
    },
    { path: '/tasks', title: 'Tasks', primary: { role: 'link', name: 'New Task' } },
    { path: '/notes', title: 'Notes' },
    { path: '/activity', title: 'Activity' },
    {
      path: '/signatures',
      title: 'Signatures',
      primary: { role: 'link', name: 'Send for signature' },
    },
  ];

/** Opens the Mark Completed dialog of the lead appointment. */
async function markCompletedDialog(page: Page, apptId: string): Promise<Locator> {
  await page.goto(app(`/calendar/${apptId}`));
  const close = page.getByTestId('detail-close');
  await expect(close.or(signIn(page))).toBeVisible({ timeout: 60_000 });
  await failIfSignedOut(page);
  await expect(close.getByRole('button', { name: 'Mark Completed' })).toBeEnabled({
    timeout: 60_000,
  });
  await close.getByRole('button', { name: 'Mark Completed' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mark Completed' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** A refusal on the page (not found, no access), with none of the record's details. */
async function expectRefused(page: Page, secrets: string[]) {
  await expect(
    page
      .getByTestId('page-not-found')
      .or(
        page.getByText(
          /not found|no access|can.t find|couldn.t (find|be found)|could not be found|doesn.t exist|not available|permission/i,
        ),
      )
      .first(),
  ).toBeVisible({ timeout: 60_000 });
  for (const s of secrets) await expect(main(page)).not.toContainText(s);
}

// ================================================================ Owner
test.describe('Clients (Owner)', () => {
  test.use(as('owner'));
  test.skip(() => !hasLogin('owner'), 'no owner login');
  let c: Ctx;
  test.beforeAll(async ({ browser }) => {
    await freshSession(browser, 'owner');
    c = await fixture(browser);
  });

  // ---------------------------------------------------------------- §1 green rows (regressions)

  for (const [row, label, owes] of [
    ['§1 Pending Documents filter (C2-001/012)', 'Pending Documents', 'DOCUMENTS'],
    ['§1 Balances Due filter (C2-002/013)', 'Balances Due', 'BALANCE'],
  ] as const) {
    test(`${row} owner: the card filters the list to the clients it counts; kept after a reload; a second click clears it`, async ({
      page,
    }, info) => {
      await openClients(page);
      const card = kpi(page, label);
      await expect(card).toHaveAttribute('aria-pressed', 'false', { timeout: 60_000 });
      const count = await kpiNumber(page, label);
      await card.click();
      await expect(card).toHaveAttribute('aria-pressed', 'true');
      await expect(page).toHaveURL(new RegExp(`[?&]owes=${owes}`));
      await settled(page);
      expect(await listTotal(page), `${label}: the list total equals the card`).toBe(count);
      await page.reload();
      await settled(page);
      await expect(kpi(page, label)).toHaveAttribute('aria-pressed', 'true');
      expect(await listTotal(page), `${label} after a reload`).toBe(count);
      await shot(page, TAB, `${owes}-filter`, info);
      await kpi(page, label).click();
      await expect(kpi(page, label)).toHaveAttribute('aria-pressed', 'false');
      await expect(page).not.toHaveURL(/owes=/);
    });
  }

  test('§1 Dirty Edit warning (C2-032) owner: Keep Editing keeps, Discard reverts, Save Changes saves (kept after a reload)', async ({
    page,
  }, info) => {
    await openClient(page, c.alpha);
    let dialog = await editOpen(page, N.alpha);
    const city = () => dialog.getByLabel('City *');
    const before = await city().inputValue();
    await city().fill('Faketown');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    const ask = dialog.getByTestId('unsaved-changes');
    await expect(ask).toBeVisible();
    await shot(page, TAB, 'C2-032-ask', info);
    await ask.getByRole('button', { name: 'Keep Editing' }).click();
    await expect(city()).toHaveValue('Faketown');
    await page.keyboard.press('Escape');
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Discard Changes' }).click();
    await expect(dialog).toBeHidden();
    dialog = await editOpen(page, N.alpha);
    await expect(city()).toHaveValue(before);
    await city().fill('Decatur');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await ask.getByRole('button', { name: 'Save Changes' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(page.getByTestId('client-overview')).toContainText('Decatur');
    await page.reload();
    await expect(page.getByTestId('client-overview')).toContainText('Decatur', { timeout: 60_000 });
  });

  test('§1 Individual and Business creation (C2-031) owner: each valid form makes one profile, kept after a reload', async ({
    page,
  }, info) => {
    await openClients(page);
    let dialog = await addDialog(page);
    await fillIndividual(dialog, full('Made Individual'), email(20), phone(20));
    await dialog.getByRole('button', { name: 'Add Client' }).click();
    await expect(page).toHaveURL(new RegExp(`/clients/${UUID.source}$`), { timeout: 60_000 });
    const one = new RegExp(`/clients/(${UUID.source})`).exec(page.url())![1]!;
    remember({ made: [...readCtx().made, one] });
    await page.reload();
    await expect(title(page)).toHaveText(full('Made Individual'), { timeout: 60_000 });
    await expect(main(page).locator('header')).toContainText(email(20));
    await shot(page, TAB, 'C2-031-individual', info);

    await openClients(page);
    dialog = await addDialog(page);
    await dialog.getByLabel('Client type *').selectOption('BUSINESS');
    await dialog.getByLabel('Business name *').fill(full('Made Business LLC'));
    await dialog.getByLabel('Business email *').fill(email(21));
    await dialog.getByLabel('Business phone *').fill(phone(21));
    await dialog.getByLabel('Street address *').fill(`${STAMP} Dock Street`);
    await dialog.getByLabel('City *').fill('Savannah');
    await dialog.getByLabel('State *').selectOption('GA');
    await dialog.getByLabel('ZIP code *').fill('31401');
    const party = dialog.getByTestId('responsible-party');
    await party.getByLabel('Full name *').fill(full('Made Owner'));
    await party.getByLabel('Their email *').fill(email(22));
    await party.getByLabel('Their phone *').fill(phone(22));
    await dialog.getByRole('button', { name: 'Add Client' }).click();
    await expect(title(page)).toHaveText(full('Made Business LLC'), { timeout: 60_000 });
    const two = new RegExp(`/clients/(${UUID.source})`).exec(page.url())![1]!;
    remember({ made: [...readCtx().made, two] });
    await page.reload();
    const shown = page.getByTestId('responsible-party');
    await expect(shown).toContainText(full('Made Owner'), { timeout: 60_000 });
    await expect(shown).toContainText(email(22));
    await shot(page, TAB, 'C2-031-business', info);
  });

  test('§1 Add required and format checks (C2-027/028) owner: every required field and format is named; nothing is added', async ({
    page,
  }, info) => {
    await openClients(page);
    const dialog = await addDialog(page);
    await dialog.getByRole('button', { name: 'Add Client' }).click();
    for (const message of [
      'Enter a name',
      'Enter an email address',
      'Enter a phone number',
      'Enter the street address',
      'Enter the city',
      'Choose the state',
      'Enter the ZIP code',
    ]) {
      await expect(dialog.getByText(message, { exact: true })).toBeVisible();
    }
    await expectPlain(dialog, 'the required-field messages');
    await shot(page, TAB, 'C2-027-required', info);
    await fillIndividual(dialog, full('Format Check'), 'not-an-email', '12', '3030');
    await dialog.getByRole('button', { name: 'Add Client' }).click();
    await expect(dialog.getByText('Enter a 5-digit ZIP code')).toBeVisible();
    await expect(dialog.getByLabel('Email *')).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.getByLabel('Phone *')).toHaveAttribute('aria-invalid', 'true');
    await expectPlain(dialog, 'the format messages');
    await shot(page, TAB, 'C2-028-formats', info);
    await discardAdd(page, dialog);
    await expect(page).toHaveURL(/\/clients(\?|$)/);
  });

  test('§1 Internal notes (C2-010/033) owner: a note saves with its author and time, kept after a reload; the client never sees it', async ({
    page,
  }, info) => {
    await openClient(page, c.alpha, '/notes');
    const notes = page.getByTestId('client-notes');
    await expect(notes).toContainText('Only your firm sees these notes. The client never does.');
    const text = `${runTag} note (synthetic)`;
    await notes.getByLabel('New note').fill(text);
    await notes.getByRole('button', { name: 'Save Note' }).click();
    const item = notes
      .getByRole('list', { name: 'Internal notes' })
      .getByRole('listitem')
      .filter({ hasText: text });
    await expect(item).toBeVisible();
    if (c.ownerName) await expect(item).toContainText(c.ownerName);
    await expect(item).toContainText(/\d/);
    await page.reload();
    await expect(page.getByTestId('client-notes').getByText(text)).toBeVisible({ timeout: 60_000 });
    await shot(page, TAB, 'C2-010-note', info);
    note(
      info,
      'NOT LIVE',
      "the client side (never in the portal): the run's clients have no portal login, and Client 1's is Octavia's",
    );
  });

  test('§1 Single client archive and restore (C2-035) owner: archive keeps the Client ID and profile; restore brings it back (kept after reloads)', async ({
    page,
  }, info) => {
    await openClient(page, c.delta);
    const id = (await page.getByTestId('client-id').innerText()).trim();
    await page.getByRole('button', { name: 'Archive client' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByRole('button', { name: 'Restore client' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Restore client' })).toBeVisible({
      timeout: 60_000,
    });
    await expect(main(page).locator('header')).toContainText('Archived');
    await expect(page.getByTestId('client-id')).toHaveText(id);
    await shot(page, TAB, 'C2-035-archived', info);
    await openClients(page, `?search=${STAMP}`);
    await expect(entry(page, N.alpha)).toHaveCount(1);
    await expect(entry(page, N.delta)).toHaveCount(0);
    await viewTab(page, 'Archived').click();
    await settled(page);
    await expect(entry(page, N.delta)).toHaveCount(1);
    await openClient(page, c.delta);
    await page.getByRole('button', { name: 'Restore client' }).click();
    await expect(page.getByRole('button', { name: 'Archive client' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Archive client' })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId('client-id')).toHaveText(id);
  });

  test('§1 Directory routing and search (C2-021/022/025) owner: name, email and phone find the client; status and staff filters set the address and Reset clears', async ({
    page,
  }, info) => {
    await openClients(page);
    for (const q of [N.alpha, email(1), digits(1)]) {
      await searchFor(page, q);
      await expect(entry(page, N.alpha)).toHaveCount(1);
    }
    await page.getByLabel('Status', { exact: true }).selectOption({ label: 'Active' });
    // The list's address keeps the status as `stage` (lib/clients-place.ts).
    await expect(page).toHaveURL(/[?&]stage=ACTIVE(&|$)/);
    await page
      .getByRole('button', { name: /^Reset/ })
      .first()
      .click();
    await expect(searchBox(page)).toHaveValue('');
    await expect(page).not.toHaveURL(/search=/);
    if (!c.staffName) {
      note(info, 'partial', 'no staff login: the staff filter part needs one');
      return;
    }
    await searchFor(page, STAMP);
    await page.getByLabel('Assigned staff member').selectOption({ label: c.staffName });
    await settled(page);
    await expect(entry(page, N.beta)).toHaveCount(1);
    await expect(entry(page, N.alpha)).toHaveCount(0);
    await page.reload();
    await settled(page);
    await expect(entry(page, N.beta)).toHaveCount(1);
    await shot(page, TAB, 'C2-021-staff-filter', info);
  });

  test('§1 Menu behavior (C2-006/016) owner: More Filters closes on an outside click, the row menu on Escape; Bulk Actions waits for a choice', async ({
    page,
  }, info) => {
    await openClients(page, `?search=${STAMP}`);
    await page.getByRole('button', { name: /More Filters/ }).click();
    await expect(page.getByText('Client Type', { exact: true })).toBeVisible();
    await title(page).click();
    await expect(page.getByText('Client Type', { exact: true })).toBeHidden();
    await page.getByRole('button', { name: `More actions for ${N.alpha}` }).click();
    await expect(page.getByRole('menuitem', { name: 'View profile' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menuitem', { name: 'View profile' })).toBeHidden();
    const bulkButton = page.getByRole('button', { name: 'Bulk Actions' });
    if (await bulkButton.count()) await expect(bulkButton).toBeDisabled();
    await select(page, N.alpha);
    await expect(bulkButton).toBeEnabled();
    await shot(page, TAB, 'C2-016-bulk-enabled', info);
  });

  test('§1 Signature context (C2-014) owner: the Signatures tab keeps the client and sends for this client', async ({
    page,
  }, info) => {
    await openClient(page, c.alpha, '/signatures');
    await expect(tabHeader(page).getByRole('heading', { level: 2 })).toHaveText('Signatures');
    await expect(page).toHaveURL(new RegExp(`/clients/${c.alpha}/signatures`));
    const send = tabHeader(page).getByRole('link', { name: 'Send for signature' });
    if (await firmSignOff(page, send)) {
      // By design Send for signature shows only while Firm Sign is on (client-signatures.tsx).
      await expect(send).toHaveCount(0);
      note(
        info,
        'partial',
        'Firm Sign is off for Test Firm B: the tab keeps the client; "Send for signature" with this client shows only while Firm Sign is on',
      );
    } else await expect(send).toHaveAttribute('href', new RegExp(c.alpha));
    await page.reload();
    await expect(title(page)).toHaveText(N.alpha, { timeout: 60_000 });
    await shot(page, TAB, 'C2-014', info);
  });

  test("§1 Exact email guard (C2-038) owner: another client's email (any case) is refused on Add and Edit, in plain words, the draft kept", async ({
    page,
  }, info) => {
    await openClients(page);
    const dialog = await addDialog(page);
    const upper = email(1).replace('success', 'SUCCESS');
    await fillIndividual(dialog, full('Email Dup'), upper, phone(23));
    await dialog.getByRole('button', { name: 'Add Client' }).click();
    await expect(
      dialog.getByText('Another client of your firm already uses this email.'),
    ).toBeVisible();
    await expectPlain(dialog, 'the duplicate email message');
    await expect(dialog.getByLabel('Full name *')).toHaveValue(full('Email Dup'));
    await shot(page, TAB, 'C2-038-add', info);
    await discardAdd(page, dialog);
    await openClient(page, c.beta);
    const edit = await editOpen(page, N.beta);
    await edit.getByLabel('Email *').fill(email(1));
    await edit.getByRole('button', { name: 'Save changes' }).click();
    await expect(
      edit.getByText('Another client of your firm already uses this email.'),
    ).toBeVisible();
    await shot(page, TAB, 'C2-038-edit', info);
    await discardEdit(edit);
    await page.reload();
    await expect(main(page).locator('header')).toContainText(email(2), { timeout: 60_000 });
  });

  test('§1 Tag persistence (C2-040) owner: a tag added and removed on the profile stays so after a reload', async ({
    page,
  }, info) => {
    await openClient(page, c.alpha);
    const tags = page.getByTestId('client-tags');
    await tags.getByRole('button', { name: /^(Add|Edit) tags$/ }).click();
    await tags.getByTestId('tag-picker').getByRole('combobox').fill(TAG);
    await tags.getByTestId('tag-picker').getByRole('option', { name: TAG, exact: true }).click();
    await tags.getByRole('button', { name: 'Save tags' }).click();
    await expect(tags.getByRole('list', { name: 'Client tags' })).toContainText(TAG);
    await page.reload();
    await expect(
      page.getByTestId('client-tags').getByRole('list', { name: 'Client tags' }),
    ).toContainText(TAG, {
      timeout: 60_000,
    });
    await shot(page, TAB, 'C2-040-added', info);
    await tags.getByRole('button', { name: 'Edit tags' }).click();
    await tags.getByRole('button', { name: `Remove ${TAG}` }).click();
    await tags.getByRole('button', { name: 'Save tags' }).click();
    await page.reload();
    await expect(page.getByTestId('client-tags')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('client-tags')).not.toContainText(TAG);
  });

  // ---------------------------------------------------------------- §2 partial rows

  test('§2 Documents (C2-012) owner: Upload Document opens with the client chosen and the file lands on the profile; a request opens its details (kept after reloads)', async ({
    page,
  }, info) => {
    await openClient(page, c.alpha, '/documents');
    await tabHeader(page).getByRole('button', { name: 'More Actions' }).click();
    await page.getByRole('menuitem', { name: 'Upload Document' }).click();
    await expect(page).toHaveURL(new RegExp(`/documents/upload\\?clientId=${c.alpha}`), {
      timeout: 60_000,
    });
    // The row: Upload Document opens with this client already chosen.
    await expect(page.getByTestId('upload-document')).toContainText(N.alpha, { timeout: 60_000 });
    const file = `${STAMP}-alpha.pdf`;
    await expectSendable(page, c.alpha, 'upload (no notice: sharing and notify off)');
    await uploadForClient(page, c.alpha, file);
    await openClient(page, c.alpha, '/documents');
    // The list holds phone cards (hidden at this width) and the table: the one shown counts.
    const listed = page
      .getByTestId('client-documents-list')
      .getByText(file)
      .filter({ visible: true })
      .first();
    await expect(listed).toBeVisible({ timeout: 60_000 });
    await page.reload();
    await expect(listed).toBeVisible({ timeout: 60_000 });
    await shot(page, TAB, 'C2-012-file', info);
    // Request a document: the notice goes to Alpha's own (simulator) address.
    const titleText = `${runTag} W-2 request`;
    await page.getByTestId('request-document-open').click();
    const form = page.getByRole('dialog', { name: 'Request a document' });
    // The form shows once Alpha's active services have loaded (none would say so instead).
    const service = form.getByTestId('request-service');
    await expect(service).toBeVisible({ timeout: 30_000 });
    if (!(await service.inputValue())) await pickFirst(service);
    await expect(service).not.toHaveValue('');
    await form.getByTestId('request-document-title').fill(titleText);
    await expectSendable(page, c.alpha, 'document request');
    await form.getByTestId('request-submit').click();
    await expect(form).toBeHidden({ timeout: 30_000 });
    const requests = page.getByTestId('document-requests');
    await expect(requests).toContainText(titleText);
    await page.reload();
    await expect(page.getByTestId('document-requests')).toContainText(titleText, {
      timeout: 60_000,
    });
    await page
      .getByTestId('document-requests')
      .getByTestId('request-details')
      .filter({ visible: true })
      .first()
      .click();
    const details = page.getByTestId('request-details-dialog');
    await expect(details).toContainText('Files received');
    await shot(page, TAB, 'C2-012-request-details', info);
    await page.keyboard.press('Escape');
  });

  test("§1 Download verified by user (C2-045) owner: the profile's file downloads under its name", async ({
    page,
  }) => {
    test.skip(!readCtx().docName, 'no file (the §2 Documents upload failed)');
    await openClient(page, c.alpha, '/documents');
    // Alpha has the run's one file.
    const button = await cleanDownload(page);
    const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
    expect(download.suggestedFilename()).toContain(STAMP);
  });

  test('N8-16 Firm PDF content owner: the downloaded file has the same bytes as the uploaded one', async ({
    page,
  }, info) => {
    test.skip(!readCtx().docName, 'no file (the §2 Documents upload failed)');
    await openClient(page, c.alpha, '/documents');
    const button = await cleanDownload(page);
    const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
    const path = await download.path();
    expect(readFileSync(path).equals(PDF), 'the bytes match the uploaded PDF').toBe(true);
    note(info, 'NOT LIVE', "the portal copy's bytes: needs a portal login of a run client");
  });

  // N8-29 and N8-37 need the run's file on Alpha: before C2-051 archives it.
  test("N8-29 Document categories owner: the profile's Documents filter by category", async ({
    page,
  }, info) => {
    await openClient(page, c.alpha, '/documents');
    const filter = page.getByTestId('document-category-filter');
    if (!(await filter.count())) {
      await expect(page.getByTestId('no-categories')).toBeVisible();
      return;
    }
    await pickFirst(filter);
    await settled(page);
    await expect(page.getByTestId('client-documents-screen')).toBeVisible();
    await shot(page, TAB, 'N8-29', info);
  });

  test('N8-37 Request a Document at the top owner: Request a document comes before the files, in the first screenful', async ({
    page,
  }, info) => {
    await openClient(page, c.alpha, '/documents');
    const button = page.getByRole('button', { name: 'Request a document', exact: true });
    // The files, or the empty list's words when the client has none.
    const files = page
      .getByTestId('client-documents-list')
      .or(main(page).getByText('No documents for this client yet.', { exact: true }))
      .first();
    await expect(files).toBeVisible({ timeout: 60_000 });
    const b = await button.boundingBox();
    const f = await files.boundingBox();
    expect(b && f, 'the button and the files are on the page').toBeTruthy();
    expect(b!.y, 'the button is above the files').toBeLessThan(f!.y);
    expect(b!.y + b!.height, 'the button is in the first screenful').toBeLessThanOrEqual(
      page.viewportSize()!.height,
    );
    await shot(page, TAB, 'N8-37', info);
  });

  test('§2 Return to Clients context (C2-007/047) owner: the breadcrumb and Back bring the same search back; a new visit starts clean', async ({
    page,
  }, info) => {
    await openClients(page);
    await searchFor(page, STAMP);
    const url = page.url();
    await entry(page, N.alpha).getByTestId('client-link').click();
    await expect(title(page)).toHaveText(N.alpha, { timeout: 60_000 });
    await main(page).getByRole('link', { name: 'Clients', exact: true }).click();
    await expect(page).toHaveURL(url);
    await expect(searchBox(page)).toHaveValue(STAMP);
    await entry(page, N.alpha).getByTestId('client-link').click();
    await expect(title(page)).toHaveText(N.alpha, { timeout: 60_000 });
    await page.goBack();
    await expect(page).toHaveURL(url);
    await expect(searchBox(page)).toHaveValue(STAMP);
    await shot(page, TAB, 'C2-007-back', info);
    await openClients(page);
    await expect(searchBox(page)).toHaveValue('');
  });

  test('§2 Stacy service linkage (C2-004/024) owner: Services and Overview list the enrolled service from its record', async ({
    page,
  }, info) => {
    await openClient(page, c.alpha, '/services');
    const svc = page.getByTestId('client-service').filter({ hasText: SERVICE });
    await expect(svc).toBeVisible({ timeout: 60_000 });
    await page.reload();
    await expect(page.getByTestId('client-service').filter({ hasText: SERVICE })).toBeVisible({
      timeout: 60_000,
    });
    await openClient(page, c.alpha);
    await expect(page.getByTestId('active-services')).toContainText(SERVICE);
    await shot(page, TAB, 'C2-004', info);
  });

  test('§2 Profile workspace (C2-008) owner: the tabs, Active Services and Recent Activity', async ({
    page,
  }, info) => {
    await openClient(page, c.alpha);
    const nav = page.getByRole('navigation', { name: 'Client', exact: true });
    for (const name of [
      'Overview',
      'Services',
      'Documents',
      'Intake Forms',
      'Invoices',
      'Messages',
      'Tasks',
      'Notes',
      'Activity',
    ]) {
      await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
    }
    await expect(page.getByTestId('active-services')).toBeVisible();
    await expect(page.getByTestId('recent-activity')).toBeVisible();
    await shot(page, TAB, 'C2-008', info);
  });

  test('§2 Message submission and history (C2-011/037) owner: the composer names who, where and the notice; the message is kept after a reload', async ({
    page,
  }, info) => {
    await openClient(page, c.alpha, '/messages');
    await tabHeader(page).getByRole('button', { name: 'New Message' }).click();
    const dialog = page.getByRole('dialog', { name: 'New Message' });
    const to = dialog.getByTestId('message-recipient');
    await expect(to).toContainText(N.alpha);
    await expect(to).toContainText('Their client portal conversation');
    await expect(to).toContainText(/None: they have no active portal login yet|An email to /);
    const subject = `${runTag} message`;
    await dialog.getByLabel('Subject').fill(subject);
    await dialog
      .getByRole('textbox', { name: 'Message', exact: true })
      .fill('Live check message (synthetic).');
    const timeline = dialog.getByRole('checkbox', { name: 'Add to Client Timeline' });
    if ((await timeline.count()) && !(await timeline.isChecked())) await timeline.check();
    await shot(page, TAB, 'C2-011-composer', info);
    // Rule: right before the send, every address the client holds is a simulator one.
    await expectSendable(page, c.alpha, 'new message');
    if (/An email to /.test(await to.innerText())) await expectOnlySimulator(to, 'message notice');
    await dialog.getByRole('button', { name: 'Send Message' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(main(page)).toContainText(subject);
    await page.reload();
    await expect(main(page)).toContainText(subject, { timeout: 60_000 });
    await shot(page, TAB, 'C2-037-history', info);
  });

  test('§2 Staff assignment (C2-034) owner: a profile seen before a bulk assign shows the new member at once (kept after a reload); unassigning works too', async ({
    page,
  }, info) => {
    const to = c.staffName || c.ownerName;
    test.skip(!to, 'no member names');
    await openClients(page, `?search=${STAMP}`);
    await entry(page, N.gamma).getByTestId('client-link').click();
    await expect(title(page)).toHaveText(N.gamma, { timeout: 60_000 });
    await expect(assignedOnProfile(page)).toHaveText('Unassigned');
    await main(page).getByRole('link', { name: 'Clients', exact: true }).click();
    await expect(title(page)).toHaveText('Clients', { timeout: 60_000 });
    await bulkAssign(page, [N.gamma], to);
    await entry(page, N.gamma).getByTestId('client-link').click();
    await expect(assignedOnProfile(page)).toHaveText(to, { timeout: 60_000 });
    await page.reload();
    await expect(assignedOnProfile(page)).toHaveText(to, { timeout: 60_000 });
    await shot(page, TAB, 'C2-034-assigned', info);
    // Back to nobody, so Staff's list keeps only their own client.
    await main(page).getByRole('link', { name: 'Clients', exact: true }).click();
    await bulkAssign(page, [N.gamma], 'Nobody (unassign)');
    await entry(page, N.gamma).getByTestId('client-link').click();
    await expect(assignedOnProfile(page)).toHaveText('Unassigned', { timeout: 60_000 });
  });

  test("§2 Audit visibility (C2-043) owner: the client's Activity lists its archive and restore", async ({
    page,
  }, info) => {
    await openClient(page, c.delta, '/activity');
    const list = page.getByTestId('client-activity');
    await expect(list.getByTestId('activity-entry').first()).toBeVisible({ timeout: 60_000 });
    await shot(page, TAB, 'C2-043-activity', info);
    await expect(list).toContainText(/archiv/i);
    await expect(list).toContainText(/restor/i);
  });

  // ---------------------------------------------------------------- §3

  test('§3 Expanded directory filters (C2-005) owner: More Filters applies with chips kept after a reload; Added Last 30 Days and Archived are views', async ({
    page,
  }, info) => {
    await openClients(page, `?search=${STAMP}`);
    await page.getByRole('button', { name: /More Filters/ }).click();
    await page.getByRole('radio', { name: 'Business', exact: true }).check();
    await page.getByRole('button', { name: 'Apply Filters' }).click();
    const chips = page.getByTestId('filter-chips');
    await expect(chips).toContainText('Business');
    await settled(page);
    await expect(entry(page, N.gamma)).toHaveCount(1);
    await expect(entry(page, N.alpha)).toHaveCount(0);
    await page.reload();
    await settled(page);
    await expect(page.getByTestId('filter-chips')).toContainText('Business');
    await expect(entry(page, N.gamma)).toHaveCount(1);
    await shot(page, TAB, 'C2-005-business', info);
    await page.getByRole('button', { name: 'Remove Business' }).click();
    await settled(page);
    await expect(entry(page, N.alpha)).toHaveCount(1);
    await viewTab(page, 'Added Last 30 Days').click();
    await settled(page);
    await expect(entry(page, N.alpha)).toHaveCount(1);
    await viewTab(page, 'Archived').click();
    await settled(page);
    await expect(entry(page, N.alpha)).toHaveCount(0);
    await expect(page.getByTestId('export-clients')).toBeVisible();
  });

  test('§3 New KPI and destination (C2-020) owner: New Clients equals what its New tab lists (kept after a reload)', async ({
    page,
  }, info) => {
    await openClients(page);
    const count = await kpiNumber(page, 'New Clients');
    await kpi(page, 'New Clients').click();
    await expect(viewTab(page, 'New')).toHaveAttribute('aria-selected', 'true');
    await settled(page);
    expect(await listTotal(page)).toBe(count);
    await page.reload();
    await settled(page);
    expect(await listTotal(page)).toBe(count);
    await shot(page, TAB, 'C2-020', info);
  });

  test('§3 Client ID search (C2-023) owner: the profile shows its Client ID; the hint names it; searching it finds the one client', async ({
    page,
  }, info) => {
    await openClient(page, c.alpha);
    const shown = (await page.getByTestId('client-id').innerText()).trim();
    const number = /Client ID (CL-\d+)/.exec(shown)?.[1] ?? '';
    expect(number, 'the profile shows "Client ID CL-…"').toMatch(/^CL-\d+$/);
    await openClients(page);
    await expect(page.getByTestId('client-search-hint')).toContainText('Client ID');
    await searchFor(page, number);
    await expect(entry(page, N.alpha)).toHaveCount(1);
    expect(await listTotal(page)).toBe(1);
    await page.reload();
    await settled(page);
    await expect(entry(page, N.alpha)).toHaveCount(1);
    await shot(page, TAB, 'C2-023', info);
  });

  test("§3 Edit validation: web (C2-038/039) owner: Edit names a Business's missing phone and a bad ZIP, and an Individual's email; nothing saved", async ({
    page,
  }, info) => {
    await openClient(page, c.gamma);
    let dialog = await editOpen(page, N.gamma);
    await dialog.getByLabel('Business phone *').fill('');
    await dialog.getByLabel('ZIP code *').fill('3030');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog.getByText('Enter a phone number')).toBeVisible();
    await expect(dialog.getByText('Enter a 5-digit ZIP code')).toBeVisible();
    await expectPlain(dialog, 'the Business edit messages');
    await shot(page, TAB, 'C2-039-business', info);
    await discardEdit(dialog);
    await openClient(page, c.alpha);
    dialog = await editOpen(page, N.alpha);
    await dialog.getByLabel('Email *').fill('');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog.getByText('Enter an email address')).toBeVisible();
    await dialog.getByLabel('Email *').fill('not-an-email');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog.getByText(/invalid email|valid email/i)).toBeVisible();
    await discardEdit(dialog);
    await page.reload();
    await expect(main(page).locator('header')).toContainText(email(1), { timeout: 60_000 });
  });

  test('§3 Edit validation: server owner: the API refuses clearing the email or phone (400, each field named); the record keeps both', async ({
    page,
  }, info) => {
    await openClient(page, c.alpha);
    // The page refuses first (above); here the server's own rule, through the page's session.
    const patch = (data: Record<string, unknown>) =>
      page.request.patch(app(`/api/v1/business/clients/${c.alpha}`), {
        data,
        headers: { origin: appUrl },
      });
    for (const field of ['email', 'phone']) {
      const r = await patch({ [field]: '' });
      expect(r.status(), `clearing ${field}`).toBe(400);
      expect(await r.text()).toContain(field);
    }
    await page.reload();
    await expect(main(page).locator('header')).toContainText(email(1), { timeout: 60_000 });
    await expect(main(page).locator('header')).toContainText(phone(1));
    note(
      info,
      'API',
      "a server rule: checked with the Owner page's own session (the form refuses before sending)",
    );
  });

  test('§3 Normalized phone duplicate (C2-038) owner: a phone typed another way pauses Add with the match; Keep Editing keeps the draft; nothing merged', async ({
    page,
  }, info) => {
    await openClients(page);
    const dialog = await addDialog(page);
    const d = digits(1);
    await fillIndividual(
      dialog,
      full('Phone Dup'),
      email(25),
      `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`,
    );
    await dialog.getByRole('button', { name: 'Add Client' }).click();
    const dup = duplicateDialog(page);
    await expect(dup).toBeVisible({ timeout: 30_000 });
    await expect(dup.getByTestId('duplicate-matches')).toContainText(N.alpha);
    await shot(page, TAB, 'C2-038-phone', info);
    await dup.getByRole('button', { name: 'Keep Editing' }).click();
    await expect(dialog.getByLabel('Full name *')).toHaveValue(full('Phone Dup'));
    await discardAdd(page, dialog);
    await searchFor(page, full('Phone Dup'));
    expect(await listTotal(page)).toBe(0);
  });

  test('§3 Business responsible party (C2-017/031/041) owner: the party shows on the profile; a link to another client shows on both and is removed (kept after reloads)', async ({
    page,
  }, info) => {
    await openClient(page, c.gamma);
    const party = page.getByTestId('responsible-party');
    await expect(party).toContainText(full('Gamma Owner'));
    await expect(party).toContainText(email(4));
    await expect(party).toContainText(phone(4));
    const card = page.getByTestId('client-links');
    await page.getByTestId('add-client-link').click();
    const dialog = page.getByRole('dialog', { name: 'Add Link' });
    await dialog.getByRole('button', { name: 'Link Profiles' }).click();
    await expect(dialog).toContainText('Choose the client to link');
    await dialog.getByLabel('Find a client *').fill(N.alpha);
    await dialog
      .getByRole('button', { name: new RegExp(`${STAMP} Alpha`) })
      .first()
      .click();
    await expect(dialog.getByTestId('client-link-chosen')).toContainText(N.alpha);
    await pickFirst(dialog.getByRole('combobox').last());
    await dialog.getByRole('button', { name: 'Link Profiles' }).click();
    await expect(card.getByTestId('client-link-row').filter({ hasText: N.alpha })).toBeVisible({
      timeout: 30_000,
    });
    await page.reload();
    await expect(
      page.getByTestId('client-links').getByTestId('client-link-row').filter({ hasText: N.alpha }),
    ).toBeVisible({
      timeout: 60_000,
    });
    await shot(page, TAB, 'C2-041-linked', info);
    await openClient(page, c.alpha);
    const back = page.getByTestId('client-links');
    await expect(back.getByTestId('client-link-row').filter({ hasText: N.gamma })).toBeVisible();
    await back.getByRole('button', { name: `Remove the link to ${N.gamma}` }).click();
    await page
      .getByRole('dialog', { name: 'Remove Link' })
      .getByRole('button', { name: 'Remove Link' })
      .click();
    await page.reload();
    await expect(page.getByTestId('client-links')).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByTestId('client-links').getByTestId('client-link-row').filter({ hasText: N.gamma }),
    ).toHaveCount(0);
  });

  test('§3 Service management owner: Enroll names a missing service; pause and resume are kept and in the History', async ({
    page,
  }, info) => {
    await openClient(page, c.alpha, '/services');
    await page.getByTestId('enroll-service').click();
    const enroll = page.getByRole('dialog', { name: 'Enroll in Service' });
    await enroll.getByRole('button', { name: 'Enroll' }).click();
    await expect(enroll).toContainText('Choose a service');
    await page.keyboard.press('Escape');
    await expect(enroll).toBeHidden();
    const row = page.getByTestId('client-service').filter({ hasText: SERVICE });
    const action = async (item: string) => {
      await page
        .getByRole('button', { name: `Actions for ${SERVICE}` })
        .first()
        .click();
      await page.getByRole('menuitem', { name: item }).click();
    };
    await action('Service & Billing');
    let billing = page.getByRole('dialog', { name: 'Service & Billing' });
    const only = billing.getByRole('radio', { name: 'Service only' });
    if (await only.count()) await only.check();
    await billing
      .getByLabel('Reason for pausing the service *')
      .fill(`${runTag} pause (synthetic)`);
    await billing.getByLabel('I confirm these changes.').check();
    await billing.getByRole('button', { name: 'Apply' }).click();
    await expect(row.getByText('Paused', { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(
      page
        .getByTestId('client-service')
        .filter({ hasText: SERVICE })
        .getByText('Paused', { exact: true }),
    ).toBeVisible({
      timeout: 60_000,
    });
    await shot(page, TAB, 'S3-service-paused', info);
    await action('Service & Billing');
    billing = page.getByRole('dialog', { name: 'Service & Billing' });
    await billing.getByLabel('I confirm these changes.').check();
    await billing.getByRole('button', { name: 'Apply' }).click();
    await expect(row.getByText('Paused', { exact: true })).toHaveCount(0, { timeout: 30_000 });
    await action('History');
    const history = page.getByRole('dialog', { name: 'Service History' });
    await expect(history).toContainText('Paused');
    await expect(history).toContainText('Resumed');
    await shot(page, TAB, 'S3-service-history', info);
    await page.keyboard.press('Escape');
  });

  test('§3 Document and portal actions (C2-009/030) owner: Portal Access sends the invitation to the confirmed address, shows it after a reload, and revokes it', async ({
    page,
  }, info) => {
    await openClient(page, c.epsilon);
    const access = page.getByTestId('portal-access');
    await expect(access).toContainText(/No portal login yet|Revoked|Expired/, { timeout: 60_000 });
    await access.getByRole('button', { name: /^(Send|Resend) Portal Invitation$/ }).click();
    const dialog = page.getByRole('dialog', { name: /^(Send|Resend) Portal Invitation$/ });
    const confirm = dialog.getByRole('checkbox');
    await expect(dialog).toContainText(email(6));
    // Rule: the invitation goes only to a simulator address (the screen and the record).
    await expectOnlySimulator(dialog.getByTestId('send-invitation'), 'portal invitation');
    await expectSendable(page, c.epsilon, 'portal invitation');
    await confirm.check();
    await dialog.getByRole('button', { name: 'Send Invitation' }).click();
    await expect(page.getByTestId('portal-notice')).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(page.getByTestId('portal-access').getByTestId('invitation-line')).toBeVisible({
      timeout: 60_000,
    });
    await shot(page, TAB, 'C2-030-sent', info);
    await page
      .getByTestId('portal-access')
      .getByRole('button', { name: 'Revoke Invitation' })
      .click();
    await page
      .getByRole('dialog', { name: 'Revoke Invitation' })
      .getByRole('button', { name: 'Revoke Invitation' })
      .click();
    await page.reload();
    await expect(
      page.getByTestId('portal-access').getByRole('button', { name: 'Revoke Invitation' }),
    ).toHaveCount(0, {
      timeout: 60_000,
    });
    await shot(page, TAB, 'C2-030-revoked', info);
  });

  test('§3 Bulk and contextual actions (C2-016) owner: the row menu sends an intake form or books with the client chosen; Bulk Actions lists its actions', async ({
    page,
  }, info) => {
    await openClient(page, c.alpha);
    await expect(main(page).getByRole('link', { name: 'Schedule Appointment' })).toHaveAttribute(
      'href',
      new RegExp(`/calendar/new\\?clientId=${c.alpha}`),
    );
    await openClients(page, `?search=${STAMP}`);
    await page.getByRole('button', { name: `More actions for ${N.alpha}` }).click();
    await expect(page.getByRole('menuitem', { name: 'Schedule Appointment' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Send Intake Form' }).click();
    await expect(page).toHaveURL(new RegExp(`/intake-forms/send\\?clientId=${c.alpha}`), {
      timeout: 60_000,
    });
    await expect(page.getByTestId('send-summary')).toContainText(N.alpha, { timeout: 60_000 });
    await shot(page, TAB, 'C2-016-intake', info);
    await openClients(page, `?search=${STAMP}`);
    await select(page, N.alpha);
    await page.getByRole('button', { name: 'Bulk Actions' }).click();
    for (const item of [
      'Assign Staff Member',
      'Add Tag',
      'Change Status',
      'Export Selected',
      'Send Message',
      'Request Document',
      'Send Intake Form',
      'Archive Clients',
    ]) {
      await expect(page.getByRole('menuitem', { name: item })).toBeVisible();
    }
    await shot(page, TAB, 'C2-016-bulk-menu', info);
    await page.keyboard.press('Escape');
  });

  test("§3 Last Activity timestamp (C2-044/048) owner: the list shows the client's latest recorded action", async ({
    page,
  }, info) => {
    await openClients(page);
    await searchFor(page, N.alpha);
    const time = entry(page, N.alpha).locator('time').first();
    await expect(time).toBeVisible();
    const when = Date.parse((await time.getAttribute('datetime')) ?? '');
    expect(Date.now() - when, 'Last Activity is from this run (a note and a message)').toBeLessThan(
      6 * 3_600_000,
    );
    await shot(page, TAB, 'C2-044', info);
  });

  test("§3 Last Activity logic (C2-026) owner: today in the firm's zone includes the client, tomorrow does not (kept after a reload)", async ({
    page,
  }, info) => {
    await openClients(page, `?search=${STAMP}`);
    const range = async (from: string, to: string) => {
      await lastTrigger(page).click();
      await lastPanel(page)
        .getByRole('textbox', { name: 'Last activity: From, start date' })
        .fill(from);
      await lastPanel(page).getByRole('textbox', { name: 'Last activity: To, end date' }).fill(to);
      await lastPanel(page).getByRole('button', { name: 'Done: close last activity' }).click();
      await settled(page);
    };
    await range(firmDay(0), firmDay(0));
    await expect(entry(page, N.alpha)).toHaveCount(1);
    await page.reload();
    await settled(page);
    await expect(entry(page, N.alpha)).toHaveCount(1);
    await shot(page, TAB, 'C2-026-today', info);
    await range(firmDay(1), firmDay(1));
    await expect(entry(page, N.alpha)).toHaveCount(0);
  });

  // ---------------------------------------------------------------- §4

  test('§4 Last Activity dismissal (C2-018) owner: Escape and an outside click close the panel; focus returns to its button', async ({
    page,
  }, info) => {
    await openClients(page);
    await lastTrigger(page).click();
    await expect(lastPanel(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(lastPanel(page)).toBeHidden();
    await expect(lastTrigger(page)).toBeFocused();
    await lastTrigger(page).click();
    await expect(lastPanel(page)).toBeVisible();
    await title(page).click();
    await expect(lastPanel(page)).toBeHidden();
    await shot(page, TAB, 'C2-018', info);
  });

  test('§4 Last Activity accessible names (C2-019) owner: From, To, Clear and Done each have a name', async ({
    page,
  }, info) => {
    await openClients(page);
    await lastTrigger(page).click();
    const panel = lastPanel(page);
    await expect(
      panel.getByRole('textbox', { name: 'Last activity: From, start date', exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole('textbox', { name: 'Last activity: To, end date', exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole('button', { name: 'Clear last activity', exact: true }),
    ).toBeVisible();
    await expect(
      panel.getByRole('button', { name: 'Done: close last activity', exact: true }),
    ).toBeVisible();
    await shot(page, TAB, 'C2-019', info);
    await page.keyboard.press('Escape');
  });

  test('§4 Dirty Add dismissal (C2-029) owner: Cancel and the X ask first on a filled Add; Keep Editing keeps every value; Discard empties it', async ({
    page,
  }, info) => {
    await openClients(page);
    let dialog = await addDialog(page);
    await dialog.getByLabel('Full name *').fill(full('Draft'));
    await dialog.getByLabel('Email *').fill(email(26));
    const leaving = dialog.getByRole('alertdialog');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(leaving).toBeVisible();
    await shot(page, TAB, 'C2-029-ask', info);
    await leaving.getByRole('button', { name: 'Keep Editing' }).click();
    await expect(dialog.getByLabel('Full name *')).toHaveValue(full('Draft'));
    await expect(dialog.getByLabel('Email *')).toHaveValue(email(26));
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await expect(leaving).toBeVisible();
    await leaving.getByRole('button', { name: 'Discard' }).click();
    await expect(dialog).toBeHidden();
    dialog = await addDialog(page);
    await expect(dialog.getByLabel('Full name *')).toHaveValue('');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  test('§4 Stale profile after assignment (C2-034) owner: after a bulk assign and a bulk unassign the profile and the list agree at once', async ({
    page,
  }, info) => {
    const to = c.staffName || c.ownerName;
    test.skip(!to, 'no member names');
    await openClients(page, `?search=${STAMP}`);
    await entry(page, N.epsilon).getByTestId('client-link').click();
    await expect(title(page)).toHaveText(N.epsilon, { timeout: 60_000 });
    await main(page).getByRole('link', { name: 'Clients', exact: true }).click();
    await bulkAssign(page, [N.epsilon], to);
    await expect(entry(page, N.epsilon)).toContainText(tail(to));
    await entry(page, N.epsilon).getByTestId('client-link').click();
    await expect(assignedOnProfile(page)).toHaveText(to, { timeout: 60_000 });
    await main(page).getByRole('link', { name: 'Clients', exact: true }).click();
    await bulkAssign(page, [N.epsilon], 'Nobody (unassign)');
    await expect(entry(page, N.epsilon)).toContainText('Unassigned');
    await entry(page, N.epsilon).getByTestId('client-link').click();
    await expect(assignedOnProfile(page)).toHaveText('Unassigned', { timeout: 60_000 });
    await page.reload();
    await expect(assignedOnProfile(page)).toHaveText('Unassigned', { timeout: 60_000 });
    await shot(page, TAB, 'C2-034-stale', info);
  });

  test("§4 Archived note writes (C2-036) owner: an archived client's notes are read-only (kept after a reload); restored, they take notes again", async ({
    page,
  }, info) => {
    await openClient(page, c.delta);
    await page.getByRole('button', { name: 'Archive client' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByRole('button', { name: 'Restore client' })).toBeVisible();
    try {
      await openClient(page, c.delta, '/notes');
      const notes = page.getByTestId('client-notes');
      await expect(notes.getByTestId('notes-read-only')).toHaveText(
        'This client is archived, so its notes are read-only until it is restored.',
      );
      await expect(notes.getByLabel('New note')).toHaveCount(0);
      await page.reload();
      await expect(page.getByTestId('client-notes').getByTestId('notes-read-only')).toBeVisible({
        timeout: 60_000,
      });
      await shot(page, TAB, 'C2-036-read-only', info);
    } finally {
      await openClient(page, c.delta);
      await page.getByRole('button', { name: 'Restore client' }).click();
      await expect(page.getByRole('button', { name: 'Archive client' })).toBeVisible();
    }
    await openClient(page, c.delta, '/notes');
    await expect(page.getByTestId('client-notes').getByLabel('New note')).toBeVisible();
  });

  test('§4 Formatted phone search (C2-046) owner: the phone as shown, with dashes or digits only, finds the client', async ({
    page,
  }, info) => {
    await openClients(page);
    const d = digits(1);
    for (const q of [phone(1), `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`, d]) {
      await searchFor(page, q);
      await expect(entry(page, N.alpha)).toHaveCount(1);
    }
    await shot(page, TAB, 'C2-046', info);
  });

  test("§4 Existing rules newly failed owner: Edit pauses on another client's phone too; Keep Editing keeps the value and nothing is saved", async ({
    page,
  }, info) => {
    await openClient(page, c.alpha);
    const dialog = await editOpen(page, N.alpha);
    await dialog.getByLabel('Phone *').fill(phone(3));
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    const dup = duplicateDialog(page);
    await expect(dup).toBeVisible({ timeout: 30_000 });
    await expect(dup.getByTestId('duplicate-matches')).toContainText(N.gamma);
    await dup.getByRole('button', { name: 'Keep Editing' }).click();
    await expect(dialog.getByLabel('Phone *')).toHaveValue(phone(3));
    await shot(page, TAB, 'S4-existing', info);
    await discardEdit(dialog);
    await page.reload();
    await expect(main(page).locator('header')).toContainText(phone(1), { timeout: 60_000 });
  });

  // ---------------------------------------------------------------- §5

  test('§5 Proposed duplicate popup owner: each match shows its type, contact, staff, status and why, with its Client ID and Open Existing in a new tab', async ({
    page,
  }, info) => {
    await openClient(page, c.alpha);
    const number = /CL-\d+/.exec(await page.getByTestId('client-id').innerText())?.[0] ?? 'CL-';
    await openClients(page);
    const dialog = await addDialog(page);
    await fillIndividual(dialog, full('Popup'), email(27), phone(1));
    await dialog.getByRole('button', { name: 'Add Client' }).click();
    const dup = duplicateDialog(page);
    await expect(dup).toBeVisible({ timeout: 30_000 });
    const matches = dup.getByTestId('duplicate-matches');
    await expect(matches).toContainText(N.alpha);
    await expect(matches).toContainText(number);
    const facts = dup.getByTestId('duplicate-facts').first();
    await expect(facts).toContainText('Individual');
    await expect(facts).toContainText('Same phone number');
    await expect(facts).toContainText(/Assigned to |Unassigned/);
    const open = dup.getByRole('link', { name: /Open Existing/ }).first();
    await expect(open).toHaveAttribute('target', '_blank');
    await expect(open).toHaveAttribute('href', /\/clients\//);
    await shot(page, TAB, 'S5-popup', info);
    await dup.getByRole('button', { name: 'Keep Editing' }).click();
    await discardAdd(page, dialog);
  });

  test('§5 Duplicate review principle owner: Create Anyway adds a separate client; both open on their own (kept after a reload), never merged', async ({
    page,
  }, info) => {
    await openClients(page);
    const dialog = await addDialog(page);
    await fillIndividual(dialog, full('Anyway'), email(24), phone(1));
    await dialog.getByRole('button', { name: 'Add Client' }).click();
    await duplicateDialog(page).getByRole('button', { name: 'Create Anyway' }).click();
    await expect(title(page)).toHaveText(full('Anyway'), { timeout: 60_000 });
    const id = new RegExp(`/clients/(${UUID.source})`).exec(page.url())![1]!;
    remember({ anyway: id, made: [...readCtx().made, id] });
    await page.reload();
    await expect(title(page)).toHaveText(full('Anyway'), { timeout: 60_000 });
    await openClient(page, c.alpha);
    await expect(title(page)).toHaveText(N.alpha);
    await expect(main(page).locator('header')).toContainText(email(1));
    await shot(page, TAB, 'S5-anyway', info);
  });

  test('§5 Duplicate safeguards: matched IDs in audit, override reason owner: the audit row of a client made past the warning names the matched client', async ({
    page,
  }, info) => {
    const id = readCtx().anyway;
    test.skip(!id, 'no client made past the warning (the §5 principle test failed)');
    await page.goto(app('/audit-log'));
    await expect(title(page)).toBeVisible({ timeout: 60_000 });
    await page.getByLabel('Record id').fill(id);
    await page.getByLabel('Record id').press('Enter');
    await settled(page);
    const details = page.getByTestId('audit-details').filter({ visible: true });
    await expect(details.first()).toBeVisible({ timeout: 60_000 });
    for (const d of await details.all()) await d.locator('summary').click();
    await expect(main(page)).toContainText(c.alpha);
    await shot(page, TAB, 'S5-audit', info);
    note(info, 'NOT LIVE', 'an override reason: her recommendation, not built');
  });

  test('§5 Last Activity owner clarification owner: viewing a profile is not activity', async ({
    page,
  }, info) => {
    await openClients(page);
    await searchFor(page, N.zeta);
    const read = async () =>
      (await entry(page, N.zeta)
        .locator('time')
        .first()
        .getAttribute('datetime')
        .catch(() => null)) ?? 'none';
    const before = await read();
    await entry(page, N.zeta).getByTestId('client-link').click();
    await expect(title(page)).toHaveText(N.zeta, { timeout: 60_000 });
    await settled(page);
    await page.goBack();
    await settled(page);
    await page.reload();
    await settled(page);
    expect(await read(), 'Last Activity after only viewing').toBe(before);
    await shot(page, TAB, 'S5-view-not-activity', info);
  });

  test('§5 ZIP validity: format owner: a non-ZIP is refused on Add; ZIP+4 with a leading zero is kept as typed (after a reload)', async ({
    page,
  }, info) => {
    await openClients(page);
    const add = await addDialog(page);
    await fillIndividual(add, full('Zip Format'), email(28), phone(28), 'abc');
    await add.getByRole('button', { name: 'Add Client' }).click();
    await expect(add.getByText('Enter a 5-digit ZIP code')).toBeVisible();
    await discardAdd(page, add);
    await openClient(page, c.alpha);
    const dialog = await editOpen(page, N.alpha);
    await dialog.getByLabel('City *').fill('Boston');
    await dialog.getByLabel('State *').fill('MA');
    await dialog.getByLabel('ZIP code *').fill('02134-0001');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await page.reload();
    await expect(page.getByTestId('client-overview')).toContainText('02134-0001', {
      timeout: 60_000,
    });
    await shot(page, TAB, 'S5-zip-plus4', info);
  });

  test('§5 ZIP validity: existence, city/state, server owner: a ZIP from another state warns and saves (kept after a reload)', async ({
    page,
  }, info) => {
    await openClient(page, c.alpha);
    let dialog = await editOpen(page, N.alpha);
    await dialog.getByLabel('City *').fill('Atlanta');
    await dialog.getByLabel('State *').fill('GA');
    await dialog.getByLabel('ZIP code *').fill('10001');
    await expect(dialog.getByTestId('zip-warning')).toHaveText(/usually in NY, not GA/);
    await shot(page, TAB, 'S5-zip-warning', info);
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await page.reload();
    await expect(page.getByTestId('client-overview')).toContainText('10001', { timeout: 60_000 });
    // Back to Alpha's own address.
    dialog = await editOpen(page, N.alpha);
    await dialog.getByLabel('ZIP code *').fill('30301');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
  });

  test("§5 ZIP lookup edge cases owner: an unknown ZIP says it can't be verified, another state's says so; neither blocks", async ({
    page,
  }, info) => {
    await openClients(page);
    const dialog = await addDialog(page);
    await fillIndividual(dialog, full('Zip Edge'), email(29), phone(29));
    await expect(dialog.getByTestId('zip-warning')).toBeHidden();
    await dialog.getByLabel('ZIP code *').fill('42801');
    await expect(dialog.getByTestId('zip-warning')).toHaveText(/can't verify ZIP code 42801/);
    await dialog.getByLabel('ZIP code *').fill('10001');
    await expect(dialog.getByTestId('zip-warning')).toHaveText(/usually in NY, not GA/);
    await expect(dialog.getByRole('button', { name: 'Add Client' })).toBeEnabled();
    await shot(page, TAB, 'S5-zip-edge', info);
    await discardAdd(page, dialog);
  });

  test('§5 Prior owner additions owner: Added 30 days, More Filters, Archived, Export, the party, links, Request Details, Enrolled Services and Activity are there', async ({
    page,
  }, info) => {
    await openClients(page);
    await expect(viewTab(page, 'Added Last 30 Days')).toBeVisible();
    await expect(viewTab(page, 'Archived')).toBeVisible();
    await expect(page.getByRole('button', { name: /More Filters/ })).toBeVisible();
    await expect(page.getByTestId('export-clients')).toBeVisible();
    await openClient(page, c.gamma);
    await expect(page.getByTestId('responsible-party')).toBeVisible();
    await expect(page.getByTestId('client-links')).toBeVisible();
    await openClient(page, c.alpha);
    await expect(page.getByTestId('active-services')).toContainText(SERVICE);
    await expect(page.getByTestId('recent-activity')).toBeVisible();
    await openClient(page, c.alpha, '/documents');
    await expect(page.getByTestId('document-requests')).toBeVisible();
    await shot(page, TAB, 'S5-prior', info);
  });

  test("§5 Billing cross reference owner: the Invoices tab is there (billing additions are the billing review's)", async ({
    page,
  }, info) => {
    await openClient(page, c.alpha, '/invoices');
    await expect(tabHeader(page).getByRole('heading', { level: 2 })).toHaveText('Invoices');
    await shot(page, TAB, 'S5-billing', info);
    note(info, 'note', 'the billing additions belong to her billing review');
  });

  // ---------------------------------------------------------------- §6

  test('§6 Counts and filter membership owner: All, Active, New and Inactive cards each equal their tab', async ({
    page,
  }, info) => {
    await openClients(page);
    for (const [label, tabName] of [
      ['Total Clients', 'All Clients'],
      ['Active Clients', 'Active'],
      ['New Clients', 'New'],
      ['Inactive Clients', 'Inactive'],
    ] as const) {
      const count = await kpiNumber(page, label);
      await viewTab(page, tabName).click();
      await expect(viewTab(page, tabName)).toHaveAttribute('aria-selected', 'true');
      await settled(page);
      expect(await listTotal(page), `${label} equals the ${tabName} tab`).toBe(count);
    }
    await shot(page, TAB, 'S6-counts', info);
  });

  test('§6 Search and navigation depth owner: a company name finds the business; Name A to Z orders the list and stays after opening one and Back', async ({
    page,
  }, info) => {
    await openClients(page);
    await searchFor(page, `${STAMP} Gamma Holdings`);
    await expect(entry(page, N.gamma)).toHaveCount(1);
    await searchFor(page, STAMP);
    // Sort by (G12) is the list's own choice: it is not in the address (clients-screen.tsx).
    await page.getByLabel('Sort by').selectOption('NAME_ASC');
    await settled(page);
    const azOrder = async () => {
      const names = (await entries(page).getByTestId('client-link').allInnerTexts()).map((s) =>
        s.trim(),
      );
      return (
        names.length > 1 &&
        names.join('|') === [...names].sort((a, b) => a.localeCompare(b)).join('|')
      );
    };
    await expect.poll(azOrder, { message: 'Name A to Z', timeout: 30_000 }).toBe(true);
    await entries(page).first().getByTestId('client-link').click();
    await expect(title(page)).toContainText(STAMP, { timeout: 60_000 });
    await page.goBack();
    await expect(title(page)).toHaveText('Clients', { timeout: 60_000 });
    await expect(searchBox(page)).toHaveValue(STAMP);
    await settled(page);
    await shot(page, TAB, 'S6-sort', info);
    await expect(page.getByLabel('Sort by'), 'Name A to Z is kept after Back').toHaveValue(
      'NAME_ASC',
    );
    await expect.poll(azOrder, { message: 'Name A to Z after Back' }).toBe(true);
  });

  test('§6 Full Add and Edit coverage a (likely company match) owner: a business with a likely matching name pauses with the match', async ({
    page,
  }, info) => {
    await openClients(page);
    const dialog = await addDialog(page);
    await dialog.getByLabel('Client type *').selectOption('BUSINESS');
    await dialog.getByLabel('Business name *').fill(`${runTag} Gamma Holdings, Inc.`);
    await dialog.getByLabel('Business email *').fill(email(30));
    await dialog.getByLabel('Business phone *').fill(phone(30));
    await dialog.getByLabel('Street address *').fill(`${STAMP} Dock Street`);
    await dialog.getByLabel('City *').fill('Savannah');
    await dialog.getByLabel('State *').selectOption('GA');
    await dialog.getByLabel('ZIP code *').fill('31401');
    const party = dialog.getByTestId('responsible-party');
    await party.getByLabel('Full name *').fill(full('Likely Owner'));
    await party.getByLabel('Their email *').fill(email(31));
    await party.getByLabel('Their phone *').fill(phone(31));
    await dialog.getByRole('button', { name: 'Add Client' }).click();
    const dup = duplicateDialog(page);
    await expect(dup).toContainText('Another business client of your firm has a similar name.', {
      timeout: 30_000,
    });
    await expect(dup.getByTestId('duplicate-matches')).toContainText(N.gamma);
    await expect(dup.getByTestId('duplicate-facts').first()).toContainText('Similar name');
    await shot(page, TAB, 'S6-company-match', info);
    await dup.getByRole('button', { name: 'Keep Editing' }).click();
    await discardAdd(page, dialog);
  });

  test('§6 Lifecycle and service history owner: Change Status moves a client to Inactive (kept after a reload); the service history lists its events', async ({
    page,
  }, info) => {
    await openClients(page, `?search=${STAMP}`);
    await select(page, N.delta);
    await bulk(page, 'Change Status');
    const dialog = page.getByRole('dialog', { name: 'Change Status' });
    await dialog.getByLabel('New status').selectOption('INACTIVE');
    await dialog.getByRole('button', { name: 'Change Status' }).click();
    await expect(page.getByText('1 client updated.').first()).toBeVisible();
    await viewTab(page, 'Inactive').click();
    await settled(page);
    await expect(entry(page, N.delta)).toHaveCount(1);
    await page.reload();
    await settled(page);
    await expect(entry(page, N.delta)).toHaveCount(1);
    await shot(page, TAB, 'S6-inactive', info);
    await openClient(page, c.alpha, '/services');
    await page
      .getByRole('button', { name: `Actions for ${SERVICE}` })
      .first()
      .click();
    await page.getByRole('menuitem', { name: 'History' }).click();
    await expect(page.getByRole('dialog', { name: 'Service History' })).toContainText(
      /Enrolled|Started|Active/,
    );
    await page.keyboard.press('Escape');
  });

  test('§6 Canonical workflow completion owner: intake, task, document request and appointment each open with the client chosen', async ({
    page,
  }, info) => {
    await openClient(page, c.alpha, '/intake-forms');
    await expect(
      tabHeader(page).getByRole('link', { name: 'Send an Intake Form' }),
    ).toHaveAttribute('href', new RegExp(`clientId=${c.alpha}`));
    await openClient(page, c.alpha, '/tasks');
    await expect(tabHeader(page).getByRole('link', { name: 'New Task' })).toHaveAttribute(
      'href',
      new RegExp(`clientId=${c.alpha}`),
    );
    await openClient(page, c.alpha, '/documents');
    await expect(tabHeader(page).getByRole('button', { name: 'Request a document' })).toBeVisible();
    await expect(main(page).getByRole('link', { name: 'Schedule Appointment' })).toHaveAttribute(
      'href',
      new RegExp(`clientId=${c.alpha}`),
    );
    await page.goto(app(`/calendar/new?clientId=${c.alpha}`));
    await expect(main(page)).toContainText(N.alpha, { timeout: 60_000 });
    await shot(page, TAB, 'S6-canonical-appointment', info);
  });

  test("§6 Summaries and important dates owner: Overview's summaries each open their place with Back to the client", async ({
    page,
  }, info) => {
    await openClient(page, c.alpha);
    const cards = page.getByTestId('client-summary');
    for (const [key, label] of [
      ['balance', 'Balance due'],
      ['documents', 'Missing documents'],
      ['messages', 'Unread messages'],
      ['intake', 'Open intake forms'],
      ['services', 'Active services'],
      ['appointment', 'Next appointment'],
    ] as const) {
      await expect(cards.getByTestId(`summary-${key}`)).toContainText(label);
    }
    await shot(page, TAB, 'S6-summaries', info);
    // The summaries have loaded once each card is a link to its place.
    await expect(cards.getByTestId('summary-services')).toHaveAttribute('href', /\/services/);
    await cards.getByTestId('summary-services').click();
    await expect(page).toHaveURL(new RegExp(`/clients/${c.alpha}/services`), { timeout: 60_000 });
  });

  test('§6 Delivery and document access owner: who a message reaches and the portal state are shown before anything is sent; the file downloads', async ({
    page,
  }, info) => {
    await openClient(page, c.epsilon);
    await expect(page.getByTestId('portal-access')).toBeVisible({ timeout: 60_000 });
    await openClient(page, c.alpha, '/messages');
    await tabHeader(page).getByRole('button', { name: 'New Message' }).click();
    await expect(page.getByRole('dialog').getByTestId('message-recipient')).toContainText('Notice');
    await page.keyboard.press('Escape');
    if (readCtx().docName) {
      await openClient(page, c.alpha, '/documents');
      await expect(page.getByTestId('document-download').first()).toBeVisible();
    }
    await shot(page, TAB, 'S6-delivery', info);
    note(
      info,
      'NOT LIVE',
      'receipt in a mailbox and the portal: her retest (simulator addresses only here)',
    );
  });

  test("§6 Audit completeness owner: Export says what goes in and is recorded; the client's record has audit rows", async ({
    page,
  }, info) => {
    await openClients(page, `?search=${STAMP}`);
    const total = await listTotal(page);
    await page.getByTestId('export-clients').click();
    const dialog = page.getByTestId('export-dialog');
    await expect(dialog).toContainText('Never an SSN, EIN or date of birth');
    await expect(dialog).toContainText('recorded in your firm');
    // The CSV opens or downloads (either way the page says what it exported).
    await page.getByRole('button', { name: `Export ${total} clients` }).click();
    await expect(page.getByText(`Exported ${total} clients.`)).toBeVisible();
    await page.goto(app('/audit-log'));
    await page.getByLabel('Record id').fill(c.alpha);
    await page.getByLabel('Record id').press('Enter');
    await settled(page);
    await expect(page.getByTestId('audit-details').filter({ visible: true }).first()).toBeVisible({
      timeout: 60_000,
    });
    await shot(page, TAB, 'S6-audit', info);
  });

  test('§6 Reliability and accessibility a (dismissal, focus, names, failed save) owner: a failed Add says why and keeps every value; closing returns focus to Add New Client', async ({
    page,
  }, info) => {
    await openClients(page);
    const dialog = await addDialog(page);
    await fillIndividual(dialog, full('Failed Save'), email(1), phone(32));
    await dialog.getByRole('button', { name: 'Add Client' }).click();
    await expect(
      dialog.getByText('Another client of your firm already uses this email.'),
    ).toBeVisible();
    await expect(dialog.getByLabel('Full name *')).toHaveValue(full('Failed Save'));
    await expect(dialog.getByLabel('State *')).toHaveValue('GA');
    await expect(dialog.getByRole('button', { name: 'Add Client' })).toBeEnabled();
    await shot(page, TAB, 'S6-failed-save', info);
    await page.keyboard.press('Escape');
    const leaving = dialog.getByRole('alertdialog');
    if (await leaving.isVisible().catch(() => false))
      await leaving.getByRole('button', { name: 'Discard' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('add-client')).toBeFocused();
  });

  test("§6 Full Add and Edit coverage b (Edit's Save Anyway) owner: Edit pauses on another client's phone; Save Anyway saves it (kept after a reload)", async ({
    page,
  }, info) => {
    await openClient(page, c.epsilon);
    const dialog = await editOpen(page, N.epsilon);
    await dialog.getByLabel('Phone *').fill(phone(1));
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    const dup = duplicateDialog(page);
    await expect(dup).toBeVisible({ timeout: 30_000 });
    await dup.getByRole('button', { name: 'Save Anyway' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await page.reload();
    await expect(main(page).locator('header')).toContainText(phone(1), { timeout: 60_000 });
    await shot(page, TAB, 'S6-save-anyway', info);
  });

  // ---------------------------------------------------------------- visual (§9)

  test('V-001 Tab strip scrollbar owner: the Sign-ups strip has no vertical scrollbar', async ({
    page,
  }, info) => {
    await page.goto(app('/sign-ups'));
    const strip = page.getByRole('tablist', { name: 'Sign-up status' });
    await expect(strip).toBeVisible({ timeout: 60_000 });
    expect(await verticalOverflow(strip)).toBeLessThanOrEqual(1);
    const doc = readCtx().docId;
    if (doc) {
      await page.goto(app(`/documents/${doc}/share`));
      const sharing = page.getByRole('tablist', { name: 'Sharing' });
      await expect(sharing).toBeVisible({ timeout: 60_000 });
      expect(await verticalOverflow(sharing)).toBeLessThanOrEqual(1);
    }
    await shot(page, TAB, 'V-001', info);
  });

  test('V-002 Documents KPI labels owner: each card label fits its card', async ({
    page,
  }, info) => {
    await page.goto(app('/documents'));
    const cards = page.getByTestId('stat-cards').locator('> *');
    await expect(cards.first()).toBeVisible({ timeout: 60_000 });
    for (const card of await cards.all()) {
      expect(
        await card.evaluate((el) => el.scrollWidth - el.clientWidth),
        'a label wider than its card',
      ).toBeLessThanOrEqual(1);
    }
    await shot(page, TAB, 'V-002', info);
  });

  test('V-003 Documents filters owner: with a client chosen the filters do not overlap and the client shows on hover', async ({
    page,
  }, info) => {
    await page.goto(app('/documents'));
    await expect(page.getByTestId('documents-screen')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('filter-client').selectOption({ label: N.alpha });
    await expect(page.getByTestId('filter-client')).toHaveAttribute('title', N.alpha);
    const boxes = [];
    for (const f of await page
      .getByTestId('documents-filters')
      .locator('select, input')
      .filter({ visible: true })
      .all()) {
      const b = await f.boundingBox();
      if (b) boxes.push(b);
    }
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const overlap =
          a.x < b.x + b.width - 1 &&
          b.x < a.x + a.width - 1 &&
          a.y < b.y + b.height - 1 &&
          b.y < a.y + a.height - 1;
        expect(overlap, `filters ${i} and ${j} overlap`).toBe(false);
      }
    await shot(page, TAB, 'V-003', info);
  });

  test('V-004 Documents table readability owner: headers fit their cells; the table scrolls inside its region, never the page', async ({
    page,
  }, info) => {
    await page.goto(app('/documents'));
    await expect(page.getByTestId('documents-screen')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('filter-client').selectOption({ label: N.alpha });
    await settled(page);
    const table = page.getByTestId('documents-table').locator('table');
    if (await table.count()) {
      for (const th of await table.locator('th').all()) {
        expect(
          await th.evaluate((el) => el.scrollWidth - el.clientWidth),
          'a header clipped',
        ).toBeLessThanOrEqual(1);
      }
    }
    await expectNoSideScroll(page);
    await shot(page, TAB, 'V-004', info);
  });

  test('V-005 Actions menu clipping owner: the row menu opens with every item in view', async ({
    page,
  }, info) => {
    const name = readCtx().docName;
    test.skip(!name, 'no file (the §2 Documents upload failed)');
    await page.goto(app('/documents'));
    await expect(page.getByTestId('documents-screen')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('filter-client').selectOption({ label: N.alpha });
    await page.getByRole('button', { name: `Actions for ${name}` }).click();
    const items = page.getByRole('menu', { name: `Actions for ${name}` }).getByRole('menuitem');
    await expect(items.first()).toBeVisible();
    for (const item of await items.all())
      await inViewport(page, item, (await item.innerText()).trim());
    await shot(page, TAB, 'V-005', info);
    await page.keyboard.press('Escape');
  });

  test('V-006 Request KPI baselines owner: the Document Requests counts sit on one line', async ({
    page,
  }, info) => {
    await page.goto(app('/documents/requests'));
    const cards = page.getByTestId('request-cards').locator('> *');
    await expect(cards.first()).toBeVisible({ timeout: 60_000 });
    const tops: number[] = [];
    for (const card of await cards.all()) {
      const count = card.getByText(/^\d[\d,]*$/).first();
      const b = await count.boundingBox();
      if (b) tops.push(b.y);
    }
    expect(Math.max(...tops) - Math.min(...tops), "the counts' tops differ").toBeLessThanOrEqual(2);
    await shot(page, TAB, 'V-006', info);
  });

  test('V-007 Main sidebar collapse owner: the menu collapses to named icons, remembers it after a reload, and expands', async ({
    page,
  }, info) => {
    await openClients(page);
    await page.getByRole('button', { name: 'Collapse menu' }).click();
    await expect(page.getByRole('button', { name: 'Expand menu' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Clients' }).first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Expand menu' })).toBeVisible({
      timeout: 60_000,
    });
    await shot(page, TAB, 'V-007', info);
    await page.getByRole('button', { name: 'Expand menu' }).click();
    await expect(page.getByRole('button', { name: 'Collapse menu' })).toBeVisible();
  });

  test('V-008 Full filename disclosure owner: a file name shows its full name with the extension on hover', async ({
    page,
  }, info) => {
    const name = readCtx().docName;
    test.skip(!name, 'no file (the §2 Documents upload failed)');
    await page.goto(app('/documents'));
    await expect(page.getByTestId('documents-screen')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('filter-client').selectOption({ label: N.alpha });
    const link = page.getByTestId('document-name').filter({ hasText: STAMP }).first();
    await expect(link).toHaveAttribute('title', /\.pdf$/);
    await shot(page, TAB, 'V-008', info);
  });

  test('V-009 Approved column alignment owner: at 1165 px the Folders panel starts where the cards start; the table is the widest region', async ({
    page,
  }, info) => {
    await page.goto(app('/documents'));
    const cards = page.getByTestId('stat-cards');
    await expect(cards).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('folders-panel')).toBeVisible({ timeout: 60_000 });
    await shot(page, TAB, 'V-009', info);
    const first = await cards.locator('> *').first().boundingBox();
    const folders = await page.getByTestId('folders-panel').boundingBox();
    // The table's region (the second column of the panels): the table itself shows only once a
    // client is chosen ("Select a client to view their documents.").
    const table = await page
      .getByTestId('documents-columns')
      .locator(':scope > *')
      .nth(1)
      .boundingBox();
    expect(first && folders && table, 'cards, Folders and the table are on the page').toBeTruthy();
    const tolerance = 24; // px: her alignment rule names no number
    expect(
      Math.abs(folders!.x - first!.x),
      `Folders' left edge vs the first card's (tolerance ${tolerance} px)`,
    ).toBeLessThanOrEqual(tolerance);
    expect(table!.width, 'the table is wider than Folders').toBeGreaterThan(folders!.width);
  });

  test('V-010 Directory, profiles, Sign-ups, other Documents owner: each screen fits without sideways scroll', async ({
    page,
  }, info) => {
    for (const [name, path] of [
      ['list', '/clients'],
      ['profile', `/clients/${c.alpha}`],
      ['sign-ups', '/sign-ups'],
      ['requests', '/documents/requests'],
    ] as const) {
      await page.goto(app(path));
      await expect(main(page)).toBeVisible({ timeout: 60_000 });
      await settled(page);
      await shot(page, TAB, `V-010-${name}`, info);
      await expectNoSideScroll(page);
    }
  });

  // ---------------------------------------------------------------- Documents follow-through (§10)

  test('C2-052 Existing file visibility owner: an existing file is internal by default; the switch shows it to the client (kept after a reload)', async ({
    page,
  }, info) => {
    const doc = readCtx().docId;
    test.skip(!doc, 'no file (the §2 Documents upload failed)');
    await page.goto(app(`/documents/${doc}`));
    const card = page.getByTestId('document-visibility');
    await expect(card).toContainText('Internal: the client does not see it', { timeout: 60_000 });
    // C2-055 sends the client a "New document" notice: Alpha's addresses are simulator ones.
    await expectSendable(page, c.alpha, 'shared-file notice');
    await card.getByLabel('Visible to the client').click();
    await expect(card).toContainText('Visible to the client in their portal');
    await page.reload();
    await expect(page.getByTestId('document-visibility')).toContainText(
      'Visible to the client in their portal',
      {
        timeout: 60_000,
      },
    );
    await shot(page, TAB, 'C2-052', info);
  });

  test('N8-31 Share Access recipients owner: a client-visible file offers the client as recipient', async ({
    page,
  }, info) => {
    const doc = readCtx().docId;
    test.skip(!doc, 'no file (the §2 Documents upload failed)');
    await page.goto(app(`/documents/${doc}/share`));
    await expect(page.getByTestId('share-file')).toContainText(N.alpha, { timeout: 60_000 });
    await expect(page.getByRole('radio', { name: /^Client/ })).toBeEnabled();
    await shot(page, TAB, 'N8-31', info);
  });

  test('Approved later client sharing owner: the switch hides the file again (revocable, kept after a reload)', async ({
    page,
  }, info) => {
    const doc = readCtx().docId;
    test.skip(!doc, 'no file (the §2 Documents upload failed)');
    await page.goto(app(`/documents/${doc}`));
    const card = page.getByTestId('document-visibility');
    await expect(card).toContainText('Visible to the client in their portal', { timeout: 60_000 });
    await card.getByLabel('Visible to the client').click();
    await expect(card).toContainText('Internal: the client does not see it');
    await page.reload();
    await expect(page.getByTestId('document-visibility')).toContainText(
      'Internal: the client does not see it',
      {
        timeout: 60_000,
      },
    );
    await shot(page, TAB, 'later-sharing', info);
  });

  test("C2-049 Empty staff choices owner: an internal file lists the firm's staff under Team Member (nothing shared)", async ({
    page,
  }, info) => {
    const doc = readCtx().docId;
    test.skip(!doc, 'no file (the §2 Documents upload failed)');
    await page.goto(app(`/documents/${doc}/share`));
    await expect(page.getByTestId('share-file')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('radio', { name: /^Team Member/ })).toBeChecked();
    const options = (
      await page.getByLabel('Recipient', { exact: true }).locator('option').allInnerTexts()
    ).map((s) => s.trim());
    expect(
      options.filter((o) => o && !/^Choose/i.test(o)).length,
      'staff are listed',
    ).toBeGreaterThan(0);
    if (c.staffName) {
      expect(
        options.some((o) => o.includes(c.staffName)),
        `${c.staffName} is a Team Member choice`,
      ).toBe(true);
    }
    await shot(page, TAB, 'C2-049', info);
    note(
      info,
      'NOT LIVE',
      'sharing with a staff member: it would email a @dev.firmivra.com login (no MX)',
    );
  });

  test('C2-050 Required recipient check owner: Share Document with no recipient says to choose one (nothing shared)', async ({
    page,
  }, info) => {
    const doc = readCtx().docId;
    test.skip(!doc, 'no file (the §2 Documents upload failed)');
    await page.goto(app(`/documents/${doc}/share`));
    await expect(page.getByTestId('share-file')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Share Document' }).click();
    await expect(page.getByText('Choose who to share it with.')).toBeVisible();
    await shot(page, TAB, 'C2-050', info);
  });

  test('C2-051 Document action scope owner: Rename, Move, Request e-sign and Archive work from the table (kept after a reload)', async ({
    page,
  }, info) => {
    const name = readCtx().docName;
    test.skip(!name, 'no file (the §2 Documents upload failed)');
    const open = async () => {
      await page.goto(app('/documents'));
      await expect(page.getByTestId('documents-screen')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('filter-client').selectOption({ label: N.alpha });
      await settled(page);
    };
    const act = async (file: string, item: string) => {
      await page.getByRole('button', { name: `Actions for ${file}` }).click();
      await page
        .getByRole('menu', { name: `Actions for ${file}` })
        .getByRole('menuitem', { name: item, exact: true })
        .click();
    };
    const done = page.getByTestId('document-action-done');
    await open();
    const renamed = `${STAMP}-renamed.pdf`;
    await act(name, 'Rename');
    const rename = page.getByRole('dialog', { name: 'Rename Document' });
    await rename.getByLabel('File name *').fill(renamed);
    await rename.getByRole('button', { name: 'Rename' }).click();
    await expect(done).toHaveText(`Renamed to ${renamed}.`);
    remember({ docName: renamed });
    await page.reload();
    await page.getByTestId('filter-client').selectOption({ label: N.alpha });
    await expect(page.getByTestId('document-name').filter({ hasText: renamed })).toBeVisible({
      timeout: 60_000,
    });
    await act(renamed, 'Move');
    const move = page.getByRole('dialog', { name: 'Move Document' });
    // The folders load after the dialog opens (the field is disabled until then). Move offers
    // the folders of the file's kind only: an internal file's are the firm folders, and Test Firm
    // B has none, so "No folder" (out of its client folder) is then the one destination.
    const folderField = move.getByLabel('Folder');
    await expect(folderField).toBeEnabled();
    const target = (await pickFirst(folderField)).trim();
    await move.getByRole('button', { name: 'Move' }).click();
    await expect(done).toHaveText(target ? `Moved to ${target}.` : 'Moved out of its folder.');
    await shot(page, TAB, 'C2-051-moved', info);
    await act(renamed, 'Request e-sign');
    await expect(page).not.toHaveURL(/\/documents(\?|$)/, { timeout: 60_000 });
    await expect(page).toHaveURL(new RegExp(`/firm-sign/new\\?clientId=${c.alpha}&documentId=`));
    const clientField = page.getByLabel('Client', { exact: true });
    const chosen = clientField.locator('option:checked');
    if (await firmSignOff(page, clientField))
      note(
        info,
        'partial',
        'Firm Sign is off for Test Firm B: Request e-sign opens Firm Sign with the client and file in its address; the form itself shows only while Firm Sign is on',
      );
    else await expect(chosen).toHaveText(N.alpha, { timeout: 60_000 });
    await shot(page, TAB, 'C2-051-esign', info);
    await open();
    await act(renamed, 'Archive');
    await page
      .getByRole('dialog', { name: 'Archive Document' })
      .getByRole('button', { name: 'Archive' })
      .click();
    await expect(done).toHaveText(`${renamed} archived.`);
    await page.reload();
    await page.getByTestId('filter-client').selectOption({ label: N.alpha });
    await settled(page);
    await expect(page.getByTestId('document-name').filter({ hasText: renamed })).toHaveCount(0);
  });

  // ---------------------------------------------------------------- Nov 8 flow check (N8)

  test("N8-05 Client Activity and Last Activity owner: the firm message is on the client's Activity with its link; Last Activity follows", async ({
    page,
  }, info) => {
    await openClient(page, c.alpha, '/activity');
    const list = page.getByTestId('client-activity');
    const msg = list.getByTestId('activity-entry').filter({ hasText: `${runTag} message` });
    await expect(msg).toBeVisible({ timeout: 60_000 });
    await expect(msg.getByRole('link').first()).toBeVisible();
    await shot(page, TAB, 'N8-05', info);
    await expect(list, 'any recorded client event (a note, the file, an edit)').toContainText(
      /note|document|file|updated|edited|changed/i,
    );
  });

  test('N8-06 Digits-only phone search hint owner: the hint says how to type a phone; digits find the client', async ({
    page,
  }, info) => {
    await openClients(page);
    await expect(page.getByTestId('client-search-hint')).toHaveText(
      'Search by name, email, company or Client ID (CL-10024). Phone: type numbers only, e.g. 5551234567.',
    );
    await searchFor(page, digits(1));
    await expect(entry(page, N.alpha)).toHaveCount(1);
    await shot(page, TAB, 'N8-06', info);
  });

  test('N8-07 Client ID search (UUID, CL-10004) owner: the record id and the shown Client ID each find the one client', async ({
    page,
  }, info) => {
    await openClient(page, c.alpha);
    const number = /CL-\d+/.exec(await page.getByTestId('client-id').innerText())?.[0] ?? '';
    await openClients(page);
    for (const q of [c.alpha, number]) {
      await searchFor(page, q);
      await expect(entry(page, N.alpha)).toHaveCount(1);
      expect(await listTotal(page)).toBe(1);
    }
    await shot(page, TAB, 'N8-07', info);
  });

  test('N8-08 Pagination and return owner: page 2 comes back after opening a client and Back', async ({
    page,
  }, info) => {
    await openClients(page);
    const pager = page
      .getByRole('navigation', { name: 'Pagination' })
      .filter({ visible: true })
      .first();
    await pickFirst(pager.getByRole('combobox'));
    await settled(page);
    const two = pager.getByRole('button', { name: 'Page 2' });
    test.skip(!(await two.count()), 'one page only at the smallest size');
    await two.click();
    await expect(page).toHaveURL(/page=2/);
    await entries(page).first().getByTestId('client-link').click();
    await expect(page).toHaveURL(new RegExp(`/clients/${UUID.source}`), { timeout: 60_000 });
    await page.goBack();
    await expect(page).toHaveURL(/page=2/);
    await expect(pager.getByRole('button', { name: 'Page 2' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await shot(page, TAB, 'N8-08', info);
  });

  test("N8-09 Profile tab scrollbar owner: the client's tab strip has no vertical scrollbar on any tab", async ({
    page,
  }, info) => {
    for (const t of TABS) {
      await openClient(page, c.alpha, t.path);
      const strip = page.getByRole('navigation', { name: 'Client', exact: true });
      expect(await verticalOverflow(strip), `${t.title}: vertical overflow`).toBeLessThanOrEqual(1);
    }
    await shot(page, TAB, 'N8-09-strip', info);
  });

  test("N8-09 Sign-ups Invite, Resend, Revoke owner: each changes the row (kept after a reload); sent only to the client's simulator address", async ({
    page,
  }, info) => {
    await page.goto(app('/sign-ups'));
    await page.getByTestId('sign-ups-tab-INVITATIONS').click({ timeout: 60_000 });
    await expect(page).toHaveURL(/tab=invitations/);
    const tab = page.getByTestId('sign-ups-invitations');
    await tab.getByLabel('Search clients').fill(N.zeta);
    const row = tab.getByTestId('invitation-row').filter({ hasText: N.zeta });
    await expect(row).toBeVisible({ timeout: 60_000 });
    const send = async (label: RegExp, ask: RegExp) => {
      await expectSendable(page, c.zeta, 'portal invitation');
      await row.getByRole('button', { name: label }).click();
      const dialog = page.getByRole('dialog', { name: ask });
      await expect(dialog).toBeVisible();
      if ((await dialog.innerText()).match(EMAILS)) await expectOnlySimulator(dialog, 'invitation');
      await dialog.getByRole('button', { name: 'Send Invitation' }).click();
      await expect(row).toContainText('Sent');
    };
    const revoke = async () => {
      await row.getByRole('button', { name: `Revoke ${N.zeta}` }).click();
      await page
        .getByRole('dialog', { name: `Revoke the invitation to ${N.zeta}?` })
        .getByRole('button', { name: 'Revoke Invitation' })
        .click();
      await expect(row).toContainText('Revoked');
    };
    // Button and dialog names carry the whole client name ("LIVE-CHECK <stamp> Zeta").
    await send(
      new RegExp(`^(Invite|Resend) ${N.zeta}$`),
      new RegExp(`^(Invite ${N.zeta}\\?|Resend the invitation to ${N.zeta}\\?)$`),
    );
    await shot(page, TAB, 'N8-09-sent', info);
    await revoke();
    await page.reload();
    await page.getByTestId('sign-ups-invitations').getByLabel('Search clients').fill(N.zeta);
    await expect(row).toContainText('Revoked', { timeout: 60_000 });
    await send(
      new RegExp(`^Resend ${N.zeta}$`),
      new RegExp(`^Resend the invitation to ${N.zeta}\\?$`),
    );
    await revoke();
    await shot(page, TAB, 'N8-09-revoked', info);
  });

  test('N8-10 Last Activity dismissal and names owner: every control is named; Escape, a heading click and Done each close it', async ({
    page,
  }, info) => {
    await openClients(page);
    for (const close of ['Escape', 'heading', 'Done'] as const) {
      await lastTrigger(page).click();
      const panel = lastPanel(page);
      await expect(panel).toBeVisible();
      await expect(
        panel.getByRole('textbox', { name: 'Last activity: From, start date' }),
      ).toBeVisible();
      if (close === 'Escape') await page.keyboard.press('Escape');
      else if (close === 'heading') await title(page).click();
      else await panel.getByRole('button', { name: 'Done: close last activity' }).click();
      await expect(panel).toBeHidden();
    }
    await shot(page, TAB, 'N8-10', info);
  });

  test('N8-12 Overview summary controls owner: each summary opens its place, with Back to the client', async ({
    page,
  }, info) => {
    for (const [key, path] of [
      ['balance', '/invoices'],
      ['documents', '/documents'],
      ['messages', '/messages'],
      ['intake', '/intake-forms'],
      ['services', '/services'],
    ] as const) {
      await openClient(page, c.alpha);
      const card = page.getByTestId('client-summary').getByTestId(`summary-${key}`);
      // Loaded: the card is a link to its place.
      await expect(card).toHaveAttribute('href', new RegExp(path));
      await card.click();
      await expect(page).toHaveURL(new RegExp(`/clients/${c.alpha}${path}`), { timeout: 60_000 });
      const back = page.getByTestId('back-to-origin');
      if (await back.count()) {
        await expect(back).toHaveText(/Back to Client/);
        await back.click();
        await expect(page).toHaveURL(new RegExp(`/clients/${c.alpha}$`), { timeout: 60_000 });
      }
    }
    await shot(page, TAB, 'N8-12', info);
  });

  test('N8-13 New Clients definition owner: the card counts what its New tab lists; a client with no started service is in it', async ({
    page,
  }, info) => {
    await openClients(page);
    const count = await kpiNumber(page, 'New Clients');
    await kpi(page, 'New Clients').click();
    await settled(page);
    expect(await listTotal(page)).toBe(count);
    // One client at a time: the run's New clients can fill more than the first page.
    await searchFor(page, `${STAMP} Beta`);
    await expect(entry(page, N.beta)).toHaveCount(1);
    await shot(page, TAB, 'N8-13', info);
    await searchFor(page, `${STAMP} Zeta`);
    await expect(summaryLine(page).or(emptyLine(page))).toBeVisible({ timeout: 30_000 });
    await expect(entry(page, N.zeta), 'Zeta (its service started) is not New').toHaveCount(0);
  });

  test('N8-15 Balances reconcile owner: Balances Due equals its list, and every client listed owes something', async ({
    page,
  }, info) => {
    await openClients(page);
    const count = await kpiNumber(page, 'Balances Due');
    await kpi(page, 'Balances Due').click();
    await settled(page);
    expect(await listTotal(page)).toBe(count);
    for (const e of await entries(page).all()) {
      const owed = e
        .locator('dt', { hasText: /^Balance Due$/ })
        .locator('xpath=following-sibling::dd[1]');
      if (await owed.count()) await expect(owed).not.toHaveText(/^\$0\.00$/);
    }
    await shot(page, TAB, 'N8-15', info);
  });

  test('N8-17 Accept and work-start triggers owner: a started service makes the client Active; a client with none stays New', async ({
    page,
  }, info) => {
    // One client at a time: the run's clients can fill more than the first page.
    // Zeta's service was started (Start Service on its pending request, in the fixture).
    await openClients(page, `?search=${encodeURIComponent(`${STAMP} Zeta`)}`);
    await expect(entry(page, N.zeta)).toContainText('Active');
    await shot(page, TAB, 'N8-17', info);
    await searchFor(page, `${STAMP} Beta`);
    await expect(entry(page, N.beta)).toContainText('New Client');
  });

  test("N8-21 Published template and preview owner: the intake forms library opens (her scoped pass; the forms are the Intake Forms check's)", async ({
    page,
  }, info) => {
    await page.goto(app('/intake-forms'));
    await expect(main(page)).toBeVisible({ timeout: 60_000 });
    await settled(page);
    await expectNoSideScroll(page);
    await shot(page, TAB, 'N8-21', info);
    note(info, 'note', 'publish and preview are covered by e2e/live/intake-forms.spec.ts');
  });

  test('N8-22 Direct send, share link, button, portal toggle owner: Send Intake Form opens for the client with no service needed', async ({
    page,
  }, info) => {
    await page.goto(app(`/intake-forms/send?clientId=${c.beta}`));
    await expect(page.getByTestId('send-summary')).toContainText(N.beta, { timeout: 60_000 });
    await expect(main(page)).toContainText('No active service is needed.');
    // The form choice, or (no published form in Test Firm B) the words that say so.
    const choice = page
      .locator('select')
      .filter({ has: page.locator('option', { hasText: 'Select a form' }) });
    const none = main(page).getByText(/^No published forms yet\./);
    await expect(choice.or(none).first()).toBeVisible();
    await shot(page, TAB, 'N8-22', info);
    if (await none.isVisible().catch(() => false))
      note(
        info,
        'partial',
        'Test Firm B has no published intake form now: the page opens for the client with no service needed; choosing a form is not shown',
      );
    note(
      info,
      'note',
      'the share link, website button and portal toggle are covered by e2e/live/intake-forms.spec.ts',
    );
  });

  test('N8-23 Intake send without an active service owner: a form sent to a client with no service is on their Intake Forms (kept after a reload); the client stays New', async ({
    page,
  }, info) => {
    await page.goto(app(`/intake-forms/send?clientId=${c.beta}`));
    await expect(page.getByTestId('send-summary')).toContainText(N.beta, { timeout: 60_000 });
    const form = page
      .locator('select')
      .filter({ has: page.locator('option', { hasText: 'Select a form' }) });
    const formName = await pickFirst(form);
    test.skip(!formName, 'no published form');
    // No copy to the staff member (a @dev.firmivra.com login has no mail domain).
    const copy = page.getByRole('checkbox', { name: 'Send me a copy of the email' });
    if (await copy.count()) await copy.setChecked(false);
    // Rule: every address the send can reach is a simulator one (the screen and the record).
    const delivery = page.getByTestId('send-delivery');
    if ((await delivery.count()) && (await delivery.innerText()).match(EMAILS))
      await expectOnlySimulator(delivery, 'intake send');
    await expectSendable(page, c.beta, 'intake send');
    await page.getByRole('button', { name: 'Send Form', exact: true }).click();
    const result = page.getByTestId('send-result');
    await expect(result).toContainText(/Form Sent|Email Retrying/, { timeout: 60_000 });
    // The sent form, for cleanup (archived there, so it sends no reminder).
    const href =
      (await result.getByRole('link', { name: 'View sent form' }).getAttribute('href')) ?? '';
    const sent = new RegExp(`/intake-forms/(${UUID.source})`).exec(href)?.[1] ?? '';
    if (sent) remember({ intakeId: sent });
    else
      note(info, 'cleanup', "the sent form's link was not found: cleanup finds it by Beta's name");
    await shot(page, TAB, 'N8-23-sent', info);
    await openClient(page, c.beta, '/intake-forms');
    await expect(page.getByTestId('client-intakes')).toContainText(formName, { timeout: 60_000 });
    await page.reload();
    await expect(page.getByTestId('client-intakes')).toContainText(formName, { timeout: 60_000 });
    await openClients(page, `?search=${STAMP}`);
    await expect(entry(page, N.beta)).toContainText('New');
  });

  test('N8-26 Search paging and narrowing owner: narrowing the search goes back to page 1', async ({
    page,
  }, info) => {
    await openClients(page, `?search=${STAMP}`);
    const pager = page
      .getByRole('navigation', { name: 'Pagination' })
      .filter({ visible: true })
      .first();
    await pickFirst(pager.getByRole('combobox'));
    await settled(page);
    const two = pager.getByRole('button', { name: 'Page 2' });
    if (await two.count()) {
      await two.click();
      await expect(page).toHaveURL(/page=2/);
    } else note(info, 'note', "the run's clients fit one page at the smallest size");
    await searchFor(page, `${STAMP} Alpha`);
    await expect(page).not.toHaveURL(/page=2/);
    await expect(entry(page, N.alpha)).toHaveCount(1);
    await shot(page, TAB, 'N8-26', info);
  });

  test("N8-27 Staff and search return owner: a staff filter with a search comes back from the client's page", async ({
    page,
  }, info) => {
    test.skip(!c.staffName, 'no staff login');
    await openClients(page);
    await searchFor(page, STAMP);
    await page.getByLabel('Assigned staff member').selectOption({ label: c.staffName });
    await settled(page);
    const url = page.url();
    await entry(page, N.beta).getByTestId('client-link').click();
    await expect(title(page)).toHaveText(N.beta, { timeout: 60_000 });
    await main(page).getByRole('link', { name: 'Clients', exact: true }).click();
    await expect(page).toHaveURL(url);
    await expect(entry(page, N.beta)).toHaveCount(1);
    await shot(page, TAB, 'N8-27', info);
  });

  test('N8-28 New plus Business Development owner: New with a service lists only New clients', async ({
    page,
  }, info) => {
    await openClients(page);
    // The stage's label is the design's "New Client" (list-parts.ts STAGES).
    await page.getByLabel('Status', { exact: true }).selectOption({ label: 'New Client' });
    await settled(page);
    const svc = page.getByLabel('Service', { exact: true });
    const chosen = await pickFirst(svc);
    test.skip(!chosen, 'no service to combine');
    await settled(page);
    for (const e of await entries(page).all()) await expect(e).toContainText('New');
    await shot(page, TAB, 'N8-28', info);
  });

  test("N8-30 Business dirty Edit owner: a Business's Edit asks before throwing changes away; Save Changes saves (kept after a reload)", async ({
    page,
  }, info) => {
    await openClient(page, c.gamma);
    const dialog = await editOpen(page, N.gamma);
    await dialog.getByLabel('Entity type').fill('LLC');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    const ask = dialog.getByTestId('unsaved-changes');
    await ask.getByRole('button', { name: 'Keep Editing' }).click();
    await expect(dialog.getByLabel('Entity type')).toHaveValue('LLC');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await ask.getByRole('button', { name: 'Save Changes' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await page.reload();
    await expect(page.getByTestId('client-overview')).toContainText('LLC', { timeout: 60_000 });
    await shot(page, TAB, 'N8-30', info);
  });

  test("N8-32 Service labels owner: the service tab and filter carry the catalog's name", async ({
    page,
  }, info) => {
    await openClients(page);
    await expect(viewTab(page, SERVICE)).toBeVisible();
    const options = await page
      .getByLabel('Service', { exact: true })
      .locator('option')
      .allInnerTexts();
    expect(options.map((s) => s.trim())).toContain(SERVICE);
    await shot(page, TAB, 'N8-32', info);
  });

  test('N8-33 Draft-service visibility owner: a draft service is no Clients tab, filter or enrollment choice', async ({
    page,
  }, info) => {
    await openClients(page);
    await expect(viewTab(page, DRAFT)).toHaveCount(0);
    const options = await page
      .getByLabel('Service', { exact: true })
      .locator('option')
      .allInnerTexts();
    expect(options.map((s) => s.trim())).not.toContain(DRAFT);
    await openClient(page, c.alpha, '/services');
    await page.getByTestId('enroll-service').click();
    const enroll = page.getByRole('dialog', { name: 'Enroll in Service' });
    const choices = await enroll.getByLabel('Service *').locator('option').allInnerTexts();
    expect(choices.map((s) => s.trim())).not.toContain(DRAFT);
    await shot(page, TAB, 'N8-33', info);
    await page.keyboard.press('Escape');
  });

  test('N8-34 Sign-ups list checks owner: search and sort set the list and survive a reload', async ({
    page,
  }, info) => {
    await page.goto(app('/sign-ups'));
    await expect(page.getByRole('tablist', { name: 'Sign-up status' })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByLabel('Search name or email').fill(STAMP);
    await settled(page);
    await expect(
      page.getByTestId('sign-ups-empty').or(page.getByTestId('sign-ups-table')),
    ).toBeVisible();
    await expect(page.getByTestId('sign-ups-sort')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('tablist', { name: 'Sign-up status' })).toBeVisible({
      timeout: 60_000,
    });
    await shot(page, TAB, 'N8-34', info);
  });

  test("N8-35 Signature history owner: the client's Signatures tab opens with its history", async ({
    page,
  }, info) => {
    await openClient(page, c.alpha, '/signatures');
    await expect(tabHeader(page)).toBeVisible();
    await expectNoSideScroll(page);
    await shot(page, TAB, 'N8-35', info);
  });

  test('N8-36 Tasks tab with New Task owner: New Task opens Create Task on this client, with Back', async ({
    page,
  }, info) => {
    await openClient(page, c.alpha, '/tasks');
    await tabHeader(page).getByRole('link', { name: 'New Task', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/tasks/new\\?clientId=${c.alpha}`), {
      timeout: 60_000,
    });
    await expect(page.getByRole('combobox', { name: 'Client' })).toHaveValue(N.alpha, {
      timeout: 60_000,
    });
    await shot(page, TAB, 'N8-36', info);
    await page.getByTestId('back-to-origin').click();
    await expect(page).toHaveURL(new RegExp(`/clients/${c.alpha}/tasks$`));
  });

  test('N8-38 Task details readable owner: the Tasks list opens and fits', async ({
    page,
  }, info) => {
    await page.goto(app('/tasks'));
    await expect(main(page)).toBeVisible({ timeout: 60_000 });
    await settled(page);
    await expectNoSideScroll(page);
    await shot(page, TAB, 'N8-38', info);
  });

  test("N8-40 Message audit names the client owner: the message's audit row names the client", async ({
    page,
  }, info) => {
    await page.goto(app('/audit-log'));
    await expect(title(page)).toBeVisible({ timeout: 60_000 });
    await page.getByLabel('Record id').fill(c.alpha);
    await page.getByLabel('Record id').press('Enter');
    await settled(page);
    await expect(main(page)).toContainText(N.alpha, { timeout: 60_000 });
    await shot(page, TAB, 'N8-40', info);
  });

  test('FC-01 Profile Invoices owner: total, balance due and status show together; Open Invoice opens it (QA Fixture Client 1, read only)', async ({
    page,
  }, info) => {
    await page.goto(app(`/clients/${CLIENT1}/invoices`));
    await expect(title(page)).toContainText('QA Fixture Client 1', { timeout: 60_000 });
    await settled(page);
    const open = page
      .getByRole('link', { name: /^Open Invoice INV-/ })
      .filter({ visible: true })
      .first();
    test.skip(!(await open.count()), 'Client 1 has no invoice');
    const holder = page.getByTestId('invoices-table').or(page.getByTestId('invoice-card').first());
    await expect(holder.first()).toContainText('Total');
    await expect(holder.first()).toContainText(/Balance due/i);
    await shot(page, TAB, 'FC-01', info);
    await open.click();
    await expect(page).toHaveURL(/\/invoices\/[0-9a-f-]{36}/, { timeout: 60_000 });
  });

  test("FC-02 Sign-ups Waiting guidance by mode owner: the empty Waiting tab says what the firm's mode does", async ({
    page,
  }, info) => {
    await page.goto(app('/sign-ups'));
    await expect(page.getByRole('tablist', { name: 'Sign-up status' })).toBeVisible({
      timeout: 60_000,
    });
    const empty = page.getByTestId('sign-ups-empty');
    test.skip(
      !(await empty.isVisible().catch(() => false)),
      'Waiting has requests: the empty help does not show',
    );
    await expect(empty).toContainText(
      /^(Automatic Approval is on|Manual Review is on|When someone signs up)/,
    );
    await shot(page, TAB, 'FC-02', info);
  });

  test('FC-03 Documents staff guidance owner: with no client chosen the note is plain words', async ({
    page,
  }, info) => {
    await page.goto(app('/documents'));
    await expect(page.getByTestId('filter-client')).toHaveValue('', { timeout: 60_000 });
    await expect(page.getByTestId('documents-no-client')).toHaveText(
      'Select a client to view their documents.',
    );
    await shot(page, TAB, 'FC-03', info);
  });

  test('FC-04 Unassigned in Assigned Staff owner: Unassigned lists the clients nobody is assigned to, with New too (kept after a reload)', async ({
    page,
  }, info) => {
    await openClients(page, `?search=${STAMP}`);
    await page.getByLabel('Assigned staff member').selectOption({ label: 'Unassigned' });
    await settled(page);
    await expect(entry(page, N.gamma)).toHaveCount(1);
    await expect(entry(page, N.alpha)).toHaveCount(0);
    await page.getByLabel('Status', { exact: true }).selectOption({ label: 'New Client' });
    await settled(page);
    await expect(entry(page, N.gamma)).toHaveCount(1);
    await page.reload();
    await settled(page);
    await expect(entry(page, N.gamma)).toHaveCount(1);
    await shot(page, TAB, 'FC-04', info);
  });

  // ---------------------------------------------------------------- §23 and P4-7

  test('§23 Messages Subject width, collapsible notes owner: Hide Internal Notes widens the list and keeps the draft note', async ({
    page,
  }, info) => {
    await openClient(page, c.alpha, '/messages');
    const notes = page.locator('#client-internal-notes');
    const draft = `${runTag} draft note`;
    await notes.getByRole('textbox').first().fill(draft);
    const subject = page.getByRole('columnheader', { name: 'Subject' }).first();
    const before = (await subject.boundingBox())?.width ?? 0;
    await tabHeader(page).getByRole('button', { name: 'More Actions' }).click();
    await page.getByRole('menuitem', { name: 'Hide Internal Notes' }).click();
    await expect(notes).toBeHidden();
    if (before) expect((await subject.boundingBox())?.width ?? 0).toBeGreaterThan(before);
    await shot(page, TAB, 'S23-notes-hidden', info);
    await tabHeader(page).getByRole('button', { name: 'More Actions' }).click();
    await page.getByRole('menuitem', { name: 'Show Internal Notes' }).click();
    await expect(notes.getByRole('textbox').first()).toHaveValue(draft);
  });

  test('§23 V-007 side-menu direction owner: the menu collapses and expands from the same control', async ({
    page,
  }, info) => {
    await openClient(page, c.alpha);
    await page.getByRole('button', { name: 'Collapse menu' }).click();
    await expect(page.getByRole('button', { name: 'Expand menu' })).toBeVisible();
    await shot(page, TAB, 'S23-V-007', info);
    await page.getByRole('button', { name: 'Expand menu' }).click();
    await expect(page.getByRole('button', { name: 'Collapse menu' })).toBeVisible();
  });

  test("§23 Business Overview and Edit visual owner: a Business's Overview and Edit fit with the party shown", async ({
    page,
  }, info) => {
    await openClient(page, c.gamma);
    await expect(page.getByTestId('responsible-party')).toBeVisible();
    await expectNoSideScroll(page);
    await shot(page, TAB, 'S23-business-overview', info);
    const dialog = await editOpen(page, N.gamma);
    await expect(dialog.getByTestId('responsible-party-fields')).toBeVisible();
    await shot(page, TAB, 'S23-business-edit', info);
    await discardEdit(dialog);
  });

  test("§23 Platform heading and action-row consistency owner: every tab's title is one size with its primary action at the row's right end", async ({
    page,
  }, info) => {
    const sizes = new Set<string>();
    for (const t of TABS) {
      await openClient(page, c.alpha, t.path);
      const header = tabHeader(page);
      const h2 = header.getByRole('heading', { level: 2 });
      await expect(h2).toHaveText(t.title);
      sizes.add(await h2.evaluate((el) => getComputedStyle(el).fontSize));
      if (t.primary) {
        const primary = header.getByRole(t.primary.role, { name: t.primary.name, exact: true });
        if (t.path === '/signatures' && (await firmSignOff(page, primary))) {
          // Send for signature shows only while Firm Sign is on (client-signatures.tsx).
          note(
            info,
            'partial',
            'Firm Sign is off for Test Firm B: Signatures has no primary action',
          );
          continue;
        }
        await expect(primary).toBeVisible();
        const row = (await header.boundingBox())!;
        const box = (await primary.boundingBox())!;
        expect(
          Math.abs(box.x + box.width - (row.x + row.width)),
          `${t.title}: primary at the right end`,
        ).toBeLessThanOrEqual(1);
      }
    }
    expect([...sizes], 'one title size').toHaveLength(1);
    await shot(page, TAB, 'S23-headings', info);
  });

  test('P4-7 one heading row owner: every client tab shows exactly one heading row, with its own title', async ({
    page,
  }, info) => {
    for (const t of TABS) {
      await openClient(page, c.alpha, t.path);
      await expect(tabHeader(page), `${t.title}: heading rows`).toHaveCount(1);
      await expect(tabHeader(page).getByRole('heading', { level: 2 })).toHaveCount(1);
      await expect(
        main(page).getByRole('heading', { level: 2, name: t.title, exact: true }),
      ).toHaveCount(1);
      await shot(page, TAB, `P4-7-${t.title}`, info);
    }
  });

  test('§23 Mobile-friendly Clients a (profile screens) @narrow owner: the profile tabs, Add and Edit fit the screen', async ({
    page,
    browser,
  }, info) => {
    const id = await layoutClient(browser);
    for (const t of ['', '/documents', '/messages', '/activity']) {
      await openClient(page, id, t);
      await expectNoSideScroll(page);
    }
    await openClient(page, id);
    const edit = await editOpen(page, N.alpha);
    await expectNoSideScroll(page);
    await shot(page, TAB, 'S23-mobile-edit', info);
    await discardEdit(edit);
    await openClients(page);
    const add = await addDialog(page);
    await expectNoSideScroll(page);
    await shot(page, TAB, 'S23-mobile-add', info);
    await add.getByRole('button', { name: 'Cancel' }).click();
  });
});

// ================================================================ Staff (after the Owner's checks)
test.describe('Clients (Staff)', () => {
  test.use(as('staff'));
  test.skip(() => !hasLogin('staff'), 'no staff login');
  let c: Ctx;
  test.beforeAll(async ({ browser }) => {
    await freshSession(browser, 'owner');
    await freshSession(browser, 'staff');
    c = await fixture(browser);
  });

  test('§6 Security and permissions staff: only their own clients; another client by its address is not found; no Archive or bulk assign', async ({
    page,
  }, info) => {
    await openClients(page, `?search=${STAMP}`);
    await expect(entry(page, N.beta)).toHaveCount(1);
    await expect(entry(page, N.alpha)).toHaveCount(0);
    await expect(entry(page, N.gamma)).toHaveCount(0);
    await shot(page, TAB, 'S6-staff-list', info);
    await openClient(page, c.beta);
    await expect(page.getByRole('button', { name: 'Archive client' })).toHaveCount(0);
    await page.goto(app(`/clients/${c.alpha}`));
    await expectRefused(page, [N.alpha, email(1)]);
    await shot(page, TAB, 'S6-staff-refused', info);
    note(info, 'NOT LIVE', "the second-firm check: needs another firm's login (never LVP)");
  });

  test("§5 Duplicate safeguards: permission, no cross-firm staff: a phone only another member's client has pauses Add without naming that client", async ({
    page,
  }, info) => {
    await openClients(page);
    const dialog = await addDialog(page);
    await fillIndividual(dialog, full('Staff Dup'), email(33), phone(1));
    await dialog.getByRole('button', { name: 'Add Client' }).click();
    const dup = duplicateDialog(page);
    await expect(dup).toBeVisible({ timeout: 30_000 });
    await expect(dup).not.toContainText(N.alpha);
    await expect(dup).not.toContainText(email(1));
    await shot(page, TAB, 'S5-staff-dup', info);
    await dup.getByRole('button', { name: 'Keep Editing' }).click();
    await discardAdd(page, dialog);
    note(info, 'NOT LIVE', "no cross-firm disclosure: needs another firm's login (never LVP)");
  });

  test("Remaining sharing acceptance staff: another member's client's file is refused", async ({
    page,
  }, info) => {
    const doc = readCtx().docId;
    test.skip(!doc, "no file (the Owner's upload failed)");
    await page.goto(app(`/documents/${doc}`));
    await expectRefused(page, [readCtx().docName, N.alpha]);
    await shot(page, TAB, 'sharing-staff-refused', info);
  });

  test('P4-7 Convert staff: on their own appointment with a lead they do not reach, Convert is not offered and the lead is refused', async ({
    page,
  }, info) => {
    test.skip(!c.apptId, 'the lead appointment was not booked (see the fixture log)');
    const dialog = await markCompletedDialog(page, c.apptId);
    const outcome = dialog.getByRole('group', { name: 'Outcome' });
    await expect(outcome.getByRole('radio')).toHaveCount(2);
    await expect(outcome.getByRole('radio', { name: 'Convert to New client' })).toHaveCount(0);
    await expect(dialog).toContainText("The lead's owner can convert this lead.");
    await shot(page, TAB, 'P4-7-convert-staff', info);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(
      page.getByTestId('detail-close').getByRole('button', { name: 'Mark Completed' }),
    ).toBeEnabled({
      timeout: 60_000,
    });
    await page.goto(app(`/leads/${c.leadId}/convert`));
    await expectRefused(page, [email(8)]);
  });
});

// ================================================================ Owner, after Staff (the lead appointment)
test.describe('Clients (Owner, lead appointment)', () => {
  test.use(as('owner'));
  test.skip(() => !hasLogin('owner'), 'no owner login');
  let c: Ctx;
  test.beforeAll(async ({ browser }) => {
    await freshSession(browser, 'owner');
    c = await fixture(browser);
  });

  test('P4-7 Convert owner: the Owner reaches the lead and is offered Convert to New client (nothing saved)', async ({
    page,
  }, info) => {
    test.skip(!c.apptId, 'the lead appointment was not booked (see the fixture log)');
    const dialog = await markCompletedDialog(page, c.apptId);
    const outcome = dialog.getByRole('group', { name: 'Outcome' });
    await expect(outcome.getByRole('radio')).toHaveCount(3);
    await expect(outcome.getByRole('radio', { name: 'Convert to New client' })).toBeVisible();
    await expect(dialog).not.toContainText("The lead's owner can convert this lead.");
    await shot(page, TAB, 'P4-7-convert-owner', info);
    await page.keyboard.press('Escape');
  });

  test("N8-18 Appointment outcomes owner: completing a lead's appointment asks for an outcome and notes; Keep as Lead saves them", async ({
    page,
  }, info) => {
    test.skip(!c.apptId, 'the lead appointment was not booked (see the fixture log)');
    const dialog = await markCompletedDialog(page, c.apptId);
    await dialog.getByRole('button', { name: 'Mark Completed' }).click();
    // Nothing chosen: the outcome's own message, under the choices.
    await expect(dialog.locator('#outcome-error')).toBeVisible();
    await expectPlain(dialog, 'the outcome messages');
    await dialog
      .getByRole('group', { name: 'Outcome' })
      .getByRole('radio', { name: 'Keep as Lead', exact: true })
      .check();
    const notes = `${runTag} outcome notes (synthetic)`;
    await dialog.getByLabel('Notes').fill(notes);
    await dialog.getByRole('button', { name: 'Mark Completed' }).click();
    await expect(page.getByTestId('detail-result')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('detail-notes')).toContainText(notes);
    await shot(page, TAB, 'N8-18', info);
  });

  test('N8-19 Completed appointment fixture owner: the completed lead appointment keeps its outcome and notes after a reload', async ({
    page,
  }, info) => {
    test.skip(!c.apptId, 'the lead appointment was not booked (see the fixture log)');
    await page.goto(app(`/calendar/${c.apptId}`));
    await expect(page.getByTestId('detail-summary')).toContainText('Completed', {
      timeout: 60_000,
    });
    await expect(page.getByTestId('detail-notes')).toContainText(`${runTag} outcome notes`);
    // A closed appointment keeps its close actions, switched off (calendar detail-screen.tsx).
    await expect(
      page.getByTestId('detail-close').getByRole('button', { name: 'Mark Completed' }),
    ).toBeDisabled();
    await shot(page, TAB, 'N8-19', info);
  });
});

// ================================================================ Admin
test.describe('Clients (Admin)', () => {
  test.use(as('admin'));
  test.skip(() => !hasLogin('admin'), 'no admin login');
  let c: Ctx;
  test.beforeAll(async ({ browser }) => {
    await freshSession(browser, 'owner');
    await freshSession(browser, 'admin');
    c = await fixture(browser);
  });

  test('§1 Two client bulk round trip (C2-042) admin: assign, archive and restore two clients, each kept after a reload', async ({
    page,
    browser,
  }, info) => {
    // Both are the Owner's from the fixture: a change, to Staff (or the Owner when no Staff).
    const to = c.staffName || c.ownerName;
    test.skip(!to, 'no member names');
    const two = [N.zeta, N.delta];
    await openClients(page, `?search=${STAMP}`);
    await bulkAssign(page, two, to);
    await page.reload();
    await settled(page);
    for (const n of two) await expect(entry(page, n)).toContainText(tail(to));
    for (const n of two) await select(page, n);
    await bulk(page, 'Archive Clients');
    await page
      .getByRole('dialog', { name: 'Archive Clients' })
      .getByRole('button', { name: 'Archive' })
      .click();
    await expect(page.getByText('2 clients archived.').first()).toBeVisible();
    try {
      await viewTab(page, 'Archived').click();
      await settled(page);
      for (const n of two) await expect(entry(page, n)).toHaveCount(1);
      await shot(page, TAB, 'C2-042-archived', info);
      for (const n of two) await select(page, n);
      await bulk(page, 'Restore Clients');
      await page
        .getByRole('dialog', { name: 'Restore Clients' })
        .getByRole('button', { name: 'Restore' })
        .click();
      await expect(page.getByText('2 clients restored.').first()).toBeVisible();
    } finally {
      // Never leave the pair archived for the next tests (cleanup archives them at the end).
      const api = await roleApi(browser, 'owner');
      try {
        await api.post('business/clients/bulk', {
          action: 'RESTORE',
          clientIds: [c.zeta, c.delta],
        });
      } finally {
        await api.dispose();
      }
    }
    await openClients(page, `?search=${STAMP}`);
    for (const n of two) await expect(entry(page, n)).toHaveCount(1);
  });

  test('§6 Multi client mutations admin: unassigning two clients at once leaves both Unassigned in the list and the profile (kept after a reload)', async ({
    page,
  }, info) => {
    const two = [N.zeta, N.delta];
    await openClients(page, `?search=${STAMP}`);
    await bulkAssign(page, two, 'Nobody (unassign)');
    await page.reload();
    await settled(page);
    for (const n of two) await expect(entry(page, n)).toContainText('Unassigned');
    await openClient(page, c.zeta);
    await expect(assignedOnProfile(page)).toHaveText('Unassigned');
    await shot(page, TAB, 'S6-unassign', info);
  });
});

// ================================================================ Portal (harness portal client, read only)
test.describe('Clients (portal, read only)', () => {
  test.use(as('client'));
  test.skip(() => !hasLogin('client'), 'no client login');

  test('N8-03 Portal source filters client (read only): the portal documents open with their filter', async ({
    page,
  }, info) => {
    await page.goto(portal('/documents'));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('combobox').or(page.getByRole('tablist')).first()).toBeVisible();
    await shot(page, TAB, 'N8-03', info);
    note(info, 'note', 'read only: sends to the harness portal client are a later pass');
  });

  test('N8-39 Portal notification filter client (read only): the notifications open; clearing is her retest', async ({
    page,
  }, info) => {
    await page.goto(portal('/notifications'));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60_000 });
    await expectNoSideScroll(page);
    await shot(page, TAB, 'N8-39', info);
    note(info, 'NOT LIVE', 'clearing notifications: a later pass on the harness portal client');
  });
});

// ================================================================ Rows that cannot run live
const NOT_LIVE: [string, string][] = [
  [
    '§6 Reliability and accessibility b (her assistive and state retest)',
    'her keyboard, screen reader, zoom and touch retest on dev with the role logins',
  ],
  ['§6 Acceptance and next module', 'a report note: no behaviour to check'],
  ['§7, §20, §21 roll-ups', 'no work of their own: they close with the rows above and her retest'],
  ['§8 Release boundary', 'a report note: no behaviour to check'],
  ['§9 Visual acceptance limits', 'a report note: the widths are checked by the @narrow tests'],
  ['§17 Portal crosswalk and open decisions', 'no Clients requirement attached'],
  [
    '§23 Mobile-friendly Clients b (her acceptance)',
    'her mobile and tablet retest on real devices',
  ],
  [
    'C2-053/054 Portal visible upload',
    'needs an upload by a portal login: a later pass on the harness portal client',
  ],
  [
    'C2-055 Portal notice when a document is shared',
    'the notice shows in a client portal: a later pass on the harness portal client',
  ],
  [
    'N8-01 Replacement request',
    'the client uploads again in the portal: a later pass on the harness portal client',
  ],
  [
    'N8-02 / N8-20 Assigned form start',
    'a form sent to and opened by a portal login: a later pass on the harness portal client',
  ],
  [
    'N8-04 Portal message delivery',
    'a message to a portal login: a later pass on the harness portal client',
  ],
  [
    'N8-11 Text preference and SMS',
    'SMS toll-free registration is pending; a text would reach a real phone',
  ],
  [
    'N8-14 Client reply and firm notice',
    'a reply from a portal login: a later pass on the harness portal client',
  ],
  [
    'N8-17 Intake/sign-up with purchase intent creates a New client',
    'her decision (a public submission makes a Lead): nothing to check until she confirms',
  ],
  [
    'N8-22 Iframe embed; publish adds to every portal by default',
    'deferred: the iframe needs CloudFront frame-ancestors (infra)',
  ],
  [
    'N8-24 Existing Bookkeeping record',
    'an observation that follows N8-23; nothing separate to check',
  ],
  [
    'N8-25 Receipt, acceptance, existing-service link',
    'the link to the engagement is not on a screen, and acceptance needs a portal submission',
  ],
];
test.describe('Clients (not live)', () => {
  for (const [row, why] of NOT_LIVE) {
    // eslint-disable-next-line no-empty-pattern
    test(`${row}: NOT LIVE`, async ({}, info) => {
      note(info, 'NOT LIVE', why);
    });
  }
});

// ================================================================ Layout (both widths)

/** Alpha, active (a @narrow run after an earlier cleanup restores it). */
async function layoutClient(browser: Browser): Promise<string> {
  const c = await fixture(browser);
  const api = await roleApi(browser, 'owner');
  try {
    const r = await api.get(`business/clients/${c.alpha}`);
    if (r.ok() && (await r.json()).archivedAt) {
      await ok(await api.post(`business/clients/${c.alpha}/restore`), 'restore Alpha');
    }
  } finally {
    await api.dispose();
  }
  return c.alpha;
}

const layoutPages: [string, (id: string, doc: string) => string][] = [
  ['list', () => '/clients'],
  ...TABS.map(
    (t) =>
      [
        `profile${t.path.replace('/', '-') || '-overview'}`,
        (id: string) => `/clients/${id}${t.path}`,
      ] as [string, (id: string, doc: string) => string],
  ),
  ['add', () => '/clients?new=1'],
  ['edit', (id) => `/clients/${id}?edit=1`],
  ['upload', (id) => `/documents/upload?clientId=${id}`],
  ['new-task', (id) => `/tasks/new?clientId=${id}`],
  ['send-intake', (id) => `/intake-forms/send?clientId=${id}`],
  ['new-appointment', (id) => `/calendar/new?clientId=${id}`],
  ['sign-ups', () => '/sign-ups'],
  ['sign-ups-invitations', () => '/sign-ups?tab=invitations'],
  ['documents', () => '/documents'],
  ['document-requests', () => '/documents/requests'],
  ['document', (_, doc) => (doc ? `/documents/${doc}` : '/documents')],
  ['document-share', (_, doc) => (doc ? `/documents/${doc}/share` : '/documents')],
  ['audit-log', () => '/audit-log'],
];

test.describe('Clients layout', () => {
  test.use(as('owner'));
  test.skip(() => !hasLogin('owner'), 'no owner login');
  test.beforeAll(async ({ browser }) => {
    await freshSession(browser, 'owner');
  });
  for (const [name, path] of layoutPages) {
    test(`@narrow layout ${name}: no sideways scroll`, async ({ page, browser }, info) => {
      const id = await layoutClient(browser);
      await page.goto(app(path(id, readCtx().docId)));
      await expect(page).not.toHaveURL(/sign-in/);
      await expect(main(page)).toBeVisible({ timeout: 60_000 });
      await settled(page);
      await page.waitForTimeout(1000);
      await shot(page, TAB, `layout-${name}`, info);
      await expectNoSideScroll(page);
    });
  }
  test('@narrow layout more-filters: no sideways scroll', async ({ page }, info) => {
    await openClients(page);
    await page.getByRole('button', { name: /More Filters/ }).click();
    await expect(page.getByText('Client Type', { exact: true })).toBeVisible();
    await shot(page, TAB, 'layout-more-filters', info);
    await expectNoSideScroll(page);
  });
  test('@narrow layout last-activity: no sideways scroll', async ({ page }, info) => {
    await openClients(page);
    await lastTrigger(page).click();
    await expect(lastPanel(page)).toBeVisible();
    await shot(page, TAB, 'layout-last-activity', info);
    await expectNoSideScroll(page);
  });
  test('@narrow layout new-message: no sideways scroll', async ({ page, browser }, info) => {
    const id = await layoutClient(browser);
    await openClient(page, id, '/messages');
    await tabHeader(page).getByRole('button', { name: 'New Message' }).click();
    await expect(page.getByRole('dialog', { name: 'New Message' })).toBeVisible();
    await shot(page, TAB, 'layout-new-message', info);
    await expectNoSideScroll(page);
  });
});

// ================================================================ Cleanup (after every role's checks)

const LIVE_STATUSES = ['SCHEDULED', 'PENDING', 'CONFIRMED', 'RESCHEDULED'];

/** Removes one run's records (by its tag). `final` also archives the reused service. */
async function cleanRun(api: Api, c: Ctx, done: string[], left: string[], final: boolean) {
  const stamp = c.tag.slice('LIVE-CHECK '.length);
  const tagged = (x: string | null | undefined) => Boolean(x && x.includes(stamp));
  type Row = { id: string; displayName: string; email?: string | null; archivedAt?: string | null };
  const found = await api.get(
    `business/clients?search=${encodeURIComponent(stamp)}&status=all&limit=100`,
  );
  const rows = found.ok() ? itemsOf<Row>(await found.json()) : [];
  if (!found.ok()) left.push(`client search ${found.status()}`);
  const ids = new Set([
    ...rows.filter((r) => tagged(r.displayName) || tagged(r.email)).map((r) => r.id),
    ...[c.alpha, c.beta, c.gamma, c.delta, c.epsilon, c.zeta, ...c.made].filter(Boolean),
  ]);
  // The intake form sent to Beta (N8-23), before its client is archived: archived (sent forms
  // have no delete), so it takes no reminder. Found by its id and by the run's recipients.
  const intakes = new Set<string>(c.intakeId ? [c.intakeId] : []);
  const sentForms = await api.get(
    `business/intakes?tab=all&search=${encodeURIComponent(stamp)}&pageSize=100`,
  );
  if (sentForms.ok()) {
    for (const s of itemsOf<{ id: string; recipient?: { name?: string } | null }>(
      await sentForms.json(),
    )) {
      if (tagged(s.recipient?.name)) intakes.add(s.id);
    }
  } else left.push(`sent forms: list ${sentForms.status()}`);
  for (const id of intakes) {
    const r = await api.post(`business/intakes/${id}/archive`);
    (r.ok() || r.status() === 409 ? done : left).push(`sent form ${id}: archive ${r.status()}`);
  }
  for (const id of ids) {
    const safe = await recordSafe(api, id);
    // The client's own list (archived files too; trashed ones are never listed): the library
    // list takes no `archived`.
    const docs = await api.get(`business/clients/${id}/documents?archived=include&limit=100`);
    if (!docs.ok()) left.push(`client ${id}: files list ${docs.status()}`);
    else {
      for (const d of itemsOf<{ id: string; fileName?: string; name?: string }>(
        await docs.json(),
      )) {
        if (!tagged(d.fileName ?? d.name)) continue;
        const r = await api.post(`business/documents/${d.id}/trash`);
        (r.ok() || r.status() === 409 ? done : left).push(
          `file ${d.fileName ?? d.id} trash (${r.status()})`,
        );
      }
    }
    const reqs = await api.get(`business/clients/${id}/document-requests`);
    if (!reqs.ok()) left.push(`client ${id}: requests list ${reqs.status()}`);
    else {
      for (const q of itemsOf<{ id: string; title?: string; status?: string }>(await reqs.json())) {
        if (!tagged(q.title) || ['CANCELLED', 'COMPLETED'].includes(q.status ?? '')) continue;
        // A cancellation may notify the client: only when every address is a simulator one.
        if (!safe.ok) {
          left.push(`request ${q.title} not cancelled: ${safe.why}`);
          continue;
        }
        const r = await api.post(`business/document-requests/${q.id}/cancel`);
        (r.ok() || r.status() === 409 ? done : left).push(
          `request ${q.title} cancel (${r.status()})`,
        );
      }
    }
    const inv = await api.post(`business/clients/${id}/portal-invitation/revoke`);
    if (inv.ok()) done.push(`client ${id}: portal invitation revoked`);
    const row = rows.find((r) => r.id === id);
    if (row?.archivedAt) {
      done.push(`client ${row.displayName}: archived already`);
      continue;
    }
    const r = await api.post(`business/clients/${id}/archive`, {});
    (r.ok() || r.status() === 409 ? done : left).push(
      `client ${row?.displayName ?? id} archive (${r.status()})`,
    );
  }
  if (c.apptId) {
    const r = await api.get(`business/appointments/${c.apptId}`);
    const status = r.ok() ? ((await r.json()).status as string) : '';
    if (LIVE_STATUSES.includes(status)) {
      const rec = await api.get(`business/appointments/${c.apptId}/record`);
      const to = rec.ok() ? (((await rec.json()).contact?.email as string | undefined) ?? '') : '';
      if (SIMULATOR.test(to)) {
        const x = await api.post(`business/appointments/${c.apptId}/cancel`, {
          reason: `${c.tag} cleanup`,
        });
        (x.ok() ? done : left).push(`appointment ${c.apptId} cancel (${x.status()})`);
      } else left.push(`appointment ${c.apptId} not cancelled: recipient ${to || 'unknown'}`);
    } else if (status) done.push(`appointment ${c.apptId}: ${status}, left as it is`);
  }
  if (c.leadId) {
    const r = await api.post('business/leads/bulk', { action: 'ARCHIVE', ids: [c.leadId] });
    (r.ok() || r.status() === 409 ? done : left).push(`lead ${c.leadId} archive (${r.status()})`);
  }
  if (c.invoiceId) {
    // The fixture's draft (deleted at once already; a deleted draft is archived).
    const r = await api.delete(`business/invoices/${c.invoiceId}`);
    (r.ok() || r.status() === 404 || r.status() === 409 ? done : left).push(
      `fixture draft invoice delete (${r.status()})`,
    );
  }
  if (c.typeId) {
    const r = await api.post(`business/appointment-types/${c.typeId}/archive`);
    (r.ok() || r.status() === 409 || r.status() === 404 ? done : left).push(
      `appointment type archive (${r.status()})`,
    );
  }
  if (c.draftId) {
    const del = await api.delete(`business/catalog/services/${c.draftId}`);
    if (del.ok() || del.status() === 404)
      done.push(`draft service ${DRAFT}: delete ${del.status()}`);
    else {
      const ar = await api.post(`business/catalog/services/${c.draftId}/archive`);
      (ar.ok() || ar.status() === 409 ? done : left).push(
        `draft service: delete ${del.status()}, archive ${ar.status()}`,
      );
    }
  }
  if (final) {
    // The reused service: archived (restored by the next run); the category stays for reuse.
    const listed = await api.get(
      `business/catalog/services?status=all&search=${encodeURIComponent(SERVICE)}`,
    );
    for (const s of listed.ok() ? itemsOf<{ id: string; name: string }>(await listed.json()) : []) {
      if (s.name !== SERVICE) continue;
      const r = await api.post(`business/catalog/services/${s.id}/archive`);
      (r.ok() || r.status() === 409 ? done : left).push(
        `service ${SERVICE}: archive ${r.status()}`,
      );
    }
    // The reused document type: archived (restored by the next run; types have no delete). The
    // client folder stays for reuse (it holds the run's trashed file, so it cannot be deleted).
    const types = await api.get('business/document-categories');
    for (const t of types.ok()
      ? itemsOf<{ id: string; name: string; archivedAt: string | null }>(await types.json())
      : []) {
      if (t.name !== DOC_TYPE || t.archivedAt) continue;
      const r = await api.patch(`business/document-categories/${t.id}`, { archived: true });
      (r.ok() ? done : left).push(`document type ${DOC_TYPE}: archive ${r.status()}`);
    }
  }
  const after = await api.get(
    `business/clients?search=${encodeURIComponent(stamp)}&status=active&limit=100`,
  );
  if (after.ok()) {
    for (const r of itemsOf<Row>(await after.json()))
      if (tagged(r.displayName) || tagged(r.email))
        left.push(`client ${r.displayName} still active`);
  }
}

test.describe('Clients cleanup', () => {
  test.use(as('owner'));
  test('zz cleanup @narrow: archive every client of the run, trash its files, cancel its requests and appointment, archive the lead, type and service', async ({
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
        await cleanRun(api, run, d, l, run.tag === runTag);
        done.push(...d.map((x) => `[${run.tag}] ${x}`));
        left.push(...l.map((x) => `[${run.tag}] ${x}`));
        if (run.tag !== runTag && !l.length) register({ ...run, cleaned: true });
      }
    } finally {
      await api.dispose();
    }
    done.push(`tag "${TAG}" kept: the one fixed tag every run reuses (tags have no delete)`);
    done.push(`category "${CATEGORY}" kept for reuse`);
    done.push(`client folder "${FOLDER}" kept for reuse (it holds the runs' trashed files)`);
    console.log(`CLEANUP done:\n${done.join('\n')}\nCLEANUP left:\n${left.join('\n')}`);
    info.annotations.push({ type: 'left-behind', description: left.join('; ') || 'none' });
  });
});
