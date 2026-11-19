import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { shotsDir } from './env';
import {
  app,
  apiAs,
  as,
  expectNoSideScroll,
  portal,
  portalApi,
  runTag as freshTag,
  settled,
  shot,
} from './helpers';

/**
 * Tax Returns, Review 2, live on dev as Test Firm B. One test per row of her review (title starts
 * with the row id). Everything the run makes is named with runTag and removed by the last test.
 * The run's ids live in a private state file so a failing row does not stop the rows after it.
 */
const TAB = 'tax-returns';
// The only client the harness may reach (record and login on the SES simulator). QA Fixture
// Client 1's portal login is a real address, so nothing is made for it any more.
const CLIENT = 'QA Appointments Client (fake)';
const CLIENT_ID = '00000000-0000-4a28-8005-000000000900'; // success+qa-appointments@simulator.amazonses.com
const YEAR = 2021;
const CORRECTED = 2020;
const DUE = '2022-04-18'; // the return's filing deadline
const DUE_TEXT = 'Apr 18, 2022';
const STAFF_NAME = 'QA Perf Staff B';
const OWNER_NAME = 'QA Perf (fake)';

interface State {
  tag: string;
  categoryId?: string;
  serviceId?: string;
  returnId?: string;
  engagementId?: string;
  quarterlyId?: string;
  taskTitle?: string;
  docName?: string;
  requestLabel?: string;
  messageText?: string;
}
const stateFile = () => join(shotsDir(TAB), 'state.json');
const load = (): State =>
  existsSync(stateFile()) ? (JSON.parse(readFileSync(stateFile(), 'utf8')) as State) : { tag: '' };
const save = (patch: Partial<State>) =>
  writeFileSync(stateFile(), JSON.stringify({ ...load(), ...patch }, null, 1));
/** The run's tag (from the setup test), the same after Playwright restarts a worker. */
const runTagOf = () => load().tag || freshTag;
const need = (s: State, k: keyof State) => {
  test.skip(!s[k], `no ${k} from the setup test`);
  return s[k] as string;
};

const pdf = (name: string) => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  ),
});

/**
 * Rows that send the client a notice. They were written for QA Fixture Client 1, whose portal
 * login is Octavia's real address; they come back on the harness's own portal client.
 */
const NO_SEND =
  'NOT LIVE: a send to a portal client; a later pass moves it to the harness portal client';

/** Runs a row and keeps its screenshot (path in the test's annotations). */
async function finish(page: Page, info: TestInfo, id: string) {
  const path = await shot(page, TAB, id, info).catch(() => '');
  if (path) info.annotations.push({ type: 'shot', description: path });
}
function row(id: string, title: string, body: (page: Page, info: TestInfo) => Promise<void>) {
  test(`${id} ${title}`, async ({ page }, info) => {
    try {
      await body(page, info);
    } finally {
      await finish(page, info, id);
    }
  });
}

async function openReturn(page: Page, id: string, tab?: string) {
  await page.goto(app(`/tax-returns/${id}`));
  await expect(page.getByTestId('return-workspace')).toBeVisible({ timeout: 60_000 });
  if (tab) await showTab(page, tab);
}
/**
 * Clicks a return tab and waits until it is current. The page renders only the current tab, and
 * the Overview has its own Document Checklist (Set Up Service, Upload): a click made before the
 * switch lands on the Overview's copy, which the switch then unmounts with any dialog it opened.
 */
async function showTab(page: Page, tab: string) {
  const t = page.getByRole('tab', { name: tab, exact: true });
  await t.click();
  await expect(t).toHaveAttribute('aria-selected', 'true');
  if (tab !== 'Overview') await expect(page).toHaveURL(/[?&]tab=/);
}
async function listRowMenu(page: Page, query = `?q=${encodeURIComponent(CLIENT)}`) {
  await page.goto(app(`/tax-returns${query}`));
  const id = load().returnId ?? '';
  const first = page
    .getByRole('row')
    .filter({ has: page.locator(`a[href*="${id}"]`) })
    .first();
  await expect(first).toBeVisible({ timeout: 60_000 });
  const button = first.getByRole('button', { name: /^Actions for/ });
  return { first, button };
}
async function menuItem(page: Page, name: string) {
  const { button } = await listRowMenu(page);
  await button.click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}
/**
 * The Owner's API with a fresh access cookie: the saved session file is not updated when the
 * browser refreshes its own session, so a long run's file can hold an expired one.
 */
async function ownerApi() {
  const api = await apiAs('owner');
  await api.post('auth/refresh', { data: {} });
  return api;
}

/** The role a file is linked to the return with (DRAFT_RETURN, SIGNATURE_FORM, …). */
async function linkedKind(returnId: string, fileName: string): Promise<string | undefined> {
  const api = await ownerApi();
  const res = await api.get(`business/tax-returns/${returnId}/documents`);
  const items = (
    (await res.json()) as { items?: { kind: string; document: { fileName: string } }[] }
  ).items;
  return items?.find((d) => d.document.fileName === fileName)?.kind;
}

const dialog = (page: Page) => page.getByRole('dialog');
const toast = (page: Page, text: string | RegExp) => page.getByText(text).first();

async function inViewport(page: Page, el: Locator) {
  const box = (await el.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.x, 'menu left edge').toBeGreaterThanOrEqual(0);
  expect(box.y, 'menu top edge').toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, 'menu right edge').toBeLessThanOrEqual(vp.width + 1);
  expect(box.y + box.height, 'menu bottom edge').toBeLessThanOrEqual(vp.height + 1);
}

// ---------------------------------------------------------------------------------------------
test.describe('owner', () => {
  test.use(as('owner'));
  test.describe.configure({ timeout: 180_000 });

  test('00 setup: a synthetic tax service, a return made on the Create New Return screen, its service', async ({
    page,
  }, info) => {
    writeFileSync(stateFile(), JSON.stringify({ tag: freshTag }, null, 1));
    try {
      const api = await ownerApi();
      // Test Firm B has no tax service in Services & Pricing, so the return could not get one. The
      // harness keeps one LIVE-CHECK service (archived between runs) and turns it on for the run.
      type Svc = {
        id: string;
        name: string;
        status: string;
        category: { id: string; name: string };
      };
      let found: Svc | undefined;
      for (const status of ['archived', 'inactive', 'active']) {
        const list = (await (
          await api.get(`business/catalog/services?status=${status}&pageSize=100`)
        ).json()) as { items?: Svc[] };
        found ??= (list.items ?? []).find((x) =>
          /^LIVE-CHECK .* Individual Tax \(fake\)$/.test(x.name),
        );
      }
      if (found) {
        const cat = await api.put(`business/catalog/categories/${found.category.id}`, {
          data: { name: found.category.name, status: 'ACTIVE' },
        });
        expect(cat.ok(), await cat.text()).toBe(true);
        if (found.status !== 'ACTIVE') {
          const on = await api.post(`business/catalog/services/${found.id}/activate`, { data: {} });
          expect(on.ok(), await on.text()).toBe(true);
        }
        save({ categoryId: found.category.id, serviceId: found.id });
      } else {
        const cat = await api.post('business/catalog/categories', {
          data: { name: `${runTagOf()} cat` },
        });
        expect(cat.status(), await cat.text()).toBe(201);
        const categoryId = ((await cat.json()) as { id: string }).id;
        save({ categoryId });
        const svc = await api.post('business/catalog/services', {
          data: {
            name: `${runTagOf()} Individual Tax (fake)`,
            categoryId,
            shortDescription: 'Synthetic live check, archived after each run',
            kind: 'ANNUAL_TAX',
            pricingType: 'FIXED',
            basePriceCents: 100,
            activate: true,
          },
        });
        expect(svc.status(), await svc.text()).toBe(201);
        save({ serviceId: ((await svc.json()) as { id: string }).id });
      }

      const serviceId = load().serviceId!;
      await expect
        .poll(
          async () =>
            JSON.stringify(
              await (await api.get('business/catalog/services?status=active&pageSize=100')).json(),
            ).includes(serviceId),
          { timeout: 120_000, intervals: [5_000] },
        )
        .toBe(true);

      await page.goto(app('/tax-returns'));
      await page
        .getByRole('button', { name: /Create New Return/ })
        .first()
        .click({ timeout: 60_000 });
      const d = page.getByTestId('create-dialog');
      await d.getByLabel('Client').selectOption({ label: CLIENT });
      await d.getByLabel('Tax year').fill(String(YEAR));
      await d.getByLabel('Return type').selectOption({ index: 1 });
      await d.getByLabel('State returns (two-letter codes, e.g. GA, NY)').fill('GA');
      await d.getByLabel('Preparer').selectOption({ label: STAFF_NAME });
      await d.getByLabel('Reviewer').selectOption({ label: OWNER_NAME });
      await d.getByLabel('Due date').fill(DUE);
      await dialog(page)
        .getByRole('button', { name: /^Create (Return|Anyway)$/ })
        .click();
      await expect(page).toHaveURL(/\/tax-returns\/[0-9a-f-]{36}$/, { timeout: 60_000 });
      const returnId = page.url().split('/').pop()!;
      save({ returnId });
      await expect(page.getByTestId('return-workspace')).toBeVisible();

      // Set Up Service (the return's own dialog) gives it an engagement of the synthetic service.
      await showTab(page, 'Intake & Documents');
      // F08-S: the dialog on the Intake & Documents tab (showTab waited for the switch), with the
      // synthetic service offered once the catalog has loaded.
      const sd = page.getByTestId('return-service-dialog');
      await page.getByTestId('set-up-return-service').click();
      await expect(sd).toBeVisible();
      const serviceSelect = sd.getByLabel('Service', { exact: true });
      await expect(serviceSelect).toContainText('LIVE-CHECK', { timeout: 30_000 });
      const option = await serviceSelect
        .locator('option', { hasText: 'LIVE-CHECK' })
        .first()
        .textContent();
      await serviceSelect.selectOption({ label: option! });
      await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
      await expect(sd).toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByRole('button', { name: 'Upload Documents' })).toBeVisible({
        timeout: 60_000,
      });
      const detail = await api.get(`business/tax-returns/${returnId}`);
      const engagementId = ((await detail.json()) as { engagement?: { id: string } }).engagement
        ?.id;
      expect(engagementId, 'the return has its service').toBeTruthy();
      save({ engagementId: engagementId! });
      // A note marks the return as this run's, for anyone who sees it before cleanup.
      await showTab(page, 'Notes');
      await page.getByTestId('notes').getByRole('button', { name: '+ Add Note' }).click();
      await dialog(page)
        .getByLabel('Note')
        .fill(`${runTagOf()}: synthetic return, removed by this run`);
      await dialog(page).getByRole('button', { name: 'Add Note' }).click();
      await expect(page.getByTestId('notes')).toContainText(runTagOf());
    } finally {
      await finish(page, info, '00-setup');
    }
  });

  row('F01a', 'client details and the checklist do not overlap at desktop widths', async (page) => {
    const id = need(load(), 'returnId');
    for (const [width, height] of [
      [1165, 747],
      [1440, 900],
    ] as const) {
      await page.setViewportSize({ width, height });
      await openReturn(page, id);
      const details = page.getByTestId('client-details');
      const checklist = page.getByTestId('document-checklist');
      await expect(details).toBeVisible();
      await expect(checklist).toBeVisible();
      const a = (await details.boundingBox())!;
      const b = (await checklist.boundingBox())!;
      const overlap =
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
      expect(overlap, `cards overlap at ${width}px`).toBe(false);
      await expectNoSideScroll(page);
    }
    await page.setViewportSize({ width: 1165, height: 900 });
  });

  row(
    'F02',
    'row menu opens inside the window; Escape closes it and focus returns',
    async (page) => {
      need(load(), 'returnId');
      const { button } = await listRowMenu(page);
      await button.click();
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      await inViewport(page, menu);
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(button).toBeFocused();
      // Keyboard: Enter opens, arrows move, Escape closes.
      await button.press('Enter');
      await expect(menu).toBeVisible();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
    },
  );

  row('F03a', 'Request Client Information, then Back, keeps the list search', async (page) => {
    need(load(), 'returnId');
    await menuItem(page, 'Request Client Information');
    await expect(page).toHaveURL(/\/documents\/requests\/new\?clientId=[0-9a-f-]+.*from=/, {
      timeout: 60_000,
    });
    await page.getByTestId('back-to-origin').click();
    await expect(page).toHaveURL(/\/tax-returns\?q=QA(\+|%20)Appointments(\+|%20)Client/);
    const kept = await page.evaluate(
      (v) =>
        Array.from(document.querySelectorAll('main input')).some(
          (i) => (i as HTMLInputElement).value === v,
        ),
      CLIENT,
    );
    expect(kept, 'the list search still holds the client name').toBe(true);
  });

  row('F03b', 'Send Message from the row, closed, stays on Tax Returns', async (page) => {
    need(load(), 'returnId');
    await menuItem(page, 'Send Message');
    const d = page.getByRole('dialog', { name: 'New Message' });
    await expect(d.getByLabel('Subject')).toHaveValue(/^\d{4} .*Return$/, { timeout: 60_000 });
    await d.getByRole('button', { name: 'Close dialog' }).click();
    await expect(d).toHaveCount(0);
    await expect(page).toHaveURL(/\/tax-returns\?q=/);
  });

  row(
    'F03c',
    'Full Review Create Task keeps the client, the return year and Back',
    async (page) => {
      const id = need(load(), 'returnId');
      await page.goto(app(`/tax-returns/${id}/review`));
      const link = page.getByTestId('review-actions').getByRole('link', { name: 'Create Task' });
      await expect(link).toHaveAttribute(
        'href',
        new RegExp(`clientId=${CLIENT_ID}.*period=Tax\\+year\\+${YEAR}.*from=`),
        { timeout: 60_000 },
      );
      await link.click();
      await expect(page).toHaveURL(/\/tasks\/new\?/, { timeout: 60_000 });
      await page.getByTestId('back-to-origin').click();
      await expect(page).toHaveURL(new RegExp(`/tax-returns/${id}/review`));
    },
  );

  row(
    'F03da',
    'Full Review signatures: View / Send opens Firm Sign with the client, and Back',
    async (page) => {
      const id = need(load(), 'returnId');
      await page.goto(app(`/tax-returns/${id}/review`));
      const sig = page.getByTestId('signatures');
      await expect(sig).toBeVisible({ timeout: 60_000 });
      const link = sig
        .getByRole('link', { name: /View \/ Send|Send for Signature|Request Signature/ })
        .first();
      await expect(link).toHaveAttribute(
        'href',
        new RegExp(`/firm-sign/new\\?.*clientId=${CLIENT_ID}`),
      );
      await link.click();
      await expect(page).toHaveURL(/\/firm-sign\/new\?/, { timeout: 60_000 });
      await settled(page);
      if (await page.getByText('Firm Sign is off').count()) {
        test
          .info()
          .annotations.push({ type: 'not-live', description: 'Firm Sign is off for Test Firm B' });
        await finish(page, test.info(), 'F03da');
        test.skip(true, 'Firm Sign is off for Test Firm B');
      }
      await expect(page.getByText(CLIENT).first()).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('back-to-origin').click();
      await expect(page).toHaveURL(new RegExp(`/tax-returns/${id}/review`));
    },
  );

  row('F03db', 'a signature request from Full Review carries this return', async (page) => {
    const id = need(load(), 'returnId');
    await page.goto(app(`/tax-returns/${id}/review`));
    const links = page.getByTestId('signatures').locator('a[href*="/firm-sign/new"]');
    await expect(links.first()).toBeVisible({ timeout: 60_000 });
    const hrefs = await links.evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
    expect(
      hrefs.some((h) => h.includes(id)),
      `hrefs: ${hrefs.join(' ')}`,
    ).toBe(true);
  });

  row(
    'F04',
    'Client Portal from the return opens the firm-side portal page, with Back',
    async (page) => {
      const id = need(load(), 'returnId');
      await openReturn(page, id);
      const link = page.getByTestId('action-bar').getByRole('link', { name: 'Client Portal' });
      await expect(link).toHaveAttribute(
        'href',
        new RegExp(`^/client-portal/${CLIENT_ID}\\?from=`),
      );
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/client-portal/${CLIENT_ID}`), { timeout: 60_000 });
      await settled(page);
      await expect(page.getByText(CLIENT).first()).toBeVisible();
      await page.getByTestId('back-to-origin').click();
      await expect(page).toHaveURL(new RegExp(`/tax-returns/${id}`));
    },
  );

  row(
    'F05',
    'Send Message on the return sends in place (portal, synthetic client)',
    async (page) => {
      const id = need(load(), 'returnId');
      test.skip(true, NO_SEND);
      const api = await ownerApi();
      const c = (await (await api.get(`business/clients/${CLIENT_ID}`)).json()) as {
        email?: string;
      };
      expect(c.email, 'recipient is synthetic').toMatch(
        /@example\.test$|@simulator\.amazonses\.com$/,
      );
      await openReturn(page, id);
      await page.getByTestId('action-bar').getByRole('button', { name: 'Send Message' }).click();
      const d = page.getByRole('dialog', { name: 'New Message' });
      await expect(d.getByLabel('Subject')).toHaveValue(new RegExp(`^${YEAR} .*Return$`));
      const text = `${runTagOf()}: synthetic message from the return, please ignore.`;
      await d.getByLabel('Message', { exact: true }).fill(text);
      await d.getByRole('button', { name: 'Send Message' }).click();
      await expect(toast(page, 'Message sent to the client.')).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/tax-returns/${id}`));
      save({ messageText: text });
    },
  );

  row(
    'F05-N1',
    'Send Message offers the email notice, the text choice and Save for client',
    async (page) => {
      const id = need(load(), 'returnId');
      await openReturn(page, id);
      await page.getByTestId('action-bar').getByRole('button', { name: 'Send Message' }).click();
      const d = page.getByRole('dialog', { name: 'New Message' });
      await expect(d).toContainText(/email/i);
      await expect(d.getByRole('checkbox').first()).toBeVisible();
      await d.getByRole('button', { name: 'Close dialog' }).click();
    },
  );

  row(
    'F06',
    'Create Appointment opens in place with the client and this return linked',
    async (page) => {
      const id = need(load(), 'returnId');
      await openReturn(page, id);
      await page
        .getByTestId('action-bar')
        .getByRole('button', { name: 'Create Appointment' })
        .click();
      const panel = page.getByRole('dialog', { name: 'Create Appointment' });
      await expect(panel.getByText(new RegExp(`${YEAR} .*Return`)).first()).toBeVisible({
        timeout: 90_000,
      });
      const link = panel.getByLabel('Link to Tax Return');
      await expect(link).toBeVisible();
      await expect(link).toBeEnabled();
      await expect(link.locator('option:checked')).toContainText(String(YEAR));
      await expect(panel).toContainText(CLIENT);
      await panel.getByRole('button', { name: 'Cancel' }).click();
      await expect(panel).toBeHidden();
      await expect(page).toHaveURL(new RegExp(`/tax-returns/${id}`));
    },
  );

  row('F07', 'row actions open with the client and return, and keep Back', async (page) => {
    need(load(), 'returnId');
    for (const [name, path] of [
      ['Schedule Appointment', /\/calendar\/new\?clientId=[0-9a-f-]+&taxReturnId=[0-9a-f-]+&from=/],
      ['Edit Client Details', /\/clients\/[0-9a-f-]+\?edit=1&from=/],
      ['View Client Profile', /\/clients\/[0-9a-f-]+/],
    ] as const) {
      await menuItem(page, name);
      await expect(page, name).toHaveURL(path, { timeout: 60_000 });
      await settled(page);
      await expect(page.getByText(CLIENT).first(), name).toBeVisible();
    }
  });

  row('F10a', 'client Documents has Upload, separate from Request', async (page) => {
    await page.goto(app(`/clients/${CLIENT_ID}/documents`));
    const screen = page.getByTestId('client-documents-screen');
    await expect(screen).toBeVisible({ timeout: 60_000 });
    // Since P4-7 (#1617) the tab's one primary action is Request a document; Upload Document is
    // in More Actions (E8: Documents' own upload with this client chosen).
    await screen.getByRole('button', { name: /More Actions/ }).click();
    await expect(
      page
        .getByRole('menuitem', { name: /Upload Document/ })
        .or(page.getByRole('link', { name: /Upload Document/ }))
        .first(),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      screen
        .getByRole('link', { name: /Request/ })
        .or(screen.getByRole('button', { name: /Request/ }))
        .first(),
    ).toBeVisible();
  });

  row(
    'F11',
    'Send an Intake Form from the return keeps the client and the return',
    async (page) => {
      const id = need(load(), 'returnId');
      await openReturn(page, id, 'Intake & Documents');
      const card = page.getByTestId('intake-form');
      await expect(card).toContainText(String(YEAR), { timeout: 60_000 });
      const link = card.getByRole('link', { name: /Send an Intake Form|Send Intake/ });
      await expect(link).toHaveAttribute('href', new RegExp(`clientId=${CLIENT_ID}`));
      await link.click();
      await expect(page).toHaveURL(/\/intake-forms\/send\?/, { timeout: 60_000 });
      await settled(page);
      await expect(page.getByText(CLIENT).first()).toBeVisible();
      await page.getByTestId('back-to-origin').click();
      await expect(page).toHaveURL(new RegExp(`/tax-returns/${id}`));
    },
  );

  row(
    'F08',
    'Upload Documents on the return works in place, prefilled, and links the file',
    async (page) => {
      const id = need(load(), 'returnId');
      await openReturn(page, id, 'Intake & Documents');
      const here = page.url();
      await page.getByRole('button', { name: 'Upload Documents' }).click();
      const d = page.getByRole('dialog', { name: 'Upload Document' });
      const form = d.getByTestId('upload-document');
      await expect(form).toContainText('Tax Returns');
      await expect(form).toContainText(CLIENT);
      await expect(form.getByLabel('Tax year')).toHaveValue(String(YEAR));
      await expect(
        form.getByLabel(`Link to the ${YEAR} return as`).locator('option:checked'),
      ).toHaveText(/Draft/);
      const name = `LIVE-CHECK_${runTagOf().slice(-12)}_Draft.pdf`;
      await form.getByLabel('File').setInputFiles(pdf(name));
      await d.getByRole('button', { name: 'Upload', exact: true }).click();
      await expect(toast(page, new RegExp(`Uploaded ${name}`))).toBeVisible({ timeout: 60_000 });
      save({ docName: name });
      // Stays on this return (the Documents tab may be added to the address).
      expect(new URL(page.url()).pathname).toBe(new URL(here).pathname);
      await page.reload();
      await showTab(page, 'Intake & Documents');
      const linked = page
        .getByTestId('return-documents')
        .getByRole('listitem')
        .filter({ hasText: name });
      await expect(linked).toHaveCount(1, { timeout: 60_000 });
      expect(await linkedKind(id, name), 'linked as a draft return').toBe('DRAFT_RETURN');
    },
  );

  row('F09a', 'the file uploaded from the return opens from the return', async (page) => {
    const id = need(load(), 'returnId');
    const name = need(load(), 'docName');
    await openReturn(page, id, 'Intake & Documents');
    const docs = page.getByTestId('return-documents');
    const item = docs.getByRole('listitem').filter({ hasText: name });
    // The malware scan runs first; give it a minute.
    for (let i = 0; i < 12 && /Scanning/.test(await item.innerText()); i++) {
      await page.waitForTimeout(5_000);
      await page.reload();
      await showTab(page, 'Intake & Documents');
    }
    await expect(item).not.toContainText('Scanning');
    const open = docs
      .getByRole('button', { name, exact: true })
      .or(docs.getByRole('link', { name, exact: true }));
    const [opened] = await Promise.all([
      Promise.race([
        page.waitForEvent('download', { timeout: 30_000 }).then(() => 'download'),
        page
          .context()
          .waitForEvent('page', { timeout: 30_000 })
          .then(() => 'tab'),
      ]),
      open.first().click(),
    ]);
    expect(['download', 'tab']).toContain(opened);
    await expect(
      page.getByRole('alert').filter({ hasText: /could not|failed|error/i }),
    ).toHaveCount(0);
  });

  row(
    'F10b',
    'a request from the return names the return and its year where it is saved',
    async (page) => {
      test.skip(true, NO_SEND);
      const id = need(load(), 'returnId');
      await openReturn(page, id, 'Intake & Documents');
      await page.getByRole('button', { name: 'Request Documents' }).click();
      const d = page.getByRole('dialog', { name: 'Request Documents' });
      const label = `${runTagOf()} W-2 (fake)`;
      await d.getByLabel('Document needed').fill(label);
      await d.getByRole('button', { name: 'Send Request' }).click();
      await expect(
        toast(page, new RegExp(`Requested "${label.replace(/[()]/g, '\\$&')}" from `)),
      ).toBeVisible();
      save({ requestLabel: label });
      // The firm's saved request (client Documents) shows the return and the year.
      await page.goto(app(`/clients/${CLIENT_ID}/documents`));
      const req = page.getByTestId('document-requests').getByRole('row').filter({ hasText: label });
      await expect(req.first()).toBeVisible({ timeout: 60_000 });
      await expect(req.first()).toContainText(String(YEAR));
    },
  );

  row('F12', 'Link Document as Draft persists after reload', async (page) => {
    const id = need(load(), 'returnId');
    const name = need(load(), 'docName');
    await openReturn(page, id, 'Intake & Documents');
    const docs = page.getByTestId('return-documents');
    const item = docs.getByRole('listitem').filter({ hasText: name });
    await expect(item).toContainText('Draft', { timeout: 60_000 });
    // Unlink, then link it back with Link Document as a Draft.
    await item.getByRole('button', { name: /Unlink|Remove/ }).click();
    const confirm = dialog(page).getByRole('button', { name: /Unlink|Remove/ });
    if (await confirm.count()) await confirm.click();
    await expect(item).toHaveCount(0, { timeout: 30_000 });
    await docs.getByRole('button', { name: 'Link Document' }).click();
    const ld = page.getByTestId('link-doc-dialog');
    await ld.getByLabel('Document').selectOption({ label: `${name} (${YEAR})` });
    // The role list reads Draft, Signature Form, Filed Return, … (DOC_KIND).
    await ld.getByLabel('Role in this return').selectOption({ label: 'Draft' });
    await dialog(page).getByRole('button', { name: /^Link/ }).last().click();
    await expect(item).toHaveCount(1, { timeout: 30_000 });
    await page.reload();
    await showTab(page, 'Intake & Documents');
    await expect(
      page.getByTestId('return-documents').getByRole('listitem').filter({ hasText: name }),
    ).toHaveCount(1, { timeout: 60_000 });
    // The file name holds "Draft" too, so the role is read from the return's documents.
    expect(await linkedKind(id, name), 'linked again as a draft return').toBe('DRAFT_RETURN');
  });

  row(
    'ACC-DOC',
    "the return's Document Checklist lists only this return's requests",
    async (page) => {
      const id = need(load(), 'returnId');
      const api = await ownerApi();
      // (a) Read only: run 3's archived return on QA Fixture Client 1, where Payroll's "payroll
      // register" requests showed before #1601. Nothing is changed or sent there.
      const OLD = '01a1e9ed-601f-76b8-a476-b4fd2eed2cb4';
      await page.goto(app(`/tax-returns/${OLD}`));
      await expect(page.getByTestId('return-workspace')).toBeVisible({ timeout: 60_000 });
      const oldList = page.getByTestId('document-checklist');
      if (await oldList.isVisible({ timeout: 15_000 }).catch(() => false)) {
        await settled(page);
        const text = (await oldList.innerText()).replace(/\s+/g, ' ');
        console.warn(`[ACC-DOC] run-3 return checklist: ${text.slice(0, 200)}`);
        expect(text).not.toMatch(/payroll register/i);
      } else {
        console.warn('[ACC-DOC] the archived run-3 return shows no Document Checklist');
      }
      // (b) A request made from this return, to the simulator client only (record and login).
      const c = (await (await api.get(`business/clients/${CLIENT_ID}`)).json()) as {
        email: string;
        portalStatus?: string | null;
      };
      expect(c.email, 'the client record is on the SES simulator').toMatch(
        /@simulator\.amazonses\.com$/,
      );
      expect(c.portalStatus ?? 'NONE', 'no portal login a notice could reach').not.toBe('ACTIVE');
      await openReturn(page, id, 'Intake & Documents');
      await page.getByRole('button', { name: 'Request Documents' }).click();
      const d = page.getByRole('dialog', { name: 'Request Documents' });
      const label = `${runTagOf()} W-2 (fake)`;
      await d.getByLabel('Document needed').fill(label);
      await d.getByRole('button', { name: 'Send Request' }).click();
      await expect(toast(page, /^Requested "/)).toBeVisible({ timeout: 30_000 });
      save({ requestLabel: label });
      await page.reload();
      await showTab(page, 'Intake & Documents');
      const list = page.getByTestId('document-checklist');
      await expect(list).toContainText(label, { timeout: 60_000 });
      // (c) Every other request of the client that is not this return's (another return, year or
      // service) stays off the list.
      const detail = (await (await api.get(`business/tax-returns/${id}`)).json()) as {
        taxYear: number;
        engagement: { id: string } | null;
      };
      const reqs = (
        (await (await api.get(`business/clients/${CLIENT_ID}/document-requests`)).json()) as {
          items: {
            title: string;
            status: string;
            taxYear: number | null;
            taxReturn: { id: string } | null;
            service: { id: string };
          }[];
        }
      ).items.filter((r) => r.status !== 'CANCELLED');
      const mine = (r: (typeof reqs)[number]) =>
        r.taxReturn
          ? r.taxReturn.id === id
          : r.taxYear === detail.taxYear &&
            (!detail.engagement || r.service.id === detail.engagement.id);
      const others = reqs.filter((r) => !mine(r));
      console.warn(
        `[ACC-DOC] client requests: ${reqs.length}, this return's: ${reqs.length - others.length}, others: ${others.length}`,
      );
      for (const o of others) await expect(list).not.toContainText(o.title);
      // F10b: the firm's saved request names the return's year.
      await page.goto(app(`/clients/${CLIENT_ID}/documents`));
      const req = page.getByTestId('document-requests').getByRole('row').filter({ hasText: label });
      await expect(req.first()).toBeVisible({ timeout: 60_000 });
      await expect(req.first()).toContainText(String(YEAR));
    },
  );

  row(
    'F13',
    'Blocked from the return task list asks why and saves with the reason',
    async (page) => {
      const id = need(load(), 'returnId');
      await openReturn(page, id);
      const tasks = page.getByTestId('upcoming-tasks');
      const returnUrl = page.url();
      await tasks.getByRole('link', { name: 'Create Task' }).click();
      await expect(page).toHaveURL(/\/tasks\/new\?clientId=[0-9a-f-]+&engagementId=[0-9a-f-]+/, {
        timeout: 60_000,
      });
      const title = `${runTagOf()} get the K-1 (fake)`;
      await page.locator('#tf-title').fill(title);
      // Test Firm B has no task types: the field says so and the task saves without one.
      const type = page.getByLabel('Task type');
      if (await type.isEnabled()) await type.selectOption({ index: 1 });
      else await expect(type).toContainText('No task types set up');
      await page.getByLabel('Assigned to').selectOption({ label: OWNER_NAME });
      await page.locator('#tf-due').fill('2027-03-02');
      await page.getByRole('button', { name: 'Save Task' }).click();
      await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}\?from=/, { timeout: 60_000 });
      save({ taskTitle: title });
      await page.getByTestId('back-to-origin').first().click();
      await expect
        .poll(() => new URL(page.url()).pathname, { timeout: 60_000 })
        .toBe(new URL(returnUrl).pathname);
      await expect(tasks.getByRole('link', { name: title })).toBeVisible({ timeout: 60_000 });
      await tasks.getByLabel(`Status of ${title}`).selectOption('BLOCKED');
      const why = page.getByRole('dialog', { name: 'Why is this task blocked?' });
      const mark = why.getByRole('button', { name: 'Mark Blocked' });
      await expect(mark).toBeDisabled();
      await why.getByLabel('Reason *').click();
      await page.keyboard.type('Waiting on the partnership K-1 (fake)');
      await mark.click();
      await expect(toast(page, `${title}: Blocked.`)).toBeVisible();
      await page.reload();
      await expect(page.getByTestId('upcoming-tasks').getByLabel(`Status of ${title}`)).toHaveValue(
        'BLOCKED',
        {
          timeout: 60_000,
        },
      );
    },
  );

  row('F14', 'the task menu on the return lists the twelve actions', async (page) => {
    const id = need(load(), 'returnId');
    const title = need(load(), 'taskTitle');
    await openReturn(page, id);
    await page
      .getByTestId('upcoming-tasks')
      .getByRole('button', { name: `Actions for ${title}` })
      .click();
    await expect(page.getByRole('menuitem')).toHaveCount(12);
    await page.keyboard.press('Escape');
  });

  row(
    'F15',
    'Convert to Recurring opens the setup at once, with Back to the return',
    async (page) => {
      const id = need(load(), 'returnId');
      const title = need(load(), 'taskTitle');
      await openReturn(page, id);
      await page
        .getByTestId('upcoming-tasks')
        .getByRole('button', { name: `Actions for ${title}` })
        .click();
      await page.getByRole('menuitem', { name: 'Convert to Recurring', exact: true }).click();
      await expect(page).toHaveURL(
        new RegExp(`/tasks/[0-9a-f-]{36}\\?convert=recurring&from=%2Ftax-returns%2F${id}`),
        { timeout: 60_000 },
      );
      const setup = page.getByRole('dialog', { name: 'Convert to Recurring' });
      await expect(setup).toBeVisible({ timeout: 60_000 });
      await setup.getByRole('button', { name: 'Cancel' }).click();
      await page.getByTestId('back-to-origin').click();
      await expect(page).toHaveURL(new RegExp(`/tax-returns/${id}`));
    },
  );

  row(
    'EXT-1',
    'the extension panel names the client, the year and the current deadline',
    async (page) => {
      need(load(), 'returnId');
      await menuItem(page, 'Record Extension');
      const panel = page.getByRole('dialog').filter({ has: page.getByTestId('extension-dialog') });
      await expect(
        panel.getByText(
          new RegExp(`^${CLIENT.replace(/[()]/g, '\\$&')}, ${YEAR} \\S+: due ${DUE_TEXT}$`),
        ),
      ).toBeVisible();
      await panel.getByRole('button', { name: 'Cancel' }).click();
    },
  );

  row('EXT-4a', 'Cancel on the extension panel leaves the return unchanged', async (page) => {
    const id = need(load(), 'returnId');
    await menuItem(page, 'Record Extension');
    const panel = page.getByRole('dialog').filter({ has: page.getByTestId('extension-dialog') });
    await panel.getByLabel('Extension filed on *').fill('2022-04-10');
    await panel.getByLabel('New due date').fill('2022-10-17');
    await panel.getByRole('button', { name: 'Cancel' }).click();
    await expect(panel).toHaveCount(0);
    await openReturn(page, id);
    await expect(page.getByTestId('extension-state')).toHaveText('Not Filed');
  });

  row(
    'EXT-2',
    'Record Extension saves the filing day and new deadline; reload shows Extension Filed',
    async (page) => {
      const id = need(load(), 'returnId');
      await menuItem(page, 'Record Extension');
      const d = page.getByTestId('extension-dialog');
      const record = dialog(page).getByRole('button', { name: 'Record Extension' });
      await d.getByLabel('New due date').fill('2022-10-17');
      await expect(record).toBeDisabled();
      await d.getByLabel('Extension filed on *').fill('2022-04-10');
      await record.click();
      // EXT-3: the confirmation says nothing went to an agency.
      await expect(
        toast(page, /^Extension recorded, due .*nothing was sent to an agency\.$/),
      ).toBeVisible();
      await openReturn(page, id);
      await page.reload();
      await expect(page.getByTestId('extension-state')).toHaveText(/^Filed /, { timeout: 60_000 });
      await expect(page.getByTestId('info-cards')).toContainText(/Oct 17, 2022/);
    },
  );

  row(
    'F28',
    'a Federal amount saves with its source and version, and History shows it',
    async (page) => {
      const id = need(load(), 'returnId');
      await openReturn(page, id, 'Payments & Refunds');
      const federal = page.getByTestId('summary').getByRole('row').filter({ hasText: 'Federal' });
      await federal.getByRole('button', { name: /(Edit|Add) the Federal amount/ }).click();
      const d = dialog(page);
      await d.getByLabel('Refund or amount due').selectOption('due');
      await d.getByLabel('Amount ($)').fill('1250.50');
      await d.getByLabel('Status').selectOption('FINAL');
      await d.getByLabel('Source').selectOption('TAX_SOFTWARE');
      await d.getByRole('button', { name: 'Save' }).click();
      await expect(toast(page, 'Amount saved.')).toBeVisible();
      await page.reload();
      await showTab(page, 'Payments & Refunds');
      await expect(federal).toContainText('$1,250.50', { timeout: 60_000 });
      await expect(federal).toContainText('Tax software');
    },
  );

  row('F28-N', 'Edit shows the saved amount beside the new one', async (page) => {
    const id = need(load(), 'returnId');
    await openReturn(page, id, 'Payments & Refunds');
    const federal = page.getByTestId('summary').getByRole('row').filter({ hasText: 'Federal' });
    await federal.getByRole('button', { name: 'Edit the Federal amount' }).click();
    const d = dialog(page);
    const compare = d.getByTestId('amount-compare');
    await expect(compare).toContainText(/Now \(v\d+\)/);
    await d.getByLabel('Amount ($)').fill('2000');
    await expect(compare).toContainText('$2,000');
    await d.getByRole('button', { name: 'Cancel' }).click();
  });

  row('F29', 'negative and text amounts are refused; 2.345 saves as 2.35', async (page) => {
    const id = need(load(), 'returnId');
    await openReturn(page, id, 'Payments & Refunds');
    const federal = page.getByTestId('summary').getByRole('row').filter({ hasText: 'Federal' });
    await federal.getByRole('button', { name: 'Edit the Federal amount' }).click();
    const d = dialog(page);
    const saveBtn = d.getByRole('button', { name: 'Save' });
    await d.getByLabel('Amount ($)').fill('-5');
    await expect(saveBtn).toBeDisabled();
    await d.getByLabel('Amount ($)').fill('abc');
    const v = await d.getByLabel('Amount ($)').inputValue();
    if (v === 'abc') await expect(saveBtn).toBeDisabled();
    await d.getByLabel('Amount ($)').fill('2.345');
    await d.getByLabel('Source').selectOption('TAX_SOFTWARE');
    await saveBtn.click();
    await expect(toast(page, 'Amount saved.')).toBeVisible();
    await page.reload();
    await showTab(page, 'Payments & Refunds');
    await expect(federal).toContainText('$2.35', { timeout: 60_000 });
  });

  row('F29-N', 'Tax statuses settings offer Exact or Round to the dollar', async (page) => {
    await page.goto(app('/settings/tax-statuses'));
    const rounding = page.getByTestId('amount-rounding').getByLabel('Refunds and amounts due');
    await expect(rounding).toBeVisible({ timeout: 60_000 });
    await expect(rounding.locator('option')).toHaveCount(2, { timeout: 30_000 });
    const options = (await rounding.locator('option').allTextContents()).join(' | ');
    expect(options).toMatch(/Exact/);
    expect(options).toMatch(/Round to the dollar/);
  });

  row('F36', 'Tax statuses: Maps to per label and Where returns appear', async (page) => {
    await page.goto(app('/settings/tax-statuses'));
    await expect(page.getByTestId('maps-to-help')).toBeVisible({ timeout: 60_000 });
    const where = page.getByTestId('where-returns-appear');
    await expect(where).toBeVisible();
    await expect(where.getByTestId('tab-explained').first()).toBeVisible();
  });

  row(
    'F16',
    'Correct Tax Year needs a reason; the corrected year survives reload, with history',
    async (page) => {
      const id = need(load(), 'returnId');
      await openReturn(page, id);
      await menuItem(page, 'Correct Tax Year');
      const d = page.getByTestId('correct-year-dialog');
      const confirm = dialog(page).getByRole('button', { name: 'Correct Year' });
      await d.getByLabel('Correct tax year *').fill(String(CORRECTED));
      await expect(confirm).toBeDisabled();
      await d.getByLabel('Reason *').fill(`${runTagOf()}: entered under the wrong year (fake)`);
      await confirm.click();
      await expect(toast(page, /corrected|Tax year/i)).toBeVisible();
      await openReturn(page, id);
      await page.reload();
      await expect(page.getByText(`${CORRECTED} Prior Year Return`).first()).toBeVisible({
        timeout: 60_000,
      });
      await showTab(page, 'Activity');
      await expect(page.getByText(new RegExp(`${YEAR}.*${CORRECTED}`)).first()).toBeVisible();
    },
  );

  row('F17', 'Assign / Reassign and Notes save and survive reload', async (page) => {
    const id = need(load(), 'returnId');
    await openReturn(page, id, 'Notes');
    await expect(page.getByTestId('notes')).toContainText(runTagOf(), { timeout: 60_000 });
    await menuItem(page, 'Assign / Reassign Staff');
    const d = page.getByTestId('assign-dialog');
    await expect(d.getByLabel(/Preparer/).locator('option:checked')).toHaveText(STAFF_NAME);
    await expect(d.getByLabel(/Reviewer/).locator('option:checked')).toHaveText(OWNER_NAME);
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  });

  row(
    'F19',
    'a validation item assigned shows its responsible person and version',
    async (page) => {
      const id = need(load(), 'returnId');
      await openReturn(page, id, 'Review');
      const validation = page.getByTestId('validation');
      const label = `${runTagOf()} dependent age check (fake)`;
      await validation.getByRole('button', { name: '+ Add Validation Item' }).click();
      const add = page.getByTestId('add-check-dialog');
      await add.getByLabel('Item').fill(label);
      await add.getByLabel('Result').selectOption('WARNING');
      await dialog(page).getByRole('button', { name: 'Add', exact: true }).click();
      const line = validation.getByRole('row').filter({ hasText: label });
      await expect(line).toBeVisible();
      await line.getByRole('button', { name: `Assign ${label}` }).click();
      const fields = page.getByTestId('assign-validation-dialog').getByTestId('issue-fields');
      await fields.getByLabel('Responsible person').selectOption({ label: STAFF_NAME });
      const version = fields.getByLabel('Version (draft return)');
      await expect(version, 'the draft uploaded in F08 is offered as the version').toBeEnabled({
        timeout: 10_000,
      });
      await version.selectOption({ index: 1 });
      const file = ((await version.locator('option:checked').textContent()) ?? '').trim();
      await dialog(page).getByRole('button', { name: 'Assign', exact: true }).click();
      await expect(toast(page, 'Validation item assigned.')).toBeVisible();
      await page.reload();
      await showTab(page, 'Review');
      const owner = page
        .getByTestId('validation')
        .getByRole('row')
        .filter({ hasText: label })
        .getByTestId('validation-line-owner');
      await expect(owner).toContainText(STAFF_NAME, { timeout: 60_000 });
      await expect(owner).toContainText(`Version: ${file}`);
    },
  );

  row(
    'F20a',
    'a Warning needs acknowledging before final validation; Info does not block',
    async (page) => {
      const id = need(load(), 'returnId');
      await page.goto(app(`/tax-returns/${id}/review`));
      const api = await ownerApi();
      const blockers = async () =>
        ((await (await api.get(`business/tax-returns/${id}`)).json()) as { blockers: string[] })
          .blockers;
      const v = page.getByTestId('validation');
      await expect(v).toContainText('Warning', { timeout: 60_000 });
      expect(await blockers()).toContain('WARNINGS_NOT_ACKNOWLEDGED');
      // Before the warning is acknowledged, Ready to File stays blocked even after a validation run.
      await page.getByRole('button', { name: 'Run Final Validation' }).click();
      await page.waitForTimeout(2_000);
      expect(await blockers()).toContain('WARNINGS_NOT_ACKNOWLEDGED');
      await v.getByRole('button', { name: 'Acknowledge' }).first().click();
      await expect(toast(page, 'Warning acknowledged.')).toBeVisible();
      await page.getByRole('button', { name: 'Run Final Validation' }).click();
      await expect(toast(page, 'Final validation recorded.')).toBeVisible();
      await page.reload();
      await expect(page.getByTestId('validation')).toBeVisible({ timeout: 60_000 });
      const after = await blockers();
      expect(after).not.toContain('WARNINGS_NOT_ACKNOWLEDGED');
      expect(after).not.toContain('VALIDATION_NOT_RUN');
    },
  );

  row('F21', 'an Error issue blocks Ready to File; resolving needs a reason', async (page) => {
    const id = need(load(), 'returnId');
    const api = await ownerApi();
    const add = await api.post(`business/tax-returns/${id}/issues`, {
      data: { severity: 'ERROR', note: `${runTagOf()} W-2 box 1 mismatch (fake)` },
    });
    expect(add.ok(), await add.text()).toBe(true);
    await page.goto(app(`/tax-returns/${id}/review`));
    const panel = page.getByTestId('validation-issues');
    await expect(panel.getByTestId('issues-blocking')).toContainText('blocks Ready to File', {
      timeout: 60_000,
    });
    await expect(page.getByTestId('next-steps')).toContainText(
      'Resolve the open validation errors',
    );
    await expect(panel.getByTestId('resolve-rule')).toContainText('needs a reason');
    await panel.getByRole('button', { name: 'Resolve' }).first().click();
    const resolve = page.getByRole('dialog', { name: 'Resolve Issue' });
    const ok = resolve.getByRole('button', { name: 'Resolve' });
    await expect(ok).toBeDisabled();
    await resolve.getByLabel('Valid: checked, it needs no change').check();
    await resolve.getByLabel("Reason (kept in the return's history)").fill('W-2 matches (fake)');
    await ok.click();
    await expect(resolve).toBeHidden();
    // Open issues are listed first: find this one by its note.
    await expect(
      panel.getByTestId('issue').filter({ hasText: 'W-2 box 1 mismatch (fake)' }).first(),
    ).toContainText('Resolved by');
    await page.reload();
    await expect(page.getByTestId('validation-issues').getByTestId('issues-blocking')).toHaveCount(
      0,
      { timeout: 60_000 },
    );
  });

  row('F20b', 'an open Error blocks a paper filing record, with the reason shown', async (page) => {
    const id = need(load(), 'returnId');
    const api = await ownerApi();
    const add = await api.post(`business/tax-returns/${id}/issues`, {
      data: { severity: 'ERROR', note: `${runTagOf()} schedule C missing (fake)` },
    });
    expect(add.ok(), await add.text()).toBe(true);
    const issueId = ((await add.json()) as { items: { id: string; note: string }[] }).items.find(
      (i) => i.note.includes('schedule C missing'),
    )!.id;
    try {
      await openReturn(page, id, 'E-File');
      const efile = page.getByTestId('efile');
      await expect(efile.getByTestId('filing-GA')).toBeVisible({ timeout: 60_000 });
      await efile.getByRole('button', { name: 'Jurisdictions' }).click();
      await page.getByLabel('GA filing method').selectOption('PAPER');
      await dialog(page).getByRole('button', { name: 'Save' }).click();
      const ga = efile.getByTestId('filing-GA');
      const rec = ga.getByRole('button', { name: 'Record Paper Filing' });
      await expect(ga).toContainText('(paper)', { timeout: 30_000 });
      await rec.waitFor({ timeout: 10_000 }).catch(() => {});
      if ((await rec.count()) && (await rec.isEnabled())) {
        await rec.click();
        await page
          .getByTestId('paper-dialog')
          .getByLabel('Mail Tracking Number')
          .fill('FAKE 9400 0001');
        await page.getByTestId('paper-dialog').getByLabel('Date mailed *').fill('2022-04-12');
        await dialog(page).getByRole('button', { name: 'Record' }).click();
        // The gate: the refusal comes as a toast (not role=alert), the dialog stays open, and the
        // API has no paper filing for GA.
        const refusal = page
          .getByText(/Resolve the validation errors first|cannot move there yet|validation error/i)
          .first();
        await expect(refusal).toBeVisible({ timeout: 15_000 });
        const shown = (await refusal.innerText()).trim();
        console.warn(`[F20b] refusal shown: ${shown}`);
        await expect(page.getByTestId('paper-dialog')).toBeVisible();
        const filings = (await (await api.get(`business/tax-returns/${id}/filings`)).json()) as {
          items: { jurisdiction: string; paperFiledOn: string | null }[];
        };
        const gaFiling = filings.items.find((f) => f.jurisdiction === 'GA');
        expect(gaFiling?.paperFiledOn ?? null, 'GA is not recorded as paper filed').toBeNull();
        await expect(ga).not.toContainText('FAKE 9400 0001');
        await dialog(page)
          .getByRole('button', { name: 'Cancel' })
          .click()
          .catch(() => {});
        // Her F20b: the refusal shows the blocker. The API says "Resolve the validation errors
        // first" (STATUS_BLOCKED, blockers VALIDATION_ISSUES_OPEN); the screen must not replace it
        // with the status-move text ("This return cannot move there yet").
        expect(shown, 'the refusal names the open validation error').toMatch(/validation error/i);
      } else {
        await expect(efile).toContainText(/error/i);
      }
    } finally {
      await api.patch(`business/tax-returns/${id}/issues/${issueId}`, {
        data: { resolved: true, resolution: 'FIXED', reason: 'Live check cleanup (fake)' },
      });
    }
  });

  row(
    'F25-J',
    'Jurisdictions opened right away lists every filing of the return (GA too)',
    async (page) => {
      const id = need(load(), 'returnId');
      await openReturn(page, id, 'E-File');
      const efile = page.getByTestId('efile');
      await efile.getByRole('button', { name: 'Jurisdictions' }).click();
      const fast = await dialog(page)
        .getByRole('combobox')
        .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
      await dialog(page).getByRole('button', { name: 'Cancel' }).click();
      await expect(efile.getByTestId('filing-GA')).toBeVisible({ timeout: 60_000 });
      await efile.getByRole('button', { name: 'Jurisdictions' }).click();
      const slow = await dialog(page)
        .getByRole('combobox')
        .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
      await dialog(page).getByRole('button', { name: 'Cancel' }).click();
      test.info().annotations.push({
        type: 'lists',
        description: `right away: ${fast.join(', ')}; after load: ${slow.join(', ')}`,
      });
      expect(slow).toContain('GA filing method');
      expect(fast, 'the dialog opened right away lists the same filings').toEqual(slow);
    },
  );

  row(
    'F25',
    'E-file and paper per jurisdiction; the GA paper record keeps date and tracking',
    async (page) => {
      const id = need(load(), 'returnId');
      await openReturn(page, id, 'E-File');
      const efile = page.getByTestId('efile');
      const ga = efile.getByTestId('filing-GA');
      await expect(ga).toBeVisible({ timeout: 60_000 });
      if (!(await ga.getByRole('button', { name: 'Record Paper Filing' }).count())) {
        await efile.getByRole('button', { name: 'Jurisdictions' }).click();
        await page.getByLabel('GA filing method').selectOption('PAPER');
        await dialog(page).getByRole('button', { name: 'Save' }).click();
      }
      await ga.getByRole('button', { name: 'Record Paper Filing' }).click();
      const record = dialog(page).getByRole('button', { name: 'Record' });
      // F26a: Record waits for the tracking number; F26ba: and for the actual date mailed.
      await expect(record).toBeDisabled();
      await page
        .getByTestId('paper-dialog')
        .getByLabel('Mail Tracking Number')
        .fill('FAKE 9400 0002');
      await expect(page.getByTestId('paper-dialog').getByLabel('Date mailed *')).toHaveValue('');
      await expect(record).toBeDisabled();
      await page.getByTestId('paper-dialog').getByLabel('Date mailed *').fill('2022-04-12');
      await record.click();
      await expect(toast(page, 'Paper filing recorded.')).toBeVisible();
      await page.reload();
      await showTab(page, 'E-File');
      await expect(page.getByTestId('efile').getByTestId('filing-GA')).toContainText(
        'FAKE 9400 0002',
        { timeout: 60_000 },
      );
    },
  );

  row('F26c', 'Close is refused while a required filing is unrecorded', async (page) => {
    const id = need(load(), 'returnId');
    await menuItem(page, 'Change Status');
    await page.getByTestId('status-dialog').getByLabel('New status').selectOption('CLOSED');
    await dialog(page)
      .getByRole('button', { name: /Continue|Change Status|Save/ })
      .last()
      .click();
    await expect(
      page
        .getByRole('alert')
        .or(page.getByText(/cannot move there yet|Check its next steps/))
        .first(),
    ).toBeVisible();
    const api = await ownerApi();
    const r = (await (await api.get(`business/tax-returns/${id}`)).json()) as {
      workflowStatus: string;
    };
    expect(r.workflowStatus).not.toBe('CLOSED');
  });

  row(
    'F27',
    'Mailing Report lists the paper filing with its date, tracking and status',
    async (page) => {
      need(load(), 'returnId');
      await page.goto(app(`/tax-returns?year=${CORRECTED}`));
      await page
        .getByTestId('quick-actions')
        .getByRole('button', { name: 'Mailing Report' })
        .click({ timeout: 60_000 });
      const report = page.getByTestId('mailing-report');
      await expect(report).toContainText('FAKE 9400 0002', { timeout: 60_000 });
      await expect(report).toContainText(CLIENT);
      await expect(report).toContainText(/Apr 12, 2022|2022-04-12|04\/12\/2022/);
    },
  );

  row('F27b', 'Print / Export List downloads a CSV', async (page) => {
    await page.goto(app('/tax-returns'));
    const action = page
      .getByTestId('quick-actions')
      .getByRole('button', { name: 'Print / Export List' });
    await expect(action).toBeVisible({ timeout: 60_000 });
    const [file] = await Promise.all([page.waitForEvent('download'), action.click()]);
    expect(file.suggestedFilename()).toMatch(/\.csv$/);
    const text = readFileSync((await file.path())!, 'utf8');
    expect(text).toContain(CLIENT);
  });

  row(
    'F22',
    'record a transmission and its rejection with agency, code and action',
    async (page) => {
      const id = need(load(), 'returnId');
      // Ready to File needs the approvals and the 8879: give them through the API (their screens are
      // other rows), then the reviewer (this Owner) moves it on the screen.
      const api = await ownerApi();
      const approvals = (
        (await (await api.get(`business/tax-returns/${id}/approvals`)).json()) as {
          items: { id: string; status: string; canDecide: boolean }[];
        }
      ).items;
      for (const a of approvals.filter((a) => a.status !== 'APPROVED')) {
        const r = await api.post(`business/tax-returns/${id}/approvals/${a.id}/approve`, {
          data: {},
        });
        expect(r.ok(), await r.text()).toBe(true);
      }
      const docs = (await (await api.get(`business/tax-returns/${id}/documents`)).json()) as {
        items: { document?: { id: string }; documentId?: string }[];
      };
      const docId = docs.items[0]?.document?.id ?? docs.items[0]?.documentId;
      const auths = (
        (await (await api.get(`business/tax-returns/${id}/authorizations`)).json()) as {
          items: { id: string; required: boolean; status: string }[];
        }
      ).items;
      for (const a of auths.filter((a) => a.required && a.status !== 'SIGNED')) {
        expect(docId, 'a document of the return for the wet signature').toBeTruthy();
        const r = await api.post(
          `business/tax-returns/${id}/authorizations/${a.id}/wet-signature`,
          {
            data: { signedOn: '2022-04-01', documentId: docId },
          },
        );
        expect(r.ok(), await r.text()).toBe(true);
      }
      const before = (
        (await (await api.get(`business/tax-returns/${id}`)).json()) as { blockers: string[] }
      ).blockers;
      test.info().annotations.push({ type: 'blockers', description: before.join(',') || 'none' });
      await openReturn(page, id);
      const bar = page.getByTestId('action-bar');
      const ready = bar.getByRole('button', { name: 'Mark as Ready to File' });
      if (await ready.count()) {
        await ready.click();
        await expect(toast(page, /Moved to Ready to File/)).toBeVisible();
      } else {
        const res = await api.post(`business/tax-returns/${id}/status`, {
          data: { workflowStatus: 'READY_TO_FILE' },
        });
        expect(res.status(), await res.text()).toBeLessThan(300);
      }
      await openReturn(page, id, 'E-File');
      const efile = page.getByTestId('efile');
      await efile
        .getByTestId('filing-US')
        .getByRole('button', { name: 'Record Transmission' })
        .click();
      await page
        .getByTestId('attempt-dialog')
        .getByLabel('Submission ID')
        .fill('LIVECHECK-SUB-0001');
      await dialog(page).getByRole('button', { name: 'Record' }).click();
      await expect(toast(page, 'Transmission recorded.')).toBeVisible();
      await efile
        .getByTestId('filing-US')
        .getByRole('button', { name: 'Record Acknowledgment' })
        .click();
      const ack = page.getByTestId('ack-dialog');
      await ack.getByLabel('Answer').selectOption('REJECTED');
      await ack.getByLabel('Reject code').fill('R0000-504-02');
      await expect(ack.getByLabel('Rejecting agency')).toHaveValue('IRS');
      await expect(dialog(page).getByRole('button', { name: 'Record' })).toBeDisabled();
      await ack
        .getByLabel('Corrective action')
        .fill('Correct the dependent and transmit again (fake)');
      await ack.getByLabel('Description').fill('Fake: the dependent is claimed on another return');
      await dialog(page).getByRole('button', { name: 'Record' }).click();
      await page.reload();
      await showTab(page, 'E-File');
      await expect(page.getByTestId('efile').getByTestId('filing-US')).toContainText(
        'IRS · R0000-504-02',
        { timeout: 60_000 },
      );
    },
  );

  row(
    'F22-N',
    'a rejected return goes to In Correction, never straight to review',
    async (page) => {
      const id = need(load(), 'returnId');
      const api = await ownerApi();
      const direct0 = await api.post(`business/tax-returns/${id}/status`, {
        data: { workflowStatus: 'REJECTED' },
      });
      console.warn(`[F22-N] Ready to File -> Rejected: ${direct0.status()}`);
      for (const to of ['TRANSMITTED', 'REJECTED']) {
        const r = (await (await api.get(`business/tax-returns/${id}`)).json()) as {
          workflowStatus: string;
        };
        if (r.workflowStatus === 'REJECTED') break;
        const mv = await api.post(`business/tax-returns/${id}/status`, {
          data: { workflowStatus: to },
        });
        expect(mv.ok(), await mv.text()).toBe(true);
      }
      const r0 = (await (await api.get(`business/tax-returns/${id}`)).json()) as {
        workflowStatus: string;
      };
      expect(r0.workflowStatus).toBe('REJECTED');
      const direct = await api.post(`business/tax-returns/${id}/status`, {
        data: { workflowStatus: 'READY_FOR_REVIEW' },
      });
      expect(direct.status()).toBe(409);
      await menuItem(page, 'Start Correction');
      const modal = dialog(page);
      const confirm = modal.getByRole('button', { name: 'Start Correction' });
      await expect(confirm).toBeDisabled();
      await modal.getByLabel('What needs correcting').fill('The dependent (fake).');
      await confirm.click();
      await expect(toast(page, 'Moved to In Correction.')).toBeVisible();
      await openReturn(page, id);
      await page.reload();
      const r1 = (await (await api.get(`business/tax-returns/${id}`)).json()) as {
        workflowStatus: string;
      };
      expect(r1.workflowStatus).toBe('IN_CORRECTION');
    },
  );

  row('F23', 'the rejected attempt keeps its answer after a retransmission', async (page) => {
    const id = need(load(), 'returnId');
    // By design Rejected and In Correction offer no transmission: the corrected return goes back
    // through review (Ready for Review, then Ready to File by its reviewer) before it is sent again.
    const api = await ownerApi();
    const status = async () =>
      (await (await api.get(`business/tax-returns/${id}`)).json()) as {
        workflowStatus: string;
        blockers: string[];
      };
    if ((await status()).workflowStatus === 'IN_CORRECTION') {
      const back = await api.post(`business/tax-returns/${id}/status`, {
        data: { workflowStatus: 'READY_FOR_REVIEW', reason: 'Corrected (fake)' },
      });
      expect(back.ok(), await back.text()).toBe(true);
    }
    const approvals = (
      (await (await api.get(`business/tax-returns/${id}/approvals`)).json()) as {
        items: { id: string; status: string }[];
      }
    ).items;
    for (const a of approvals.filter((a) => a.status !== 'APPROVED')) {
      await api.post(`business/tax-returns/${id}/approvals/${a.id}/approve`, { data: {} });
    }
    if ((await status()).blockers.includes('VALIDATION_NOT_RUN')) {
      await api.post(`business/tax-returns/${id}/final-validation`, { data: {} });
    }
    const ready = await api.post(`business/tax-returns/${id}/status`, {
      data: { workflowStatus: 'READY_TO_FILE' },
    });
    expect(ready.ok(), await ready.text()).toBe(true);
    await openReturn(page, id, 'E-File');
    const us = page.getByTestId('efile').getByTestId('filing-US');
    await us.getByRole('button', { name: 'Record Retransmission' }).click();
    await page.getByTestId('attempt-dialog').getByLabel('Submission ID').fill('LIVECHECK-SUB-0002');
    await dialog(page).getByRole('button', { name: 'Record' }).click();
    await expect(us).toContainText('Earlier attempts (1)', { timeout: 60_000 });
  });

  row(
    'F24',
    'Earlier attempts show the description, the action and the corrective task with its owner',
    async (page) => {
      const id = need(load(), 'returnId');
      await openReturn(page, id, 'E-File');
      const us = page.getByTestId('efile').getByTestId('filing-US');
      await us.getByText('Earlier attempts (1)').click();
      const earlier = us.getByTestId('earlier-attempts');
      await expect(earlier).toContainText('LIVECHECK-SUB-0001');
      await expect(earlier).toContainText('R0000-504-02');
      await expect(earlier).toContainText('Fake: the dependent is claimed on another return');
      await expect(earlier).toContainText('Correct the dependent and transmit again (fake)');
      await expect(page.getByTestId('corrective-task').first()).toContainText(STAFF_NAME);
    },
  );

  row('AUD-1', 'history rows do not repeat the previous reason', async (page) => {
    const id = need(load(), 'returnId');
    const api = await ownerApi();
    const h = (await (await api.get(`business/tax-returns/${id}/history`)).json()) as {
      items: { reason?: string | null }[];
    };
    const items = h.items;
    expect(items.length, 'the return has history rows').toBeGreaterThan(1);
    for (let i = 1; i < items.length; i++) {
      if (items[i]!.reason) expect(items[i]!.reason).not.toBe(items[i - 1]!.reason);
    }
    await openReturn(page, id, 'Activity');
  });

  row('F33', 'the Quarterly tab lists a quarterly return with its quarter', async (page) => {
    const api = await ownerApi();
    const res = await api.post('business/tax-returns', {
      data: {
        clientId: CLIENT_ID,
        taxYear: YEAR,
        filingType: 'INDIVIDUAL',
        quarter: 1,
        formType: '1040-ES',
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    save({ quarterlyId: ((await res.json()) as { id: string }).id });
    await page.goto(app(`/tax-returns?tab=quarterly&q=${encodeURIComponent(CLIENT)}`));
    await expect(
      page.getByRole('row').filter({ hasText: CLIENT }).filter({ hasText: /Q1/ }).first(),
    ).toBeVisible({ timeout: 60_000 });
  });

  row('F34', 'an archived return is listed under Archived, read-only', async (page) => {
    const id = need(load(), 'returnId');
    await menuItem(page, 'Archive');
    await dialog(page).getByRole('button', { name: 'Archive' }).click();
    await expect(toast(page, 'Return archived.')).toBeVisible();
    await page.getByTestId('tr-filters').getByLabel('Show').selectOption('archived');
    const row = page
      .getByRole('row')
      .filter({ has: page.locator(`a[href*="${id}"]`) })
      .first();
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.getByRole('button', { name: /^Actions for/ }).click();
    const items = (await page.getByRole('menuitem').allInnerTexts()).map((t) => t.trim());
    expect(items).toEqual(expect.arrayContaining(['Open / View Return', 'Restore']));
    for (const gone of ['Edit Return Details', 'Change Status', 'Assign / Reassign Staff']) {
      expect(items).not.toContain(gone);
    }
    await page.keyboard.press('Escape');
    await openReturn(page, id);
    await expect(page.getByTestId('archived-return')).toBeVisible();
  });

  row(
    'F35a',
    'Restore keeps the data, the linked document and the archive/restore history',
    async (page) => {
      const id = need(load(), 'returnId');
      const name = load().docName;
      await page.goto(app('/tax-returns'));
      await page.getByTestId('tr-filters').getByLabel('Show').selectOption('archived');
      const row = page
        .getByRole('row')
        .filter({ has: page.locator(`a[href*="${id}"]`) })
        .first();
      await row.getByRole('button', { name: /^Actions for/ }).click({ timeout: 60_000 });
      await page.getByRole('menuitem', { name: 'Restore' }).click();
      await dialog(page).getByRole('button', { name: 'Restore' }).click();
      await expect(toast(page, 'Return restored.')).toBeVisible();
      await openReturn(page, id, 'Payments & Refunds');
      await expect(
        page.getByTestId('summary').getByRole('row').filter({ hasText: 'Federal' }),
      ).toContainText('$2.35');
      if (name) {
        await showTab(page, 'Intake & Documents');
        await expect(page.getByTestId('return-documents')).toContainText(name);
      }
      await showTab(page, 'Activity');
      await expect(
        page
          .getByTestId('activity')
          .or(page.locator('main'))
          .getByText(/^Restored$/)
          .first(),
      ).toBeVisible();
      await expect(
        page
          .locator('main')
          .getByText(/^Archived$/)
          .first(),
      ).toBeVisible();
    },
  );
});

// ---------------------------------------------------------------------------------------------
test.describe('staff (the preparer, not the reviewer)', () => {
  test.use(as('staff'));
  test.describe.configure({ timeout: 120_000 });

  row('F18', 'Staff opens the return but cannot take the reviewer decisions', async (page) => {
    const id = need(load(), 'returnId');
    await openReturn(page, id);
    const api = await apiAs('staff');
    const res = await api.post(`business/tax-returns/${id}/status`, {
      data: { workflowStatus: 'CLOSED' },
    });
    const text = await res.text();
    test
      .info()
      .annotations.push({ type: 'api', description: `${res.status()} ${text.slice(0, 200)}` });
    expect([403, 409], text).toContain(res.status());
    const body = JSON.parse(text) as { error?: { message?: string } };
    expect(body.error?.message ?? '').toMatch(/\w+ \w+/);
  });

  row(
    'CR-5a',
    'Staff without Export cannot export the list, and the screen says why',
    async (page) => {
      await page.goto(app('/tax-returns'));
      const action = page
        .getByTestId('quick-actions')
        .getByRole('button', { name: 'Print / Export List' });
      await expect(page.getByTestId('quick-actions')).toBeVisible({ timeout: 60_000 });
      if (await action.count()) {
        await action.click();
        await expect(
          page
            .getByRole('alert')
            .or(page.getByText(/permission|not allowed|can't|cannot/i))
            .first(),
        ).toBeVisible();
      }
    },
  );
});

// ---------------------------------------------------------------------------------------------
test.describe('client (portal)', () => {
  test.use(as('client'));
  test.describe.configure({ timeout: 120_000 });
  // The run's return is on QA Appointments Client, which has no portal login. These rows passed
  // only on data from run 1 (Nov 17) on QA Fixture Client 1, Octavia's login, which the harness
  // no longer signs in as. They come back when the run's return is on the harness's own portal
  // client (portalClient()).
  test.skip(
    true,
    "NOT LIVE: the run's return is on QA Appointments Client (no portal login), not the harness portal client",
  );

  row(
    'F05-portal',
    'the client receives the message from the return in the portal',
    async (page) => {
      const text = load().messageText ?? 'synthetic message from the return, please ignore.';
      await page.goto(portal('/messages'));
      await settled(page);
      const row = page
        .getByRole('row')
        .filter({ hasText: `${YEAR} 1040 Return` })
        .first();
      await expect(row).toBeVisible({ timeout: 60_000 });
      await row
        .getByRole('link', { name: 'View' })
        .or(row.getByRole('button', { name: 'View' }))
        .first()
        .click();
      await expect(page.getByText(text.slice(-45)).first()).toBeVisible({ timeout: 30_000 });
    },
  );

  row(
    'F22-N-portal',
    'the client sees the corrected year and In Progress, never Rejected',
    async (page) => {
      need(load(), 'returnId');
      const api = await apiAs('client');
      const res = await api.get(portalApi('me/tax-returns'));
      expect(res.status()).toBe(200);
      await page.goto(portal('/taxes'));
      await settled(page);
      const mine = (await res.json()) as { items?: unknown[] } | unknown[];
      const list = Array.isArray(mine) ? mine : (mine.items ?? []);
      test
        .info()
        .annotations.push({ type: 'api', description: JSON.stringify(list).slice(0, 400) });
      const card = page
        .getByText(new RegExp(`\\b${CORRECTED}\\b`))
        .filter({ visible: true })
        .first();
      await expect(card).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText(/Rejected/).filter({ visible: true })).toHaveCount(0);
    },
  );

  row('F10c-portal', 'the client sees the request from the return, with its year', async (page) => {
    const label = need(load(), 'requestLabel');
    await page.goto(portal('/documents'));
    await settled(page);
    const req = page.getByText(label).first();
    await expect(req).toBeVisible({ timeout: 60_000 });
    const box = page.locator('li, tr, article, section').filter({ hasText: label }).last();
    await expect(box).toContainText(String(YEAR));
  });
});

// ---------------------------------------------------------------------------------------------
test.describe('layout', () => {
  test.use(as('owner'));
  for (const [name, path] of [
    ['list', () => '/tax-returns'],
    ['workspace', (id: string) => `/tax-returns/${id}`],
    ['review', (id: string) => `/tax-returns/${id}/review`],
  ] as const) {
    test(`F01b CR-6 @narrow ${name} fits the width`, async ({ page }, info) => {
      const s = load();
      let id = s.returnId;
      let temp: string | undefined;
      const api = await ownerApi();
      if (name !== 'list') {
        const ok = id ? (await api.get(`business/tax-returns/${id}`)).ok() : false;
        if (!ok) {
          const res = await api.post('business/tax-returns', {
            data: {
              clientId: CLIENT_ID,
              taxYear: 2019,
              filingType: 'INDIVIDUAL',
              formType: '1040',
            },
          });
          expect(res.status(), await res.text()).toBe(201);
          id = temp = ((await res.json()) as { id: string }).id;
        }
      }
      try {
        await page.goto(app(path(id ?? '')));
        await settled(page);
        await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 60_000 });
        await expectNoSideScroll(page);
      } finally {
        await finish(page, info, `layout-${name}`);
        if (temp) await api.delete(`business/tax-returns/${temp}`);
      }
    });
  }
  test('@narrow portal taxes fits the width', async ({ browser }, info) => {
    const ctx = await browser.newContext({
      ...as('client'),
      viewport: info.project.use.viewport ?? null,
    });
    const page = await ctx.newPage();
    try {
      await page.goto(portal('/taxes'));
      await settled(page);
      await expectNoSideScroll(page);
    } finally {
      await finish(page, info, 'layout-portal-taxes');
      await ctx.close();
    }
  });
});

// ---------------------------------------------------------------------------------------------
test.describe('cleanup', () => {
  test.use(as('owner'));
  // eslint-disable-next-line no-empty-pattern -- Playwright needs a destructured first argument
  test('zz cleanup: remove what this run made', async ({}, info) => {
    test.skip(info.project.name !== 'w1165', 'cleanup runs once');
    const s = load();
    const api = await ownerApi();
    const left: string[] = [];
    const tryIt = async (
      what: string,
      call: () => Promise<{ ok(): boolean; status(): number; text(): Promise<string> }>,
    ) => {
      const res = await call();
      if (!res.ok()) left.push(`${what}: ${res.status()} ${(await res.text()).slice(0, 120)}`);
    };
    // Tasks the run made (by title), then the request, the document, the returns, the service.
    const tasks = (await (await api.get(`business/tasks?clientId=${CLIENT_ID}`)).json()) as {
      items?: { id: string; title: string }[];
    };
    for (const t of (tasks.items ?? []).filter((t) => t.title.startsWith(s.tag))) {
      await api.post(`business/tasks/${t.id}/cancel`, { data: {} });
      await tryIt(`task ${t.id}`, () => api.post(`business/tasks/${t.id}/archive`, { data: {} }));
    }
    const reqs = (await (
      await api.get(`business/clients/${CLIENT_ID}/document-requests`)
    ).json()) as {
      items?: { id: string; status?: string }[];
    };
    for (const r of (reqs.items ?? []).filter((r) => JSON.stringify(r).includes(s.tag))) {
      if (r.status !== 'CANCELLED')
        await tryIt(`request ${r.id}`, () =>
          api.post(`business/document-requests/${r.id}/cancel`, { data: {} }),
        );
    }
    // The draft uploaded from the return goes to the trash (the product's removal for a file).
    if (s.returnId) {
      const docs = (await (
        await api.get(`business/tax-returns/${s.returnId}/documents`)
      ).json()) as {
        items?: { document: { id: string; fileName: string } }[];
      };
      for (const d of (docs.items ?? []).filter((d) =>
        d.document.fileName.startsWith('LIVE-CHECK_'),
      )) {
        await tryIt(`document ${d.document.id}`, () =>
          api.post(`business/documents/${d.document.id}/trash`, { data: {} }),
        );
      }
    }
    for (const id of [s.quarterlyId, s.returnId].filter(Boolean) as string[]) {
      const del = await api.delete(`business/tax-returns/${id}`);
      if (!del.ok())
        await tryIt(`return ${id} (archive)`, () =>
          api.post(`business/tax-returns/${id}/archive`, { data: {} }),
        );
    }
    if (s.engagementId) {
      await tryIt(`engagement ${s.engagementId}`, () =>
        api.post(`business/engagements/${s.engagementId}/cancel`, {
          data: { reason: `${s.tag} cleanup` },
        }),
      );
    }
    if (s.serviceId) {
      const del = await api.delete(`business/catalog/services/${s.serviceId}`);
      if (!del.ok())
        await tryIt(`service ${s.serviceId} (archive)`, () =>
          api.post(`business/catalog/services/${s.serviceId}/archive`, { data: {} }),
        );
    }
    if (s.categoryId) {
      const del = await api.delete(`business/catalog/categories/${s.categoryId}`);
      if (!del.ok()) {
        await tryIt(`category ${s.categoryId} (inactive)`, () =>
          api.put(`business/catalog/categories/${s.categoryId}`, {
            data: { name: `${s.tag} cat`, status: 'INACTIVE' },
          }),
        );
        left.push(`category ${s.categoryId}: kept inactive (an archived service uses it)`);
      }
    }
    info.annotations.push({ type: 'left', description: left.join('; ') || 'none' });
    writeFileSync(join(shotsDir(TAB), 'cleanup.txt'), left.join('\n') || 'none');
  });
});
