import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import { apiAs, app, as, expectNoSideScroll, runTag, settled, shot } from './helpers';

/**
 * Live checks: Bookkeeping, every row of Octavia's Review Two (checklist and developer review),
 * on dev as Test Firm B. Test Firm B has no bookkeeping clients of its own, so the run makes two
 * LIVE-CHECK clients (on the SES simulator), enrolls them, and archives them at the end
 * ("zz cleanup"). Records without a delete (notes, documents, periods, reconciliations, reports,
 * Terms drafts) stay on those archived clients.
 */
const TAB = 'bookkeeping';
test.use(as('owner'));

interface Party {
  clientId: string;
  bkId: string;
  name: string;
}
interface Fixture {
  tag: string;
  /** The run's own Bookkeeping service in Services & Pricing (Test Firm B has none). */
  serviceId?: string;
  categoryId?: string;
  clientIds: string[];
  a: Party;
  b: Party;
  accountId: string;
  periodId: string;
  taskIds: string[];
  seriesIds: string[];
}

const fixturePath = (info: TestInfo) =>
  `${process.env['LIVE_OUT_DIR']}/bk-fixture-${info.project.name}.json`;

async function ok(res: Awaited<ReturnType<APIRequestContext['get']>>, what: string) {
  if (!res.ok()) throw new Error(`${what}: ${res.status()} ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

/**
 * The run's two clients (and its Bookkeeping service), made once per project and reused after a
 * worker restart. Each id is written down as soon as it exists, so cleanup finds a half-made one.
 */
async function fixture(info: TestInfo): Promise<Fixture> {
  const path = fixturePath(info);
  if (existsSync(path)) {
    const saved = JSON.parse(readFileSync(path, 'utf8')) as Fixture;
    if (saved.periodId) return saved;
    throw new Error(
      'the fixture is half-made (an earlier attempt failed); "zz cleanup" removes it',
    );
  }
  const draft = {
    tag: runTag,
    clientIds: [] as string[],
    taskIds: [],
    seriesIds: [],
  } as unknown as Fixture;
  const save = () => writeFileSync(path, JSON.stringify(draft));
  save();
  const api = await apiAs('owner');
  try {
    // Its own category too: Test Firm B's categories come and go with other runs.
    const category = await ok(
      await api.post('business/catalog/categories', {
        data: { name: `${runTag} BK cat`, status: 'ACTIVE' },
      }),
      'catalog category',
    );
    const categoryId = category.id as string;
    draft.categoryId = categoryId;
    save();
    const service = await ok(
      await api.post('business/catalog/services', {
        data: {
          name: `${runTag} BK Service`,
          kind: 'BOOKKEEPING',
          pricingType: 'RECURRING',
          basePriceCents: 10000,
          billingFrequency: 'MONTHLY',
          categoryId,
          shortDescription: 'LIVE-CHECK synthetic bookkeeping service',
          activate: true,
        },
      }),
      'catalog service',
    );
    draft.serviceId = service.id;
    save();
    const stamp = runTag.replace(/\D/g, '');
    const make = async (suffix: string) => {
      const name = `${runTag} BK ${suffix}`;
      const client = await ok(
        await api.post('business/clients', {
          data: {
            accountType: 'BUSINESS',
            displayName: name,
            email: `success+livecheck-bk-${suffix.toLowerCase()}-${stamp}@simulator.amazonses.com`,
          },
        }),
        'create client',
      );
      draft.clientIds.push(client.id);
      save();
      const bk = await ok(
        await api.post('business/bookkeeping/clients', {
          data: { clientId: client.id, catalogServiceId: service.id },
        }),
        'enroll in bookkeeping',
      );
      return { clientId: client.id as string, bkId: bk.id as string, name };
    };
    const a = await make('Alpha');
    draft.a = a;
    save();
    const b = await make('Bravo');
    draft.b = b;
    save();
    await ok(
      await api.patch(`business/bookkeeping/clients/${a.bkId}`, {
        data: { nextReportDueOn: '2026-12-05' },
      }),
      'due A',
    );
    await ok(
      await api.patch(`business/bookkeeping/clients/${b.bkId}`, {
        data: { nextReportDueOn: '2026-12-20' },
      }),
      'due B',
    );
    const account = await ok(
      await api.post(`business/bookkeeping/clients/${a.bkId}/accounts`, {
        data: { name: 'LIVE-CHECK Checking', type: 'BANK' },
      }),
      'account',
    );
    // A second account for the zero-difference, no-statement check (R01c).
    await ok(
      await api.post(`business/bookkeeping/clients/${a.bkId}/accounts`, {
        data: { name: 'LIVE-CHECK Card', type: 'CREDIT_CARD' },
      }),
      'second account',
    );
    const period = await ok(
      await api.post(`business/bookkeeping/clients/${a.bkId}/periods`, {
        data: { periodStart: '2026-10-01', periodEnd: '2026-10-31' },
      }),
      'period',
    );
    draft.accountId = account.id;
    draft.periodId = period.id;
    save();
    return draft;
  } finally {
    await api.dispose();
  }
}

function remember(info: TestInfo, change: (f: Fixture) => void) {
  const path = fixturePath(info);
  const f = JSON.parse(readFileSync(path, 'utf8')) as Fixture;
  change(f);
  writeFileSync(path, JSON.stringify(f));
}

const ws = async (page: Page, f: Fixture, query = '') => {
  await page.goto(app(`/bookkeeping/clients/${f.a.bkId}${query}`));
  await expect(page.getByTestId('bk-client')).toBeVisible();
  // Run 1 once saw "Recent documents could not be loaded." and "Tasks are not available right
  // now." on the workspace: log each time a card says it could not load.
  await page.waitForLoadState('networkidle').catch(() => {});
  const broken = page.getByText(/could not be loaded|not available right now/);
  for (const t of await broken.allInnerTexts())
    console.log(`WORKSPACE-CARD-ERROR ${query || '?'}: ${t}`);
};
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Client views' });
const toast = (page: Page, text: string | RegExp) =>
  expect(page.getByText(text).first()).toBeVisible();
const pdf = (name: string) => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n% synthetic LIVE-CHECK file\n%%EOF\n'),
});

let f: Fixture;
let fixtureError: unknown;
// eslint-disable-next-line no-empty-pattern -- Playwright needs a destructured first argument
test.beforeAll(async ({}, info) => {
  try {
    f = await fixture(info);
  } catch (e) {
    fixtureError = e;
  }
});
// A fixture that could not be made fails each check with its reason; cleanup still runs.
test.beforeEach(async ({ page }, info) => {
  if (fixtureError && !info.title.includes('zz cleanup')) throw fixtureError;
  // Every failed API answer the page got, for the report (paths only, no bodies).
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/v1/') && r.status() >= 400) {
      console.log(
        `API ${r.status()} ${r.request().method()} ${u.pathname}${u.search} [${info.title.slice(0, 40)}]`,
      );
    }
  });
});

// ---------------------------------------------------------------- Layout at both widths

for (const [name, path] of [
  ['list', '/bookkeeping'],
  ['settings', '/bookkeeping/settings'],
  ['reports', '/bookkeeping/reports'],
] as const) {
  test(`@narrow layout: ${name} page has no sideways scroll`, async ({ page }, info) => {
    await page.goto(app(path));
    await settled(page);
    await expectNoSideScroll(page);
    await shot(page, TAB, `layout-${name}`, info);
  });
}

test('@narrow layout: client workspace, every tab, no sideways scroll', async ({ page }, info) => {
  for (const t of ['overview', 'transactions', 'reconciliation', 'reports', 'notes', 'settings']) {
    await ws(page, f, `?tab=${t}`);
    await settled(page);
    await expectNoSideScroll(page);
    await shot(page, TAB, `layout-workspace-${t}`, info);
  }
  await page.goto(app(`/bookkeeping/clients/${f.a.bkId}/terms`));
  await settled(page);
  await expectNoSideScroll(page);
  await shot(page, TAB, 'layout-terms', info);
  await page.goto(app(`/bookkeeping/periods/${f.periodId}`));
  await settled(page);
  await expectNoSideScroll(page);
  await shot(page, TAB, 'layout-period', info);
});

// ---------------------------------------------------------------- Corrected (green)

test('D05 D06: a checklist document is typed without losing focus, saves and survives a reload', async ({
  page,
}, info) => {
  await page.goto(app('/bookkeeping/settings'));
  const list = page.getByTestId('doc-checklist');
  await list.getByRole('button', { name: 'Add document' }).click();
  const field = list.getByRole('textbox', { name: 'Document', exact: true }).last();
  await field.click();
  const text = `${f.tag} statements`;
  await page.keyboard.type(text, { delay: 15 });
  await expect(field).toHaveValue(text);
  await expect(field).toBeFocused();
  await page.getByRole('button', { name: /^Save/ }).first().click();
  await toast(page, /saved/i);
  await page.reload();
  const saved = page
    .getByTestId('doc-checklist')
    .getByRole('textbox', { name: 'Document', exact: true });
  await expect(saved.last()).toHaveValue(text);
  await shot(page, TAB, 'D05', info);
  // Remove it again (the firm's settings go back as they were).
  const rows = await saved.count();
  const remove = page.getByTestId('doc-checklist').getByRole('button', { name: /^Remove/ });
  await remove.nth(rows - 1).click();
  await page.getByRole('button', { name: /^Save/ }).first().click();
  await toast(page, /saved/i);
  await page.reload();
  await expect(page.getByTestId('doc-checklist')).not.toContainText(f.tag);
});

test('D05 D06: Assign starts on the current assignee, keeps the one chosen, and Unassign persists', async ({
  page,
}, info) => {
  await page.goto(app('/bookkeeping'));
  const open = async () => {
    await page.getByRole('button', { name: `Actions for ${f.a.name}` }).click();
    await page.getByRole('menuitem', { name: 'Assign/Reassign Staff' }).click();
    return page.getByRole('dialog');
  };
  let dialog = await open();
  const select = dialog.getByLabel('Assigned to');
  await expect(select).toBeEnabled();
  const option = select
    .locator('option')
    .filter({ hasText: /QA Perf Admin/ })
    .first();
  const name = ((await option.textContent()) ?? '').trim();
  expect(name).not.toBe('');
  await select.selectOption({ label: name });
  await dialog.getByRole('button', { name: 'Assign', exact: true }).click();
  await toast(page, `Assigned to ${name}.`);
  await page.reload();
  dialog = await open();
  await expect(dialog.getByTestId('assigned-now')).toHaveText(`Now: ${name}`);
  await shot(page, TAB, 'D06', info);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});

test('D04: Missing Documents counts days since the request was sent', async ({ page }, info) => {
  await page.goto(app('/bookkeeping/settings'));
  await expect(
    page.getByLabel('Missing Documents after (days since the request was sent)'),
  ).toBeVisible();
  await expect(page.getByTestId('missing-docs-help')).toContainText(/sent/);
  await shot(page, TAB, 'D04', info);
});

test('N01: Request Documents opens prefilled with the client, Bookkeeping and the period; Cancel closes it', async ({
  page,
}, info) => {
  await ws(page, f);
  await page.getByRole('button', { name: 'Request Documents' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(f.a.name);
  await expect(dialog).toContainText(/Bookkeeping/);
  await shot(page, TAB, 'N01', info);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});

test('N03a N02 N03: a staff-only upload saves once, survives a reload and opens in a quick view on the workspace', async ({
  page,
}, info) => {
  await ws(page, f);
  const card = page.getByTestId('shared-documents');
  await card.getByRole('button', { name: 'Upload Document' }).click();
  const file = `LIVE-CHECK-${f.tag.slice(-12)}.pdf`;
  await page.getByTestId('upload-document').locator('input[type=file]').setInputFiles(pdf(file));
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(card.getByRole('button', { name: `View ${file}` })).toBeVisible();
  await page.reload();
  const view = page.getByTestId('shared-documents').getByRole('button', { name: `View ${file}` });
  await expect(view).toHaveCount(1);
  const url = page.url();
  await view.click();
  const quick = page.getByRole('dialog', { name: file });
  await expect(quick.getByTestId('document-preview')).toBeVisible();
  expect(page.url()).toBe(url);
  await shot(page, TAB, 'N03a', info);
});

test('N05 update: a one-off task from Bookkeeping saves with client, service, assignee and due date, and the workspace counts it', async ({
  page,
}, info) => {
  await ws(page, f, '?tab=overview');
  const origin = page.url();
  await page.getByRole('link', { name: 'Create Task' }).first().click();
  await expect(page).toHaveURL(/\/tasks\/new\?/);
  // The engagement's service is the run's Bookkeeping service of Services & Pricing.
  await expect(page.locator('#tf-service option:checked')).toHaveText(`${f.tag} BK Service`);
  const title = `${f.tag} BK one-off task`;
  await page.locator('#tf-title').fill(title);
  // Only a harness login (never one of Octavia's), so no notice reaches a person.
  const assignee = page.getByLabel('Assigned to');
  const mine = assignee
    .locator('option')
    .filter({ hasText: /QA Perf/ })
    .first();
  await assignee.selectOption({ label: ((await mine.textContent()) ?? '').trim() });
  await page.locator('#tf-due').fill('2026-12-31');
  await page.getByRole('button', { name: 'Save Task' }).click();
  await expect(page).not.toHaveURL(/\/tasks\/new/);
  const id = /\/tasks\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (id) remember(info, (x) => x.taskIds.push(id));
  await page.goto(origin);
  await page.reload();
  await expect(page.getByTestId('shared-tasks')).toContainText(/1 open|Open\s*1|1/);
  await shot(page, TAB, 'N05-one-off', info);
});

test('N05 update: a daily series ending after two saves from Bookkeeping, with client, service and assignee, reminders and client notice off', async ({
  page,
}, info) => {
  await ws(page, f, '?tab=overview');
  await page.getByRole('link', { name: 'Create Task' }).first().click();
  await page.getByRole('switch', { name: 'Recurring Task' }).click();
  const leave = page.getByRole('button', { name: /Leave|Discard/ });
  if (await leave.count()) await leave.first().click();
  await expect(page).toHaveURL(/\/tasks\/recurring\/new\?/);
  const title = `${f.tag} BK recurrence`;
  await page.locator('#rf-title').fill(title);
  const type = page.locator('#rf-type');
  if ((await type.evaluate((e) => e.tagName)) === 'SELECT' && !(await type.inputValue())) {
    await type.selectOption({ index: 1 });
  }
  const assignee = page.locator('#rf-assignee');
  const mine = assignee
    .locator('option')
    .filter({ hasText: /QA Perf/ })
    .first();
  await assignee.selectOption({ label: ((await mine.textContent()) ?? '').trim() });
  await page.locator('#rf-interval').fill('1');
  await page.getByLabel('Unit').selectOption('DAY');
  await page.locator('#rf-start').fill(new Date().toISOString().slice(0, 10));
  await page.getByRole('radio', { name: /End after/ }).check();
  await page.getByRole('spinbutton', { name: 'Occurrences', exact: true }).fill('2');
  const remind = page.getByLabel('Enable reminders');
  if (await remind.isChecked()) await remind.uncheck();
  const notify = page.getByLabel('Notify client (if visible)');
  if ((await notify.count()) && (await notify.isChecked())) await notify.uncheck();
  await page.getByRole('button', { name: 'Save Recurring Task' }).click();
  await expect(page).toHaveURL(/\/tasks\/recurring\/[0-9a-f-]{36}/);
  const id = /\/tasks\/recurring\/([0-9a-f-]{36})/.exec(page.url())![1]!;
  remember(info, (x) => x.seriesIds.push(id));
  await page.reload();
  await expect(page.getByText(title).first()).toBeVisible();
  await expect(page.getByText(f.a.name).first()).toBeVisible();
  await shot(page, TAB, 'N05-series', info);
});

test('N04 update: a note saves once with its type and stays internal; the count and Notes tab show it after a reload', async ({
  page,
}, info) => {
  await ws(page, f);
  await page.getByRole('button', { name: 'Add Note' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add Note' });
  await expect(dialog.getByLabel('Note type')).toBeVisible();
  await expect(dialog.getByLabel('Related to')).toBeVisible();
  await expect(dialog.getByLabel('Internal (staff only)')).toBeChecked();
  const body = `${f.tag} BK note body`;
  await dialog.getByLabel('Note', { exact: true }).fill(body);
  await dialog.getByRole('button', { name: /^(Save|Add) Note$|^Save$/ }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await page.getByTestId('shared-notes').getByRole('button', { name: 'View All' }).click();
  await expect(page.getByTestId('bk-notes')).toContainText(body);
  await expect(page).toHaveURL(/[?&]tab=notes/);
  await shot(page, TAB, 'N04', info);
});

test('N06 update: Communications opens Messages on this client and Bookkeeping', async ({
  page,
}, info) => {
  await ws(page, f);
  const link = tabs(page).getByRole('tab', { name: 'Communications' });
  await expect(link).toHaveAttribute(
    'href',
    new RegExp(`/messages\\?clientId=${f.a.clientId}&service=Bookkeeping`),
  );
  await link.click();
  await expect(page).toHaveURL(/\/messages\?clientId=/);
  await expect(page.getByRole('combobox', { name: 'Client' }).locator('option:checked')).toHaveText(
    f.a.name,
  );
  await shot(page, TAB, 'N06', info);
});

test('N07: the Integrations link from a filtered list comes back to the same filtered list', async ({
  page,
}, info) => {
  await page.goto(app('/bookkeeping'));
  await page.getByTestId('bk-clients').getByLabel('Search clients').fill(f.a.name);
  await expect(page.getByTestId('bk-clients').getByTestId('bk-link')).toHaveCount(1);
  const filtered = page.url();
  await page.getByTestId('software').getByRole('link', { name: 'Manage Integrations' }).click();
  await expect(page).toHaveURL(/integrations/);
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(filtered);
  await expect(page.getByTestId('bk-clients').getByTestId('bk-link')).toHaveCount(1);
  await shot(page, TAB, 'N07', info);
});

// Reconciliation: one reconciliation of the LIVE-CHECK account carries R01b, R01c, R01 and G12.
test('R01b R01c R01 G12: nonzero difference blocks Approve on both screens; the discrepancy note saves; zero difference needs the statement', async ({
  page,
}, info) => {
  await ws(page, f, '?tab=reconciliation');
  const panel = page.getByTestId('reconciliation-panel');
  await expect(panel.getByRole('row').filter({ hasText: 'LIVE-CHECK Checking' })).toBeVisible();
  const start = panel.getByRole('button', { name: 'Start reconciling LIVE-CHECK Checking' });
  if (await start.count()) {
    await start.click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Beginning balance ($)').fill('1000');
    await dialog.getByLabel('Ending balance ($)').fill('1010');
    await dialog.getByRole('button', { name: 'Start Reconciling' }).click();
  } else {
    await panel
      .getByRole('link', { name: /LIVE-CHECK Checking/ })
      .first()
      .click();
  }
  await expect(page).toHaveURL(/\/bookkeeping\/reconciliations\//);
  const difference = page.getByTestId('recon-difference');
  await expect(difference).not.toContainText('$0.00');

  // R01 approved: the note beside the difference, kept after a reload.
  const note = `${f.tag} difference: bank fee not yet in the ledger`;
  await page.getByLabel('Note on the difference').fill(note);
  await page
    .getByRole('button', { name: /Save (Note|Progress)/ })
    .first()
    .click();
  await page.reload();
  await expect(page.getByTestId('recon-discrepancy-note')).toContainText(note);

  // R01b new test: Ready for Review with a difference, Approve stays off with its reason.
  await page.getByRole('button', { name: 'Attach Statement' }).click();
  await page
    .getByRole('dialog', { name: 'Attach Statement' })
    .getByLabel('Statement')
    .setInputFiles(pdf('LIVE-CHECK statement.pdf'));
  await page.getByRole('dialog').getByRole('button', { name: 'Attach' }).click();
  await toast(page, 'Statement attached.');
  await page.getByRole('button', { name: 'Ready for Review' }).click();
  await toast(page, 'Ready for review.');
  await page.reload();
  const reason = 'The difference must be zero to approve.';
  await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled();
  await expect(page.getByTestId('recon-blocked')).toHaveText(reason);
  await shot(page, TAB, 'R01b-recon', info);

  // G12 / R01 review: the Close Checklist's Approve is off too, with the same reason.
  await page.getByRole('link', { name: 'Close Checklist' }).click();
  await expect(page).toHaveURL(/\/bookkeeping\/periods\//);
  const blocked = page.getByTestId('close-recon-blocked');
  await expect(blocked).toHaveText(reason);
  await expect(blocked.locator('xpath=..').getByRole('button', { name: 'Approve' })).toBeDisabled();
  await shot(page, TAB, 'R01b-close', info);
});

test('R01c R01b: at a zero difference without a statement Approve is blocked with the attach instruction', async ({
  page,
}, info) => {
  // The second account (made with the fixture), reconciled to zero with no statement.
  await ws(page, f, '?tab=reconciliation');
  const panel = page.getByTestId('reconciliation-panel');
  await expect(panel.getByRole('row').filter({ hasText: 'LIVE-CHECK Card' })).toBeVisible();
  const start = panel.getByRole('button', { name: 'Start reconciling LIVE-CHECK Card' });
  if (await start.count()) {
    await start.click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Beginning balance ($)').fill('0');
    await dialog.getByLabel('Ending balance ($)').fill('0');
    await dialog.getByRole('button', { name: 'Start Reconciling' }).click();
  } else {
    await panel
      .getByRole('link', { name: /LIVE-CHECK Card/ })
      .first()
      .click();
  }
  await expect(page).toHaveURL(/\/bookkeeping\/reconciliations\//);
  await expect(page.getByTestId('recon-difference')).toContainText('$0.00');
  const ready = page.getByRole('button', { name: 'Ready for Review' });
  if (await ready.count()) await ready.click();
  await expect(page.getByRole('button', { name: 'Approve' })).toBeDisabled();
  await expect(page.getByTestId('recon-blocked')).toContainText(/statement/i);
  await shot(page, TAB, 'R01c', info);
});

test('RP02 RP01 RP03: a P&L report generates v1 and downloads a CSV with readable headings and no fake zeros; Refund and Settlement are offered', async ({
  page,
}, info) => {
  await ws(page, f, '?tab=reports');
  await page.getByRole('button', { name: 'Generate Report' }).click();
  const dialog = page.getByRole('dialog');
  const kind = dialog.getByLabel('Report');
  const options = await kind.locator('option').allInnerTexts();
  expect(options.join('|')).toMatch(/Refund/);
  expect(options.join('|')).toMatch(/Settlement/);
  await kind.selectOption({ label: options.find((o) => /Profit|P&L/.test(o))! });
  await dialog.getByLabel('Period').fill('October 2026');
  await dialog.getByRole('button', { name: /^(Add|Create)/ }).click();
  await expect(dialog).toHaveCount(0);
  const openVersions = async () => {
    await page.getByRole('button', { name: 'Actions for Profit & Loss' }).first().click();
    await page.getByRole('menuitem', { name: 'Figures & Versions' }).click();
    return page.getByRole('dialog', { name: /Figures & Versions/ });
  };
  // RP03: with no P&L source chosen, Generate waits and says why.
  let versions = await openVersions();
  await expect(versions).toContainText("Choose where this client's P&L comes from first");
  await expect(versions.getByRole('button', { name: 'Generate Version' })).toBeDisabled();
  await versions.getByRole('button', { name: 'Done' }).click();
  // Her RP03 case: entered in Firmivra, October income $1,000 and expenses $350 give net $650.
  await ws(page, f, '?tab=settings');
  await page.getByLabel(/^Entered in Firmivra/).check();
  await page.getByTestId('settings-tab').getByRole('button', { name: /^Save/ }).click();
  await toast(page, /saved/i);
  await page.goto(app(`/bookkeeping/periods/${f.periodId}`));
  await page.getByRole('button', { name: 'Enter figures' }).click();
  const figures = page.getByTestId('figures-dialog');
  await figures.getByLabel('Total income ($)').fill('1000');
  await figures.getByLabel('Total expenses ($)').fill('350');
  await page.getByRole('button', { name: 'Save Figures' }).click();
  await expect(figures).toHaveCount(0);
  await ws(page, f, '?tab=reports');
  versions = await openVersions();
  await expect(versions).toContainText('$650');
  await shot(page, TAB, 'RP03-preview', info);
  await versions.getByRole('button', { name: 'Generate Version' }).click();
  await expect(versions.getByText(/Version 1 ·/)).toBeVisible();
  await page.reload();
  versions = await openVersions();
  await expect(versions.getByText(/Version 1 ·/)).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    versions
      .getByRole('link', { name: /Download CSV/ })
      .first()
      .click(),
  ]);
  const csv = readFileSync((await download.path())!, 'utf8');
  console.log(`RP02 CSV head: ${JSON.stringify(csv.split('\n').slice(0, 8))}`);
  expect(csv).not.toMatch(/incomeCents|expensesCents|Cents\b/);
  expect(csv).toContain(f.a.name);
  expect(csv).toMatch(/650/);
  await shot(page, TAB, 'RP02', info);
});

test('P01: enrolling the same client twice is refused with a clear message', async ({
  page,
}, info) => {
  await page.goto(app('/bookkeeping'));
  await page.getByRole('button', { name: 'Add Client' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add Bookkeeping Client' });
  const select = dialog.getByLabel('Client', { exact: true });
  await expect(select.locator('option', { hasText: f.a.name })).toHaveCount(1);
  await select.selectOption({ label: f.a.name });
  await dialog.getByRole('button', { name: 'Add Client' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  const message = await dialog.getByRole('alert').innerText();
  expect(message).not.toMatch(/[A-Z_]{6,}|Error:|request/);
  await shot(page, TAB, 'P01', info);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});

test('P05 P06 Cross service: pause the service with a reason, effects shown before confirming, then resume', async ({
  page,
}, info) => {
  await page.goto(app('/bookkeeping'));
  await page.getByRole('button', { name: `Actions for ${f.b.name}` }).click();
  await page.getByRole('menuitem', { name: 'Pause Bookkeeping Service' }).click();
  const dialog = page.getByRole('dialog', { name: 'Service & Billing' });
  await expect(dialog.getByLabel('Service only')).toBeChecked();
  await expect(dialog.getByLabel('Billing only')).toBeVisible();
  await dialog.getByLabel('Reason for pausing the service').fill(`${f.tag} seasonal`);
  await expect(dialog.getByTestId('service-billing-effects')).not.toBeEmpty();
  await shot(page, TAB, 'cross-service-dialog', info);
  const confirm = dialog.getByLabel('I confirm these changes.');
  if (await confirm.count()) await confirm.check();
  await dialog.getByRole('button', { name: /^(Apply|Pause)/ }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  const row = page.getByRole('row').filter({ hasText: f.b.name });
  console.log(`P05 row after pause: ${await row.innerText()}`);
  await page.goto(app(`/bookkeeping/clients/${f.b.bkId}`));
  await expect(page.getByTestId('bk-client')).toBeVisible();
  await expect(page.getByTestId('bk-client')).toContainText(/Paused/);
  await shot(page, TAB, 'P06-paused', info);
});

test('D01 D02: the Active card and the list leave the paused client out; the status chart counts the cohort shown', async ({
  page,
}, info) => {
  await page.goto(app('/bookkeeping'));
  await page.getByRole('button', { name: /^Active Bookkeeping Clients/ }).click();
  await expect(page.getByRole('tab', { name: /^Active/ })).toHaveAttribute('aria-selected', 'true');
  const list = page.getByTestId('bk-clients');
  await expect(list.getByTestId('bk-link').filter({ hasText: f.a.name })).toHaveCount(1);
  await expect(list.getByTestId('bk-link').filter({ hasText: f.b.name })).toHaveCount(0);
  const card = await page.getByRole('button', { name: /^Active Bookkeeping Clients/ }).innerText();
  const shown = await list.getByTestId('bk-link').count();
  expect(Number(/\d+/.exec(card)?.[0])).toBe(shown);
  await shot(page, TAB, 'D01', info);
});

test('P06: resume the paused service', async ({ page }, info) => {
  await page.goto(app('/bookkeeping'));
  await page.getByRole('button', { name: `Actions for ${f.b.name}` }).click();
  await page.getByRole('menuitem', { name: /Resume Bookkeeping Service/ }).click();
  const dialog = page.getByRole('dialog');
  const confirm = dialog.getByLabel('I confirm these changes.');
  if (await confirm.count()) await confirm.check();
  await dialog.getByRole('button', { name: /^(Apply|Resume)/ }).click();
  await page.reload();
  await expect(page.getByRole('row').filter({ hasText: f.b.name })).not.toContainText(/Paused/);
  await shot(page, TAB, 'P06-resumed', info);
});

test('E01 renewal setting / E01 latest / E01b / D07: Create Terms is a draft with the package from Services & Pricing; Auto-Renew off survives a reload', async ({
  page,
}, info) => {
  await page.goto(app(`/bookkeeping/clients/${f.a.bkId}/terms`));
  const create = page.getByRole('button', { name: 'Create Terms' });
  await expect(create.or(page.getByTestId('terms-version'))).toBeVisible();
  if (await create.count()) await create.click();
  await expect(page.getByTestId('terms-version')).toContainText('Draft');
  const pkg = page.getByLabel('Package (from Services & Pricing)');
  await expect(pkg).toBeVisible();
  expect(await pkg.evaluate((e) => e.tagName)).toBe('SELECT');
  const renew = page.getByLabel('Auto-Renew');
  if (await renew.isChecked()) await renew.uncheck();
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await toast(page, 'Terms saved.');
  await page.reload();
  await expect(page.getByLabel('Auto-Renew')).not.toBeChecked();
  await shot(page, TAB, 'E01', info);
});

test('E01b confirmed: Payment Schedule View All opens Invoices on this client', async ({
  page,
}, info) => {
  await page.goto(app(`/bookkeeping/clients/${f.a.bkId}/terms`));
  const tab = page.getByRole('tab', { name: /Billing/ });
  if (await tab.count()) await tab.first().click();
  const link = page.getByTestId('terms-schedule').getByRole('link', { name: 'View All' });
  await expect(link).toHaveAttribute('href', new RegExp(`^/invoices\\?client=${f.a.clientId}`));
  await link.click();
  await expect(page).toHaveURL(/\/invoices\?client=/);
  await expect(page.getByLabel('Client', { exact: true }).locator('option:checked')).toHaveText(
    new RegExp(f.a.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
  await shot(page, TAB, 'E01b-invoices', info);
});

// ---------------------------------------------------------------- Needs correction (red)

test('D03: a custom Report Due range changes the rows at once, no reload; reversed dates are refused', async ({
  page,
}, info) => {
  await page.goto(app('/bookkeeping'));
  const links = page.getByTestId('bk-clients').getByTestId('bk-link');
  await expect(links.filter({ hasText: f.a.name })).toHaveCount(1);
  await expect(links.filter({ hasText: f.b.name })).toHaveCount(1);
  await page.evaluate(() => ((window as unknown as { stayed?: boolean }).stayed = true));
  await page.getByLabel('Report Due').selectOption('CUSTOM');
  const custom = page.getByTestId('due-custom');
  await custom.getByLabel('Due from').fill('2026-12-01');
  await custom.getByLabel('Due to').fill('2026-12-10');
  await expect(links.filter({ hasText: f.a.name })).toHaveCount(1);
  await expect(links.filter({ hasText: f.b.name })).toHaveCount(0);
  await custom.getByLabel('Due to').fill('2026-12-31');
  await expect(links.filter({ hasText: f.b.name })).toHaveCount(1);
  await custom.getByLabel('Due from').fill('2027-01-10');
  await expect(custom.getByRole('alert')).toHaveText('The start date is after the end date.');
  expect(await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed)).toBe(true);
  await shot(page, TAB, 'D03', info);
});

test('N02 N03 + Tasks tab scope: View All opens Documents on this client, service and period; Tasks on this client', async ({
  page,
}, info) => {
  await ws(page, f);
  await expect(
    page.getByTestId('shared-tasks').getByRole('link', { name: 'View All' }),
  ).toHaveAttribute('href', new RegExp(`^/tasks\\?clientId=${f.a.clientId}`));
  await page.getByTestId('shared-documents').getByRole('link', { name: 'View All' }).click();
  await expect(page).toHaveURL(new RegExp(`/documents\\?clientId=${f.a.clientId}&serviceId=`));
  await expect(page.getByTestId('documents-scope')).toContainText(f.a.name);
  await shot(page, TAB, 'N02', info);
  await page.goBack();
  await tabs(page).getByRole('tab', { name: 'Tasks' }).click();
  await expect(page).toHaveURL(new RegExp(`/tasks\\?clientId=${f.a.clientId}`));
  await expect(page.getByRole('combobox', { name: 'Client' }).locator('option:checked')).toHaveText(
    f.a.name,
  );
  await shot(page, TAB, 'tasks-scope', info);
});

test('N04 update (route): the Notes tab opens Notes and keeps it after a reload', async ({
  page,
}, info) => {
  await ws(page, f);
  await tabs(page).getByRole('tab', { name: 'Notes' }).click();
  await expect(page.getByTestId('bk-notes')).toBeVisible();
  await expect(tabs(page).getByRole('tab', { name: 'Notes' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.reload();
  await expect(page.getByTestId('bk-notes')).toBeVisible();
  await shot(page, TAB, 'N04-route', info);
});

test('N05 update: switching a new task to recurring keeps client and engagement; Related To links back', async ({
  page,
}, info) => {
  await ws(page, f, '?tab=overview');
  await page.getByRole('link', { name: 'Create Task' }).first().click();
  await expect(page).toHaveURL(/\/tasks\/new\?/);
  const client = page.getByRole('combobox', { name: 'Client' });
  await expect(client).toHaveValue(f.a.name);
  const related = page.getByLabel('Related to');
  await expect(related.locator('option:checked')).toHaveText(/Bookkeeping/);
  // The Recurring Task switch opens the recurring form, which must keep client and engagement.
  await page.getByRole('switch', { name: 'Recurring Task' }).click();
  const leave = page.getByRole('button', { name: /Leave|Discard/ });
  if (await leave.count()) await leave.first().click();
  await expect(page).toHaveURL(/\/tasks\/recurring\/new\?/);
  const shown = (sel: string) =>
    page
      .locator(sel)
      .evaluate((e) =>
        e instanceof HTMLSelectElement
          ? (e.selectedOptions[0]?.textContent ?? '')
          : ((e as HTMLInputElement).value ?? e.textContent ?? ''),
      );
  await expect.poll(() => shown('#rf-client')).toContain(f.a.name);
  await expect.poll(() => shown('#rf-related')).toMatch(/Bookkeeping/);
  await shot(page, TAB, 'N05-recurrence', info);
});

test('N05 original: Create Task starts on the Bookkeeping service and Cancel returns to the workspace', async ({
  page,
}, info) => {
  await ws(page, f, '?tab=overview');
  const origin = page.url();
  await page.getByRole('link', { name: 'Create Task' }).first().click();
  const service = page.locator('#tf-service');
  await expect(service).not.toHaveValue('');
  await expect(service.locator('option:checked')).toHaveText(`${f.tag} BK Service`);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(origin);
  await expect(page.getByTestId('quick-actions')).toBeVisible();
  await shot(page, TAB, 'N05-original', info);
});

test('N08: Categorize opens Transactions and survives a reload; Back from Terms returns to the tab it left', async ({
  page,
}, info) => {
  await ws(page, f);
  await page
    .getByTestId('quick-actions')
    .getByRole('button', { name: 'Categorize Transactions' })
    .click();
  await expect(page.getByTestId('transactions-tab')).toBeVisible();
  await expect(page).toHaveURL(/[?&]tab=transactions/);
  await page.reload();
  await expect(page.getByTestId('transactions-tab')).toBeVisible();
  await tabs(page).getByRole('tab', { name: 'Reconciliation' }).click();
  await expect(page).toHaveURL(/[?&]tab=reconciliation/);
  await tabs(page).getByRole('tab', { name: 'Terms' }).click();
  await expect(page).toHaveURL(/\/terms/);
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(/[?&]tab=reconciliation/);
  await expect(tabs(page).getByRole('tab', { name: 'Reconciliation' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await shot(page, TAB, 'N08', info);
});

test('New approved: Documents Archived and Trash explain themselves in plain words', async ({
  page,
}, info) => {
  await page.goto(app(`/documents?clientId=${f.a.clientId}`));
  const archived = page.getByTestId('folder-archived');
  await expect(archived).toBeDisabled();
  await expect(archived).toHaveAccessibleDescription(
    'Archived documents are not available yet. Every document stays in its client’s list.',
  );
  await expect(page.getByTestId('folder-trash')).toHaveAccessibleDescription(
    'Trash is empty: documents cannot be deleted here yet, so nothing is ever lost.',
  );
  await shot(page, TAB, 'documents-messages', info);
});

test('New approved: every workspace tab, Settings too, is visible at desktop width without sideways scroll', async ({
  page,
}, info) => {
  await ws(page, f);
  await expect(tabs(page).getByRole('tab', { name: 'Settings' })).toBeInViewport();
  await expectNoSideScroll(page);
  await shot(page, TAB, 'desktop-tabs', info);
});

test('RP03 approved: Settings offers the P&L source choice, saved and kept after a reload', async ({
  page,
}, info) => {
  await ws(page, f, '?tab=settings');
  const manual = page.getByLabel(/^Entered in Firmivra/);
  const software = page.getByLabel(/^Connected accounting software/);
  await expect(manual).toBeVisible();
  await expect(software).toBeVisible();
  await manual.check();
  await page.getByTestId('settings-tab').getByRole('button', { name: /^Save/ }).click();
  await toast(page, /saved/i);
  await page.reload();
  await expect(page.getByLabel(/^Entered in Firmivra/)).toBeChecked();
  await shot(page, TAB, 'RP03', info);
});

// ---------------------------------------------------------------- Partially fixed (yellow)

test('I01: the software card says linked and authorized apart from synced', async ({
  page,
}, info) => {
  await page.goto(app('/bookkeeping'));
  const card = page.getByTestId('software');
  await expect(card.getByTestId('provider-states')).toContainText(
    'figures arrive only after the first successful sync',
  );
  await shot(page, TAB, 'I01', info);
});

test('I02 I03: with no synced data the workspace shows dashes, not zeros', async ({
  page,
}, info) => {
  await ws(page, f);
  await expect(page.getByTestId('ytd')).not.toContainText('$0.00');
  await shot(page, TAB, 'I02', info);
});

test('D07: Add Client and the Plan Type filter offer the bookkeeping services of Services & Pricing', async ({
  page,
}, info) => {
  await page.goto(app('/bookkeeping'));
  await page.getByRole('button', { name: 'Add Client' }).first().click();
  const dialog = page.getByRole('dialog');
  const plan = dialog.getByRole('combobox', { name: 'Plan', exact: true });
  await expect(plan.locator('option', { hasText: `${f.tag} BK Service` })).toHaveCount(1);
  await expect(dialog.getByText(/Choosing a plan does not bill the client/)).toBeVisible();
  await shot(page, TAB, 'D07', info);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});

test('T01a: Transactions has search, amount and source filters and says where data comes from', async ({
  page,
}, info) => {
  await ws(page, f, '?tab=transactions');
  const tab = page.getByTestId('transactions-tab');
  await expect(tab.getByLabel('Search')).toBeVisible();
  await expect(tab.getByLabel('Debit / Credit')).toBeVisible();
  await tab.getByLabel('From', { exact: true }).fill('2026-12-10');
  await tab.getByLabel('To', { exact: true }).fill('2026-12-01');
  await expect(tab.getByRole('alert')).toHaveText('The start date is after the end date.');
  await shot(page, TAB, 'T01a', info);
});

test('R01a R01d: the period shows the reconciliation and the close checklist areas', async ({
  page,
}, info) => {
  await page.goto(app(`/bookkeeping/periods/${f.periodId}`));
  const items = page.getByTestId('checklist').getByRole('checkbox');
  await expect(items.first()).toBeVisible();
  expect(await items.count()).toBeGreaterThanOrEqual(12);
  await expect(page.getByTestId('reconciliations')).toContainText('LIVE-CHECK Checking');
  await shot(page, TAB, 'R01a', info);
});

test('E01a A01: Terms has its six areas; Activity View All opens the history and Back returns', async ({
  page,
}, info) => {
  await page.goto(app(`/bookkeeping/clients/${f.a.bkId}/terms`));
  await expect(page.getByRole('tablist', { name: 'Terms areas' }).getByRole('tab')).toHaveCount(6);
  await ws(page, f);
  const activity = page.getByTestId('client-activity');
  await expect(activity).toContainText('Terms version 1');
  await activity.getByRole('link', { name: 'View All' }).click();
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}\/activity\?/);
  await expect(page.getByText(/note/i).first()).toBeVisible();
  await shot(page, TAB, 'E01a', info);
  const back = page.getByTestId('back-to-origin');
  await expect(back).toHaveText('Back to Bookkeeping');
  await back.click();
  await expect(page.getByTestId('client-activity')).toBeVisible();
});

test('E01a A01: View All is the whole history, so it has the Terms and report events the card shows', async ({
  page,
}, info) => {
  await ws(page, f);
  await expect(page.getByTestId('client-activity')).toContainText('Terms version 1');
  await page.getByTestId('client-activity').getByRole('link', { name: 'View All' }).click();
  await expect(page).toHaveURL(/\/activity\?/);
  await settled(page);
  await shot(page, TAB, 'A01-view-all-history', info);
  await expect(page.getByText(/Terms version 1/).first()).toBeVisible({ timeout: 5_000 });
});

test('E01a A01: Activity lines read as words, never raw codes', async ({ page }, info) => {
  // The bookkeeping feed in full, through the page's own session (the card shows five lines).
  const res = await page.request.get(
    app(`/api/v1/business/bookkeeping/clients/${f.a.bkId}/activities?pageSize=100`),
  );
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { items?: unknown[] };
  const lines =
    JSON.stringify(body.items ?? body).match(
      /"(?:summary|title|text|message|description)":"[^"]*"/g,
    ) ?? [];
  const code = /\b[A-Z]+_[A-Z_]+\b|\b(GENERAL|OVERDUE|ACTIVE|PAUSED|PENDING|DRAFT|ON_TRACK)\b/;
  const bkRaw = lines.filter((l) => code.test(l));
  // And the client Activity page that View All opens.
  await ws(page, f);
  await page.getByTestId('client-activity').getByRole('link', { name: 'View All' }).click();
  await expect(page).toHaveURL(/\/activity\?/);
  await settled(page);
  const pageRaw = (await page.locator('main').innerText()).split('\n').filter((l) => code.test(l));
  console.log(
    `ACTIVITY raw: bookkeeping ${JSON.stringify(bkRaw.slice(0, 5))} page ${JSON.stringify(pageRaw.slice(0, 5))}`,
  );
  await shot(page, TAB, 'A01-activity-wording', info);
  expect([...bkRaw, ...pageRaw]).toEqual([]);
});

test('P04 P07 P08 P09: status tab, search and Clear All filter the list', async ({
  page,
}, info) => {
  await page.goto(app('/bookkeeping'));
  const list = page.getByTestId('bk-clients');
  await list.getByLabel('Search clients').fill(f.b.name);
  await expect(list.getByTestId('bk-link')).toHaveCount(1);
  await page.getByRole('button', { name: 'Clear All' }).click();
  await expect(list.getByTestId('bk-link').filter({ hasText: f.tag })).toHaveCount(2);
  await page.getByRole('tab', { name: 'All Clients' }).click();
  await shot(page, TAB, 'P04', info);
});

// ---------------------------------------------------------------- Roles (T01b R01 RP04, X02)

test.describe('as Staff (not assigned)', () => {
  test.use(as('staff'));
  test('X02 T01b: Staff do not see a client they are not assigned to', async ({ page }, info) => {
    await page.goto(app('/bookkeeping'));
    await settled(page);
    await expect(page.getByTestId('bk-clients').getByText(f.b.name)).toHaveCount(0);
    await shot(page, TAB, 'X02-staff', info);
  });
});

test.describe('as Admin (assigned to Alpha)', () => {
  test.use(as('admin'));
  test('X02: Admin opens the workspace of the LIVE-CHECK client', async ({ page }, info) => {
    await ws(page, f);
    await shot(page, TAB, 'X02-admin', info);
  });
});

// ---------------------------------------------------------------- Rows that cannot be checked live

const NOT_LIVE: [string, string][] = [
  [
    'N06 update: user confirmed notice receipt',
    'her own inbox receipt; a send would only reach the SES simulator',
  ],
  ['N06 SMS', 'SMS delivery is Review Three (production); texting is limited to leads'],
  [
    'F4 F5 T01c refund treatment and payout matching',
    'needs a synced ledger (provider sandbox), Review Three',
  ],
  ['I02 I03 successful sync', 'needs a provider sandbox'],
  ['F14 M7 integration dependency', 'provider authorization and mapping, Integrations review'],
  [
    'R01 fixture / R01d Review Three',
    "the row's fixture is in LVP (never touched); close/reopen is Review Three",
  ],
  ['E01b history', 'payments and refunds: Review Three'],
  ['C01 C02 C03 C04 C05 C06 C07', 'product decisions, not behaviour'],
  [
    'N04 N06 X03 portal note isolation; A01 client upload',
    'needs a portal client enrolled in Bookkeeping; the only Test Firm B portal login is shared with Octavia',
  ],
  [
    'F9 C08 / F10-F13 / L02 P03 X01 X04-X06 / RP02 remaining',
    'requirement lists for Review Three; parts are covered by the rows above',
  ],
];
for (const [row, why] of NOT_LIVE) {
  test(`${row} (not live)`, () => {
    test.skip(true, why);
  });
}

// ---------------------------------------------------------------- Cleanup

// eslint-disable-next-line no-empty-pattern -- Playwright needs a destructured first argument
test('@narrow zz cleanup: archive what this run made', async ({}, info) => {
  const path = fixturePath(info);
  if (!existsSync(path)) return;
  const x = JSON.parse(readFileSync(path, 'utf8')) as Fixture;
  const api = await apiAs('owner');
  const failures: string[] = [];
  const tryPost = async (p: string, data: unknown = {}) => {
    const r = await api.post(p, { data });
    if (!r.ok() && r.status() !== 409) failures.push(`${p} ${r.status()}`);
  };
  // Tasks the run made, found by the tag as well as by id.
  const found = await api.get(`business/tasks?search=${encodeURIComponent(x.tag)}&limit=50`);
  const ids = new Set(x.taskIds);
  if (found.ok()) for (const t of (await found.json()).items ?? []) ids.add(t.id);
  for (const id of ids) await tryPost(`business/tasks/${id}/archive`);
  for (const id of x.seriesIds) await tryPost(`business/task-series/${id}/stop`);
  for (const c of [x.a, x.b]) {
    if (c?.bkId) {
      await tryPost(`business/bookkeeping/clients/${c.bkId}/archive`, {
        reason: 'LIVE-CHECK cleanup',
      });
    }
  }
  for (const id of x.clientIds ?? []) await tryPost(`business/clients/${id}/archive`);
  if (x.serviceId) {
    // Delete is refused once anything used the service; then it is archived.
    const del = await api.delete(`business/catalog/services/${x.serviceId}`);
    if (!del.ok()) {
      await tryPost(`business/catalog/services/${x.serviceId}/deactivate`);
      await tryPost(`business/catalog/services/${x.serviceId}/archive`);
    }
  }
  if (x.categoryId) {
    const del = await api.delete(`business/catalog/categories/${x.categoryId}`);
    if (!del.ok()) {
      // In use by the archived service: deactivate it (the API's own advice).
      const off = await api.put(`business/catalog/categories/${x.categoryId}`, {
        data: { name: `${x.tag} BK cat`, status: 'INACTIVE' },
      });
      if (!off.ok())
        failures.push(
          `category ${x.categoryId}: delete ${del.status()}, deactivate ${off.status()}`,
        );
    }
  }
  await api.dispose();
  unlinkSync(path);
  console.log(`cleanup ${x.tag}: ${failures.length ? failures.join(', ') : 'all archived'}`);
  expect(failures).toEqual([]);
});
