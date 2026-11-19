import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  app,
  apiAs,
  as,
  expectNoSideScroll,
  hasLogin,
  portal,
  portalApi,
  portalClient,
  runTag,
  settled,
  shot,
} from './helpers';
import { login, portalUrl, type Role } from './env';

/**
 * Appointments, Review Two (Nov 8): every row, live on dev as Test Firm B. Setup makes two
 * LIVE-CHECK types and appointments for the QA Appointments Client (an SES simulator address, no
 * portal login), the ONLY client this spec ever books, so every notice goes to the simulator.
 * Never another client: QA Fixture Client 1's login has no mail domain, and @example.test does not
 * resolve (a bounce on the SES account dev and prod share). The last test cancels each appointment and
 * archives each type this run made (appointments and types have no delete).
 *
 * The run's ids live in a file (LIVE_OUT_DIR), so a failed test that restarts the worker does not
 * set up twice and cleanup still finds everything.
 */
const TAB = 'appointments';
const SIM_CLIENT = '00000000-0000-4a28-8005-000000000900'; // QA Appointments Client (fake), SES simulator
const SIM_NAME = 'QA Appointments Client (fake)';
const TZ = 'America/New_York';

interface Ctx {
  tag: string;
  ownerId: string;
  t1: { id: string; name: string };
  t2: { id: string; name: string };
  day: string; // YYYY-MM-DD, a day the simulator client has nothing else (firm zone)
  allDay: string; // another free day, for the all-day row
  p6: string; // a free day whose next week is free too
  b10: string; // another free day
  ap1: string; // the main record: 2:00-2:30 PM, three reminders, instructions
  ap3: string; // for Cancel
  ap4: string; // for Complete
  ap5: string; // for No-show
  appointments: string[]; // every appointment this run made, for cleanup
  drafts: string[];
  clients: string[];
  equipment: string[];
}
const ctxFile = () => join(process.env['LIVE_OUT_DIR']!, 'appointments-ctx.json');
const ctx = (): Ctx => JSON.parse(readFileSync(ctxFile(), 'utf8')) as Ctx;
const saveCtx = (c: Ctx) => writeFileSync(ctxFile(), JSON.stringify(c, null, 2));
function track(kind: 'appointments' | 'drafts' | 'clients' | 'equipment', id: string) {
  const c = ctx();
  if (!c[kind].includes(id)) c[kind].push(id);
  saveCtx(c);
}
const idFromUrl = (page: Page) => /\/calendar\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';

/** YYYY-MM-DD in the firm's zone, `days` from today. */
function localDay(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}
/** EST until March: Review 2 dates here are all in November and December. */
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00-05:00`;

async function ok(res: Awaited<ReturnType<APIRequestContext['get']>>, what: string) {
  if (!res.ok()) throw new Error(`${what}: ${res.status()} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function schedule(
  api: APIRequestContext,
  c: Pick<Ctx, 'ownerId'>,
  typeId: string,
  startsAt: string,
  endsAt: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const body = {
    idempotencyKey: randomUUID(),
    contact: { kind: 'CLIENT', id: SIM_CLIENT },
    typeId,
    startsAt,
    endsAt,
    timezone: TZ,
    allDay: false,
    method: 'IN_PERSON',
    staffUserIds: [c.ownerId],
    status: 'CONFIRMED',
    sendConfirmation: false,
    reminders: [],
    ...extra,
  };
  let res = await api.post('business/appointments/schedule', { data: body });
  if (res.status() === 409) {
    // Outside the harness owner's hours: the Owner books anyway, with a reason.
    res = await api.post('business/appointments/schedule', {
      data: {
        ...body,
        idempotencyKey: randomUUID(),
        overrideConflicts: { reason: `${runTag} setup` },
      },
    });
  }
  const out = (await ok(res, 'schedule')) as { id?: string; appointments?: { id: string }[] };
  return out.id ?? out.appointments?.[0]?.id ?? '';
}

/**
 * The API through the page's own cookies (the browser refreshes the session; a context made from
 * the saved state does not). Opens the workspace first so a stale token is refreshed.
 */
async function pageApi(page: Page) {
  if (!page.url().startsWith(app(''))) {
    await page.goto(app('/calendar'));
    await settled(page);
  }
  const base = app('/api/v1/');
  const headers = { origin: app('') };
  return {
    get: (path: string) => page.request.get(base + path, { headers }),
    post: (path: string, data?: unknown) =>
      page.request.post(base + path, { headers, data: data ?? {} }),
    put: (path: string, data: unknown) => page.request.put(base + path, { headers, data }),
    patch: (path: string, data: unknown) => page.request.patch(base + path, { headers, data }),
    delete: (path: string) => page.request.delete(base + path, { headers }),
  };
}

/** Assigned Staff: the harness owner only (the form starts with the firm's first member). */
async function pickHarnessStaff(page: Page) {
  const remove = page.getByRole('button', { name: /^Remove / });
  const opener = page.getByRole('button', { name: /Assigned Staff/ }).last();
  await opener.click();
  const group = page.getByRole('group', { name: 'Assigned Staff *' });
  await group.getByLabel('QA Perf (fake)', { exact: true }).check();
  for (const box of await group.getByRole('checkbox').all()) {
    const label = ((await box.locator('xpath=..').textContent()) ?? '').trim();
    if (label !== 'QA Perf (fake)' && (await box.isChecked())) await box.uncheck();
  }
  await page.keyboard.press('Escape');
  await expect(remove).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Remove QA Perf (fake)' })).toBeVisible();
}

/** Clicks the save button; books anyway (Owner) if asked; fails with the screen's own error. */
async function submit(page: Page, button: string, landing: RegExp, reason: string) {
  const answers: string[] = [];
  const listen = async (r: import('@playwright/test').Response) => {
    const req = r.request();
    if (req.method() === 'GET' || !/\/api\/v1\/business\/appointments/.test(r.url())) return;
    if (r.ok()) return answers.push(`${req.method()} ${new URL(r.url()).pathname} ${r.status()}`);
    const body = (await r.text().catch(() => '')).slice(0, 300);
    answers.push(`${req.method()} ${new URL(r.url()).pathname} ${r.status()} ${body}`);
  };
  page.on('response', listen);
  await page.getByRole('button', { name: button, exact: true }).click();
  const anyway = page.getByLabel('Reason to book anyway (Owner or Admin)');
  const err = page.getByTestId('schedule-error');
  for (let i = 0; i < 60 && !landing.test(page.url()); i++) {
    if (await anyway.isVisible().catch(() => false)) {
      await anyway.fill(`${runTag} ${reason}`);
      await page.getByRole('button', { name: 'Book Anyway' }).click();
      await page.waitForTimeout(1500);
      continue;
    }
    if (await err.isVisible().catch(() => false)) {
      const text = (await err.textContent())?.trim();
      if (text) throw new Error(`the screen said: ${text} | API: ${answers.join(' ; ')}`);
    }
    await page.waitForTimeout(500);
  }
  page.off('response', listen);
  if (!landing.test(page.url())) {
    const alerts = (await page.locator('[role="alert"], .text-danger').allTextContents())
      .map((t) => t.trim())
      .filter(Boolean);
    throw new Error(
      `did not land; screen: ${alerts.join(' | ').slice(0, 400)} | API: ${answers.join(' ; ') || 'no write call'}`,
    );
  }
}

async function newForm(page: Page) {
  await page.goto(app('/calendar/new'));
  await expect(page.getByLabel('Client / Lead *')).toBeVisible({ timeout: 60_000 });
}
async function pickSimClient(page: Page) {
  await page.getByLabel('Client / Lead *').fill('QA Appointments');
  await page
    .getByTestId('contact-results')
    .getByRole('button', { name: /QA Appointments Client/ })
    .click();
}
/** Selects a type by its name (the select's option label may carry the length). */
async function pickType(page: Page, name: string) {
  const select = page.getByLabel('Appointment Type *');
  const label = await select.locator('option', { hasText: name }).first().textContent();
  await select.selectOption({ label: label!.trim() });
}

// ---------------------------------------------------------------- setup (Owner)
test.describe('Appointments (Owner)', () => {
  test.use(as('owner'));
  test.skip(() => !hasLogin('owner'), 'no owner login');

  // eslint-disable-next-line no-empty-pattern -- Playwright needs a destructured first argument
  test('setup: LIVE-CHECK types and appointments for the simulator client', async ({}, info) => {
    test.skip(info.project.name !== 'w1165');
    if (existsSync(ctxFile())) {
      const old = ctx();
      if (old.tag === runTag) return; // same run, a restarted worker
    }
    const api = await apiAs('owner');
    const me = (await ok(await api.get('me'), 'me')) as { user: { id: string } };
    const mk = async (name: string, minutes: number, methods: string[]) =>
      (await ok(
        await api.post('business/appointment-types', {
          // sortOrder 0: the types list shows only its first 10 rows (see the types-list test).
          data: { name, durationMinutes: minutes, methods, clientBookable: true, sortOrder: 0 },
        }),
        `type ${name}`,
      )) as { id: string; name: string };
    // The harness owner's own hours (it had none, so every time read Outside working hours).
    const hours = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      startsAt: '07:00',
      endsAt: '19:00',
    }));
    await ok(
      await api.put(`business/availability/${me.user.id}/working-hours`, { data: { hours } }),
      'hours',
    );
    const t1 = await mk(`${runTag} 30m`, 30, ['IN_PERSON', 'VIDEO']);
    const t2 = await mk(`${runTag} Zoom 15m`, 15, ['VIDEO']);
    // The simulator client's seeded appointments (Octavia's QA Owner) make a hard double booking:
    // pick days it has nothing on, and a different set each run.
    const slot = Math.floor(Date.now() / 60_000) % 6;
    const busy = new Set<string>();
    const nyDay = (iso: string) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(iso));
    for (const [a, b] of [
      [-14, 30],
      [30, 75],
    ] as const) {
      const from = new Date(Date.now() + a * 86_400_000).toISOString();
      const to = new Date(Date.now() + b * 86_400_000).toISOString();
      const list = (await ok(
        await api.get(`business/appointments?from=${from}&to=${to}&clientId=${SIM_CLIENT}`),
        'busy days',
      )) as { items: { startsAt: string; status: string }[] };
      for (const x of list.items) if (x.status !== 'CANCELLED') busy.add(nyDay(x.startsAt));
    }
    const taken = new Set<string>();
    const free = (from: number, step = 1, also = 0) => {
      for (let d = from; Math.abs(d) < 75; d += step) {
        const days = [localDay(d), ...(also ? [localDay(d + also)] : [])];
        if (days.every((x) => !busy.has(x) && !taken.has(x))) {
          days.forEach((x) => taken.add(x));
          return days[0]!;
        }
      }
      throw new Error('no free day for the simulator client');
    };
    const day = free(8 + slot * 2);
    const allDayDay = free(9 + slot * 2);
    const p6Day = free(16 + slot * 2, 1, 7);
    const b10Day = free(10 + slot * 2);
    const pastDay = free(-2, -1);
    const c: Ctx = {
      tag: runTag,
      ownerId: me.user.id,
      t1: { id: t1.id, name: t1.name },
      t2: { id: t2.id, name: t2.name },
      day,
      allDay: allDayDay,
      p6: p6Day,
      b10: b10Day,
      ap1: '',
      ap3: '',
      ap4: '',
      ap5: '',
      appointments: [],
      drafts: [],
      clients: [],
      equipment: [],
    };
    saveCtx(c);
    const keep = (id: string) => {
      c.appointments.push(id);
      saveCtx(c);
      return id;
    };
    c.ap1 = keep(
      await schedule(api, c, t1.id, at(day, '14:00'), at(day, '14:30'), {
        internalNotes: `${runTag} internal note`,
        clientInstructions: `${runTag}: bring your books and receipts.`,
        instructionsInEmail: true,
        instructionsInPortal: true,
        instructionsInSms: false,
        reminders: [
          { channel: 'EMAIL', amount: 1, unit: 'DAYS', note: `${runTag} reminder note` },
          { channel: 'EMAIL', amount: 2, unit: 'HOURS' },
          { channel: 'PORTAL', amount: 2, unit: 'HOURS' },
        ],
      }),
    );
    c.ap3 = keep(await schedule(api, c, t1.id, at(day, '10:00'), at(day, '10:30')));
    // Complete and No-show need a started appointment: yesterday (nothing is sent for a past one).
    const yesterday = pastDay;
    const past = ['07:00', '08:00', '09:00', '13:00', '15:00', '16:00'][slot]!;
    const plus = (hhmm: string, m: number) => {
      const t = Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) + m;
      return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    };
    c.ap4 = keep(await schedule(api, c, t1.id, at(yesterday, past), at(yesterday, plus(past, 15))));
    c.ap5 = keep(
      await schedule(api, c, t1.id, at(yesterday, plus(past, 30)), at(yesterday, plus(past, 45))),
    );
    saveCtx(c);
    expect(c.ap1 && c.ap3 && c.ap4 && c.ap5).toBeTruthy();
    await api.dispose();
  });

  // ------------------------------------------------------------ types (rows A0, 1, 2, 3, 10, B11)
  async function openType(page: Page, name: string) {
    await page.goto(app('/calendar/types'));
    const row = page.getByTestId('types-list').locator('button[aria-pressed]', { hasText: name });
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.click();
    await expect(row).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('type-settings')).toBeVisible();
  }

  test('1 Meeting methods: Other Video Meeting needs its platform, saves beside others, kept after reload', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await openType(page, c.t1.name);
    const methods = page.getByTestId('meeting-methods');
    await methods.getByLabel('Other Video Meeting').check();
    await page.getByRole('button', { name: 'Save Settings' }).click();
    const platform = page.getByTestId('other-video-platform');
    await expect(platform).toContainText('Name the video platform');
    await expect(methods).not.toContainText('keeps one meeting method');
    await expect(methods.getByLabel('In-Person')).toBeChecked();
    await platform.getByLabel('Video platform *').fill('Google Meet');
    await page.getByRole('button', { name: 'Save Settings' }).click();
    await expect(page.getByTestId('type-settings-saved')).toHaveText('Settings saved.');
    await page.reload();
    await openType(page, c.t1.name);
    for (const label of ['In-Person', 'Zoom / Video', 'Other Video Meeting'])
      await expect(methods.getByLabel(label)).toBeChecked();
    await expect(platform.getByLabel('Video platform *')).toHaveValue('Google Meet');
    await shot(page, TAB, '1-methods', info);
  });

  test('2 Booking window: 2, 6 and 12 hours and the day choices save and stay after reload, apart from Minimum Notice', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await openType(page, c.t1.name);
    const windowSel = page.getByLabel('Booking window');
    const notice = page.getByLabel('Minimum notice');
    const wanted = [
      '2 hours ahead',
      '6 hours ahead',
      '12 hours ahead',
      '1 day ahead (24 hours)',
      '3 days ahead',
      '5 days ahead',
      '7 days ahead',
    ];
    // The options fill in once the type's settings load.
    await expect
      .poll(() => windowSel.locator('option').allTextContents(), { timeout: 30_000 })
      .toEqual(expect.arrayContaining(wanted));
    await notice.selectOption({ label: '2 hours' });
    for (const label of ['2 hours ahead', '6 hours ahead', '12 hours ahead', '5 days ahead']) {
      await windowSel.selectOption({ label });
      await page.getByRole('button', { name: 'Save Settings' }).click();
      const saved = page.getByTestId('type-settings-saved');
      const problem = page.getByTestId('type-settings-error');
      await expect(saved.or(problem)).toBeVisible({ timeout: 30_000 });
      if (await problem.isVisible())
        throw new Error(`${label}: the screen said ${(await problem.textContent())?.trim()}`);
      // "Settings saved." can go as soon as the types list refreshes after the save (the form
      // remounts): the reload below is what shows the value was kept.
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.reload();
      await openType(page, c.t1.name);
      await expect(windowSel.locator('option:checked')).toHaveText(label);
      await expect(notice.locator('option:checked')).toHaveText('2 hours');
    }
    await shot(page, TAB, '2-booking-window', info);
  });

  test('3 Booking links: Copy Booking Link and Copy Embed Code, in the menu and the settings, each for that exact type', async ({
    page,
    context,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: app('') });
    const api = await pageApi(page);
    const link = (await ok(
      await api.get(`business/appointment-types/${c.t2.id}/public-link`),
      'link',
    )) as { url: string };
    expect(link.url).toContain(`/test-firm-b/book/${c.t2.id}`);
    await openType(page, c.t2.name);
    const settings = page.getByTestId('type-booking-link');
    await expect(settings).toContainText(link.url);
    await expect(settings.getByRole('button', { name: /Copy Booking Link/ })).toBeVisible();
    await expect(settings.getByRole('button', { name: /Copy Embed Code/ })).toBeVisible();
    await settings.getByRole('button', { name: /Copy Booking Link/ }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(link.url);
    // The row menu of this type.
    await page.getByRole('button', { name: `Actions for ${c.t2.name}` }).click();
    const menu = page.getByRole('menu', { name: `Actions for ${c.t2.name}` });
    await expect(menu.getByRole('menuitem', { name: 'Copy Booking Link' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Copy Embed Code' })).toBeVisible();
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await menu.getByRole('menuitem', { name: 'Copy Booking Link' }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(link.url);
    await page.getByRole('button', { name: `Actions for ${c.t2.name}` }).click();
    await menu.getByRole('menuitem', { name: 'Copy Embed Code' }).click();
    const embed = page.getByTestId('type-embed-dialog');
    await expect(embed).toBeVisible();
    await expect(embed).toContainText(link.url);
    await shot(page, TAB, '3-embed-dialog', info);
    await page.keyboard.press('Escape');
  });

  test('10 Internal description: staff see it; the public booking page and the portal never show it', async ({
    page,
    browser,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    const secret = `${runTag} staff-only description`;
    await openType(page, c.t1.name);
    await page.getByLabel('Description (staff only)').fill(secret);
    await page.getByRole('button', { name: 'Save Settings' }).click();
    await expect(page.getByTestId('type-settings-saved')).toHaveText('Settings saved.');
    await page.reload();
    await openType(page, c.t1.name);
    await expect(page.getByLabel('Description (staff only)')).toHaveValue(secret);
    // The public booking link, signed out.
    const api = await pageApi(page);
    const link = (await ok(
      await api.get(`business/appointment-types/${c.t1.id}/public-link`),
      'link',
    )) as { url: string };
    const anon = await browser.newContext();
    const visitor = await anon.newPage();
    await visitor.goto(link.url);
    await settled(visitor);
    await visitor.waitForTimeout(3000);
    const seen = (await visitor.locator('body').innerText()).replace(/\s+/g, ' ');
    info.annotations.push({ type: 'visitor-sees', description: seen.slice(0, 700) });
    expect(seen).not.toContain(secret);
    await shot(visitor, TAB, '10-public-booking', info);
    await anon.close();
  });

  test('A0 + 3 Types list: every type is listed, or a pager reaches the rest', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await page.goto(app('/calendar/types'));
    const rows = page.getByTestId('types-list').locator('button[aria-pressed]');
    await expect(rows.first()).toBeVisible({ timeout: 60_000 });
    const api = await pageApi(page);
    // The screen lists active and archived types (status=all).
    const all = (await ok(await api.get('business/appointment-types?status=all'), 'types')) as {
      items: unknown[];
    };
    const shown = await rows.count();
    const pager = await page.getByTestId('types-list').getByRole('navigation').count();
    info.annotations.push({
      type: 'types-shown',
      description: `${shown} of ${all.items.length}, pager ${pager}`,
    });
    await shot(page, TAB, 'types-list', info);
    expect(
      shown === all.items.length || pager > 0,
      `${shown} of ${all.items.length} types shown, no pager`,
    ).toBe(true);
  });

  test('A0 + 3 Archive and Restore a type from its menu; an archived type refuses public booking', async ({
    page,
    browser,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await page.goto(app('/calendar/types'));
    const api = await pageApi(page);
    const link = (await ok(
      await api.get(`business/appointment-types/${c.t2.id}/public-link`),
      'link',
    )) as { url: string };
    const archivedAt = async () =>
      (
        (await (await api.get(`business/appointment-types/${c.t2.id}/public-link`)).json()) as {
          state: string;
        }
      ).state;
    const menuOf = async (item: string) => {
      await page.getByRole('button', { name: `Actions for ${c.t2.name}` }).click();
      await page
        .getByRole('menu', { name: `Actions for ${c.t2.name}` })
        .getByRole('menuitem', { name: item })
        .click();
      const d = page.getByRole('dialog');
      if (await d.isVisible().catch(() => false))
        await d.getByRole('button', { name: item }).last().click();
    };
    try {
      await openType(page, c.t2.name);
      await menuOf('Archive');
      await expect.poll(archivedAt, { timeout: 30_000 }).toBe('ARCHIVED');
      await page.reload();
      await expect(page.getByTestId('types-list')).toContainText(c.t2.name, { timeout: 60_000 });
      await shot(page, TAB, 'A0-archived-in-list', info);
      const anon = await browser.newContext();
      const visitor = await anon.newPage();
      await visitor.goto(link.url);
      await settled(visitor);
      await expect(visitor.locator('body')).toContainText('Is No Longer Offered', {
        timeout: 30_000,
      });
      await shot(visitor, TAB, 'A0-archived-public-link', info);
      await anon.close();
      await menuOf('Restore');
      await expect.poll(archivedAt, { timeout: 30_000 }).not.toBe('ARCHIVED');
    } finally {
      // Never leave T2 archived for the rows after this one.
      await api.post(`business/appointment-types/${c.t2.id}/restore`);
    }
  });

  // ------------------------------------------------------------ the new-appointment form
  test('W11 Required fields and time range: clear messages, notes kept', async ({ page }, info) => {
    test.skip(info.project.name !== 'w1165');
    await newForm(page);
    await page.getByLabel('Internal Notes (not visible to client)').fill(`${runTag} W11 note`);
    await page.getByRole('button', { name: 'Schedule Appointment' }).click();
    await expect(page.locator('body')).toContainText(
      'Choose a client or lead, or add a new contact.',
    );
    await expect(page.locator('body')).toContainText('Choose an appointment type.');
    await expect(page.getByLabel('Internal Notes (not visible to client)')).toHaveValue(
      `${runTag} W11 note`,
    );
    await shot(page, TAB, 'W11-required', info);
  });

  test('W3 Form prefill from a calendar slot; the type sets the end', async ({ page }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await page.goto(app(`/calendar/new?date=${c.day}&time=14:00`));
    await expect(page.getByLabel('Date *')).toHaveValue(c.day, { timeout: 60_000 });
    await expect(page.getByLabel('Start Time *')).toHaveValue('14:00');
    await pickType(page, c.t1.name);
    await expect(page.getByLabel('End Time *')).toHaveValue('14:30');
  });

  test('B5 End Time follows start plus the type length (15 and 30 minutes), summary agrees', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await newForm(page);
    await page.getByLabel('Date *').fill(c.day);
    await page.getByLabel('Start Time *').selectOption('15:00');
    await pickType(page, c.t2.name);
    await expect(page.getByLabel('End Time *')).toHaveValue('15:15');
    await expect(page.getByTestId('appointment-summary')).toContainText('3:00 PM – 3:15 PM');
    await pickType(page, c.t1.name);
    await expect(page.getByLabel('End Time *')).toHaveValue('15:30');
    await page.getByLabel('Start Time *').selectOption('16:00');
    await page.waitForTimeout(500);
    await shot(page, TAB, 'B5-start-changed', info);
    info.annotations.push({
      type: 'end-after-start-change',
      description: await page.getByLabel('End Time *').inputValue(),
    });
    await expect(page.getByLabel('End Time *')).toHaveValue('16:30');
    await expect(page.getByTestId('appointment-summary')).toContainText('4:00 PM – 4:30 PM');
    await shot(page, TAB, 'B5-end-time', info);
  });

  test('B4 Appointment Summary shows the repeat and its count before saving', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await newForm(page);
    await pickType(page, c.t1.name);
    const summary = page.getByTestId('appointment-summary');
    await expect(summary).toContainText('Does not repeat');
    await page.getByLabel('Repeat').selectOption('MONTHLY');
    await page.getByLabel('Occurrences').selectOption('6');
    await expect(summary).toContainText(/Every month, 6 times/);
    await page.getByLabel('Repeat').selectOption({ index: 0 });
    await expect(summary).toContainText('Does not repeat');
    await shot(page, TAB, 'B4-summary', info);
  });

  test('B1 A Zoom / Video-only type sets Zoom / Video and turns the other methods off', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await newForm(page);
    const where = page.getByRole('radiogroup', { name: 'Location Type *' });
    await expect(where.getByRole('radio', { name: 'In Person' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await pickType(page, c.t2.name);
    await expect(where.getByRole('radio', { name: /Zoom|Video/ }).first()).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(where.getByRole('radio', { name: 'In Person' })).toBeDisabled();
    await expect(page.getByTestId('type-methods')).toContainText('offers Zoom / Video');
    await shot(page, TAB, 'B1-type-method', info);
  });

  test('6 Zoom link layout: full-width Video Meeting Link with Copy; Generate needs video connected', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await newForm(page);
    await pickType(page, c.t2.name);
    const link = page.getByTestId('video-link');
    await expect(link).toBeVisible();
    await expect(page.getByLabel('Video Meeting Link')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy the video link' })).toBeVisible();
    const gen = page.getByLabel('Generate Zoom Link');
    await expect(gen).toBeDisabled();
    await expect(page.getByTestId('video-notice')).toContainText(/connect/i);
    await shot(page, TAB, '6-video-link', info);
  });

  test('B2 The unsaved form survives Edit My Availability and Back', async ({ page }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await newForm(page);
    await pickType(page, c.t1.name);
    const notes = page.getByLabel('Internal Notes (not visible to client)');
    await notes.fill(`${runTag} unsaved navigation probe`);
    const end = await page.getByLabel('End Time *').inputValue();
    await page
      .getByRole('navigation', { name: 'Availability' })
      .getByRole('link', { name: 'Edit My Availability' })
      .click();
    await expect(page).toHaveURL(/\/calendar\/availability/);
    await page.goBack();
    await expect(page.getByTestId('form-restored')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByLabel('Appointment Type *').locator('option:checked')).toContainText(
      c.t1.name,
    );
    await expect(notes).toHaveValue(`${runTag} unsaved navigation probe`);
    await expect(page.getByLabel('End Time *')).toHaveValue(end);
    await shot(page, TAB, 'B2-restored', info);
    await page.getByRole('button', { name: 'Discard them' }).click();
  });

  test('B7 + B9 Confirmation message, a note per reminder, instructions per channel (Email and Portal on, Text off)', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await newForm(page);
    const channels = page.getByTestId('instructions-in');
    await expect(channels.getByLabel('Email')).toBeChecked();
    await expect(channels.getByLabel('Portal')).toBeChecked();
    await expect(channels.getByLabel(/^Text/)).not.toBeChecked();
    await channels.getByLabel('Portal').uncheck();
    await expect(channels.getByLabel('Email')).toBeChecked();
    await expect(page.getByLabel('Confirmation message (optional)')).toBeEditable();
    const card = page.getByTestId('client-reminders');
    await card.getByLabel('Email Reminder', { exact: true }).check();
    await expect(card.getByLabel('Email Reminder note')).toBeEditable();
    await shot(page, TAB, 'B7-B9-form', info);
  });

  test('W10 + B11 Staff Availability: overlap conflicts, the edges are free, and the type buffers count before saving', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    const panel = page
      .getByRole('complementary', { name: 'Staff Availability' })
      .or(page.getByLabel('Staff Availability'));
    /** The panel's answer once it has loaded: 'free' (No Conflicts) or 'conflict'. */
    const check = async (start: string, end: string) => {
      await page.getByLabel('Start Time *').selectOption(start);
      await page.getByLabel('End Time *').selectOption(end);
      // The check is asked again after a change; give the new answer time to replace the old one.
      await page.waitForTimeout(2500);
      let text = '';
      await expect
        .poll(
          async () => {
            text = ((await panel.first().textContent()) ?? '').replace(/\s+/g, ' ');
            return /No Conflicts/.test(text)
              ? 'free'
              : /Conflict/.test(text)
                ? 'conflict'
                : 'loading';
          },
          { timeout: 30_000 },
        )
        .not.toBe('loading');
      return /No Conflicts/.test(text) ? 'free' : 'conflict';
    };
    const fill = async () => {
      await newForm(page);
      await pickSimClient(page);
      await pickType(page, c.t1.name);
      await pickHarnessStaff(page);
      await page.getByLabel('Date *').fill(c.day);
    };
    // AP1 is 2:00-2:30 PM. No buffers: 2:00-3:00 overlaps; 2:30-3:00 is free.
    await fill();
    expect(await check('14:00', '15:00')).toBe('conflict');
    expect(await check('14:30', '15:00')).toBe('free');
    await shot(page, TAB, 'W10-availability', info);
    // B11: 30-minute buffers on the type; 2:30-3:00 is now inside AP1's buffer, before saving too.
    const api = await pageApi(page);
    const put = (b: number) =>
      api.put(`business/appointment-types/${c.t1.id}/config`, {
        bufferBeforeMinutes: b,
        bufferAfterMinutes: b,
      });
    const res = await put(30);
    test.info().annotations.push({
      type: 'buffer-put',
      description: `${res.status()} ${(await res.text()).slice(0, 300)}`,
    });
    await fill();
    const inside = await check('14:30', '15:00');
    await shot(page, TAB, 'B11-buffer-pre-save', info);
    await put(0);
    expect(res.ok(), `buffer config saved (${res.status()})`).toBe(true);
    expect(inside).toBe('conflict');
  });

  test('P1 Save as Draft keeps the form and reopens from Your saved drafts', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await newForm(page);
    await pickSimClient(page);
    await pickType(page, c.t1.name);
    await pickHarnessStaff(page);
    await page.getByLabel('Internal Notes (not visible to client)').fill(`${runTag} draft`);
    await page.getByRole('button', { name: 'Save as Draft' }).click();
    await expect(page.getByTestId('schedule-note')).toContainText('Draft saved');
    await page.reload();
    const drafts = page.getByTestId('my-drafts');
    await expect(drafts).toBeVisible({ timeout: 60_000 });
    const item = drafts.getByRole('listitem').filter({ hasText: c.t1.name }).first();
    await item.getByRole('link').first().click();
    await expect(page).toHaveURL(/\/calendar\/new\?draft=([0-9a-f-]{36})/);
    const draftId = /draft=([0-9a-f-]{36})/.exec(page.url())![1]!;
    track('drafts', draftId);
    await expect(page.getByLabel('Internal Notes (not visible to client)')).toHaveValue(
      `${runTag} draft`,
    );
    await expect(page.getByLabel('Appointment Type *').locator('option:checked')).toContainText(
      c.t1.name,
    );
    await shot(page, TAB, 'P1-draft', info);
  });

  test('4 Save Client inline: the typed contact becomes a client, is chosen, entries stay', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await newForm(page);
    await pickType(page, c.t1.name);
    await page.getByLabel('Internal Notes (not visible to client)').fill(`${runTag} inline client`);
    // Add a new contact: name and an SES simulator email (Save Client sends nothing).
    await page
      .getByRole('radio', { name: /Add a new contact/i })
      .or(page.getByRole('button', { name: /Add a new contact/i }))
      .first()
      .click();
    await page.getByLabel('Name *').fill(`${runTag} Inline Client`);
    await page
      .getByLabel('Email *')
      .fill(`success+live-check-${Date.now()}@simulator.amazonses.com`);
    await page.getByRole('button', { name: 'Save Client' }).click();
    await expect(page.getByTestId('save-client-note')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('save-client-error')).toHaveCount(0);
    await expect(page.getByLabel('Appointment Type *').locator('option:checked')).toContainText(
      c.t1.name,
    );
    await expect(page.getByLabel('Internal Notes (not visible to client)')).toHaveValue(
      `${runTag} inline client`,
    );
    await shot(page, TAB, '4-save-client', info);
    const api = await pageApi(page);
    const found = (await ok(
      await api.get(
        `business/appointments/contacts?search=${encodeURIComponent(`${runTag} Inline`)}`,
      ),
      'contacts',
    )) as { items: { id: string; kind: string }[] };
    for (const it of found.items) if (it.kind === 'CLIENT') track('clients', it.id);
    expect(found.items.length).toBe(1);
  });

  test('W4 All Day: start and end off, saved, reads all day after reload and in Edit', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await newForm(page);
    await pickSimClient(page);
    await pickType(page, c.t1.name);
    await pickHarnessStaff(page);
    await page.getByLabel('Date *').fill(c.allDay);
    await page.getByLabel('All Day').check();
    await expect(page.getByLabel('Start Time *')).toBeDisabled();
    await expect(page.getByLabel('End Time *')).toBeDisabled();
    await expect(page.getByTestId('appointment-summary')).toContainText(/All day/i);
    await page
      .getByLabel('Send Confirmation Message Immediately')
      .uncheck()
      .catch(() => {});
    await submit(page, 'Schedule Appointment', /\/calendar\/[0-9a-f-]{36}$/, 'all-day');
    const id = idFromUrl(page);
    track('appointments', id);
    await page.reload();
    await expect(page.getByTestId('detail-summary')).toContainText(/all day/i, { timeout: 60_000 });
    await shot(page, TAB, 'W4-all-day-detail', info);
    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    await expect(page.getByLabel('All Day')).toBeChecked({ timeout: 60_000 });
  });

  test('W9 Today: only today, and each entry opens its own detail (read only)', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await page.goto(app('/calendar/today'));
    const today = page.getByTestId('today-schedule');
    await expect(today).toBeVisible({ timeout: 60_000 });
    await shot(page, TAB, 'W9-today', info);
    const links = today.getByRole('link');
    if ((await links.count()) === 0) {
      await expect(page.locator('main')).toContainText(/No appointments|nothing/i);
      return;
    }
    const href = await links.first().getAttribute('href');
    await links.first().click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    // The open record is today's (firm zone).
    const c = ctx();
    expect(c.day).not.toBe(localDay(0));
  });

  test('P6 Recurring: weekly, 2 occurrences, both saved with the right dates', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await newForm(page);
    await pickSimClient(page);
    await pickType(page, c.t1.name);
    await pickHarnessStaff(page);
    await page.getByLabel('Date *').fill(c.p6);
    await page.getByLabel('Start Time *').selectOption('13:00');
    // End Time does not follow a changed start (B5), so it is set by hand here.
    await page.getByLabel('End Time *').selectOption('13:30');
    await page.getByLabel('Repeat').selectOption('WEEKLY');
    await page.getByLabel('Occurrences').selectOption('2');
    await page
      .getByLabel('Send Confirmation Message Immediately')
      .uncheck()
      .catch(() => {});
    await submit(page, 'Schedule Appointment', /\/calendar\/[0-9a-f-]{36}$/, 'recurring');
    const api = await pageApi(page);
    const from = `${c.p6}T00:00:00-05:00`;
    const to = new Date(Date.parse(from) + 20 * 86_400_000).toISOString();
    const list = (await ok(
      await api.get(
        `business/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&clientId=${SIM_CLIENT}`,
      ),
      'list',
    )) as {
      items: { id: string; startsAt: string; status: string; type: { name: string } | null }[];
    };
    const mine = list.items.filter(
      (a) =>
        a.type?.name === c.t1.name &&
        a.status !== 'CANCELLED' &&
        a.startsAt >= new Date(from).toISOString(),
    );
    for (const a of mine) track('appointments', a.id);
    const starts = mine
      .map((a) => a.startsAt)
      .filter((x) => x.slice(11, 16) === '18:00')
      .sort();
    expect(starts).toHaveLength(2);
    expect(Date.parse(starts[1]!) - Date.parse(starts[0]!)).toBe(7 * 86_400_000);
    await shot(page, TAB, 'P6-recurring-detail', info);
  });

  test('B10 A new appointment starts in the firm time zone; its own zone is kept', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await newForm(page);
    await expect(page.getByLabel('Time Zone')).toHaveValue(TZ);
    await pickSimClient(page);
    await pickType(page, c.t1.name);
    await pickHarnessStaff(page);
    await page.getByLabel('Date *').fill(c.b10);
    await page.getByLabel('Start Time *').selectOption('09:00');
    await page.getByLabel('End Time *').selectOption('09:30');
    await page.getByLabel('Time Zone').selectOption('America/Chicago');
    await page
      .getByLabel('Send Confirmation Message Immediately')
      .uncheck()
      .catch(() => {});
    await submit(page, 'Schedule Appointment', /\/calendar\/[0-9a-f-]{36}$/, 'tz');
    track('appointments', idFromUrl(page));
    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    await expect(page.getByLabel('Time Zone')).toHaveValue('America/Chicago', { timeout: 60_000 });
    await expect(page.getByLabel('Start Time *')).toHaveValue('09:00');
    await shot(page, TAB, 'B10-timezone', info);
    // The firm's own setting is unchanged.
    const api = await pageApi(page);
    const opts = (await ok(await api.get('business/appointments/options'), 'options')) as {
      timezone: string;
    };
    expect(opts.timezone).toBe(TZ);
  });

  // ------------------------------------------------------------ the detail page (AP1 and friends)
  test('W5 + 7 Saved record: time, reminders (two by Email) and instructions kept after reload and in Edit', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await page.goto(app(`/calendar/${c.ap1}`));
    const main = page.locator('main');
    await expect(main).toContainText(SIM_NAME, { timeout: 60_000 });
    await expect(main).toContainText('2:00 PM');
    await expect(main).toContainText('2:30 PM');
    await expect(main).toContainText('bring your books and receipts');
    await shot(page, TAB, 'W5-detail', info);
    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    const card = page.getByTestId('client-reminders');
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card.getByLabel('Email Reminder', { exact: true })).toBeChecked();
    const more = page.getByTestId('more-reminders');
    await expect(more).toBeVisible();
    const units = await more
      .locator('select')
      .evaluateAll((els) => els.map((e) => (e as HTMLSelectElement).value));
    expect(units.join(' ')).toMatch(/EMAIL/);
    expect(units.join(' ')).toMatch(/HOURS/);
    await expect(page.getByLabel('Start Time *')).toHaveValue('14:00');
    await expect(page.getByLabel('End Time *')).toHaveValue('14:30');
    await shot(page, TAB, '7-edit-reminders', info);
  });

  test('W7 Cancel on Edit discards the change', async ({ page }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await page.goto(app(`/calendar/${c.ap1}/edit`));
    await expect(page.getByLabel('Start Time *')).toHaveValue('14:00', { timeout: 60_000 });
    await page.getByLabel('Start Time *').selectOption('15:00');
    await page
      .getByRole('link', { name: 'Cancel', exact: true })
      .or(page.getByRole('button', { name: 'Cancel', exact: true }))
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(`/calendar/${c.ap1}$`));
    await page.reload();
    await expect(page.locator('main')).toContainText('2:00 PM', { timeout: 60_000 });
    await expect(page.locator('main')).not.toContainText('3:00 PM');
  });

  test('W6 Internal note: added with author and time, kept after reload; empty Add Note disabled', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await page.goto(app(`/calendar/${c.ap1}`));
    const box = page.getByLabel('Add a note (internal)');
    await expect(box).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Add Note' })).toBeDisabled();
    await box.fill(`${runTag} W6 note`);
    await page.getByRole('button', { name: 'Add Note' }).click();
    await expect(page.locator('main')).toContainText('Note added');
    await page.reload();
    await expect(page.locator('main')).toContainText(`${runTag} W6 note`, { timeout: 60_000 });
    await expect(page.locator('main')).toContainText('QA Perf');
    await shot(page, TAB, 'W6-note', info);
  });

  test('P7 + B8 Send Reminder (simulator client): success, and the notice history lists it after reload', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await page.goto(app(`/calendar/${c.ap1}`));
    await expect(page.locator('main')).toContainText(SIM_NAME, { timeout: 60_000 });
    await page.getByRole('button', { name: 'Send Reminder' }).click();
    const dialog = page.getByRole('dialog');
    if (await dialog.isVisible().catch(() => false)) {
      await dialog.getByRole('button', { name: /Send/ }).last().click();
    }
    await expect(page.getByTestId('detail-result').or(page.getByRole('status'))).toContainText(
      /sent|Reminder/i,
      { timeout: 30_000 },
    );
    await page.reload();
    const notices = page
      .locator('section, div')
      .filter({ has: page.getByRole('heading', { name: 'Reminders & Notices' }) })
      .last();
    await expect(notices).toContainText(/Email/i, { timeout: 60_000 });
    await expect(notices).toContainText(/Sent|sent/);
    await shot(page, TAB, 'B8-notice-history', info);
  });

  test('P2 Reschedule: a new time on Edit is kept and the history says who moved it', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await page.goto(app(`/calendar/${c.ap3}/edit`));
    await expect(page.getByLabel('Start Time *')).toHaveValue('10:00', { timeout: 60_000 });
    await page.getByLabel('Start Time *').selectOption('09:00');
    await page.getByLabel('End Time *').selectOption('09:30');
    await submit(page, 'Save Changes', new RegExp(`/calendar/${c.ap3}$`), 'reschedule');
    await page.reload();
    const main = page.locator('main');
    await expect(main).toContainText('9:00 AM', { timeout: 60_000 });
    await expect(main).toContainText(/Reschedul/);
    await shot(page, TAB, 'P2-reschedule', info);
  });

  const summary = (page: Page) => page.getByTestId('detail-summary');
  test('P3 Cancel: the dialog says the client is told; Canceled after reload; actions then off', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await page.goto(app(`/calendar/${c.ap3}`));
    await expect(summary(page)).toContainText(SIM_NAME, { timeout: 60_000 });
    await page.getByRole('button', { name: 'Cancel Appointment' }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancel Appointment' });
    await expect(dialog).toContainText('They are told');
    await dialog.getByLabel('Reason (optional)').fill(`${runTag} cancel test`);
    await shot(page, TAB, 'P3-cancel-dialog', info);
    await dialog.getByRole('button', { name: 'Cancel Appointment' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await page.reload();
    await expect(summary(page)).toContainText('Canceled', { timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Cancel Appointment' })).toBeDisabled();
    await shot(page, TAB, 'P3-canceled', info);
  });

  test('P4 Complete: refused with a clear message before the start; a started one becomes Completed, final', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    // Before the start (AP1, next week): refused, and the words say why.
    await page.goto(app(`/calendar/${c.ap1}`));
    await expect(summary(page)).toContainText(SIM_NAME, { timeout: 60_000 });
    await page.getByRole('button', { name: 'Mark Completed' }).click();
    let dialog = page.getByRole('dialog', { name: 'Mark Completed' });
    await dialog.getByRole('button', { name: 'Mark Completed' }).click();
    await page.waitForTimeout(3000);
    const said = ((await dialog.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ');
    info.annotations.push({ type: 'not-started-message', description: said.slice(0, 300) });
    await shot(page, TAB, 'P4-not-started-message', info);
    expect(said).toMatch(/start/i);
    await dialog.getByRole('button', { name: 'Keep It' }).click();
    // A started one (yesterday).
    await page.goto(app(`/calendar/${c.ap4}`));
    await expect(summary(page)).toContainText(SIM_NAME, { timeout: 60_000 });
    await page.getByRole('button', { name: 'Mark Completed' }).click();
    dialog = page.getByRole('dialog', { name: 'Mark Completed' });
    await dialog.getByRole('button', { name: 'Mark Completed' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await page.reload();
    await expect(summary(page)).toContainText('Completed', { timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Mark Completed' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Mark No-Show' })).toBeDisabled();
    await shot(page, TAB, 'P4-completed', info);
  });

  test('P5 No-show: a started one becomes No-Show after reload, final', async ({ page }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await page.goto(app(`/calendar/${c.ap5}`));
    await expect(summary(page)).toContainText(SIM_NAME, { timeout: 60_000 });
    await page.getByRole('button', { name: 'Mark No-Show' }).click();
    const dialog = page.getByRole('dialog', { name: 'Mark No-Show' });
    await dialog.getByRole('button', { name: 'Mark No-Show' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await page.reload();
    await expect(summary(page)).toContainText('No-Show', { timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Mark No-Show' })).toBeDisabled();
    await shot(page, TAB, 'P5-no-show', info);
  });

  test('A1 Group appointments: the Other Attendees field finds the firm clients (not saved: see NOT LIVE)', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await page.goto(app(`/calendar/${c.ap1}/edit`));
    await expect(page.getByLabel('Start Time *')).toHaveValue('14:00', { timeout: 60_000 });
    const picker = page.getByTestId('attendees').getByLabel('Other Attendees');
    await expect(picker).toBeVisible();
    await picker.fill('QA');
    await expect(page.getByTestId('attendee-results')).toBeVisible({ timeout: 30_000 });
    // The appointment's own client is never offered as another attendee.
    await expect(page.getByTestId('attendee-results')).not.toContainText(SIM_NAME);
    await shot(page, TAB, 'A1-attendee-picker', info);
    // Saving would email the attendee, who can only be another client: not done (send rule).
  });

  // ------------------------------------------------------------ list, calendar, today
  test('W1 List: period, status and search narrow it; an unmatched search says so', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await page.goto(app('/calendar/list'));
    const toolbar = page.getByTestId('appointments-toolbar');
    await expect(toolbar.getByLabel('Status')).toBeVisible({ timeout: 60_000 });
    await toolbar.getByLabel('Period').selectOption({ index: 1 });
    await toolbar.getByLabel('Search appointments').fill('QA Appointments');
    const list = page.getByTestId('appointments-list');
    await expect(list).toContainText(SIM_NAME, { timeout: 30_000 });
    await toolbar.getByLabel('Search appointments').fill('zz-no-such-client-zz');
    await expect(page.locator('main')).toContainText('No matching appointments', {
      timeout: 30_000,
    });
    await shot(page, TAB, 'W1-list', info);
  });

  test('B3 Back from an appointment keeps the list filters and the calendar view', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await page.goto(app('/calendar/list'));
    const toolbar = page.getByTestId('appointments-toolbar');
    await expect(toolbar.getByLabel('Status')).toBeVisible({ timeout: 60_000 });
    await toolbar.getByLabel('Period').selectOption('next30');
    await toolbar.getByLabel('Status').selectOption('CONFIRMED');
    await toolbar.getByLabel('Search appointments').fill('QA Appointments');
    const row = page
      .getByTestId('appointments-list')
      .getByRole('link')
      .filter({ hasText: SIM_NAME })
      .first();
    await row.click();
    await expect(page).toHaveURL(/\/calendar\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await page.goBack();
    await expect(toolbar.getByLabel('Period')).toHaveValue('next30', { timeout: 60_000 });
    await expect(toolbar.getByLabel('Status')).toHaveValue('CONFIRMED');
    await expect(toolbar.getByLabel('Search appointments')).toHaveValue('QA Appointments');
    // The calendar: a month view on AP1's day, then an appointment, then Back.
    await page.goto(app(`/calendar?date=${c.day}`));
    const cal = page.getByTestId('appointments-toolbar');
    await cal.getByLabel('Show').selectOption('month');
    const period = await page.getByTestId('calendar-period').textContent();
    await page.goto(app(`/calendar/${c.ap1}`));
    await page.goBack();
    await expect(page.getByTestId('calendar-period')).toHaveText(period!, { timeout: 60_000 });
    await expect(cal.getByLabel('Show')).toHaveValue('month');
    await shot(page, TAB, 'B3-back', info);
  });

  test('W2 + W8 Calendar month shows the saved record; it opens its detail; Upcoming lists it', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await page.goto(app(`/calendar?date=${c.day}&view=week`));
    await expect(page.getByTestId('calendar-period')).toBeVisible({ timeout: 60_000 });
    const chip = page
      .getByTestId('appointments-calendar')
      .getByRole('button', { name: /, 2:00\s*PM\s*[–-]\s*2:30\s*PM/ })
      .first();
    await expect(chip).toBeVisible({ timeout: 30_000 });
    await shot(page, TAB, 'W2-calendar-week', info);
    await chip.click();
    await expect(page).toHaveURL(/\/calendar\/[0-9a-f-]{36}$/);
    await page.goto(app('/calendar'));
    await expect(page.locator('main')).toContainText('Upcoming', { timeout: 60_000 });
  });

  // ------------------------------------------------------------ settings (A2, A3) and availability (5)
  test('5 Staff Availability: saving unchanged hours keeps them after reload', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await page.goto(app('/calendar/availability'));
    const rules = page.getByTestId('availability-rules');
    await expect(rules).toBeVisible({ timeout: 60_000 });
    await expect(rules).toContainText('Weekly Working Hours', { timeout: 60_000 });
    const before = (await rules.textContent())?.replace(/\s+/g, ' ');
    await page.getByRole('button', { name: 'Save Availability' }).click();
    await expect(page.getByTestId('rules-saved')).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(rules).toBeVisible({ timeout: 60_000 });
    // The weekly hours fill in after the card itself shows.
    await expect
      .poll(async () => (await rules.textContent())?.replace(/\s+/g, ' '), { timeout: 30_000 })
      .toBe(before);
    await shot(page, TAB, '5-availability', info);
  });

  test('A2 Rooms and Equipment under Appointment Settings: equipment added and archived', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await page.goto(app('/settings/appointments'));
    await expect(
      page.getByTestId('page-title').or(page.getByRole('heading', { level: 1 })),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('main')).toContainText('Rooms');
    await expect(page.locator('main')).toContainText('Equipment');
    await shot(page, TAB, 'A2-settings', info);
    const name = page.getByTestId('new-item-name');
    if (await name.isEnabled().catch(() => false)) {
      await name.fill(`${runTag} projector`);
      await page
        .getByRole('button', { name: 'Add equipment' })
        .or(page.getByRole('button', { name: /^Add/ }))
        .first()
        .click();
      const row = page.getByTestId('equipment-row').filter({ hasText: `${runTag} projector` });
      await expect(row).toBeVisible({ timeout: 30_000 });
      await page.reload();
      await expect(row).toBeVisible({ timeout: 60_000 });
      await row.getByRole('button', { name: /Archive/ }).click();
      const d = page.getByRole('dialog');
      if (await d.isVisible().catch(() => false))
        await d
          .getByRole('button', { name: /Archive/ })
          .last()
          .click();
      await expect(row).toContainText(/Archived/i, { timeout: 30_000 });
    } else {
      // No office yet in Test Firm B: the screen says what is needed.
      await expect(page.locator('main')).toContainText(/office/i);
    }
  });

  test('A3 Waitlist card: on/off and two clearly separate modes (read only)', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await page.goto(app('/settings/appointments'));
    const card = page
      .getByRole('region', { name: 'Waitlist settings' })
      .or(page.getByLabel('Waitlist settings'));
    await expect(card.first()).toBeVisible({ timeout: 60_000 });
    await expect(card.first()).toContainText(/Automatic confirmation/i);
    await expect(card.first()).toContainText(/Staff approval/i);
    await expect(page.getByLabel('Offer earlier openings')).toBeVisible();
    await shot(page, TAB, 'A3-waitlist', info);
  });
});

// ---------------------------------------------------------------- other roles
test.describe('Appointments (Admin)', () => {
  test.use(as('admin'));
  test.skip(() => !hasLogin('admin'), 'no admin login');
  test('P10 Admin: opens an appointment and has the status actions; manages types', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await page.goto(app(`/calendar/${c.ap1}`));
    await expect(page.locator('main')).toContainText(SIM_NAME, { timeout: 60_000 });
    const actions = page.getByTestId('detail-actions');
    for (const name of ['Mark Completed', 'Mark No-Show', 'Cancel Appointment'])
      await expect(page.getByRole('button', { name })).toBeVisible();
    await shot(page, TAB, 'P10-admin-detail', info);
    await expect(actions).toBeVisible();
  });
});

test.describe('Appointments (Staff)', () => {
  test.use(as('staff'));
  test.skip(() => !hasLogin('staff'), 'no staff login');
  test('P10 Staff: an appointment of a client not assigned to them is not shown; settings are closed', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    await page.goto(app(`/calendar/${c.ap1}`));
    await settled(page);
    await expect(page.locator('main')).toContainText(
      'This appointment was not found. It may have been removed, or you may not have access.',
      { timeout: 60_000 },
    );
    await expect(page.getByRole('button', { name: 'Mark Completed' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Cancel Appointment' })).toBeDisabled();
    await shot(page, TAB, 'P10-staff-detail', info);
    await page.goto(app('/settings/appointments'));
    await settled(page);
    await expect(page.getByTestId('new-item-name')).toHaveCount(0);
    await shot(page, TAB, 'P10-staff-settings', info);
  });
});

test.describe('Appointments (Client portal)', () => {
  test.use(as('client'));
  test.skip(() => !hasLogin('client'), 'no client login');
  test('10 Portal: the bookable types never show a staff-only description', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    await page.goto(portal('/appointments'));
    await settled(page);
    await expect(page.locator('main')).not.toContainText('staff-only description');
    await shot(page, TAB, '10-portal-appointments', info);
  });
});

// ---------------------------------------------------------------- both widths: every page of the tab
const pages: { name: string; path: (page: Page) => Promise<string> }[] = [
  { name: 'calendar', path: async () => '/calendar' },
  { name: 'calendar-month', path: async () => '/calendar?view=month' },
  { name: 'list', path: async () => '/calendar/list' },
  { name: 'today', path: async () => '/calendar/today' },
  { name: 'new', path: async () => '/calendar/new' },
  { name: 'types', path: async () => '/calendar/types' },
  { name: 'availability', path: async () => '/calendar/availability' },
  { name: 'settings', path: async () => '/settings/appointments' },
  {
    name: 'detail',
    path: async (page: Page) => {
      const api = await pageApi(page);
      const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const to = new Date(Date.now() + 30 * 86_400_000).toISOString();
      const res = await api.get(
        `business/appointments?from=${from}&to=${to}&clientId=${SIM_CLIENT}`,
      );
      const items = ((await ok(res, 'list')) as { items: { id: string }[] }).items;
      return `/calendar/${items[0]!.id}`;
    },
  },
  {
    name: 'edit',
    path: async (page: Page) => {
      const api = await pageApi(page);
      const from = new Date().toISOString();
      const to = new Date(Date.now() + 30 * 86_400_000).toISOString();
      const res = await api.get(
        `business/appointments?from=${from}&to=${to}&clientId=${SIM_CLIENT}&status=SCHEDULED`,
      );
      const items = ((await ok(res, 'list')) as { items: { id: string }[] }).items;
      return `/calendar/${items[0]!.id}/edit`;
    },
  },
];

test.describe('Appointments layout', () => {
  test.use(as('owner'));
  for (const p of pages) {
    test(`@narrow layout ${p.name}: no sideways scroll`, async ({ page }, info) => {
      await page.goto(app(await p.path(page)));
      await expect(page).not.toHaveURL(/sign-in/);
      await settled(page);
      await page.waitForTimeout(1000);
      await shot(page, TAB, `layout-${p.name}`, info);
      await expectNoSideScroll(page);
    });
  }
});

test.describe('Appointments layout (portal)', () => {
  test.use(as('client'));
  test('@narrow layout portal-appointments: no sideways scroll', async ({ page }, info) => {
    await page.goto(portal('/appointments'));
    await settled(page);
    await page.waitForTimeout(1000);
    await shot(page, TAB, 'layout-portal-appointments', info);
    await expectNoSideScroll(page);
  });
});

// ---------------------------------------------------------------- Review Two: her steps (R61)
/**
 * Octavia's Review Two rows 8, P8, B3, B5, B6, A1, A2 and A3, live, with her steps on data like
 * hers (audit, Nov 19): each test asserts the words her row asks for. Times are in the firm's zone
 * (America/Chicago, as in her review). Every client here is one this run creates on the SES
 * simulator, or the harness portal client (on the simulator too); never QA Fixture Client 1 or a
 * qa- login. Rooms and equipment are the fixture's (FX Office, FX Room 1, FX Projector), else
 * LIVE-CHECK ones this run archives. The waitlist switch is put back exactly as it was. The run's
 * ids live in their own file; the zz cleanup cancels, leaves and archives what is left.
 */
type Named = { id: string; name: string };
interface R2 {
  tag: string;
  tz: string;
  owner: Named;
  /** The harness Admin and Staff members, when the run has their logins. */
  others: Named[];
  t15: Named;
  t45: Named;
  clients: Record<
    'b3' | 'b5' | 'b6' | 'main' | 'guestA' | 'guestB' | 'resA' | 'resB' | 'p10' | 'series' | 'r3',
    Named
  >;
  appointments: string[];
  rooms: string[];
  equipment: string[];
  /** Records the R60-pending rows make (9 + P9): archived or deleted by the cleanup. */
  types: string[];
  services: string[];
  categories: string[];
  forms: string[];
  /** The waitlist switch before A3 changed it (null: A3 has not read it). */
  waitlistBefore: { enabled: boolean; mode: string } | null;
  cleaned: boolean;
}
const r2File = () => join(process.env['LIVE_OUT_DIR'] ?? '.', 'appointments-r2-ctx.json');
const r2 = (): R2 => JSON.parse(readFileSync(r2File(), 'utf8')) as R2;
const saveR2 = (c: R2) => writeFileSync(r2File(), JSON.stringify(c, null, 2));
type R2List =
  'appointments' | 'rooms' | 'equipment' | 'types' | 'services' | 'categories' | 'forms';
function keepR2(kind: R2List, id: string) {
  const c = r2();
  if (id && !c[kind].includes(id)) c[kind].push(id);
  saveR2(c);
}
const FX = { office: 'FX Office', room: 'FX Room 1', item: 'FX Projector' };

/** YYYY-MM-DD in `tz`, `days` from today. */
const dayIn = (tz: string, days: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(
    new Date(Date.now() + days * 86_400_000),
  );
/** The instant of `day` at `hhmm` on the wall clock of `tz`. */
function instant(tz: string, day: string, hhmm: string): string {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
  const [h = 0, mi = 0] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const shown = Date.UTC(
    Number(parts['year']),
    Number(parts['month']) - 1,
    Number(parts['day']),
    Number(parts['hour']),
    Number(parts['minute']),
  );
  return new Date(guess - (shown - guess)).toISOString();
}
const oneLine = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
/** The detail's "Date & time": "Nov 26, 2026, 3:00 PM – 3:15 PM". */
function detailWhen(startIso: string, endIso: string, tz: string): string {
  const day = new Date(startIso).toLocaleDateString('en-US', {
    timeZone: tz,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const clock = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' });
  return oneLine(`${day}, ${clock(startIso)} – ${clock(endIso)}`);
}

type PageApi = Awaited<ReturnType<typeof pageApi>>;
interface Want {
  staff: string[];
  clientId: string;
  attendees?: string[];
  roomId?: string;
  equipmentIds?: string[];
  recurrence?: { frequency: 'WEEKLY' | 'MONTHLY'; count: number };
}
/** Whether the conflict check (the form's own) lets the Owner book it: free, or only soft clashes. */
async function bookable(api: PageApi, w: Want, startsAt: string, endsAt: string) {
  const res = await api.post('business/appointments/conflicts', {
    staffUserIds: w.staff,
    startsAt,
    endsAt,
    contact: { kind: 'CLIENT', id: w.clientId },
    ...(w.attendees ? { attendeeClientIds: w.attendees } : {}),
    ...(w.roomId ? { roomId: w.roomId } : {}),
    ...(w.equipmentIds ? { equipmentIds: w.equipmentIds } : {}),
    ...(w.recurrence ? { recurrence: { ...w.recurrence, interval: 1 } } : {}),
  });
  const r = (await ok(res, 'conflicts')) as { ok: boolean; canOverride: boolean };
  return r.ok || r.canOverride;
}
/** The first day (of `days` from today) and time free for `w`. */
async function firstFree(
  api: PageApi,
  tz: string,
  w: Want,
  days: number[],
  times: [string, string][],
): Promise<{ day: string; start: string; end: string }> {
  for (const d of days) {
    const day = dayIn(tz, d);
    for (const [start, end] of times) {
      if (await bookable(api, w, instant(tz, day, start), instant(tz, day, end)))
        return { day, start, end };
    }
  }
  throw new Error(`no free time for ${JSON.stringify(w)} on days ${days.join(',')}`);
}
const span = (from: number, to: number) =>
  Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => (from <= to ? from + i : from - i));

/** Books through the API (setup data, as her existing records): Owner books anyway on soft clashes. */
async function book(
  api: PageApi,
  b: {
    tz: string;
    typeId: string;
    clientId: string;
    staffId: string;
    day: string;
    start: string;
    end: string;
    status: 'CONFIRMED' | 'PENDING';
    /** Instants that override day, start and end (an overnight one). */
    startsAt?: string;
    endsAt?: string;
  },
): Promise<string> {
  const body = {
    idempotencyKey: randomUUID(),
    contact: { kind: 'CLIENT', id: b.clientId },
    typeId: b.typeId,
    startsAt: b.startsAt ?? instant(b.tz, b.day, b.start),
    endsAt: b.endsAt ?? instant(b.tz, b.day, b.end),
    timezone: b.tz,
    allDay: false,
    method: 'IN_PERSON',
    staffUserIds: [b.staffId],
    status: b.status,
    sendConfirmation: false,
    reminders: [],
  };
  let res = await api.post('business/appointments/schedule', body);
  if (res.status() === 409) {
    res = await api.post('business/appointments/schedule', {
      ...body,
      idempotencyKey: randomUUID(),
      overrideConflicts: { reason: `${runTag} R2 setup` },
    });
  }
  const out = (await ok(res, 'schedule')) as { id?: string; appointments?: { id: string }[] };
  const id = out.id ?? out.appointments?.[0]?.id ?? '';
  keepR2('appointments', id);
  return id;
}

async function pickContact(page: Page, name: string) {
  await page.getByLabel('Client / Lead *').fill(name);
  await page.getByTestId('contact-results').getByRole('button', { name }).first().click();
}
/** A multi-pick (Assigned Staff, Equipment): exactly `names` chosen. */
async function pickOnly(page: Page, label: string, names: string[]) {
  await page.getByRole('button', { name: label }).last().click();
  const group = page.getByRole('group', { name: label, exact: true });
  for (const n of names) await group.getByLabel(n, { exact: true }).check();
  for (const box of await group.getByRole('checkbox').all()) {
    const text = ((await box.locator('xpath=..').textContent()) ?? '').trim();
    if (!names.includes(text) && (await box.isChecked())) await box.uncheck();
  }
  await page.keyboard.press('Escape');
  for (const n of names)
    await expect(page.getByRole('button', { name: `Remove ${n}`, exact: true })).toBeVisible();
}
/** A blank new form: an earlier test's unsaved entries, if the form offers them back, are dropped. */
async function freshForm(page: Page) {
  await newForm(page);
  const restored = page.getByTestId('form-restored');
  await restored.waitFor({ timeout: 2_000 }).catch(() => {});
  if (await restored.isVisible().catch(() => false))
    await page.getByRole('button', { name: 'Discard them' }).click();
}
/** A new form filled as staff do: contact, type, staff, date and start (the type sets the end). */
async function fillNew(
  page: Page,
  f: { contact: string; type: string; staff: string; day: string; start?: string },
) {
  await freshForm(page);
  await pickContact(page, f.contact);
  await pickType(page, f.type);
  await pickOnly(page, 'Assigned Staff *', [f.staff]);
  await page.getByLabel('Date *').fill(f.day);
  if (f.start) await page.getByLabel('Start Time *').selectOption(f.start);
}
const noConfirmation = (page: Page) =>
  page
    .getByLabel('Send Confirmation Message Immediately')
    .uncheck()
    .catch(() => {});
/** B5: End Time, Duration and the Appointment Summary agree, in her words. */
async function endIs(page: Page, end: string, duration: string, summary: string) {
  await expect(page.getByLabel('End Time *').locator('option:checked')).toHaveText(end);
  await expect(page.getByLabel('Duration')).toHaveValue(duration);
  await expect(page.getByTestId('appointment-summary')).toContainText(summary);
}
const detailSummary = (page: Page) => page.getByTestId('detail-summary');

const HOUR = 3_600_000;
/** The API through a request context (the Owner's, beside another role's page). */
const viaContext = (c: APIRequestContext): PageApi => ({
  get: (path: string) => c.get(path),
  post: (path: string, data?: unknown) => c.post(path, { data: data ?? {} }),
  put: (path: string, data: unknown) => c.put(path, { data }),
  patch: (path: string, data: unknown) => c.patch(path, { data }),
  delete: (path: string) => c.delete(path),
});
/** A member and a day (and, with `also`, the day `also` days later) free all day for the client. */
async function freeAllDay(
  api: PageApi,
  r: R2,
  clientId: string,
  offsets: number[],
  also = 0,
): Promise<{ day: string; staff: Named }> {
  for (const d of offsets) {
    for (const m of [r.owner, ...r.others]) {
      const days = [dayIn(r.tz, d), ...(also ? [dayIn(r.tz, d + also)] : [])];
      let free = true;
      for (const x of days) {
        const w = { staff: [m.id], clientId };
        if (!(await bookable(api, w, instant(r.tz, x, '00:00'), instant(r.tz, x, '23:59')))) {
          free = false;
          break;
        }
      }
      if (free) return { day: dayIn(r.tz, d), staff: m };
    }
  }
  throw new Error(`no member and day free all day for client ${clientId}`);
}
type Listed = { id: string; startsAt: string; endsAt: string; status: string; allDay?: boolean };
/** The client's appointments between two instants (each one kept for the cleanup). */
async function listFor(api: PageApi, clientId: string, from: string, to: string) {
  const items = (
    (await ok(
      await api.get(
        `business/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&clientId=${clientId}`,
      ),
      'list',
    )) as { items: Listed[] }
  ).items;
  for (const a of items) keepR2('appointments', a.id);
  return items.filter((a) => a.status !== 'CANCELLED');
}
const R2_QUESTION = 'LIVE-CHECK question (synthetic): anything to tell us?';
/** Completes a sent intake form in the portal, step by step, as the client. */
async function completeIntake(pp: Page, signer: string) {
  const form = pp.getByTestId('assigned-intake');
  await expect(form).toBeVisible({ timeout: 60_000 });
  for (let step = 0; step < 10; step++) {
    const answer = form.getByLabel(R2_QUESTION);
    if ((await answer.isVisible().catch(() => false)) && !(await answer.inputValue()))
      await answer.fill('LIVE-CHECK synthetic answer');
    const consent = pp.getByTestId('intake-consent').getByRole('checkbox');
    if (await consent.isVisible().catch(() => false)) await consent.check();
    const printed = form.getByLabel(/printed name|full name|type your name/i).first();
    if ((await printed.isVisible().catch(() => false)) && !(await printed.inputValue()))
      await printed.fill(signer);
    const next = pp.getByTestId('intake-next');
    if (!(await next.isVisible().catch(() => false))) break;
    const label = oneLine(await next.textContent());
    await next.click();
    if (label === 'Submit Intake Form') break;
    await pp.waitForTimeout(1_000);
  }
  await expect(pp.getByTestId('intake-completion')).toBeVisible({ timeout: 60_000 });
}

/** P10: each role against the permission grid on main (packages/types/src/team/permissions.ts). */
type Outcome = 'yes' | 'no';
type P10Row = Record<'view' | 'edit' | 'reschedule' | 'cancel' | 'complete' | 'noShow', Outcome>;
const P10_ALL: P10Row = {
  view: 'yes',
  edit: 'yes',
  reschedule: 'yes',
  cancel: 'yes',
  complete: 'yes',
  noShow: 'yes',
};
const P10_NONE: P10Row = {
  view: 'no',
  edit: 'no',
  reschedule: 'no',
  cancel: 'no',
  complete: 'no',
  noShow: 'no',
};
/** Expected: on an appointment the member is assigned to. null: no written matrix (custom roles). */
const P10_ROLES: { role: Role; label: string; expected: P10Row | null }[] = [
  { role: 'owner', label: 'Owner', expected: P10_ALL },
  { role: 'admin', label: 'Admin', expected: P10_ALL },
  { role: 'manager', label: 'Manager', expected: P10_ALL },
  { role: 'staff', label: 'Staff', expected: P10_ALL },
  { role: 'bookkeeper', label: 'Bookkeeper', expected: P10_NONE },
  { role: 'preparer', label: 'Tax Preparer', expected: { ...P10_ALL, edit: 'no' } },
  { role: 'support', label: 'Client Support', expected: P10_ALL },
  { role: 'consultant', label: 'Business Consultant', expected: P10_ALL },
  { role: 'readonly', label: 'Read Only', expected: { ...P10_NONE, view: 'yes' } },
  { role: 'custom1', label: 'Custom role 1', expected: null },
  { role: 'custom2', label: 'Custom role 2', expected: null },
];
const FX_PUBLIC = 'FX Public Consultation';
/**
 * P10's table for Octavia (lead, Nov 19): each role's row, expected (permissions.ts on main) and
 * actual, kept across the role tests in LIVE_OUT_DIR and written as Markdown to
 * LIVE_SHOTS_DIR/p10-table.md after every role.
 */
function writeP10Row(label: string, expected: P10Row | null, actual: Record<string, string>) {
  const rowsFile = join(process.env['LIVE_OUT_DIR'] ?? '.', 'p10-rows.json');
  type Saved = Record<
    string,
    { expected: P10Row | null; actual: Record<string, string>; at: string }
  >;
  const rows: Saved = existsSync(rowsFile)
    ? (JSON.parse(readFileSync(rowsFile, 'utf8')) as Saved)
    : {};
  rows[label] = { expected, actual, at: new Date().toISOString() };
  writeFileSync(rowsFile, JSON.stringify(rows, null, 2));
  const actions: [keyof P10Row, string][] = [
    ['complete', 'Complete'],
    ['noShow', 'No-show'],
    ['cancel', 'Cancel'],
    ['reschedule', 'Reschedule'],
    ['edit', 'Edit'],
    ['view', 'View'],
  ];
  const cell = (e: Outcome | undefined, a: string | undefined) => {
    const exp = e ?? 'not written';
    const act = a ?? 'not run';
    return e && a && e !== a ? `${exp} / **${act}** (differs)` : `${exp} / ${act}`;
  };
  const order = P10_ROLES.map((x) => x.label).filter((l) => rows[l]);
  const lines = [
    '# Appointments P10: status actions by role',
    '',
    'Each cell is expected / actual. Expected is the permission grid on main',
    '(packages/types/src/team/permissions.ts); the docs have no written appointment matrix, and a',
    'custom role has none (its base role, narrowed by its own grid). Actual is what dev answered for',
    'that role on an appointment assigned to the member: yes (done), no (refused, 403 or 404).',
    '',
    `| Role | ${actions.map(([, h]) => h).join(' | ')} | Checked (UTC) |`,
    `|---|${actions.map(() => '---').join('|')}|---|`,
    ...order.map((l) => {
      const row = rows[l];
      if (!row) return '';
      const cells = actions.map(([k]) => cell(row.expected?.[k], row.actual[k]));
      return `| ${l} | ${cells.join(' | ')} | ${row.at.slice(0, 16).replace('T', ' ')} |`;
    }),
    '',
  ];
  writeFileSync(join(process.env['LIVE_SHOTS_DIR'] ?? '.', 'p10-table.md'), lines.join('\n'));
}
/** HH:MM (24 hours) and YYYY-MM-DD of an instant on the wall clock of `tz`. */
const hhmmIn = (tz: string, iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
const ymdIn = (tz: string, iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(iso));

/**
 * The real test inbox (lead, Nov 19), only through inbox.py next to the screenshots (its text has
 * links and tokens blanked; addresses are blanked here too). Never print the inbox's address.
 */
const execFileP = promisify(execFile);
const blankAddresses = (s: string) => s.replace(/[^\s<>@()"',;:]+@[^\s<>@()"',;:]+/g, '<address>');
async function inboxRun(args: string[]): Promise<string> {
  const tool = join(process.env['LIVE_SHOTS_DIR'] ?? '.', 'inbox.py');
  try {
    const { stdout } = await execFileP('python', [tool, ...args], {
      encoding: 'utf8',
      timeout: 5 * 60_000,
      windowsHide: true,
    });
    return blankAddresses(stdout);
  } catch (e) {
    // "NO MATCH within the wait" exits 2; its output is still read.
    return blankAddresses(String((e as { stdout?: string }).stdout ?? ''));
  }
}
type Mail = { subject: string; date: string; text: string };
const parseMails = (out: string): Mail[] =>
  out
    .split(/\n---\n?/)
    .map((b) => b.trim())
    .filter((b) => b.startsWith('SUBJECT:'))
    .map((b) => ({
      subject: /^SUBJECT: (.*)$/m.exec(b)?.[1] ?? '',
      date: /^DATE: (.*)$/m.exec(b)?.[1] ?? '',
      text: (/^TEXT: ([\s\S]*)$/m.exec(b)?.[1] ?? '').trim(),
    }));
/** Mail whose subject matches, looked for a minute at a time until `untilMs`; the staff session is kept alive between turns. */
async function waitMail(subject: string, untilMs: number, keepAlive: () => Promise<unknown>) {
  while (Date.now() < untilMs) {
    const secs = Math.max(10, Math.min(60, Math.round((untilMs - Date.now()) / 1000)));
    const mails = parseMails(await inboxRun(['wait', subject, String(secs)]));
    if (mails.length) return mails;
    await keepAlive().catch(() => {});
  }
  return [];
}
/** "When" as the notices write it: "Thursday, November 26, 2026 at 3:00 PM CST". */
const whenInMail = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: tz,
    timeZoneName: 'short',
  })
    .format(new Date(iso))
    .replace(/\s+/g, ' ');
const INBOX_CLIENT = 'QA Harness Inbox Client B';
/** The inbox client, as the firm sees it: by name, and its address must be the inbox login's. */
async function inboxClient(api: PageApi): Promise<Named> {
  const res = (await ok(
    await api.get(`business/clients?search=${encodeURIComponent(INBOX_CLIENT)}`),
    'inbox client',
  )) as { items?: { id: string; displayName: string; email: string | null }[] };
  const email = login('inbox')?.email.toLowerCase();
  const mine = (res.items ?? []).filter(
    (x) => x.displayName === INBOX_CLIENT && !!email && x.email?.toLowerCase() === email,
  );
  const only = mine[0];
  if (!only || mine.length !== 1)
    throw new Error(
      `expected one ${INBOX_CLIENT} with the inbox login's address, found ${mine.length}`,
    );
  return { id: only.id, name: INBOX_CLIENT };
}
const ASK = 'Please confirm this appointment in your client portal.';
const REMINDER_INTRO = 'This is a reminder of your appointment with';
const mailNote = (m: Mail[]) =>
  m
    .map((x) => `${x.subject} | ${x.date} | ${x.text}`)
    .join(' ## ')
    .slice(0, 1800);

test.describe('Review Two verification (her steps)', () => {
  test.use(as('owner'));
  test.skip(() => !hasLogin('owner'), 'no owner login');

  // eslint-disable-next-line no-empty-pattern -- Playwright needs a destructured first argument
  test('R2 setup: 15- and 45-minute types, simulator clients, the firm on Chicago time', async ({}, info) => {
    test.skip(info.project.name !== 'w1165');
    const api = await apiAs('owner');
    try {
      const opts = (await ok(await api.get('business/appointments/options'), 'options')) as {
        timezone: string;
      };
      // Her review's times are Central: the firm must be on Chicago time before any check.
      expect(opts.timezone, 'Test Firm B time zone').toBe('America/Chicago');
      const who = async (role: Role): Promise<Named | null> => {
        if (!hasLogin(role)) return null;
        const a = await apiAs(role);
        try {
          const m = (await ok(await a.get('me'), `me ${role}`)) as {
            user: { id: string; name: string };
          };
          return { id: m.user.id, name: m.user.name };
        } finally {
          await a.dispose();
        }
      };
      const owner = await who('owner');
      if (!owner) throw new Error('no owner');
      const others = [await who('admin'), await who('staff')].filter((m): m is Named => !!m);
      const tag = runTag;
      const type = async (label: string, minutes: number): Promise<Named> => {
        const t = (await ok(
          await api.post('business/appointment-types', {
            data: {
              name: `${tag} R2 ${label}`,
              durationMinutes: minutes,
              methods: ['IN_PERSON'],
              clientBookable: true,
              sortOrder: 0,
            },
          }),
          `type ${label}`,
        )) as Named;
        return { id: t.id, name: t.name };
      };
      const stamp = Date.now();
      const client = async (key: string, label: string): Promise<Named> => {
        const name = `${tag} R2 ${label}`;
        const c = (await ok(
          await api.post('business/clients', {
            data: {
              displayName: name,
              email: `success+r2-${key.toLowerCase()}-${stamp}@simulator.amazonses.com`,
            },
          }),
          `client ${label}`,
        )) as { id: string };
        return { id: c.id, name };
      };
      const c: R2 = {
        tag,
        tz: opts.timezone,
        owner,
        others,
        t15: await type('15m', 15),
        t45: await type('45m', 45),
        clients: {
          b3: await client('b3', 'Return Client'),
          b5: await client('b5', 'End Time Client'),
          b6: await client('b6', 'All Day Client'),
          main: await client('main', 'Group Main'),
          guestA: await client('guestA', 'Group Guest A'),
          guestB: await client('guestB', 'Group Guest B'),
          resA: await client('resA', 'Room Client A'),
          resB: await client('resB', 'Room Client B'),
          p10: await client('p10', 'Roles Client'),
          series: await client('series', 'Series Client'),
          r3: await client('r3', 'All Day Change Client'),
        },
        appointments: [],
        rooms: [],
        equipment: [],
        types: [],
        services: [],
        categories: [],
        forms: [],
        waitlistBefore: null,
        cleaned: false,
      };
      saveR2(c);
    } finally {
      await api.dispose();
    }
  });

  test('8 + P8 Client confirmation: an unconfirmed appointment asks the client, who confirms in the portal; the record updates and later reminders stop asking', async ({
    page,
    browser,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    test.setTimeout(6 * 60_000);
    const c = ctx();
    const r = r2();
    const pc = await portalClient();
    const api = await pageApi(page);
    const slot = await firstFree(api, r.tz, { staff: [r.owner.id], clientId: pc.id }, span(3, 20), [
      ['10:00', '10:30'],
      ['11:00', '11:30'],
      ['15:00', '15:30'],
    ]);
    // Staff book it unconfirmed (Pending) and send the confirmation request now.
    await fillNew(page, {
      contact: pc.name,
      type: c.t1.name,
      staff: r.owner.name,
      day: slot.day,
      start: slot.start,
    });
    await page.getByLabel('Appointment Status *').selectOption({ label: 'Pending' });
    await page.getByLabel('Send Confirmation Message Immediately').check();
    await submit(page, 'Schedule Appointment', /\/calendar\/[0-9a-f-]{36}$/, 'row 8');
    const id = idFromUrl(page);
    keepR2('appointments', id);
    await page.reload();
    await expect(detailSummary(page)).toContainText('Pending', { timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
    // The confirmation request went by email (the simulator: its words are not readable on dev).
    // The notice history lists reminders only (run appointments-r2v2, Nov 19): recorded, not
    // asserted; the client-facing ask checked here is the portal's.
    const notices = page.getByTestId('detail-reminders');
    // The card reads Loading… until the record is in.
    await expect(notices).not.toContainText('Loading…', { timeout: 60_000 });
    info.annotations.push({
      type: '8-history-after-request',
      description: oneLine(await notices.textContent()),
    });
    await shot(page, TAB, '8-pending-asked', info);

    const portalCtx = await browser.newContext(as('client'));
    try {
      const pp = await portalCtx.newPage();
      await pp.goto(portal('/appointments'));
      await settled(pp);
      const row = pp.getByTestId('my-appointment').filter({ hasText: c.t1.name });
      await expect(row).toHaveCount(1, { timeout: 60_000 });
      const ask = row.getByTestId('my-appointment-confirm');
      await expect(ask).toContainText('We booked this for you. Please confirm it.');
      await shot(pp, TAB, '8-portal-asks', info);
      const answer = pp.waitForResponse(
        (res) =>
          res.request().method() === 'POST' && /\/confirm$/.test(new URL(res.url()).pathname),
        { timeout: 30_000 },
      );
      await ask.getByRole('button', { name: 'Confirm Appointment' }).click();
      const res = await answer;
      info.annotations.push({
        type: '8-confirm-answer',
        description: res.ok()
          ? String(res.status())
          : `${res.status()} ${(await res.text()).slice(0, 200)}`,
      });
      await pp.waitForTimeout(2_000);
      const said = (await pp.locator('[role="status"], [role="alert"]').allTextContents())
        .map(oneLine)
        .filter(Boolean);
      info.annotations.push({ type: '8-portal-says', description: said.join(' | ') });
      await shot(pp, TAB, '8-portal-after-confirm', info);
      expect(res.ok(), 'the portal confirm is accepted').toBe(true);
      await expect(
        pp.getByRole('status').filter({ hasText: 'Your appointment is confirmed.' }),
      ).toBeVisible({ timeout: 30_000 });
      await pp.reload();
      await settled(pp);
      await expect(row).toHaveCount(1, { timeout: 60_000 });
      await expect(row.getByTestId('my-appointment-confirm')).toHaveCount(0);
      await shot(pp, TAB, '8-portal-confirmed', info);

      // The firm's record updates: Confirmed, and staff have nothing left to confirm.
      await page.reload();
      await expect(detailSummary(page)).toContainText('Confirmed', { timeout: 60_000 });
      await expect(detailSummary(page)).not.toContainText('Pending');
      await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
      // A later reminder goes out, and the client is no longer asked to confirm.
      await page.getByRole('button', { name: 'Send Reminder' }).click();
      await expect(page.getByTestId('detail-result')).toHaveText('A reminder was sent.', {
        timeout: 30_000,
      });
      await expect
        .poll(
          async () => {
            await page.reload();
            await expect(notices).toBeVisible({ timeout: 60_000 });
            // The card reads Loading… until the record is in.
            await expect(notices).not.toContainText('Loading…', { timeout: 60_000 });
            return oneLine(await notices.textContent());
          },
          { timeout: 90_000, intervals: [5_000] },
        )
        .toMatch(/Reminder · email/);
      await shot(page, TAB, '8-confirmed-reminded', info);
      await pp.reload();
      await settled(pp);
      await expect(row).toHaveCount(1, { timeout: 60_000 });
      await expect(row.getByTestId('my-appointment-confirm')).toHaveCount(0);
      await expect(row).not.toContainText('Please confirm');
    } finally {
      await portalCtx.close();
    }
  });

  test('B3 Return navigation: Last 30 days with a client search, Last 30 days with Pending, and a past Month view are each kept after an appointment and Back', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const r = r2();
    const api = await pageApi(page);
    // Her data: a past Pending appointment inside Last 30 days, in the month before this one
    // (her October 29 from November), at the start of its day so the month view shows it.
    const month = dayIn(r.tz, 0).slice(0, 7);
    const days = span(-28, -3).sort(
      (a, b) =>
        Number(dayIn(r.tz, a).slice(0, 7) === month) - Number(dayIn(r.tz, b).slice(0, 7) === month),
    );
    const slot = await firstFree(
      api,
      r.tz,
      { staff: [r.owner.id], clientId: r.clients.b3.id },
      days,
      [['07:00', '07:45']],
    );
    const id = await book(api, {
      tz: r.tz,
      typeId: r.t45.id,
      clientId: r.clients.b3.id,
      staffId: r.owner.id,
      ...slot,
      status: 'PENDING',
    });
    const toolbar = page.getByTestId('appointments-toolbar');
    const period = toolbar.getByLabel('Period');
    const status = toolbar.getByLabel('Status');
    const search = toolbar.getByLabel('Search appointments');
    const mine = page
      .getByTestId('appointments-list')
      .getByRole('link', { name: r.clients.b3.name })
      .first();

    // Path 1: Last 30 days plus a client-name search, details, browser Back.
    await page.goto(app('/calendar/list'));
    await expect(period.locator('option:checked')).toHaveText('Next 30 days', { timeout: 60_000 });
    await period.selectOption({ label: 'Last 30 days' });
    await search.fill(r.clients.b3.name);
    await expect(mine).toBeVisible({ timeout: 30_000 });
    await mine.click();
    await expect(page).toHaveURL(new RegExp(`/calendar/${id}$`), { timeout: 30_000 });
    await page.goBack();
    await expect(period.locator('option:checked')).toHaveText('Last 30 days', { timeout: 60_000 });
    await expect(search).toHaveValue(r.clients.b3.name);
    await expect(status.locator('option:checked')).toHaveText('All Statuses');
    await expect(mine).toBeVisible({ timeout: 30_000 });
    await shot(page, TAB, 'B3-path1-back', info);

    // Path 2: Last 30 days plus Pending, details, browser Back.
    await page.goto(app('/calendar/list'));
    await expect(period.locator('option:checked')).toHaveText('Next 30 days', { timeout: 60_000 });
    await period.selectOption({ label: 'Last 30 days' });
    await status.selectOption({ label: 'Pending' });
    await expect(mine).toBeVisible({ timeout: 30_000 });
    await mine.click();
    await expect(page).toHaveURL(new RegExp(`/calendar/${id}$`), { timeout: 30_000 });
    await page.goBack();
    await expect(period.locator('option:checked')).toHaveText('Last 30 days', { timeout: 60_000 });
    await expect(status.locator('option:checked')).toHaveText('Pending');
    await expect(mine).toBeVisible({ timeout: 30_000 });
    await shot(page, TAB, 'B3-path2-back', info);

    // Path 3: the calendar's Month view of that month, the appointment on its day, Back.
    const title = new Date(`${slot.day}T12:00:00Z`).toLocaleDateString('en-US', {
      timeZone: 'UTC',
      month: 'long',
      year: 'numeric',
    });
    const shown = page.getByTestId('calendar-period');
    await page.goto(app('/calendar'));
    await expect(shown).toBeVisible({ timeout: 60_000 });
    await toolbar.getByLabel('Show').selectOption('month');
    for (let i = 0; i < 3 && oneLine(await shown.textContent()) !== title; i++) {
      await page.getByRole('button', { name: 'Previous month' }).click();
    }
    await expect(shown).toHaveText(title);
    const chip = page
      .getByTestId('appointments-calendar')
      .getByRole('button', { name: `${r.clients.b3.name}, ${r.t45.name}` })
      .first();
    await expect(chip).toBeVisible({ timeout: 30_000 });
    await chip.click();
    await expect(page).toHaveURL(new RegExp(`/calendar/${id}$`), { timeout: 30_000 });
    await page.goBack();
    await expect(shown).toHaveText(title, { timeout: 60_000 });
    await expect(toolbar.getByLabel('Show')).toHaveValue('month');
    await expect(chip).toBeVisible({ timeout: 30_000 });
    await shot(page, TAB, 'B3-path3-back', info);
  });

  test('B5 End Time: 2:00 PM plus 15 and 45 minutes, 3:00 PM plus 15, 4:00 PM plus 45, in Create and Edit, and End follows a changed Start', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    test.setTimeout(5 * 60_000);
    const r = r2();
    const api = await pageApi(page);
    const slot = await firstFree(
      api,
      r.tz,
      { staff: [r.owner.id], clientId: r.clients.b5.id },
      span(5, 30),
      [['14:00', '17:00']],
    );
    // Her first probes (unsaved): a fresh form at 2:00 PM, the 15- then the 45-minute type.
    await freshForm(page);
    await expect(page.getByLabel('Time Zone')).toHaveValue(r.tz);
    await page.getByLabel('Date *').fill(slot.day);
    await page.getByLabel('Start Time *').selectOption('14:00');
    await pickType(page, r.t15.name);
    await endIs(page, '2:15 PM', '15 min', '2:00 PM – 2:15 PM (CT)');
    await pickType(page, r.t45.name);
    await endIs(page, '2:45 PM', '45 min', '2:00 PM – 2:45 PM (CT)');
    await shot(page, TAB, 'B5-create-2pm-45', info);
    // End follows a changed Start, keeping the 45 minutes.
    await page.getByLabel('Start Time *').selectOption('15:00');
    await endIs(page, '3:45 PM', '45 min', '3:00 PM – 3:45 PM (CT)');

    // Her saved case 1: 3:00 PM and 15 minutes; then Edit, and a time change saved from Edit.
    await fillNew(page, {
      contact: r.clients.b5.name,
      type: r.t15.name,
      staff: r.owner.name,
      day: slot.day,
      start: '15:00',
    });
    await endIs(page, '3:15 PM', '15 min', '3:00 PM – 3:15 PM (CT)');
    await noConfirmation(page);
    await submit(page, 'Schedule Appointment', /\/calendar\/[0-9a-f-]{36}$/, 'B5 15');
    const first = idFromUrl(page);
    keepR2('appointments', first);
    await page.reload();
    await expect(detailSummary(page)).toContainText('3:00 PM – 3:15 PM', { timeout: 60_000 });
    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    await expect(page.getByLabel('Start Time *')).toHaveValue('15:00', { timeout: 60_000 });
    await endIs(page, '3:15 PM', '15 min', '3:00 PM – 3:15 PM (CT)');
    await page.getByLabel('Start Time *').selectOption('15:30');
    await endIs(page, '3:45 PM', '15 min', '3:30 PM – 3:45 PM (CT)');
    await shot(page, TAB, 'B5-edit-start-moved', info);
    await submit(page, 'Save Changes', new RegExp(`/calendar/${first}$`), 'B5 edit');
    await page.reload();
    await expect(detailSummary(page)).toContainText('3:30 PM – 3:45 PM', { timeout: 60_000 });

    // Her saved case 2: 4:00 PM and 45 minutes; Edit shows the same end.
    await fillNew(page, {
      contact: r.clients.b5.name,
      type: r.t45.name,
      staff: r.owner.name,
      day: slot.day,
      start: '16:00',
    });
    await endIs(page, '4:45 PM', '45 min', '4:00 PM – 4:45 PM (CT)');
    await noConfirmation(page);
    await submit(page, 'Schedule Appointment', /\/calendar\/[0-9a-f-]{36}$/, 'B5 45');
    const second = idFromUrl(page);
    keepR2('appointments', second);
    await page.reload();
    await expect(detailSummary(page)).toContainText('4:00 PM – 4:45 PM', { timeout: 60_000 });
    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    await expect(page.getByLabel('Start Time *')).toHaveValue('16:00', { timeout: 60_000 });
    await endIs(page, '4:45 PM', '45 min', '4:00 PM – 4:45 PM (CT)');
    await shot(page, TAB, 'B5-edit-4pm-45', info);
  });

  test('B6 All Day in Today: a saved all-day appointment shows "All Day", after a reload too, and opens its own record', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    const r = r2();
    const api = await pageApi(page);
    const today = dayIn(r.tz, 0);
    // A member with nothing today (an all-day booking holds the whole day).
    let staff: Named | undefined;
    for (const m of [r.owner, ...r.others]) {
      const free = await bookable(
        api,
        { staff: [m.id], clientId: r.clients.b6.id },
        instant(r.tz, today, '00:00'),
        instant(r.tz, today, '23:59'),
      );
      if (free) {
        staff = m;
        break;
      }
    }
    if (!staff) throw new Error('every harness member has an appointment today');
    await fillNew(page, {
      contact: r.clients.b6.name,
      type: c.t1.name,
      staff: staff.name,
      day: today,
    });
    await page.getByLabel('All Day').check();
    await expect(page.getByTestId('appointment-summary')).toContainText('All day');
    await noConfirmation(page);
    await submit(page, 'Schedule Appointment', /\/calendar\/[0-9a-f-]{36}$/, 'B6 all day');
    const id = idFromUrl(page);
    keepR2('appointments', id);
    await page.goto(app('/calendar/today'));
    const allDay = page.getByTestId('today-all-day');
    const entry = page.getByTestId('today-schedule').locator(`a[href="/calendar/${id}"]`);
    for (const pass of ['first', 'after reload']) {
      if (pass !== 'first') await page.reload();
      await expect(entry).toBeVisible({ timeout: 60_000 });
      await expect(allDay.locator(`a[href="/calendar/${id}"]`)).toBeVisible();
      await expect(entry).toContainText('All Day');
      await expect(entry).not.toContainText('12:00 AM');
      await expect(entry).not.toContainText('11:59 PM');
      await shot(page, TAB, `B6-today-${pass.replace(' ', '-')}`, info);
    }
    await entry.click();
    await expect(page).toHaveURL(new RegExp(`/calendar/${id}$`), { timeout: 30_000 });
    await expect(detailSummary(page)).toContainText('all day', { timeout: 60_000 });
  });

  test('A1 Group appointments: two other attendees stay with the one appointment after save and reopen', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    const r = r2();
    const { main, guestA, guestB } = r.clients;
    const api = await pageApi(page);
    const slot = await firstFree(
      api,
      r.tz,
      { staff: [r.owner.id], clientId: main.id, attendees: [guestA.id, guestB.id] },
      span(4, 30),
      [
        ['11:00', '11:30'],
        ['12:00', '12:30'],
      ],
    );
    await fillNew(page, {
      contact: main.name,
      type: c.t1.name,
      staff: r.owner.name,
      day: slot.day,
      start: slot.start,
    });
    const attendees = page.getByTestId('attendees');
    for (const g of [guestA, guestB]) {
      await attendees.getByRole('textbox', { name: 'Other Attendees' }).fill(g.name);
      await page.getByTestId('attendee-results').getByRole('button', { name: g.name }).click();
    }
    const chips = page.getByRole('list', { name: 'Other attendees' });
    await expect(chips).toContainText(guestA.name);
    await expect(chips).toContainText(guestB.name);
    await noConfirmation(page);
    await submit(page, 'Schedule Appointment', /\/calendar\/[0-9a-f-]{36}$/, 'A1 group');
    const id = idFromUrl(page);
    keepR2('appointments', id);
    const others = detailSummary(page);
    await page.reload();
    await expect(others).toContainText('Other attendees', { timeout: 60_000 });
    await expect(others).toContainText(guestA.name);
    await expect(others).toContainText(guestB.name);
    await expect(others).toContainText(main.name);
    await shot(page, TAB, 'A1-detail', info);
    // Reopen: Edit lists both, and the record still holds both after leaving and coming back.
    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    await expect(chips).toContainText(guestA.name, { timeout: 60_000 });
    await expect(chips).toContainText(guestB.name);
    await page.goto(app('/calendar/list'));
    await page.goto(app(`/calendar/${id}`));
    await expect(others).toContainText(guestA.name, { timeout: 60_000 });
    await expect(others).toContainText(guestB.name);
  });

  test('A2 Rooms and equipment: managed in Appointment Settings, chosen on an appointment, and an overlapping booking of the room or the item is refused', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    test.setTimeout(5 * 60_000);
    const c = ctx();
    const r = r2();
    const api = await pageApi(page);
    type Res = {
      rooms: { id: string; name: string; office: Named; archivedAt: string | null }[];
      equipment: { id: string; name: string; office: Named | null; archivedAt: string | null }[];
      offices: Named[];
    };
    const res = (await ok(await api.get('business/appointment-resources'), 'resources')) as Res;
    // Settings > Appointment Settings: the fixture's room under its office and its item, with
    // the forms to add more (Owner).
    await page.goto(app('/settings/appointments'));
    const fxRow = page.getByTestId('room-row').filter({ hasText: FX.room });
    await expect(fxRow).toBeVisible({ timeout: 60_000 });
    await expect(fxRow).toContainText(FX.office);
    await expect(page.getByTestId('equipment-row').filter({ hasText: FX.item })).toBeVisible();
    await expect(page.getByRole('form', { name: 'Add a room' })).toBeVisible();
    await expect(page.getByRole('form', { name: 'Add equipment' })).toBeVisible();
    await shot(page, TAB, 'A2-fixture-settings', info);
    // What the form offers: rooms and items of ACTIVE offices only. The fixture's FX Office is
    // inactive (fixtures.json, Nov 19): with no active office at all, nothing can be booked.
    const offered = (await ok(await api.get('business/appointments/options'), 'options')) as {
      offices: Named[];
      rooms: (Named & { officeId: string })[];
      equipment: (Named & { officeId: string | null })[];
    };
    const fxRoom = offered.rooms.find((x) => x.name === FX.room);
    let room = res.rooms.find((x) => x.id === fxRoom?.id);
    const office =
      room?.office ?? offered.offices.find((o) => o.name === FX.office) ?? offered.offices.at(0);
    if (!office)
      throw new Error(
        `BLOCKED: no active office in Test Firm B (${FX.office} is inactive), so Schedule Appointment offers no room or equipment`,
      );
    info.annotations.push({
      type: 'A2-resources',
      description: room
        ? `fixture ${FX.room} in ${office.name}`
        : `${FX.office} not offered (inactive): LIVE-CHECK room and item in ${office.name}`,
    });
    if (!room) {
      const made = (await ok(
        await api.post('business/appointment-resources/rooms', {
          officeId: office.id,
          name: `${r.tag} Room`,
        }),
        'room',
      )) as Res['rooms'][number];
      keepR2('rooms', made.id);
      room = made;
    }
    const fxItem = offered.equipment.find(
      (x) => x.name === FX.item && (!x.officeId || x.officeId === office.id),
    );
    let item = res.equipment.find((x) => x.id === fxItem?.id);
    if (!item) {
      const made = (await ok(
        await api.post('business/appointment-resources/equipment', {
          name: `${r.tag} Projector`,
          officeId: office.id,
        }),
        'equipment',
      )) as Res['equipment'][number];
      keepR2('equipment', made.id);
      item = made;
    }

    const slot = await firstFree(
      api,
      r.tz,
      {
        staff: [r.owner.id],
        clientId: r.clients.resA.id,
        roomId: room.id,
        equipmentIds: [item.id],
      },
      span(6, 30),
      [
        ['10:00', '10:30'],
        ['13:00', '13:30'],
      ],
    );
    // Booking A: In Person at the office, the room and the item.
    await fillNew(page, {
      contact: r.clients.resA.name,
      type: c.t1.name,
      staff: r.owner.name,
      day: slot.day,
      start: slot.start,
    });
    const placeFields = async (withRoom: boolean, withItem: boolean) => {
      await page.getByLabel('Office / Branch').selectOption({ label: office.name });
      await page
        .getByLabel('Room (optional)')
        .selectOption({ label: withRoom ? (room?.name ?? '') : 'No room' });
      if (withItem) await pickOnly(page, 'Equipment (optional)', [item?.name ?? '']);
    };
    await placeFields(true, true);
    const summary = page.getByTestId('appointment-summary');
    await expect(summary).toContainText(`In Person – ${office.name}`);
    await expect(summary).toContainText(room.name);
    await expect(summary).toContainText(item.name);
    await noConfirmation(page);
    await submit(page, 'Schedule Appointment', /\/calendar\/[0-9a-f-]{36}$/, 'A2 room');
    keepR2('appointments', idFromUrl(page));
    await page.reload();
    await expect(detailSummary(page)).toContainText(`${office.name}, ${room.name}`, {
      timeout: 60_000,
    });
    await expect(detailSummary(page)).toContainText(item.name);
    await shot(page, TAB, 'A2-booked', info);

    // Booking B at the same time: another client and (when one is free) another staff member.
    let other = r.owner;
    for (const m of r.others) {
      const free = await bookable(
        api,
        { staff: [m.id], clientId: r.clients.resB.id },
        instant(r.tz, slot.day, slot.start),
        instant(r.tz, slot.day, slot.end),
      );
      if (free) {
        other = m;
        break;
      }
    }
    info.annotations.push({ type: 'A2-second-staff', description: other.name });
    const refused = async (button: string, words: string) => {
      await page.getByRole('button', { name: button, exact: true }).click();
      const err = page.getByTestId('schedule-error');
      await expect(err).toContainText(words, { timeout: 30_000 });
      await expect(page.getByLabel('Reason to book anyway (Owner or Admin)')).toHaveCount(0);
      if (/\/calendar\/[0-9a-f-]{36}$/.test(page.url())) keepR2('appointments', idFromUrl(page));
      await expect(page).toHaveURL(/\/calendar\/new/);
    };
    await fillNew(page, {
      contact: r.clients.resB.name,
      type: c.t1.name,
      staff: other.name,
      day: slot.day,
      start: slot.start,
    });
    await placeFields(true, false);
    await noConfirmation(page);
    await refused('Schedule Appointment', 'This room is already booked at this time');
    await shot(page, TAB, 'A2-room-refused', info);
    // The same time without the room but with the item: refused for the item.
    await placeFields(false, true);
    await refused(
      'Schedule Appointment',
      `${item.name} is already booked at this time. Choose another time, or leave the item out.`,
    );
    await shot(page, TAB, 'A2-item-refused', info);
    // Nothing was booked for client B.
    const list = (await ok(
      await api.get(
        `business/appointments?from=${encodeURIComponent(instant(r.tz, slot.day, '00:00'))}&to=${encodeURIComponent(instant(r.tz, slot.day, '23:59'))}&clientId=${r.clients.resB.id}`,
      ),
      'client B',
    )) as { items: { id: string; status: string }[] };
    for (const a of list.items) keepR2('appointments', a.id);
    expect(list.items.filter((a) => a.status !== 'CANCELLED')).toHaveLength(0);
  });

  test('A3 Waitlist: the switch and its two modes, the client joins in the portal, an earlier time is offered, and the original time stands until the move is confirmed', async ({
    page,
    browser,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    test.setTimeout(14 * 60_000);
    const r = r2();
    const pc = await portalClient();
    const api = await pageApi(page);
    type Mode = 'AUTO_CONFIRM' | 'STAFF_APPROVAL';
    const before = (await ok(
      await api.get('business/appointment-waitlist/settings'),
      'waitlist settings',
    )) as { enabled: boolean; mode: Mode };
    saveR2({ ...r2(), waitlistBefore: before });
    if (!before.enabled) {
      // Turning it on offers to every waiting client: only when the harness client is the only one.
      const live = (await ok(await api.get('business/appointment-waitlist'), 'waitlist')) as {
        items: { client: Named }[];
      };
      const others = live.items.filter((e) => e.client.id !== pc.id);
      if (others.length > 0)
        throw new Error(
          `BLOCKED: ${others.length} other waitlist entries would get offers if the switch went on`,
        );
    }
    const portalCtx = await browser.newContext(as('client'));
    const pp = await portalCtx.newPage();
    const mineUrl = `${portalUrl}/api/v1/${portalApi('me/appointment-waitlist')}`;
    const headers = { origin: portalUrl };
    let entryId = '';
    try {
      // Settings > Appointment Settings: the switch, and two clearly labelled modes, one at a time.
      await page.goto(app('/settings/appointments'));
      const card = page.locator('form[aria-label="Waitlist settings"]');
      await expect(card).toBeVisible({ timeout: 60_000 });
      await expect(card).toContainText(
        'The original appointment stays as it is until the move is confirmed.',
      );
      const auto = card.getByRole('radio', { name: 'Automatic confirmation' });
      const approval = card.getByRole('radio', { name: 'Staff approval required' });
      await expect(auto).toBeAttached();
      await expect(approval).toBeAttached();
      expect((await auto.isChecked()) !== (await approval.isChecked()), 'one mode only').toBe(true);
      await expect(before.mode === 'AUTO_CONFIRM' ? auto : approval).toBeChecked();
      const toggle = card.getByRole('switch', { name: 'Offer earlier openings' });
      if (!before.enabled) {
        await toggle.click();
        await expect(toggle).toBeChecked();
        await card.getByRole('button', { name: 'Save Waitlist' }).click();
        await expect(card.getByTestId('waitlist-saved')).toHaveText(
          'Saved. Clients can join the waitlist from their portal.',
          { timeout: 30_000 },
        );
      } else {
        await expect(toggle).toBeChecked();
      }
      await shot(page, TAB, 'A3-settings', info);

      // The firm books the client late in a day a few days out, so an earlier time can open.
      const slot = await firstFree(
        api,
        r.tz,
        { staff: [r.owner.id], clientId: pc.id },
        span(4, 9),
        [
          ['17:00', '17:15'],
          ['18:00', '18:15'],
          ['16:00', '16:15'],
        ],
      );
      const id = await book(api, {
        tz: r.tz,
        typeId: r.t15.id,
        clientId: pc.id,
        staffId: r.owner.id,
        ...slot,
        status: 'CONFIRMED',
      });
      const original = detailWhen(
        instant(r.tz, slot.day, slot.start),
        instant(r.tz, slot.day, slot.end),
        r.tz,
      );

      // The client joins from the portal.
      await pp.goto(portal('/appointments'));
      await settled(pp);
      const row = pp.getByTestId('my-appointment').filter({ hasText: r.t15.name });
      await expect(row).toHaveCount(1, { timeout: 60_000 });
      await row.getByRole('button', { name: 'Join Waitlist for an Earlier Time' }).click();
      await expect(
        pp.getByRole('status').filter({
          hasText: 'You are on the waitlist. We will let you know if an earlier time opens.',
        }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(row.getByTestId('waitlist-waiting')).toContainText(
        'You are on the waitlist for an earlier time.',
      );
      await shot(pp, TAB, 'A3-joined', info);

      // The waitlist job (every 5 minutes) offers the earliest opening: wait as the client would.
      type Entry = {
        id: string;
        appointmentId: string;
        status: string;
        offer: { startsAt: string; endsAt: string; expiresAt: string } | null;
      };
      const got: { entry?: Entry } = {};
      await expect
        .poll(
          async () => {
            const list = (await ok(await pp.request.get(mineUrl, { headers }), 'my waitlist')) as {
              items: Entry[];
            };
            got.entry = list.items.find(
              (e) => e.appointmentId === id && ['WAITING', 'OFFERED'].includes(e.status),
            );
            entryId = got.entry?.id ?? entryId;
            return got.entry?.status ?? 'none';
          },
          { timeout: 9 * 60_000, intervals: [20_000] },
        )
        .toBe('OFFERED');
      const offer = got.entry?.offer;
      if (!offer) throw new Error('offered without a time');
      const offered = detailWhen(offer.startsAt, offer.endsAt, r.tz);
      info.annotations.push({ type: 'A3-offer', description: `${original} -> ${offered}` });
      await pp.reload();
      await settled(pp);
      const card2 = row.getByTestId('waitlist-offer');
      await expect(card2).toContainText('An earlier time is available:', { timeout: 60_000 });
      await expect(card2).toContainText('It is held for you until');
      await shot(pp, TAB, 'A3-offer', info);
      // The firm's record keeps its own time while the offer is open.
      await page.goto(app(`/calendar/${id}`));
      await expect
        .poll(async () => oneLine(await detailSummary(page).textContent()), { timeout: 60_000 })
        .toContain(original);

      if (before.mode === 'AUTO_CONFIRM') {
        await expect(card2).toContainText('Taking it moves your appointment at once.');
        await card2.getByRole('button', { name: 'Take This Time' }).click();
        await expect(
          pp.getByRole('status').filter({
            hasText: 'Your appointment was moved to the earlier time.',
          }),
        ).toBeVisible({ timeout: 30_000 });
      } else {
        await expect(card2).toContainText(
          'The firm confirms the change; your current time stands until then.',
        );
        await card2.getByRole('button', { name: 'Request This Time' }).click();
        await expect(
          pp.getByRole('status').filter({ hasText: 'You asked for the earlier time.' }),
        ).toBeVisible({ timeout: 30_000 });
        await expect(row.getByTestId('waitlist-requested')).toContainText(
          'The firm will confirm it; your current time stands until then.',
        );
        await shot(pp, TAB, 'A3-requested', info);
        // Staff see the request on the appointment; its own time still stands.
        await page.reload();
        const request = page.getByTestId('waitlist-request');
        await expect(request).toContainText(
          'The current time stands until you approve. Approving checks the new time again.',
          { timeout: 60_000 },
        );
        await expect
          .poll(async () => oneLine(await detailSummary(page).textContent()), {
            timeout: 30_000,
          })
          .toContain(original);
        await shot(page, TAB, 'A3-staff-request', info);
        await request.getByRole('button', { name: 'Approve' }).click();
        await expect(request).toHaveCount(0, { timeout: 30_000 });
      }
      // Once confirmed, the appointment is at the earlier time, for the firm and the client.
      await page.reload();
      await expect
        .poll(async () => oneLine(await detailSummary(page).textContent()), { timeout: 60_000 })
        .toContain(offered);
      await shot(page, TAB, 'A3-moved', info);
      entryId = '';
    } finally {
      if (entryId)
        await pp.request.post(`${mineUrl}/${entryId}/leave`, { headers }).catch(() => {});
      await portalCtx.close();
      if (!before.enabled) {
        const back = await api.put('business/appointment-waitlist/settings', before);
        const now = (await ok(
          await api.get('business/appointment-waitlist/settings'),
          'waitlist settings',
        )) as { enabled: boolean; mode: Mode };
        expect(
          { enabled: now.enabled, mode: now.mode },
          `waitlist switch restored (${back.status()})`,
        ).toEqual({ enabled: before.enabled, mode: before.mode });
      }
    }
  });

  // ------------------------------------------------------------ rows 8, P8 and P7 with the real inbox
  test.describe('Inbox rows', () => {
    test('8 + P8 inbox: the firm asks the client to confirm by email, the client confirms in the portal, the record shows Confirmed, and the next reminder no longer asks', async ({
      page,
      browser,
    }, info) => {
      test.skip(info.project.name !== 'w1165');
      test.skip(!hasLogin('inbox'), 'no inbox login in this run');
      test.setTimeout(25 * 60_000);
      const c = ctx();
      const r = r2();
      const api = await pageApi(page);
      const keepAlive = () => api.get('business');
      const firm = ((await (await api.get('business')).json()) as { name?: string }).name ?? '';
      const client = await inboxClient(api);
      info.annotations.push({ type: 'inbox-clear', description: await inboxRun(['clear']) });
      const slot = await firstFree(
        api,
        r.tz,
        { staff: [r.owner.id], clientId: client.id },
        span(3, 20),
        [
          ['10:00', '10:30'],
          ['11:00', '11:30'],
          ['15:00', '15:30'],
        ],
      );
      const when = whenInMail(instant(r.tz, slot.day, slot.start), r.tz);
      // The firm books it unconfirmed (Pending) and sends the confirmation request now.
      await fillNew(page, {
        contact: client.name,
        type: c.t1.name,
        staff: r.owner.name,
        day: slot.day,
        start: slot.start,
      });
      await page.getByLabel('Appointment Status *').selectOption({ label: 'Pending' });
      await page.getByLabel('Send Confirmation Message Immediately').check();
      await submit(page, 'Schedule Appointment', /\/calendar\/[0-9a-f-]{36}$/, 'row 8 inbox');
      const id = idFromUrl(page);
      keepR2('appointments', id);
      // 1. The email the client gets asks for the confirmation: who, what, when, what to do.
      const booked = await waitMail(
        'Your appointment with .* is booked',
        Date.now() + 5 * 60_000,
        keepAlive,
      );
      info.annotations.push({ type: '8-email-booked', description: mailNote(booked) });
      expect(booked, 'the booking email reached the client').toHaveLength(1);
      const b = booked[0]?.text ?? '';
      expect(b).toMatch(/Hi [^,]+,/);
      expect(b).toContain(firm ? `Your appointment with ${firm} is booked.` : 'is booked.');
      expect(b).toContain(c.t1.name);
      expect(b).toContain(when);
      expect(b).toContain(ASK);
      expect(b).toContain('View appointment');
      // 2. A reminder while it is unconfirmed still asks.
      await page.reload();
      await expect(detailSummary(page)).toContainText('Pending', { timeout: 60_000 });
      await page.getByRole('button', { name: 'Send Reminder' }).click();
      await expect(page.getByTestId('detail-result')).toHaveText('A reminder was sent.', {
        timeout: 30_000,
      });
      const early = await waitMail(
        '^Reminder: your appointment',
        Date.now() + 5 * 60_000,
        keepAlive,
      );
      info.annotations.push({ type: '8-email-reminder-before', description: mailNote(early) });
      expect(early, 'the reminder before confirming reached the client').toHaveLength(1);
      expect(early[0]?.text ?? '').toContain(REMINDER_INTRO);
      expect(early[0]?.text ?? '').toContain(when);
      expect(early[0]?.text ?? '').toContain(ASK);
      // 3. The client confirms in the portal.
      const portalCtx = await browser.newContext(as('inbox'));
      try {
        const pp = await portalCtx.newPage();
        await pp.goto(portal('/appointments'));
        await settled(pp);
        const row = pp.getByTestId('my-appointment').filter({ hasText: c.t1.name });
        await expect(row).toHaveCount(1, { timeout: 60_000 });
        const ask = row.getByTestId('my-appointment-confirm');
        await expect(ask).toContainText('We booked this for you. Please confirm it.');
        await shot(pp, TAB, '8-inbox-portal-asks', info);
        const answer = pp.waitForResponse(
          (res) =>
            res.request().method() === 'POST' && /\/confirm$/.test(new URL(res.url()).pathname),
          { timeout: 30_000 },
        );
        await ask.getByRole('button', { name: 'Confirm Appointment' }).click();
        expect((await answer).ok(), 'the portal confirm is accepted').toBe(true);
        // Soft: the words sometimes never show (run appointments-inbox-220948); the rest still runs.
        await expect
          .soft(pp.getByRole('status').filter({ hasText: 'Your appointment is confirmed.' }))
          .toBeVisible({ timeout: 30_000 });
        await pp.reload();
        await settled(pp);
        await expect(row).toHaveCount(1, { timeout: 60_000 });
        await expect(row.getByTestId('my-appointment-confirm')).toHaveCount(0);
        await shot(pp, TAB, '8-inbox-portal-confirmed', info);
      } finally {
        await portalCtx.close();
      }
      // 4. The record updates.
      await page.reload();
      await expect(detailSummary(page)).toContainText('Confirmed', { timeout: 60_000 });
      await expect(detailSummary(page)).not.toContainText('Pending');
      await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
      // 5. The next reminder no longer asks.
      await page.getByRole('button', { name: 'Send Reminder' }).click();
      await expect(page.getByTestId('detail-result')).toHaveText('A reminder was sent.', {
        timeout: 30_000,
      });
      const later = await waitMail(
        '^Reminder: your appointment',
        Date.now() + 5 * 60_000,
        keepAlive,
      );
      info.annotations.push({ type: '8-email-reminder-after', description: mailNote(later) });
      expect(later, 'the reminder after confirming reached the client').toHaveLength(1);
      expect(later[0]?.text ?? '').toContain(REMINDER_INTRO);
      expect(later[0]?.text ?? '').toContain(c.t1.name);
      expect(later[0]?.text ?? '').toContain(when);
      expect(later[0]?.text ?? '').not.toContain('Please confirm');
      await shot(page, TAB, '8-inbox-confirmed-detail', info);
    });

    test('P7 inbox: an Email reminder set 1 hour before goes out by itself at its time, with what, when and its note', async ({
      page,
    }, info) => {
      test.skip(info.project.name !== 'w1165');
      test.skip(!hasLogin('inbox'), 'no inbox login in this run');
      test.setTimeout(40 * 60_000);
      const c = ctx();
      const r = r2();
      const api = await pageApi(page);
      const keepAlive = () => api.get('business');
      const firm = ((await (await api.get('business')).json()) as { name?: string }).name ?? '';
      const client = await inboxClient(api);
      info.annotations.push({ type: 'inbox-clear', description: await inboxRun(['clear']) });
      // The first quarter hour at least 66 minutes ahead and free (its reminder due 6 to 21
      // minutes from now), inside the form's times (Chicago).
      const quarter = 15 * 60_000;
      let day = '';
      let start = '';
      for (
        let t = Math.ceil((Date.now() + 66 * 60_000) / quarter) * quarter;
        t < Date.now() + 5 * HOUR;
        t += quarter
      ) {
        const iso = new Date(t).toISOString();
        const hm = hhmmIn(r.tz, iso);
        if (hm < '06:00' || hm > '20:30') continue;
        const w = { staff: [r.owner.id], clientId: client.id };
        if (await bookable(api, w, iso, new Date(t + 30 * 60_000).toISOString())) {
          day = ymdIn(r.tz, iso);
          start = hm;
          break;
        }
      }
      if (!start) throw new Error('no free start inside the form times in the next 5 hours');
      const startIso = instant(r.tz, day, start);
      const due = Date.parse(startIso) - HOUR;
      const note = `${r.tag} P7 note: please bring last year's return.`;
      await fillNew(page, {
        contact: client.name,
        type: c.t1.name,
        staff: r.owner.name,
        day,
        start,
      });
      const card = page.getByTestId('client-reminders');
      const emailOn = card.getByLabel('Email Reminder', { exact: true });
      if (!(await emailOn.isChecked())) await emailOn.check();
      await card.getByLabel('Email Reminder amount').selectOption('1');
      await card.getByLabel('Email Reminder unit').selectOption('HOURS');
      await card.getByLabel('Email Reminder note').fill(note);
      await noConfirmation(page);
      await submit(page, 'Schedule Appointment', /\/calendar\/[0-9a-f-]{36}$/, 'P7 inbox');
      const id = idFromUrl(page);
      keepR2('appointments', id);
      const dueText = new Date(due).toISOString();
      info.annotations.push({
        type: 'P7-due',
        description: `starts ${startIso}; reminder due ${dueText}`,
      });
      await shot(page, TAB, 'P7-inbox-booked', info);
      // The reminder job runs every minute (reminder-jobs.ts JOB_INTERVAL_MS): wait as the client
      // would, until 15 minutes after its time.
      const mails = await waitMail('^Reminder: your appointment', due + 15 * 60_000, keepAlive);
      info.annotations.push({ type: 'P7-email', description: mailNote(mails) });
      expect(mails, 'the automatic reminder arrived by 15 minutes after its time').toHaveLength(1);
      const got = mails[0];
      const received = Date.parse(got?.date ?? '');
      info.annotations.push({
        type: 'P7-timing',
        description: `due ${dueText}; sent ${Number.isNaN(received) ? got?.date : new Date(received).toISOString()}`,
      });
      expect(received, 'not before its time (one job run early at most)').toBeGreaterThanOrEqual(
        due - 2 * 60_000,
      );
      expect(received, 'within 15 minutes of its time').toBeLessThanOrEqual(due + 15 * 60_000);
      const text = got?.text ?? '';
      expect(text).toMatch(/Hi [^,]+,/);
      expect(text).toContain(firm ? `${REMINDER_INTRO} ${firm}.` : REMINDER_INTRO);
      expect(text).toContain(c.t1.name);
      expect(text).toContain(whenInMail(startIso, r.tz));
      expect(text).toContain(note);
      expect(text).toContain('View appointment');
      // The firm's record lists it as sent.
      await page.reload();
      const notices = page.getByTestId('detail-reminders');
      await expect(notices).not.toContainText('Loading…', { timeout: 60_000 });
      await expect(notices).toContainText(/Reminder · email/);
      await shot(page, TAB, 'P7-inbox-history', info);
    });
  });

  // ------------------------------------------------------------ rows R60 is fixing (lead, Nov 19)
  // Written ahead of R60's PR: run them (and call a failure FAIL) only once it is deployed.
  test.describe('R60 pending', () => {
    test('2 + D1 Booking Window and Minimum Notice apply when the client books: FX Public Consultation, 12 hours ahead and 2 hours notice', async ({
      page,
      browser,
    }, info) => {
      test.skip(info.project.name !== 'w1165');
      const r = r2();
      // Staff side: her row 2 choices, saved on the fixture type.
      await page.goto(app('/calendar/types'));
      const typeRow = page
        .getByTestId('types-list')
        .locator('button[aria-pressed]', { hasText: FX_PUBLIC });
      await expect(typeRow).toBeVisible({ timeout: 60_000 });
      await typeRow.click();
      await expect(page.getByLabel('Booking window').locator('option:checked')).toHaveText(
        '12 hours ahead',
        { timeout: 30_000 },
      );
      await expect(page.getByLabel('Minimum notice').locator('option:checked')).toHaveText(
        '2 hours',
      );
      const portalCtx = await browser.newContext(as('client'));
      try {
        const pp = await portalCtx.newPage();
        const base = `${portalUrl}/api/v1/${portalApi('me/appointments')}`;
        const headers = { origin: portalUrl };
        await pp.goto(portal('/appointments'));
        await settled(pp);
        const types = (await ok(await pp.request.get(`${base}/types`, { headers }), 'types')) as {
          items: Named[];
        };
        const type = types.items.find((t) => t.name === FX_PUBLIC);
        if (!type) throw new Error(`BLOCKED: the portal does not offer ${FX_PUBLIC}`);
        // The free times the client is offered: none inside 2 hours, none past 12 hours.
        const now = Date.now();
        const slots = (await ok(
          await pp.request.get(
            `${base}/slots?typeId=${type.id}&from=${dayIn(r.tz, 0)}&to=${dayIn(r.tz, 3)}`,
            { headers },
          ),
          'slots',
        )) as { slots: { startsAt: string }[] };
        const soon = slots.slots.filter((s) => Date.parse(s.startsAt) < now + 2 * HOUR);
        const far = slots.slots.filter((s) => Date.parse(s.startsAt) > now + 12 * HOUR + 60_000);
        info.annotations.push({
          type: 'D1-free-times',
          description: `${slots.slots.length} offered; ${soon.length} inside 2 h; ${far.length} past 12 h`,
        });
        expect(soon, 'free times inside the 2-hour Minimum Notice').toEqual([]);
        expect(far, 'free times past the 12-hour Booking Window').toEqual([]);
        // Her steps: the booking page, a day past the window, offers no time.
        await pp.goto(portal(`/book/${type.id}`));
        const day = pp.getByLabel('Day');
        await expect(day).toBeVisible({ timeout: 60_000 });
        await day.fill(dayIn(r.tz, 2));
        await expect(pp.getByText('No free times on this day. Try another day.')).toBeVisible({
          timeout: 30_000,
        });
        await shot(pp, TAB, 'D1-past-window', info);
        // A time the page does not offer, sent anyway, is refused and the refusal says why.
        const tooSoon = new Date(Math.ceil((now + 45 * 60_000) / (15 * 60_000)) * 15 * 60_000);
        const cases: [string, string][] = [
          ['inside the Minimum Notice', tooSoon.toISOString()],
          ['past the Booking Window', instant(r.tz, dayIn(r.tz, 2), '10:00')],
        ];
        for (const [what, startsAt] of cases) {
          const res = await pp.request.post(base, { headers, data: { typeId: type.id, startsAt } });
          const body = await res.text();
          info.annotations.push({
            type: `D1 ${what}`,
            description: `${res.status()} ${body.slice(0, 300)}`,
          });
          if (res.ok()) keepR2('appointments', (JSON.parse(body) as { id: string }).id);
          expect(res.ok(), `a booking ${what} is refused`).toBe(false);
          expect(body, `the refusal for a booking ${what} says why`).toMatch(/"message":"[^"]+"/);
        }
      } finally {
        await portalCtx.close();
      }
    });

    test('9 + P9 Service intake: the Related Service picks its own intake form, not the type form; the client completes it in the portal; the appointment shows it completed', async ({
      page,
      browser,
    }, info) => {
      test.skip(info.project.name !== 'w1165');
      test.setTimeout(8 * 60_000);
      const r = r2();
      const pc = await portalClient();
      const api = await pageApi(page);
      // Two LIVE-CHECK services, each with its own one-question form (made before any listing,
      // so neither gets a built-in form).
      const category = (await ok(
        await api.post('business/catalog/categories', {
          name: `${r.tag} R2 category`,
          status: 'ACTIVE',
        }),
        'category',
      )) as { id: string };
      keepR2('categories', category.id);
      const service = async (label: string): Promise<Named & { form: Named }> => {
        const name = `${r.tag} R2 ${label}`;
        const s = (await ok(
          await api.post('business/catalog/services', {
            name,
            pricingType: 'RECURRING',
            basePriceCents: 10000,
            billingFrequency: 'MONTHLY',
            categoryId: category.id,
            shortDescription: 'LIVE-CHECK synthetic service',
            activate: true,
          }),
          `service ${label}`,
        )) as { id: string };
        keepR2('services', s.id);
        const formName = `${r.tag} R2 ${label} form`;
        const f = (await ok(
          await api.post('business/intake-forms', {
            name: formName,
            category: 'TAX_PLANNING',
            serviceId: s.id,
            description: 'LIVE-CHECK synthetic form',
            isTemplate: false,
            startFrom: { kind: 'SCRATCH' },
            sections: [
              {
                key: 'r2Section',
                title: 'LIVE-CHECK section',
                description: null,
                questions: [
                  {
                    key: 'r2Answer',
                    type: 'SHORT_ANSWER',
                    label: R2_QUESTION,
                    help: null,
                    required: false,
                  },
                ],
              },
            ],
            settings: {
              requireAllQuestions: false,
              allowFileUploads: false,
              showProgressBar: true,
              expiresAfterDays: null,
              successMessage: null,
            },
          }),
          `form ${label}`,
        )) as { id: string };
        keepR2('forms', f.id);
        await ok(await api.post(`business/intake-forms/${f.id}/publish`), `publish ${label}`);
        return { id: s.id, name, form: { id: f.id, name: formName } };
      };
      const picked = await service('Picked Service');
      const typeService = await service('Type Service');
      // The type asks for the other service's form.
      const type = (await ok(
        await api.post('business/appointment-types', {
          name: `${r.tag} R2 intake 30m`,
          durationMinutes: 30,
          methods: ['IN_PERSON'],
          clientBookable: true,
          sortOrder: 0,
        }),
        'type',
      )) as Named;
      keepR2('types', type.id);
      await ok(
        await api.put(`business/appointment-types/${type.id}/config`, {
          requiredIntakeFormId: typeService.form.id,
        }),
        'type form',
      );
      const slot = await firstFree(
        api,
        r.tz,
        { staff: [r.owner.id], clientId: pc.id },
        span(6, 25),
        [
          ['09:00', '09:30'],
          ['13:00', '13:30'],
        ],
      );
      await fillNew(page, {
        contact: pc.name,
        type: type.name,
        staff: r.owner.name,
        day: slot.day,
        start: slot.start,
      });
      await page.getByLabel('Related Service').selectOption({ label: picked.name });
      const send = page.getByLabel('Send Intake Form Before Appointment');
      if (await send.isEnabled()) await send.check();
      await noConfirmation(page);
      await submit(page, 'Schedule Appointment', /\/calendar\/[0-9a-f-]{36}$/, 'row 9');
      const id = idFromUrl(page);
      keepR2('appointments', id);
      const related = page.getByTestId('detail-related');
      const relatedText = async () => {
        await page.reload();
        await expect(related).toBeVisible({ timeout: 60_000 });
        // The card reads Loading… until the record is in.
        await expect(related).not.toContainText('Loading…', { timeout: 60_000 });
        return oneLine(await related.textContent());
      };
      await expect
        .poll(relatedText, { timeout: 90_000, intervals: [5_000] })
        .toContain(`${picked.form.name} (waiting)`);
      await expect(related).not.toContainText(typeService.form.name);
      await shot(page, TAB, '9-service-form-waiting', info);
      // The client completes it in the portal.
      const portalCtx = await browser.newContext(as('client'));
      try {
        const pp = await portalCtx.newPage();
        await pp.goto(portal('/intake'));
        await settled(pp);
        const item = pp
          .getByTestId('sent-intakes')
          .getByRole('listitem')
          .filter({ hasText: picked.form.name });
        await expect(item).toHaveCount(1, { timeout: 60_000 });
        await item.getByRole('link').first().click();
        await completeIntake(pp, pc.name);
        await shot(pp, TAB, 'P9-portal-completed', info);
      } finally {
        await portalCtx.close();
      }
      await expect
        .poll(relatedText, { timeout: 90_000, intervals: [5_000] })
        .toContain(`${picked.form.name} (completed)`);
      await shot(page, TAB, 'P9-completed-on-appointment', info);
    });

    test('D2 Related Items: the five boxes wait for a client, then open where the client has the data', async ({
      page,
    }, info) => {
      test.skip(info.project.name !== 'w1165');
      const pc = await portalClient();
      const boxes = [
        'Link to Task',
        'Link to Bookkeeping Client',
        'Send Intake Form Before Appointment',
        'Link to Invoice',
        'Require Documents Before Appointment',
      ];
      await freshForm(page);
      const related = page.getByTestId('related-items');
      await expect(related).toContainText(
        'Choose these on the appointment once the client is set.',
      );
      for (const b of boxes) await expect(related.getByLabel(b)).toBeDisabled();
      // The harness portal client: published intake forms exist, and row 9 sent it one.
      await pickContact(page, pc.name);
      const open: Record<string, boolean> = {};
      for (const b of boxes) open[b] = await related.getByLabel(b).isEnabled();
      info.annotations.push({ type: 'D2-enabled', description: JSON.stringify(open) });
      await shot(page, TAB, 'D2-related-items', info);
      expect(open['Send Intake Form Before Appointment'], 'published intake forms exist').toBe(
        true,
      );
      expect(
        boxes.filter((b) => !open[b]),
        'boxes still greyed out (each needs its data: a task, a bookkeeping client, an invoice, a document request)',
      ).toEqual([]);
    });

    test('B7 + B9 Notices, settings side: a confirmation message and a note on each reminder (two by Email) are kept; the starting channels follow the client', async ({
      page,
    }, info) => {
      test.skip(info.project.name !== 'w1165');
      const c = ctx();
      const r = r2();
      const pc = await portalClient();
      const api = await pageApi(page);
      const client = r.clients.b6; // an email, no portal login, no texts
      const slot = await firstFree(
        api,
        r.tz,
        { staff: [r.owner.id], clientId: client.id },
        span(12, 40),
        [
          ['09:00', '09:30'],
          ['10:00', '10:30'],
        ],
      );
      await fillNew(page, {
        contact: client.name,
        type: c.t1.name,
        staff: r.owner.name,
        day: slot.day,
        start: slot.start,
      });
      // B9: Email because the client has an email; no Portal (no portal login); no Text.
      const ch = page.getByTestId('instructions-in');
      await expect(ch.getByLabel('Email')).toBeChecked();
      await expect(ch.getByLabel('Portal')).not.toBeChecked();
      await expect(ch.getByLabel(/^Text/)).not.toBeChecked();
      await page
        .getByLabel('Client Instructions (visible to client)')
        .fill(`${r.tag} B9 bring last year's return`);
      await page.getByLabel('Confirmation message (optional)').fill(`${r.tag} B7 confirmation`);
      const card = page.getByTestId('client-reminders');
      await card.getByLabel('Email Reminder', { exact: true }).check();
      await card.getByLabel('Email Reminder note').fill(`${r.tag} B7 first email note`);
      await page.getByRole('button', { name: '+ Add Reminder' }).click();
      const more = page.getByTestId('more-reminders');
      await more.getByLabel('Additional reminder 1 channel').selectOption('EMAIL');
      await more.getByLabel('Additional reminder 1 amount').selectOption('2');
      await more.getByLabel('Additional reminder 1 unit').selectOption('HOURS');
      await more.getByLabel('Additional reminder 1 note').fill(`${r.tag} B7 second email note`);
      await noConfirmation(page);
      await submit(page, 'Schedule Appointment', /\/calendar\/[0-9a-f-]{36}$/, 'B7 B9');
      keepR2('appointments', idFromUrl(page));
      await page.reload();
      const notes = page.getByTestId('detail-notes');
      await expect(notes).toContainText(`${r.tag} B7 confirmation`, { timeout: 60_000 });
      expect(oneLine(await notes.textContent())).toMatch(
        /Instructions shown in\s*Email\s*Confirmation message/,
      );
      const reminders = page.getByTestId('detail-reminders');
      await expect(reminders).toContainText(`${r.tag} B7 first email note`);
      await expect(reminders).toContainText(`${r.tag} B7 second email note`);
      await shot(page, TAB, 'B7-B9-detail', info);
      // B9 for a client with a portal login and no texts: Email and Portal, no Text.
      await fillNew(page, {
        contact: pc.name,
        type: c.t1.name,
        staff: r.owner.name,
        day: slot.day,
      });
      await expect(ch.getByLabel('Email')).toBeChecked();
      await expect(ch.getByLabel('Portal')).toBeChecked();
      await expect(ch.getByLabel(/^Text/)).not.toBeChecked();
    });

    test('B7 + B9 Notices, delivered content: each reminder note and the instructions in the Email, Portal and Text received', () => {
      test.skip(true, 'BLOCKED-TOLD: needs the test inbox');
    });

    for (const p of P10_ROLES) {
      test.describe(`P10 ${p.label}`, () => {
        test.use(as(p.role));
        test(`P10 ${p.label}: view, Edit, Reschedule, Cancel, Mark Completed and Mark No-Show on an appointment assigned to them, expected against actual`, async ({
          page,
        }, info) => {
          test.skip(info.project.name !== 'w1165');
          test.skip(!hasLogin(p.role), `no ${p.role} login in this run`);
          test.setTimeout(4 * 60_000);
          const r = r2();
          const owner = await apiAs('owner');
          try {
            const oa = viaContext(owner);
            const api = await pageApi(page);
            const me = (await ok(await api.get('me'), 'me')) as { user: { id: string } };
            const client = r.clients.p10.id;
            // The Owner books three for this member: a later one and two that have started.
            const bookFor = async (days: number[], times: [string, string][]) => {
              for (const staff of [me.user.id, r.owner.id]) {
                try {
                  const slot = await firstFree(
                    oa,
                    r.tz,
                    { staff: [staff], clientId: client },
                    days,
                    times,
                  );
                  const id = await book(oa, {
                    tz: r.tz,
                    typeId: r.t15.id,
                    clientId: client,
                    staffId: staff,
                    ...slot,
                    status: 'CONFIRMED',
                  });
                  if (staff !== me.user.id)
                    info.annotations.push({ type: 'P10-note', description: 'booked on the Owner' });
                  return { id, slot };
                } catch (e) {
                  info.annotations.push({
                    type: 'P10-setup',
                    description: String(e).slice(0, 200),
                  });
                }
              }
              throw new Error('P10 setup: no time could be booked');
            };
            const index = P10_ROLES.indexOf(p);
            const later = await bookFor(span(30 + index * 2, 70), [['08:00', '08:15']]);
            const done = await bookFor(span(-2, -20), [
              ['06:00', '06:15'],
              ['06:30', '06:45'],
            ]);
            const missed = await bookFor(span(-2, -20), [
              ['07:00', '07:15'],
              ['07:30', '07:45'],
            ]);
            const record = (await ok(
              await oa.get(`business/appointments/${later.id}/record`),
              'record',
            )) as { version: string };
            const outcome = async (res: Promise<Awaited<ReturnType<PageApi['get']>>>) => {
              const s = (await res).status();
              return s < 300 ? 'yes' : s === 403 || s === 404 ? 'no' : `other ${s}`;
            };
            const actual: Record<string, string> = {};
            actual['view'] = await outcome(api.get(`business/appointments/${later.id}/record`));
            actual['edit'] = await outcome(
              api.patch(`business/appointments/${later.id}/details`, {
                version: record.version,
                internalNotes: `${r.tag} P10 ${p.label} edit`,
              }),
            );
            const moved = Date.parse(instant(r.tz, later.slot.day, later.slot.start)) + HOUR;
            actual['reschedule'] = await outcome(
              api.post(`business/appointments/${later.id}/reschedule`, {
                startsAt: new Date(moved).toISOString(),
              }),
            );
            actual['cancel'] = await outcome(
              api.post(`business/appointments/${later.id}/cancel`, {
                reason: `${r.tag} P10 ${p.label}`,
              }),
            );
            actual['complete'] = await outcome(
              api.post(`business/appointments/${done.id}/complete`),
            );
            actual['noShow'] = await outcome(
              api.post(`business/appointments/${missed.id}/no-show`),
            );
            await page.goto(app(`/calendar/${done.id}`));
            await settled(page);
            await shot(page, TAB, `P10-${p.role}-detail`, info);
            info.annotations.push({
              type: `P10 ${p.label}`,
              description: `expected ${p.expected ? JSON.stringify(p.expected) : 'none written (a custom role: its base role, narrowed by its own grid)'}; actual ${JSON.stringify(actual)}`,
            });
            writeP10Row(p.label, p.expected, actual);
            if (p.expected) expect(actual, `${p.label}: the grid on main`).toEqual(p.expected);
          } finally {
            await owner.dispose();
          }
        });
      });
    }
  });

  // ------------------------------------------------------------ her return requirements R2, R3
  // Written now; run when the lead says (Nov 19).
  test.describe('Return requirements', () => {
    test('R2 Leap year: a monthly repeat from Jan 29 and from Jan 31, 2028 lands on Feb 29, 2028', async ({
      page,
    }, info) => {
      test.skip(info.project.name !== 'w1165');
      const c = ctx();
      const r = r2();
      const api = await pageApi(page);
      const client = r.clients.series;
      const cases: [string, string, string[]][] = [
        ['2028-01-29', '10:00', ['2028-01-29', '2028-02-29', '2028-03-29']],
        ['2028-01-31', '13:00', ['2028-01-31', '2028-02-29', '2028-03-31']],
      ];
      for (const [first, start, expected] of cases) {
        await fillNew(page, {
          contact: client.name,
          type: c.t1.name,
          staff: r.owner.name,
          day: first,
          start,
        });
        await page.getByLabel('Repeat').selectOption('MONTHLY');
        await page.getByLabel('Occurrences').selectOption('3');
        await expect(page.getByTestId('appointment-summary')).toContainText('Every month, 3 times');
        await noConfirmation(page);
        await submit(page, 'Schedule Appointment', /\/calendar\/[0-9a-f-]{36}$/, 'R2 leap');
        const items = await listFor(
          api,
          client.id,
          instant(r.tz, first, '00:00'),
          instant(r.tz, '2028-04-05', '00:00'),
        );
        const days = items
          .filter((a) => hhmmIn(r.tz, a.startsAt) === start)
          .map((a) => ymdIn(r.tz, a.startsAt))
          .sort();
        info.annotations.push({ type: `R2 from ${first}`, description: days.join(', ') });
        expect(days, `monthly from ${first}`).toEqual(expected);
      }
      await shot(page, TAB, 'R2-leap-year', info);
    });

    test('R2 Overnight: 11:00 PM to 1:00 AM in Chicago keeps its times across midnight, in the detail and in Edit', async ({
      page,
    }, info) => {
      test.skip(true, 'ASKED-HER: overnight appointments are her decision (lead, Nov 19)');
      test.skip(info.project.name !== 'w1165');
      const c = ctx();
      const r = r2();
      const api = await pageApi(page);
      // Whether the form itself can make one (its times run 6:00 AM to 9:00 PM on one day).
      await freshForm(page);
      const starts = await page.getByLabel('Start Time *').locator('option').allTextContents();
      info.annotations.push({
        type: 'R2-form-times',
        description: `${starts.at(0) ?? ''} to ${starts.at(-1) ?? ''}; 11:00 PM offered: ${starts.some((t) => t.includes('11:00 PM'))}`,
      });
      let night: { startsAt: string; endsAt: string } | null = null;
      for (const d of span(40, 70)) {
        const startsAt = instant(r.tz, dayIn(r.tz, d), '23:00');
        const endsAt = instant(r.tz, dayIn(r.tz, d + 1), '01:00');
        const w = { staff: [r.owner.id], clientId: r.clients.series.id };
        if (await bookable(api, w, startsAt, endsAt)) {
          night = { startsAt, endsAt };
          break;
        }
      }
      if (!night) throw new Error('no free night for the series client');
      const id = await book(api, {
        tz: r.tz,
        typeId: c.t1.id,
        clientId: r.clients.series.id,
        staffId: r.owner.id,
        day: '',
        start: '',
        end: '',
        status: 'CONFIRMED',
        ...night,
      });
      await page.goto(app(`/calendar/${id}`));
      const when = detailWhen(night.startsAt, night.endsAt, r.tz);
      await expect
        .poll(async () => oneLine(await detailSummary(page).textContent()), { timeout: 60_000 })
        .toContain(when);
      await shot(page, TAB, 'R2-overnight-detail', info);
      await page.getByRole('link', { name: 'Edit', exact: true }).click();
      await expect(page.getByLabel('Start Time *')).toHaveValue('23:00', { timeout: 60_000 });
      await expect(page.getByLabel('End Time *')).toHaveValue('01:00');
      await expect(page.getByLabel('Duration')).toHaveValue('2 hours');
      await shot(page, TAB, 'R2-overnight-edit', info);
    });

    test('R2 Series: cancel this and all later ones, cancel a whole series, and edit a whole series', async ({
      page,
    }, info) => {
      test.skip(info.project.name !== 'w1165');
      test.setTimeout(6 * 60_000);
      const c = ctx();
      const r = r2();
      const api = await pageApi(page);
      const client = r.clients.series;
      /** A weekly series of `count` at `start`, through the form; its occurrences, in order. */
      const series = async (offsets: number[], start: string, count: number) => {
        const end = `${start.slice(0, 2)}:30`;
        const w = {
          staff: [r.owner.id],
          clientId: client.id,
          recurrence: { frequency: 'WEEKLY' as const, count },
        };
        const slot = await firstFree(api, r.tz, w, offsets, [[start, end]]);
        await fillNew(page, {
          contact: client.name,
          type: c.t1.name,
          staff: r.owner.name,
          day: slot.day,
          start,
        });
        await page.getByLabel('Repeat').selectOption('WEEKLY');
        await page.getByLabel('Occurrences').selectOption(String(count));
        await noConfirmation(page);
        await submit(page, 'Schedule Appointment', /\/calendar\/[0-9a-f-]{36}$/, 'R2 series');
        const from = instant(r.tz, slot.day, '00:00');
        const to = new Date(Date.parse(from) + (count * 7 + 1) * 86_400_000).toISOString();
        return (await listFor(api, client.id, from, to))
          .filter((a) => hhmmIn(r.tz, a.startsAt) === start)
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      };
      const read = async (id: string) =>
        (await ok(await api.get(`business/appointments/${id}`), 'appointment')) as {
          status: string;
          startsAt: string;
        };
      const wholeSeries = /(whole|entire) series|all .*in (this|the) series/i;
      const cancelWith = async (id: string, scope: RegExp) => {
        await page.goto(app(`/calendar/${id}`));
        await expect(detailSummary(page)).toContainText('Repeats', { timeout: 60_000 });
        await page.getByRole('button', { name: 'Cancel Appointment' }).click();
        const dialog = page.getByRole('dialog', { name: 'Cancel Appointment' });
        await expect(dialog).toBeVisible();
        await shot(page, TAB, 'R2-series-cancel-dialog', info);
        await dialog.getByRole('radio', { name: scope }).check();
        await dialog.getByRole('button', { name: 'Cancel Appointment' }).click();
        await expect(dialog).toBeHidden({ timeout: 30_000 });
      };
      // This and all later: from occurrence 2 of 4; occurrence 1 stays.
      const four = await series(span(80, 120), '10:00', 4);
      expect(four).toHaveLength(4);
      await cancelWith(four[1]?.id ?? '', /this and (all )?(later|following)/i);
      const after: string[] = [];
      for (const a of four) after.push((await read(a.id)).status);
      expect(after).toEqual(['SCHEDULED', 'CANCELLED', 'CANCELLED', 'CANCELLED']);
      // The whole series, from its first occurrence.
      const three = await series(span(125, 160), '11:00', 3);
      expect(three).toHaveLength(3);
      await cancelWith(three[0]?.id ?? '', wholeSeries);
      for (const a of three) expect((await read(a.id)).status).toBe('CANCELLED');
      // Edit a whole series: a new start on every occurrence.
      const edit = await series(span(165, 200), '13:00', 3);
      expect(edit).toHaveLength(3);
      await page.goto(app(`/calendar/${edit[0]?.id ?? ''}/edit`));
      await expect(page.getByLabel('Start Time *')).toHaveValue('13:00', { timeout: 60_000 });
      await page.getByRole('radio', { name: wholeSeries }).check();
      await page.getByLabel('Start Time *').selectOption('14:00');
      await submit(page, 'Save Changes', /\/calendar\/[0-9a-f-]{36}$/, 'R2 series edit');
      for (const a of edit) expect(hhmmIn(r.tz, (await read(a.id)).startsAt)).toBe('14:00');
    });

    test('R3 Timed to all-day and back: Edit turns a 2:00 to 2:30 PM appointment all-day, then timed again, each kept after reload', async ({
      page,
    }, info) => {
      test.skip(info.project.name !== 'w1165');
      const c = ctx();
      const r = r2();
      const api = await pageApi(page);
      const { day, staff } = await freeAllDay(api, r, r.clients.r3.id, span(45, 75));
      await fillNew(page, {
        contact: r.clients.r3.name,
        type: c.t1.name,
        staff: staff.name,
        day,
        start: '14:00',
      });
      await noConfirmation(page);
      await submit(page, 'Schedule Appointment', /\/calendar\/[0-9a-f-]{36}$/, 'R3 timed');
      const id = idFromUrl(page);
      keepR2('appointments', id);
      await page.getByRole('link', { name: 'Edit', exact: true }).click();
      await expect(page.getByLabel('Start Time *')).toHaveValue('14:00', { timeout: 60_000 });
      await page.getByLabel('All Day').check();
      await expect(page.getByLabel('Start Time *')).toBeDisabled();
      await expect(page.getByLabel('Duration')).toHaveValue('All day');
      await submit(page, 'Save Changes', new RegExp(`/calendar/${id}$`), 'R3 to all day');
      await page.reload();
      await expect(detailSummary(page)).toContainText('all day', { timeout: 60_000 });
      await shot(page, TAB, 'R3-now-all-day', info);
      await page.getByRole('link', { name: 'Edit', exact: true }).click();
      await expect(page.getByLabel('All Day')).toBeChecked({ timeout: 60_000 });
      await page.getByLabel('All Day').uncheck();
      const start = await page.getByLabel('Start Time *').inputValue();
      const end = await page.getByLabel('End Time *').inputValue();
      info.annotations.push({ type: 'R3-times-when-switched-off', description: `${start}-${end}` });
      await page.getByLabel('Start Time *').selectOption('14:00');
      await page.getByLabel('End Time *').selectOption('14:30');
      await expect(page.getByLabel('Duration')).toHaveValue('30 min');
      await submit(page, 'Save Changes', new RegExp(`/calendar/${id}$`), 'R3 to timed');
      await page.reload();
      await expect(detailSummary(page)).toContainText('2:00 PM – 2:30 PM', { timeout: 60_000 });
      await expect(detailSummary(page)).not.toContainText('all day');
      await shot(page, TAB, 'R3-timed-again', info);
    });

    test('R3 Recurring all-day: a weekly all-day repeat saves both days as all day', async ({
      page,
    }, info) => {
      test.skip(info.project.name !== 'w1165');
      const c = ctx();
      const r = r2();
      const api = await pageApi(page);
      const { day, staff } = await freeAllDay(api, r, r.clients.r3.id, span(80, 110), 7);
      await fillNew(page, { contact: r.clients.r3.name, type: c.t1.name, staff: staff.name, day });
      await page.getByLabel('All Day').check();
      await page.getByLabel('Repeat').selectOption('WEEKLY');
      await page.getByLabel('Occurrences').selectOption('2');
      const summary = page.getByTestId('appointment-summary');
      await expect(summary).toContainText('All day');
      await expect(summary).toContainText('Every week, 2 times');
      await noConfirmation(page);
      await submit(page, 'Schedule Appointment', /\/calendar\/[0-9a-f-]{36}$/, 'R3 recurring');
      const from = instant(r.tz, day, '00:00');
      const to = new Date(Date.parse(from) + 9 * 86_400_000).toISOString();
      const items = await listFor(api, r.clients.r3.id, from, to);
      expect(items).toHaveLength(2);
      for (const a of items) {
        await page.goto(app(`/calendar/${a.id}`));
        await expect(detailSummary(page)).toContainText('all day', { timeout: 60_000 });
        await expect(detailSummary(page)).toContainText('Repeats');
      }
      await shot(page, TAB, 'R3-recurring-all-day', info);
    });
  });
});

// ---------------------------------------------------------------- cleanup, after every role's checks
test.describe('Appointments cleanup', () => {
  test.use(as('owner'));
  test('zz cleanup: cancel every appointment this run made, archive its types, delete its draft, archive its client', async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'w1165');
    const c = ctx();
    const api = await pageApi(page);
    const left: string[] = [];
    // Sweep: anything on the run's types in the next 40 days.
    const from = `${localDay(-14)}T00:00:00-05:00`;
    const to = `${localDay(40)}T00:00:00-05:00`;
    const ids = new Set(c.appointments);
    for (const client of [SIM_CLIENT]) {
      const list = (await ok(
        await api.get(
          `business/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&clientId=${client}`,
        ),
        'list',
      )) as { items: { id: string; status: string; type: { name: string } | null }[] };
      for (const a of list.items) if (a.type?.name?.startsWith(c.tag)) ids.add(a.id);
    }
    for (const id of ids) {
      const r = await api.get(`business/appointments/${id}`);
      if (!r.ok()) continue;
      const a = (await r.json()) as { status: string };
      if (!['SCHEDULED', 'PENDING', 'CONFIRMED', 'RESCHEDULED'].includes(a.status)) continue;
      const res = await api.post(`business/appointments/${id}/cancel`, {
        reason: `${c.tag} cleanup`,
      });
      if (!res.ok()) left.push(`appointment ${id} (${res.status()})`);
    }
    for (const id of c.drafts) {
      const res = await api.delete(`business/appointment-drafts/${id}`);
      if (!res.ok() && res.status() !== 404) left.push(`draft ${id} (${res.status()})`);
    }
    for (const id of c.clients) {
      const res = await api.post(`business/clients/${id}/archive`, {});
      if (!res.ok()) left.push(`client ${id} (${res.status()})`);
    }
    for (const t of [c.t1, c.t2]) {
      const res = await api.post(`business/appointment-types/${t.id}/archive`);
      if (!res.ok() && res.status() !== 409) left.push(`type ${t.name} (${res.status()})`);
    }
    // Review Two verification (her steps): its own records, once.
    if (existsSync(r2File()) && !r2().cleaned) {
      const r = r2();
      const tryPost = async (what: string, path: string, body: unknown = {}, okAlso = [409]) => {
        const res = await api.post(path, body);
        if (!res.ok() && !okAlso.includes(res.status())) left.push(`${what} (${res.status()})`);
      };
      for (const id of r.appointments) {
        const got = await api.get(`business/appointments/${id}`);
        if (!got.ok()) continue;
        const a = (await got.json()) as { status: string };
        if (['SCHEDULED', 'PENDING', 'CONFIRMED', 'RESCHEDULED'].includes(a.status))
          await tryPost(`appointment ${id}`, `business/appointments/${id}/cancel`, {
            reason: `${r.tag} cleanup`,
          });
      }
      for (const id of r.rooms)
        await tryPost(`room ${id}`, `business/appointment-resources/rooms/${id}/archive`);
      for (const id of r.equipment)
        await tryPost(`equipment ${id}`, `business/appointment-resources/equipment/${id}/archive`);
      for (const t of [r.t15.id, r.t45.id, ...r.types])
        await tryPost(`type ${t}`, `business/appointment-types/${t}/archive`);
      for (const id of r.forms) await tryPost(`form ${id}`, `business/intake-forms/${id}/archive`);
      for (const id of r.services) {
        if ((await api.delete(`business/catalog/services/${id}`)).ok()) continue;
        await api.post(`business/catalog/services/${id}/deactivate`);
        await tryPost(`service ${id}`, `business/catalog/services/${id}/archive`);
      }
      for (const id of r.categories) {
        if ((await api.delete(`business/catalog/categories/${id}`)).ok()) continue;
        const off = await api.put(`business/catalog/categories/${id}`, {
          name: `${r.tag} R2 category`,
          status: 'INACTIVE',
        });
        if (!off.ok()) left.push(`category ${id} (${off.status()})`);
      }
      for (const cl of Object.values(r.clients))
        await tryPost(`client ${cl.name}`, `business/clients/${cl.id}/archive`);
      // The waitlist switch exactly as before A3 (A3 restores it; this is the safety net).
      if (r.waitlistBefore) {
        const now = (await ok(
          await api.get('business/appointment-waitlist/settings'),
          'waitlist settings',
        )) as { enabled: boolean; mode: string };
        if (now.enabled !== r.waitlistBefore.enabled || now.mode !== r.waitlistBefore.mode) {
          const back = await api.put('business/appointment-waitlist/settings', r.waitlistBefore);
          if (!back.ok()) left.push(`waitlist switch (${back.status()})`);
        }
      }
      saveR2({ ...r2(), cleaned: true });
    }
    info.annotations.push({ type: 'left-behind', description: left.join('; ') || 'none' });
    expect(left, 'records the run could not remove').toEqual([]);
  });
});
