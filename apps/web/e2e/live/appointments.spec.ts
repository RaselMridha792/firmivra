import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  app,
  apiAs,
  as,
  expectNoSideScroll,
  hasLogin,
  portal,
  runTag,
  settled,
  shot,
} from './helpers';

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
      await expect(saved).toHaveText('Settings saved.');
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
    info.annotations.push({ type: 'left-behind', description: left.join('; ') || 'none' });
    expect(left, 'records the run could not remove').toEqual([]);
  });
});
