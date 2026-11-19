import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
  type Request,
} from '@playwright/test';
import { shotsDir, statePath, type Role } from './env';
import { apiAs, app, as, settled, shot } from './helpers';

/**
 * Templates, Review Two batch 1 (#1639: R01, R02, Y01, Y02, Y06, Y07, Y08, P03, P04; #1648: Y04,
 * Y05, Y09), live on dev as Test Firm B's Owner (Staff where a row is about what a role sees).
 * Rows are named by their IDs only (row map: F:/firmivra-private/checks/templates.md).
 *
 * Records: only the run's own, each named "LIVE-CHECK yyyymmddhhmm ...": one Email category and
 * a few templates (Email drafts and an active one, a private draft, a Campaign, an Announcement
 * and a Text), with tags "lc<stamp>-...". They are made through the API (setup), except the one
 * the Y06 row makes through the editor. No template of anyone else is edited, used, sent or
 * archived; others' templates are only read (Y02, Y04, Y09). Nothing is sent: Use on the run's
 * Campaign and Announcement is followed to the request that would start a Communications draft,
 * and that request is stopped in the browser (it never reaches the API), so no draft is made. No
 * firm-wide setting changes (no starter install, no branding). "zz cleanup" archives every
 * template of the run (templates have no delete), then its category, and sweeps an earlier run
 * of this spec that stopped before its cleanup (.runs.json in the screenshots folder).
 */
test.describe.configure({ timeout: 180_000 });

const TAB = 'templates';

/** One tag per runner process, so a worker restarted after a failure keeps the same records. */
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
/** The tag's digits: one search word that finds this run's templates only. */
const STAMP = runTag.slice('LIVE-CHECK '.length);
const named = (what: string) => `${runTag} ${what}`;
const tag = (what: string) => `lc${STAMP}-${what}`;

const N = {
  category: named('Category'),
  alpha: named('Draft Alpha'),
  beta: named('Draft Beta'),
  active: named('Active Email'),
  private: named('Private Draft'),
  campaign: named('Campaign'),
  announcement: named('Announcement'),
  text: named('Text'),
  described: named('Described'),
} as const;
const T = { alpha: tag('Alpha'), team: tag('Team'), private: tag('Private') } as const;
const DESCRIPTION = 'LIVE-CHECK: for a new client’s first week (fake).';

// ---------------------------------------------------------------- the run's records

interface Records {
  category: string;
  alpha: string;
  beta: string;
  active: string;
  private: string;
  campaign: string;
  announcement: string;
  text: string;
}
interface RunEntry {
  tag: string;
  records?: Records;
  cleaned?: boolean;
}
const ledgerFile = () => join(shotsDir(TAB), '.runs.json');
function readLedger(): RunEntry[] {
  try {
    return JSON.parse(readFileSync(ledgerFile(), 'utf8')) as RunEntry[];
  } catch {
    return [];
  }
}
function writeEntry(e: RunEntry) {
  const all = readLedger();
  const i = all.findIndex((x) => x.tag === e.tag);
  if (i >= 0) all[i] = { ...all[i]!, ...e };
  else all.push(e);
  writeFileSync(ledgerFile(), JSON.stringify(all, null, 2));
}

type Row = {
  id: string;
  name: string;
  kind: string;
  status: string;
  description: string | null;
  starter: boolean;
  version: number;
  useCount: number;
  tags: string[];
};

async function json<T>(
  res: { ok(): boolean; status(): number; text(): Promise<string> },
  what: string,
) {
  if (!res.ok()) throw new Error(`${what}: ${res.status()} ${(await res.text()).slice(0, 300)}`);
  return JSON.parse(await res.text()) as T;
}

/** The run's templates and categories still there, found by the run's stamp. */
async function findRun(api: APIRequestContext, runStamp: string, prefix: string) {
  const rows: Row[] = [];
  for (let page = 1; page <= 10; page++) {
    const p = await json<{ items: Row[]; total: number }>(
      await api.get(
        `business/templates?tab=all&search=${encodeURIComponent(runStamp)}&pageSize=100&page=${page}`,
      ),
      'search templates',
    );
    rows.push(...p.items.filter((r) => r.name.startsWith(prefix)));
    if (page * 100 >= p.total) break;
  }
  return rows;
}

async function makeTemplate(api: APIRequestContext, body: Record<string, unknown>) {
  const name = String(body['name']);
  if (!name.startsWith(runTag)) throw new Error(`not a run name: ${name}`);
  const res = await api.post('business/templates', { data: body });
  if (res.ok()) return (JSON.parse(await res.text()) as { id: string }).id;
  if (res.status() !== 409) throw new Error(`create ${name}: ${res.status()} ${await res.text()}`);
  const hit = (await findRun(api, STAMP, runTag)).find((r) => r.name === name);
  if (!hit) throw new Error(`create ${name}: 409 and not found`);
  return hit.id;
}

let made: Promise<Records> | undefined;
/** Makes the run's records once (through the API, as setup), or reads them from the ledger. */
function records(): Promise<Records> {
  made ??= (async () => {
    const saved = readLedger().find((e) => e.tag === runTag)?.records;
    if (saved) return saved;
    writeEntry({ tag: runTag });
    const api = await apiAs('owner');
    try {
      const cats = await json<{ items: { id: string; name: string }[] }>(
        await api.get('business/template-categories?kind=EMAIL&includeArchived=true'),
        'categories',
      );
      let category = cats.items.find((c) => c.name === N.category)?.id;
      if (!category) {
        const c = await api.post('business/template-categories', {
          data: { kind: 'EMAIL', name: N.category },
        });
        category = (await json<{ id: string }>(c, 'create category')).id;
      }
      const email = (name: string, extra: Record<string, unknown>) =>
        makeTemplate(api, {
          kind: 'EMAIL',
          name,
          subject: 'LIVE-CHECK subject (fake)',
          body: '<p>Synthetic template for a live check (fake).</p>',
          access: 'TEAM',
          ...extra,
        });
      const r: Records = {
        category,
        alpha: await email(N.alpha, {
          status: 'DRAFT',
          categoryId: category,
          description: 'LIVE-CHECK draft (fake).',
          tags: [T.alpha],
        }),
        beta: await email(N.beta, { status: 'DRAFT', categoryId: category }),
        active: await email(N.active, { status: 'ACTIVE', categoryId: category, tags: [T.team] }),
        private: await email(N.private, { status: 'DRAFT', access: 'PRIVATE', tags: [T.private] }),
        campaign: await makeTemplate(api, {
          kind: 'CAMPAIGN',
          name: N.campaign,
          subject: 'LIVE-CHECK campaign (fake)',
          body: '<p>Synthetic campaign for a live check (fake).</p>',
          status: 'ACTIVE',
          access: 'TEAM',
        }),
        announcement: await makeTemplate(api, {
          kind: 'ANNOUNCEMENT',
          name: N.announcement,
          subject: 'LIVE-CHECK announcement (fake)',
          body: '<p>Synthetic announcement for a live check (fake).</p>',
          status: 'ACTIVE',
          access: 'TEAM',
        }),
        text: await makeTemplate(api, {
          kind: 'SMS',
          name: N.text,
          body: 'A'.repeat(160),
          status: 'ACTIVE',
          access: 'TEAM',
        }),
      };
      writeEntry({ tag: runTag, records: r });
      return r;
    } finally {
      await api.dispose();
    }
  })();
  return made;
}

// ---------------------------------------------------------------- page helpers

async function open(page: Page, path: string) {
  await page.goto(app(path));
  await settled(page);
  if (/\/sign-in/.test(page.url())) {
    await page.goto('about:blank');
    throw new Error(`the saved session ended (harness, not the product): ${path}`);
  }
}

// Never a failure screenshot of a sign-in screen: a page sent there is blanked first.
test.afterEach(async ({ page }) => {
  if (/\/sign-in/.test(page.url())) await page.goto('about:blank');
});

/**
 * Another role's page. Its session is refreshed first (another lane may have used the saved one);
 * `done` blanks the page before closing it, so a failure screenshot taken at close never shows a
 * sign-in screen.
 */
async function pageAs(
  browser: Browser,
  role: Role,
): Promise<{ page: Page; done: () => Promise<void> }> {
  await (await apiAs(role)).dispose();
  const ctx = await browser.newContext({ storageState: statePath(role) });
  const page = await ctx.newPage();
  const done = async () => {
    await page.goto('about:blank').catch(() => {});
    await ctx.close();
  };
  return { page, done };
}

const about = (page: Page, topic: string) =>
  page.getByRole('button', { name: `About ${topic}`, exact: true });

const libraryRows = (page: Page) => page.getByTestId('library-table').getByRole('row');
const rowOf = (page: Page, name: string) =>
  libraryRows(page).filter({ has: page.getByRole('link', { name, exact: true }) });

/**
 * Stops the request that would start a Communications draft (POST business/communications) in
 * the browser, so Use is followed without making a draft; returns the bodies it would have sent.
 */
async function stopDrafts(page: Page): Promise<Record<string, unknown>[]> {
  const stopped: Record<string, unknown>[] = [];
  await page.route(
    (url) => /\/api\/v1\/business\/communications\/?$/.test(url.pathname),
    async (route) => {
      const req: Request = route.request();
      if (req.method() !== 'POST') return route.continue();
      stopped.push((req.postDataJSON() ?? {}) as Record<string, unknown>);
      return route.abort();
    },
  );
  return stopped;
}

// ---------------------------------------------------------------- the rows

test.describe('Templates Review Two (Owner)', () => {
  test.use(as('owner'));

  test('R01 a library’s search and Draft filter survive Edit then Back, Cancel and the Back bar', async ({
    page,
  }, info) => {
    await records();
    await open(page, '/templates/library/email');
    await page.getByPlaceholder('Search templates...').fill(STAMP);
    await page
      .getByRole('form', { name: 'Template filters' })
      .getByLabel('Status', { exact: true })
      .selectOption('DRAFT');
    await expect(page).toHaveURL(
      new RegExp(`/templates/library/email\\?(?=.*q=${STAMP})(?=.*status=DRAFT)`),
    );
    await settled(page);
    const list = page.url();
    const drafts = [N.alpha, N.beta, N.private];
    const check = async (how: string) => {
      await expect(page, how).toHaveURL(list);
      await expect(page.getByPlaceholder('Search templates...')).toHaveValue(STAMP);
      await expect(
        page.getByRole('form', { name: 'Template filters' }).getByLabel('Status', { exact: true }),
      ).toHaveValue('DRAFT');
      for (const n of drafts) await expect(rowOf(page, n), `${how}: ${n}`).toHaveCount(1);
      await expect(rowOf(page, N.active)).toHaveCount(0);
    };
    await check('as typed');
    await shot(page, TAB, 'R01-list', info);
    const edit = () => rowOf(page, N.alpha).getByTestId('template-link').click();

    await edit();
    await expect(page.getByTestId('template-editor')).toBeVisible();
    await page.goBack();
    await settled(page);
    await check('browser Back');

    await edit();
    await expect(page.getByTestId('template-editor')).toBeVisible();
    await page.getByRole('link', { name: 'Cancel', exact: true }).click();
    await settled(page);
    await check('Cancel');

    await edit();
    await expect(page.getByTestId('template-editor')).toBeVisible();
    await page.getByTestId('back-to-origin').click();
    await settled(page);
    await check('the Back bar');

    await edit();
    await expect(page.getByTestId('template-editor')).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: 'Email Templates' })
      .click();
    await settled(page);
    await check('the breadcrumb');
  });

  test('Y01 a template or a Use that cannot open goes back to the list, and a new tab keeps the list', async ({
    page,
  }, info) => {
    const r = await records();
    await open(page, `/templates/library/email?q=${STAMP}&status=DRAFT`);
    const here = `/templates/library/email?q=${STAMP}&status=DRAFT`;
    await expect(rowOf(page, N.alpha)).toHaveCount(1);
    // A middle click or a new tab: the link takes the list's query as the mouse goes down.
    const link = rowOf(page, N.alpha).getByTestId('template-link');
    await link.dispatchEvent('mousedown', { button: 1 });
    const href = (await link.getAttribute('href')) ?? '';
    expect(new URL(href, app()).searchParams.get('from')).toBe(here);
    // A template that cannot be opened goes back to the list it came from.
    await open(page, `/templates/${randomUUID()}/edit?from=${encodeURIComponent(here)}`);
    const back = page.getByRole('link', { name: 'Back to Templates' });
    await expect(back).toHaveAttribute('href', here);
    await shot(page, TAB, 'Y01-not-available', info);
    await back.click();
    await expect(page).toHaveURL(app(here));
    await settled(page);
    await expect(page.getByPlaceholder('Search templates...')).toHaveValue(STAMP);
    // A Use whose draft cannot start goes back to the library it came from (the draft request is
    // stopped in the browser, so the page answers as when it fails).
    const stopped = await stopDrafts(page);
    await open(page, `/templates/library/announcement?q=${STAMP}`);
    const from = `/templates/library/announcement?q=${STAMP}`;
    await rowOf(page, N.announcement)
      .getByRole('link', { name: `Use ${N.announcement}` })
      .click();
    await expect(page).toHaveURL(/\/communications\/new\?/);
    const backTo = page.getByRole('link', { name: '← Back to Template Library' });
    await expect(backTo).toHaveAttribute('href', from);
    expect(stopped).toEqual([{ channel: 'ANNOUNCEMENT', templateId: r.announcement }]);
    await shot(page, TAB, 'Y01-use-cannot-start', info);
    await backTo.click();
    await expect(page).toHaveURL(app(from));
  });

  test('R02 the SMS counter counts parts as carriers do, in the editor and the API’s preview', async ({
    page,
  }, info) => {
    const r = await records();
    await open(page, '/templates/new?kind=SMS');
    const body = page.getByLabel('Message *');
    const count = page.getByTestId('sms-count');
    const parts = async (text: string, expected: string) => {
      await body.fill(text);
      await expect(count).toContainText(expected);
    };
    await parts('A'.repeat(160), '160 characters · 1 text part (standard characters');
    await parts('A'.repeat(161), '161 characters · 2 text parts');
    await parts('A'.repeat(306), '306 characters · 2 text parts');
    await parts('A'.repeat(307), '307 characters · 3 text parts');
    await parts('^'.repeat(80), '80 characters · 1 text part');
    await parts('^'.repeat(81), '81 characters · 2 text parts');
    await parts('漢'.repeat(70), '70 characters · 1 text part (special characters');
    await parts('漢'.repeat(71), '71 characters · 2 text parts');
    await parts('漢'.repeat(134), '134 characters · 2 text parts');
    await parts('漢'.repeat(135), '135 characters · 3 text parts');
    await parts(String.fromCodePoint(0x1f600).repeat(35), '35 characters · 1 text part');
    await parts(String.fromCodePoint(0x1f600).repeat(36), '36 characters · 2 text parts');
    await shot(page, TAB, 'R02-editor', info);
    // Leave the new template unsaved.
    await body.fill('');

    // The API counts the same: the preview of the run's Text with unsaved wording (a render;
    // nothing is saved or sent).
    await open(page, `/templates/${r.text}/edit`);
    const msg = page.getByLabel('Message *');
    const preview = async (text: string, expected: string) => {
      await msg.fill(text);
      await page.getByRole('button', { name: 'Preview Template' }).click();
      const dialog = page.getByRole('dialog', { name: 'Preview' });
      await expect(dialog.getByTestId('preview-dialog')).toContainText(expected);
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(dialog).toBeHidden();
    };
    await preview('A'.repeat(161), '161 characters, 2 text parts.');
    await preview('^'.repeat(81), '81 characters, 2 text parts.');
    await preview('漢'.repeat(70), '70 characters, 1 text part.');
    await preview(String.fromCodePoint(0x1f600).repeat(36), '36 characters, 2 text parts.');
    await shot(page, TAB, 'R02-preview', info);
    // Leave without saving.
    await page.getByRole('link', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page).not.toHaveURL(/\/edit/);
  });

  test('Y02 every starter template has a body and a description', async ({ page }, info) => {
    const api = await apiAs('owner');
    const starters = await json<{ available: number; installed: number }>(
      await api.get('business/templates/starters'),
      'starters',
    );
    expect(starters.available).toBe(48);
    const rows: Row[] = [];
    for (let p = 1; p <= 20; p++) {
      const page = await json<{ items: Row[]; total: number }>(
        await api.get(`business/templates?tab=all&pageSize=100&page=${p}`),
        'templates',
      );
      rows.push(...page.items);
      if (p * 100 >= page.total) break;
    }
    // The starters as installed and never edited since (an edited one is the firm's own wording).
    const untouched = rows.filter((x) => x.starter && x.version === 1);
    const missing: string[] = [];
    for (const s of untouched) {
      const d = await json<{ body: string; description: string | null }>(
        await api.get(`business/templates/${s.id}`),
        `starter ${s.id}`,
      );
      if (!d.body.replace(/<[^>]+>/g, '').trim() || !d.description?.trim()) missing.push(s.name);
    }
    await api.dispose();
    expect(missing, 'starters without a body or a description').toEqual([]);
    // On the page: a starter's description under its name in the library, and the starter
    // callout counts 48 when some are missing (never pressed).
    const one = untouched.find((x) => x.kind === 'EMAIL') ?? untouched[0];
    if (one) {
      const slug = one.kind.toLowerCase().replace(/_/g, '-');
      await open(page, `/templates/library/${slug}?q=${encodeURIComponent(one.name)}`);
      await expect(rowOf(page, one.name)).toContainText(one.description ?? '');
    }
    await open(page, '/templates');
    const callout = page.getByTestId('starters-callout');
    if (starters.installed < starters.available) await expect(callout).toContainText('48');
    else await expect(callout).toHaveCount(0);
    await shot(page, TAB, 'Y02-overview', info);
    info.annotations.push({
      type: 'starters',
      description: `${starters.installed} of ${starters.available} installed; ${untouched.length} unedited checked`,
    });
    // The starters' wording is only seen once they are installed, and installing them is a
    // firm-wide change this check may not make (Install is never pressed).
    test.skip(
      untouched.length === 0,
      'NOT LIVE: Test Firm B has no starter template installed, and installing the 48 is a firm-wide change; only their count (48, on the overview) was checked',
    );
  });

  test('Y04 a used template lists its latest uses: how many, what for, who and when', async ({
    page,
  }, info) => {
    const used = await mostUsed();
    test.skip(!used, NO_USES);
    await open(page, `/templates/${used!.id}/edit`);
    const uses = page.getByTestId('recent-uses');
    await expect(uses).toContainText(
      `Used ${used!.useCount} time${used!.useCount === 1 ? '' : 's'}; the latest are below.`,
    );
    const items = uses.getByRole('listitem');
    await expect(items).toHaveCount(used!.recentUses.length);
    const purpose = {
      COMMUNICATION: 'Communication',
      MESSAGE: 'Message',
      AUTOMATION: 'Automation',
    };
    for (const [i, u] of used!.recentUses.entries()) {
      await expect(items.nth(i)).toContainText(`Version ${u.version} · ${purpose[u.purpose]}`);
      await expect(items.nth(i)).toContainText(u.usedBy?.name ?? 'Automation');
    }
    await expect(about(page, 'Where it was used')).toHaveAccessibleDescription(
      /Editing, archiving or restoring the template never changes what was already sent/,
    );
    await shot(page, TAB, 'Y04-recent-uses', info);
  });

  test('Y09 each recorded use keeps the version that went out', async ({ page }, info) => {
    const used = await mostUsed();
    test.skip(!used, NO_USES);
    for (const u of used!.recentUses)
      expect(u.version, 'a use names a version the template had').toBeLessThanOrEqual(
        used!.version,
      );
    await open(page, `/templates/${used!.id}/edit`);
    const items = page.getByTestId('recent-uses').getByRole('listitem');
    for (const [i, u] of used!.recentUses.entries())
      await expect(items.nth(i)).toContainText(`Version ${u.version}`);
    await shot(page, TAB, 'Y09-versions', info);
  });

  test('Y05 a category with templates is not archived; every tag filters, a part of one finds it', async ({
    page,
    browser,
  }, info) => {
    await records();
    // The run's category holds its active and draft Email templates: Archive is refused.
    await open(page, '/templates');
    await page
      .getByTestId('tools')
      .getByRole('button', { name: /Template Categories/ })
      .click();
    const dialog = page.getByTestId('categories-dialog');
    await dialog.getByLabel('Kind of template').selectOption({ label: 'Email' });
    const row = dialog.getByRole('listitem').filter({ hasText: N.category });
    await expect(row).toContainText('(3)');
    await row.getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByRole('dialog', { name: 'Template Categories' })).toContainText(
      'This category still has templates. Move them, or merge it into another category, before archiving it.',
    );
    await expect(row.getByRole('button', { name: 'Archive' })).toBeVisible();
    await expect(row).not.toHaveClass(/line-through/);
    await shot(page, TAB, 'Y05-category-refused', info);
    await page
      .getByRole('dialog', { name: 'Template Categories' })
      .getByRole('button', {
        name: 'Close',
        exact: true,
      })
      .first()
      .click();
    const api = await apiAs('owner');
    const cats = await json<{ items: { id: string; name: string; archivedAt: string | null }[] }>(
      await api.get('business/template-categories?kind=EMAIL&includeArchived=true'),
      'categories',
    );
    expect(cats.items.find((c) => c.name === N.category)?.archivedAt ?? null).toBeNull();
    const tags = await json<{ items: string[] }>(
      await api.get('business/templates/tags?kind=EMAIL'),
      'tags',
    );
    await api.dispose();

    // The Tag filter lists every tag of the kind (the API's list), the run's too.
    await open(page, '/templates/library/email');
    const filters = page.getByRole('form', { name: 'Template filters' });
    const tagSelect = filters.getByLabel('Tag', { exact: true });
    await expect(tagSelect.locator('option', { hasText: T.alpha })).toHaveCount(1);
    const offered = (await tagSelect.locator('option').allTextContents()).slice(1);
    expect(offered).toEqual(tags.items);
    for (const t of [T.alpha, T.team, T.private]) expect(offered).toContain(t);
    await tagSelect.selectOption(T.team);
    await settled(page);
    await expect(rowOf(page, N.active)).toHaveCount(1);
    await expect(libraryRows(page)).toHaveCount(2);
    // Search finds a part of a tag, in any case.
    await filters.getByRole('button', { name: 'Clear', exact: true }).click();
    await page.getByPlaceholder('Search templates...').fill(`${STAMP}-ALP`);
    await settled(page);
    await expect(rowOf(page, N.alpha)).toHaveCount(1);
    await expect(libraryRows(page)).toHaveCount(2);
    await shot(page, TAB, 'Y05-partial-tag', info);

    // Staff see the team's tags, never the tag of an Owner's private template.
    const staff = await pageAs(browser, 'staff');
    try {
      await open(staff.page, '/templates/library/email');
      const staffTags = staff.page
        .getByRole('form', { name: 'Template filters' })
        .getByLabel('Tag', { exact: true })
        .locator('option');
      await expect(staffTags.filter({ hasText: T.team })).toHaveCount(1);
      await expect(staffTags.filter({ hasText: T.private })).toHaveCount(0);
    } finally {
      await staff.done();
    }
  });

  test('Y06 a template’s description is saved, kept and shown under its name', async ({
    page,
  }, info) => {
    await open(page, '/templates/new?kind=EMAIL');
    await page.getByLabel('Template Name *').fill(N.described);
    await page.getByLabel('Description').fill(DESCRIPTION);
    await page.getByLabel('Subject Line').fill('LIVE-CHECK welcome (fake)');
    await page.getByRole('textbox', { name: 'Email Content' }).click();
    await page.keyboard.type('Welcome to the firm (fake).');
    await page.getByRole('button', { name: 'Save as Draft' }).click();
    await expect(page).toHaveURL(/\/templates\/[0-9a-f-]{36}\/edit/);
    await settled(page);
    await expect(page.getByLabel('Description')).toHaveValue(DESCRIPTION);
    await page.reload();
    await settled(page);
    await expect(page.getByLabel('Description')).toHaveValue(DESCRIPTION);
    await shot(page, TAB, 'Y06-editor', info);
    // The overview's Recent shows it under the name.
    await page
      .getByRole('navigation', { name: 'Breadcrumb' })
      .getByRole('link', { name: 'Templates', exact: true })
      .click();
    await settled(page);
    const recent = page
      .getByTestId('recent')
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: N.described, exact: true }) });
    await expect(recent.getByTestId('recent-description')).toHaveText(DESCRIPTION);
    await shot(page, TAB, 'Y06-recent', info);
    // And the library under the name.
    await open(page, `/templates/library/email?q=${STAMP}`);
    await expect(rowOf(page, N.described)).toContainText(DESCRIPTION);
  });

  test('Y07 Preview, Share, Archive, bulk actions, Tags and Lead sequences each explain themselves', async ({
    page,
  }, info) => {
    await records();
    await open(page, `/templates/library/email?q=${encodeURIComponent(N.active)}`);
    const row = rowOf(page, N.active);
    await expect(row).toHaveCount(1);
    const menu = () => row.getByRole('button', { name: `Actions for ${N.active}` }).click();

    await menu();
    await page.getByRole('menuitem', { name: 'Share' }).click();
    const share = page.getByRole('dialog', { name: 'Share Template' });
    await expect(about(page, 'Sharing a template')).toHaveAccessibleDescription(
      /Sharing decides who can use it/,
    );
    await share.getByRole('button', { name: 'Cancel' }).click();
    await expect(share).toBeHidden();

    await menu();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    const archive = page.getByRole('dialog', { name: 'Archive template?' });
    await expect(about(page, 'Archiving a template')).toHaveAccessibleDescription(
      /Restore brings it back as a draft/,
    );
    await shot(page, TAB, 'Y07-archive', info);
    await archive.getByRole('button', { name: 'Keep' }).click();
    await expect(archive).toBeHidden();

    await row.getByRole('checkbox').check();
    await expect(about(page, 'Bulk actions')).toHaveAccessibleDescription(
      /Applies one change to every ticked template/,
    );
    await shot(page, TAB, 'Y07-bulk', info);
    await row.getByRole('checkbox').uncheck();

    await row.getByRole('button', { name: `Preview ${N.active}` }).click();
    const preview = page.getByRole('dialog', { name: 'Preview' });
    await expect(about(page, 'Preview and Test Send')).toHaveAccessibleDescription(
      /Test Send sends the saved template/,
    );
    await preview.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(preview).toBeHidden();

    await open(page, '/templates/new?kind=EMAIL');
    await expect(about(page, 'Tags')).toHaveAccessibleDescription(/press Enter/);

    await open(page, '/templates/lead-sequences');
    await expect(about(page, 'Lead follow-up sequences')).toHaveAccessibleDescription(
      /never sends anything by itself/,
    );
    await shot(page, TAB, 'Y07-lead-sequences', info);
  });

  test('Y08 the import help names its limits', async ({ page }, info) => {
    await open(page, '/templates');
    await page
      .getByTestId('tools')
      .getByRole('button', { name: /Import Template/ })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Import Template' });
    await expect(dialog).toBeVisible();
    const help = about(page, 'Importing a template').first();
    await expect(help).toHaveAccessibleDescription(/up to 50,000 characters/);
    await expect(help).toHaveAccessibleDescription(/up to 10 MB/);
    await expect(help).toHaveAccessibleDescription(/unsafe links/);
    await shot(page, TAB, 'Y08-import', info);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  test('P03 an email draft takes a Campaign template: the picker offers it, active only; automations refuse it', async ({
    page,
  }, info) => {
    const r = await records();
    const stopped = await stopDrafts(page);
    await open(page, '/communications');
    await page.getByRole('button', { name: 'New Communication' }).click();
    await page.getByRole('menuitem', { name: 'Use a Template' }).click();
    const picker = page.getByTestId('template-picker');
    const item = (name: string) => picker.getByRole('listitem').filter({ hasText: name });
    await expect(item(N.campaign)).toHaveCount(1);
    await expect(item(N.campaign)).toContainText('Email');
    await expect(item(N.announcement)).toContainText('Announcement');
    await expect(item(N.active)).toHaveCount(1);
    await expect(item(N.text)).toContainText('Text Message');
    for (const draft of [N.alpha, N.beta, N.private]) await expect(item(draft)).toHaveCount(0);
    await shot(page, TAB, 'P03-picker', info);
    // Use on the Campaign starts an email draft from it (stopped before it reaches the API).
    await item(N.campaign).getByRole('button', { name: 'Use' }).click();
    await expect.poll(() => stopped.length).toBe(1);
    expect(stopped[0]).toEqual({ channel: 'EMAIL', templateId: r.campaign });
    // The editor: a Campaign is not offered to automations, and says why.
    await open(page, `/templates/${r.campaign}/edit`);
    await expect(page.getByLabel('Include in Automations')).toBeDisabled();
    await expect(page.getByTestId('automation-ineligible')).toContainText(
      'an announcement or a campaign goes to many clients at once',
    );
    // The API keeps the same list: a Campaign or a Tax Workflow offered to automations is refused
    // (a template made by mistake would be the run's own, archived by cleanup).
    const api = await apiAs('owner');
    try {
      for (const [kind, name] of [
        ['CAMPAIGN', named('Campaign for automations')],
        ['TAX_WORKFLOW', named('Tax Workflow for automations')],
      ] as const) {
        const res = await api.post('business/templates', {
          data: {
            kind,
            name,
            subject: kind === 'CAMPAIGN' ? 'LIVE-CHECK (fake)' : null,
            body: '<p>Synthetic (fake).</p>',
            status: 'ACTIVE',
            access: 'TEAM',
            includeInAutomations: true,
          },
        });
        expect(res.status(), `${kind} offered to automations`).toBe(409);
        expect(await res.text()).toContain('NOT_AUTOMATION_ELIGIBLE');
      }
    } finally {
      await api.dispose();
    }
    // The composer's own picker (inside an email draft) needs a saved draft, which this check
    // does not make; it lists the same two kinds from the server (composer.tsx TemplateDialog).
  });

  test('P04 Use on an Announcement starts an announcement draft; the editor says why automations cannot', async ({
    page,
  }, info) => {
    const r = await records();
    const stopped = await stopDrafts(page);
    await open(page, `/templates/library/announcement?q=${STAMP}`);
    const use = rowOf(page, N.announcement).getByRole('link', { name: `Use ${N.announcement}` });
    await expect(use).toHaveAttribute(
      'href',
      new RegExp(`^/communications/new\\?channel=ANNOUNCEMENT&template=${r.announcement}`),
    );
    await use.click();
    await expect(page).toHaveURL(/\/communications\/new\?channel=ANNOUNCEMENT&template=/);
    await expect.poll(() => stopped.length).toBe(1);
    expect(stopped[0]).toEqual({ channel: 'ANNOUNCEMENT', templateId: r.announcement });
    // A Campaign's Use is an email draft.
    await open(page, `/templates/library/campaign?q=${STAMP}`);
    await expect(
      rowOf(page, N.campaign).getByRole('link', { name: `Use ${N.campaign}` }),
    ).toHaveAttribute(
      'href',
      new RegExp(`^/communications/new\\?channel=EMAIL&template=${r.campaign}`),
    );
    // The editor says why automations cannot send an announcement.
    await open(page, `/templates/${r.announcement}/edit`);
    await expect(page.getByLabel('Include in Automations')).toBeDisabled();
    await expect(page.getByTestId('automation-ineligible')).toHaveText(
      'Automations send one client a message about their own event; an announcement or a campaign goes to many clients at once, by hand, from Communications.',
    );
    await shot(page, TAB, 'P04-editor', info);
  });

  test('zz cleanup: archive every template of the run, then its category', async ({
    browser: _browser,
  }, info) => {
    const runs = readLedger().filter((e) => e.tag === runTag || !e.cleaned);
    if (!runs.some((e) => e.tag === runTag)) runs.push({ tag: runTag });
    const done: string[] = [];
    const left: string[] = [];
    const api = await apiAs('owner');
    try {
      for (const run of runs) {
        const stamp = run.tag.slice('LIVE-CHECK '.length);
        if (!/^\d{12}$/.test(stamp)) continue;
        const l0 = left.length;
        for (const t of await findRun(api, stamp, `${run.tag} `)) {
          if (t.status === 'ARCHIVED') continue;
          const res = await api.post(`business/templates/${t.id}/archive`, { data: {} });
          (res.ok() ? done : left).push(
            `[${run.tag}] template "${t.name}" archive ${res.status()}`,
          );
        }
        const cats = await json<{
          items: { id: string; name: string; archivedAt: string | null }[];
        }>(
          await api.get('business/template-categories?kind=EMAIL&includeArchived=true'),
          'categories',
        );
        for (const c of cats.items.filter(
          (x) => x.name.startsWith(`${run.tag} `) && !x.archivedAt,
        )) {
          const res = await api.post(`business/template-categories/${c.id}/archive`, { data: {} });
          (res.ok() ? done : left).push(
            `[${run.tag}] category "${c.name}" archive ${res.status()}`,
          );
        }
        if (left.length === l0) writeEntry({ tag: run.tag, cleaned: true });
      }
    } finally {
      await api.dispose();
    }
    console.warn(`CLEANUP done:\n${done.join('\n')}\nCLEANUP left:\n${left.join('\n')}`);
    info.annotations.push({ type: 'left-behind', description: left.join('; ') || 'none' });
    expect(left).toEqual([]);
  });
});

// ---------------------------------------------------------------- Y04, Y09: others' templates, read only

const NO_USES =
  'NOT LIVE: no template of Test Firm B has a recorded use yet, and recording one needs a send (a campaign, a message or an automation) to a client with portal access; the run may only send to a client it creates, and such a client has no portal login';

type Used = Row & {
  recentUses: {
    version: number;
    purpose: 'COMMUNICATION' | 'MESSAGE' | 'AUTOMATION';
    usedBy: { name: string } | null;
    usedAt: string;
  }[];
};
let usedOnce: Promise<Used | null> | undefined;
/** The firm's most used template (read only), when any use is recorded. */
function mostUsed(): Promise<Used | null> {
  usedOnce ??= (async () => {
    const api = await apiAs('owner');
    try {
      const top = await json<{ items: Row[] }>(
        await api.get('business/templates?tab=all&sort=uses&direction=desc&pageSize=1'),
        'most used',
      );
      const t = top.items[0];
      if (!t || t.useCount === 0) return null;
      return json<Used>(await api.get(`business/templates/${t.id}`), 'most used detail');
    } finally {
      await api.dispose();
    }
  })();
  return usedOnce;
}
