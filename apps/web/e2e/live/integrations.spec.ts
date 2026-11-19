import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { statePath, type Role } from './env';
import { apiAs, app, as, settled, shot } from './helpers';

/**
 * Integrations, Review Two batch 1 (#1623: I-R2-01..06, I-R2-08, I-F03; #1632: I-R2-07, I-R2-09,
 * I-UA01..06), live on dev as Test Firm B's Owner (Staff where a row is about what a role may do).
 * Rows are named by their IDs only (row map: F:/firmivra-private/checks/integrations.md).
 *
 * Read-only, always: nothing here connects, disconnects, reconfigures, syncs, tests or requests.
 * Every page carries a guard that aborts any request other than a read to the integrations API
 * (business/integrations*, business/integration-requests), and each test fails if one was tried.
 * Review dialogs are opened and left with Back; Confirm is never pressed.
 *
 * The data is Test Firm B's own (read only): the QA fixture connections (Test environment, made
 * once by the QA seed, decision F1 keeps them as they are) and its Firmivra Mail connection (Live).
 *  - Xero (Test, Connected): one sync on Oct 28 of an object Xero no longer lists ("Customers"),
 *    its row written on Nov 14; a mapping in an area Xero does not offer ("Client").
 *  - HubSpot (Test, Needs attention, a reason code the API does not know): one failed sync.
 *  - Mailchimp (Test, Disconnected): no runs.
 *  - Gusto (Test): not a catalog provider, so it shows nowhere.
 * Xero, HubSpot and Mailchimp offer Live only, so the Test overview shows no card for them.
 */
test.describe.configure({ timeout: 180_000 });

const TAB = 'integrations';
const fixture = (n: number) => `00000000-0000-4a28-8001-${String(n).padStart(12, '0')}`;
const XERO = fixture(500);
const HUBSPOT = fixture(502);
const MAILCHIMP = fixture(503);

// ---------------------------------------------------------------- helpers

/** Aborts every write to the integrations API from this page; the test checks none was tried. */
async function readOnly(page: Page): Promise<string[]> {
  const tried: string[] = [];
  await page.route(/\/api\/v1\/business\/integration/, async (route) => {
    const req = route.request();
    if (req.method() === 'GET' || req.method() === 'HEAD') return route.continue();
    tried.push(`${req.method()} ${new URL(req.url()).pathname}`);
    return route.abort();
  });
  return tried;
}

let tried: string[] = [];
test.beforeEach(async ({ page }) => {
  tried = await readOnly(page);
});
test.afterEach(async ({ page }) => {
  // Never a failure screenshot of a sign-in screen: a page sent there is blanked first.
  if (/\/sign-in/.test(page.url())) await page.goto('about:blank');
  expect(tried, 'no write to the integrations API was attempted').toEqual([]);
});

async function open(page: Page, path: string) {
  await page.goto(app(path));
  await settled(page);
  if (/\/sign-in/.test(page.url())) {
    await page.goto('about:blank');
    throw new Error(`the saved session ended (harness, not the product): ${path}`);
  }
}

/**
 * Another role's page, with the same write guard. Its session is refreshed first (another lane
 * may have used the saved one); `done` blanks the page before closing it, so a failure
 * screenshot taken at close never shows a sign-in screen.
 */
async function pageAs(
  browser: Browser,
  role: Role,
): Promise<{ page: Page; tried: string[]; done: () => Promise<void> }> {
  await (await apiAs(role)).dispose();
  const ctx = await browser.newContext({ storageState: statePath(role) });
  const page = await ctx.newPage();
  const done = async () => {
    await page.goto('about:blank').catch(() => {});
    await ctx.close();
  };
  return { page, tried: await readOnly(page), done };
}

/** A Help icon ("About <topic>") and the text it reads out. */
const help = (scope: Page | Locator, topic: string) =>
  scope.getByRole('button', { name: `About ${topic}`, exact: true });

/** One of the overview's four summary cards: its value and its note. */
function stat(page: Page, label: string) {
  const card = page
    .getByRole('region', { name: 'Integration summary' })
    .locator(':scope > *')
    .filter({ has: page.getByRole('heading', { name: label, exact: true }) });
  return { value: card.locator('p').nth(0), note: card.locator('p').nth(1) };
}

/** A row of the overview's Integration Health card, by its label: the number beside it. */
const healthRow = (page: Page, label: string) =>
  page
    .getByTestId('integration-health')
    .getByRole('listitem')
    .filter({ hasText: label })
    .locator('span')
    .last();

/** A provider card on the overview, by its name. */
const overviewCard = (page: Page, name: string) =>
  page
    .getByTestId('integration-card')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });

/** A provider card in the marketplace's catalog, by its name. */
const marketCard = (page: Page, name: string) =>
  page
    .getByTestId('marketplace-integration')
    .filter({ has: page.getByRole('heading', { name, exact: true }) });

type Health = {
  state: string;
  summary: string;
  checks: { key: string; label: string; state: string }[];
  suggestions: string[];
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  checkedAt: string | null;
};
type Run = { id: string; entity: string; startedAt: string | null; createdAt: string };
type Detail = { status: string; environment: string; provider: { name: string }; health: Health };

/** The connection's own record (read only), for what the page cannot show. */
async function detailOf(id: string): Promise<Detail | null> {
  const api = await apiAs('owner');
  try {
    const r = await api.get(`business/integrations/connections/${id}`);
    return r.ok() ? ((await r.json()) as Detail) : null;
  } finally {
    await api.dispose();
  }
}

/** Skips the test when a QA fixture connection is not there as the seed made it. */
async function needFixture(id: string, status: string): Promise<Detail> {
  const d = await detailOf(id);
  test.skip(!d, `NOT LIVE: the QA fixture connection ${id} is not in Test Firm B`);
  test.skip(
    d!.status !== status,
    `NOT LIVE: the QA fixture connection ${id} is ${d!.status}, not ${status}`,
  );
  return d!;
}

const SUMMARY: Record<string, string> = {
  HEALTHY: 'Connection is active and working properly.',
  UNKNOWN: 'No check has run yet: run a connection test to check it.',
  STALE: 'Last checked over a week ago: run a connection test to check it again.',
  DISCONNECTED: 'This integration is disconnected. Reconnect it to sync again.',
};

// ---------------------------------------------------------------- the rows

test.describe('Integrations Review Two (Owner)', () => {
  test.use(as('owner'));

  test('I-R2-01 health has one state: the summary, checks, icons and advice agree', async ({
    page,
  }, info) => {
    const xero = await needFixture(XERO, 'CONNECTED');
    const hubspot = await needFixture(HUBSPOT, 'NEEDS_ATTENTION');
    const mailchimp = await needFixture(MAILCHIMP, 'DISCONNECTED');
    // The three states the review saw contradict themselves: stale (an old sync, never tested),
    // failing (a failed sync) and disconnected.
    expect([xero.health.state, hubspot.health.state, mailchimp.health.state]).toEqual([
      'STALE',
      'FAILING',
      'DISCONNECTED',
    ]);
    for (const [id, d] of [
      [XERO, xero],
      [HUBSPOT, hubspot],
      [MAILCHIMP, mailchimp],
    ] as const) {
      await test.step(`${d.provider.name}: ${d.health.state}`, async () => {
        await open(page, `/integrations/${id}/troubleshooting`);
        const card = page.getByTestId('health-checks');
        const summary = card.getByTestId('health-summary');
        const state = d.health.state;
        await expect(summary).toHaveText(SUMMARY[state] ?? d.health.summary);
        // The colour follows the state: green only when healthy, red when failing or
        // disconnected, neutral otherwise.
        await expect(summary).toHaveClass(
          state === 'HEALTHY'
            ? /bg-success-soft/
            : state === 'FAILING' || state === 'DISCONNECTED'
              ? /bg-danger-soft/
              : /bg-canvas/,
        );
        await expect(summary).not.toHaveText(SUMMARY['HEALTHY']!);
        const what = page.getByTestId('health-suggestions');
        await expect(what).not.toContainText('Nothing needs your attention.');
        for (const s of d.health.suggestions) await expect(what).toContainText(s);
        expect(d.health.suggestions.length, 'advice for every state but healthy').toBeGreaterThan(
          0,
        );
        // Each check row reads as its result (never a passed label on a failed check).
        for (const c of d.health.checks) await expect(card).toContainText(c.label);
        if (state === 'DISCONNECTED') {
          await expect(card).toContainText('Disconnected');
          await expect(card).not.toContainText('Authentication valid');
          await expect(card).not.toContainText('Data syncing as expected');
        }
        if (state === 'FAILING') {
          await expect(card).toContainText('Data sync is failing');
          await expect(card).not.toContainText('Data syncing as expected');
        }
        // The last success is told apart from the last attempt.
        await expect(card.getByTestId('health-syncs')).toContainText(
          d.health.lastSuccessAt ? /Last successful sync: [A-Z][a-z]{2} \d/ : /none yet/,
        );
        // The Overview tab's Connection Health says the same.
        await shot(page, TAB, `I-R2-01-${d.provider.name}`, info);
        // One state: a page that says no check has run shows no check as passed, and a page whose
        // summary dates a check shows that check's date (PR #1623: "a check not yet run shows as
        // unknown, never as passed").
        // The line under the heading ("Last checked <date>" or "No check has run yet.").
        const line = card.getByText(/^(Last checked [A-Z][a-z]{2} \d.*|No check has run yet\.)$/);
        await expect(line).toHaveCount(1);
        const lineText = (await line.textContent()) ?? '';
        if (lineText.includes('No check has run yet')) {
          expect
            .soft(
              d.health.checks.filter((c) => c.state === 'OK').map((c) => c.label),
              `${d.provider.name}: "No check has run yet." above checks shown as passed`,
            )
            .toEqual([]);
          expect
            .soft(
              d.health.summary,
              `${d.provider.name}: "No check has run yet." beside a summary that dates a check`,
            )
            .not.toMatch(/Last checked/);
        }
        await open(page, `/integrations/${id}`);
        await expect(page.getByTestId('connection-health')).toContainText(d.health.summary);
      });
    }
  });

  test('I-R2-02 Live and Test agree: counts, health and lists come from one environment', async ({
    page,
  }, info) => {
    await needFixture(XERO, 'CONNECTED');
    // Test: the fixture connections belong to providers without a Test card, so nothing counts.
    await open(page, '/integrations?environment=TEST');
    await expect(stat(page, 'Connected').value).toHaveText('0');
    await expect(stat(page, 'Needs Attention').value).toHaveText('0');
    await expect(stat(page, 'Last System Check').value).toHaveText('Not checked yet');
    await expect(stat(page, 'Last System Check').note).toHaveText('No connected integrations');
    await expect(page.getByTestId('integration-health')).toContainText(
      'No connected integrations to check yet.',
    );
    for (const label of [
      'Connections working',
      'Authorization issues',
      'Failed syncs',
      'Records pending',
    ])
      await expect(healthRow(page, label), label).toHaveText('0');
    for (const name of ['Xero', 'HubSpot', 'Mailchimp'])
      await expect(overviewCard(page, name)).toHaveCount(0);
    await expect(page.getByTestId('integration-card').getByTestId('test-badge')).toHaveCount(0);
    await expect(page.getByTestId('integration-activity')).toContainText(
      'No integration activity yet.',
    );
    await page.getByRole('button', { name: 'View Health' }).click();
    const dialog = page.getByRole('dialog', { name: 'Integration Health' });
    await expect(dialog).toContainText('No connected integrations: nothing has been checked yet.');
    await expect(
      dialog.getByRole('listitem').filter({ hasText: 'Connections working' }),
    ).toHaveText(/Connections working\s*0/);
    await shot(page, TAB, 'I-R2-02-test-overview', info);
    await page.keyboard.press('Escape');

    // Live: the counts and the check note agree with the Live cards.
    await open(page, '/integrations');
    const connected = Number(await stat(page, 'Connected').value.textContent());
    const shown = await page
      .getByTestId('integration-card')
      .filter({ has: page.getByText(/^(Connected|Syncing)$/) })
      .count();
    expect(shown, 'Connected counts the Live cards that are connected').toBe(connected);
    const working = Number(await healthRow(page, 'Connections working').textContent());
    expect(working).toBe(connected);
    const note = stat(page, 'Last System Check').note;
    if (connected === 0) await expect(note).toHaveText('No connected integrations');
    else await expect(note).not.toHaveText('No connected integrations');
    await expect(page.getByTestId('integration-card').getByTestId('test-badge')).toHaveCount(0);
    await shot(page, TAB, 'I-R2-02-live-overview', info);
    // The review's complaint (row map): "nothing checked" beside a working count. A connection
    // counted as working has been checked (a test or a sync), so the check card has a date.
    if (working > 0)
      expect
        .soft(
          (await stat(page, 'Last System Check').value.textContent())?.trim(),
          `"Not checked yet" beside ${working} connection(s) working`,
        )
        .not.toBe('Not checked yet');

    // The marketplace shows Live connections unless asked for Test.
    await open(page, '/integrations/marketplace');
    const xero = marketCard(page, 'Xero');
    await expect(xero).toBeVisible();
    await expect(xero.getByTestId('test-badge')).toHaveCount(0);
    await expect(xero.getByText('Connected', { exact: true })).toHaveCount(0);
    await open(page, '/integrations/marketplace?environment=TEST');
    await expect(marketCard(page, 'Xero').getByTestId('test-badge')).toBeVisible();
    await expect(marketCard(page, 'Xero').getByText('Connected', { exact: true })).toBeVisible();
    await expect(
      marketCard(page, 'HubSpot').getByText('Needs Attention', { exact: true }),
    ).toBeVisible();
    await expect(
      marketCard(page, 'Mailchimp').getByText('Disconnected', { exact: true }),
    ).toBeVisible();
    await shot(page, TAB, 'I-R2-02-test-marketplace', info);
  });

  test('I-R2-03 a mapping saved in an area the provider no longer offers is shown read-only', async ({
    page,
  }, info) => {
    await needFixture(XERO, 'CONNECTED');
    await open(page, `/integrations/${XERO}/data-mapping`);
    const card = page
      .getByTestId('mapping-scope')
      .filter({ has: page.getByTestId('mapping-read-only') });
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('heading', { name: 'Client', exact: true })).toBeVisible();
    await expect(card).toContainText('1 field mapped');
    await expect(card.getByTestId('mapping-read-only')).toHaveText(
      'Saved for an area this provider no longer offers: kept and shown here, but it cannot be changed.',
    );
    const pair = card.getByRole('table').getByRole('row').nth(1);
    await expect(pair).toContainText('client.name');
    await expect(pair).toContainText('Contact Name');
    await expect(card.getByRole('button', { name: 'Configure Mapping' })).toHaveCount(0);
    await shot(page, TAB, 'I-R2-03-mapping', info);
    // The Overview's preview shows the same pair, so both now agree.
    await open(page, `/integrations/${XERO}`);
    const preview = page.getByTestId('data-mapping-preview');
    await expect(preview).toContainText('client.name');
    await expect(preview).toContainText('Contact Name');
  });

  test('I-R2-04 a run is dated by when it ran, the same in the table, its detail and the Overview', async ({
    page,
  }, info) => {
    await needFixture(XERO, 'CONNECTED');
    const api = await apiAs('owner');
    const runs = (
      (await (
        await api.get(`business/integrations/connections/${XERO}/history?page=1&pageSize=20`)
      ).json()) as { items: Run[] }
    ).items;
    await api.dispose();
    const run = runs[0]!;
    expect(run.startedAt, 'the fixture run has a start time').toBeTruthy();
    // The case the review saw: the row was written days after the run.
    expect(run.createdAt.slice(0, 10)).not.toBe(run.startedAt!.slice(0, 10));

    await open(page, `/integrations/${XERO}/sync-history`);
    const row = page.getByTestId('sync-history').getByRole('row').nth(1);
    const time = row.locator('time');
    await expect(time).toHaveAttribute('datetime', run.startedAt!);
    const full = (await time.getAttribute('title')) ?? '';
    expect(full).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}/);
    await row.getByRole('button', { name: /^View/ }).click();
    const drawer = page.getByRole('dialog', { name: /run$/ });
    await expect(drawer.locator('h2 + p')).toHaveText(full);
    const started = drawer
      .getByTestId('run-detail')
      .locator('dl > div')
      .filter({ has: page.getByText('Started', { exact: true }) });
    await expect(started.locator('dd')).toHaveText(full);
    await shot(page, TAB, 'I-R2-04-history', info);
    await drawer.getByRole('button', { name: 'Close panel' }).click();

    await open(page, `/integrations/${XERO}`);
    const recent = page.getByTestId('recent-sync-activity').locator('time').first();
    await expect(recent).toHaveAttribute('datetime', run.startedAt!);
  });

  test('I-R2-05 the history Object filter offers every object the runs have', async ({
    page,
  }, info) => {
    await needFixture(XERO, 'CONNECTED');
    await open(page, `/integrations/${XERO}/sync-history`);
    const object = page.getByTestId('sync-history').getByLabel('Object');
    // Xero lists Invoices and Contacts; its run is of Customers, which it no longer lists.
    await expect(object.locator('option', { hasText: 'Customers' })).toHaveCount(1);
    await expect(object.locator('option', { hasText: 'Invoices' })).toHaveCount(1);
    await object.selectOption({ label: 'Customers' });
    await settled(page);
    const rows = page.getByTestId('sync-history').getByRole('row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText('Customers');
    await expect(page.getByTestId('sync-history')).not.toContainText(
      'No runs match these filters.',
    );
    await shot(page, TAB, 'I-R2-05-filter', info);
    // A provider object without runs filters to none, and the Customers choice stays offered.
    await object.selectOption({ label: 'Invoices' });
    await expect(page.getByTestId('sync-history')).toContainText('No runs match these filters.');
    await expect(object.locator('option', { hasText: 'Customers' })).toHaveCount(1);
  });

  test('I-R2-06 a disconnected connection, or one needing attention, offers no Sync Now', async ({
    page,
    browser,
  }, info) => {
    await needFixture(MAILCHIMP, 'DISCONNECTED');
    await needFixture(HUBSPOT, 'NEEDS_ATTENTION');
    await needFixture(XERO, 'CONNECTED');
    const cases: [string, string][] = [
      [MAILCHIMP, 'Reconnect first: a disconnected integration cannot sync.'],
      [HUBSPOT, 'Fix the connection first (see Troubleshooting): it cannot sync until then.'],
    ];
    for (const [id, reason] of cases) {
      await open(page, `/integrations/${id}`);
      await expect(page.getByTestId('sync-blocked')).toHaveText(reason);
      const buttons = page.getByRole('button', { name: 'Sync Now', exact: true });
      await expect(buttons).toHaveCount(2);
      for (const b of await buttons.all()) await expect(b).toBeDisabled();
      // The header's button says why.
      await expect(
        page
          .getByTestId('integration-header')
          .getByRole('button', { name: 'Sync Now', exact: true }),
      ).toHaveAttribute('aria-describedby', 'sync-blocked');
      await shot(page, TAB, `I-R2-06-${id === MAILCHIMP ? 'disconnected' : 'attention'}`, info);
    }
    // A connected one still offers it to the Owner (not pressed), with no reason shown.
    await open(page, `/integrations/${XERO}`);
    await expect(page.getByTestId('sync-blocked')).toHaveCount(0);
    await expect(
      page.getByTestId('integration-header').getByRole('button', { name: 'Sync Now', exact: true }),
    ).toBeEnabled();
    // Staff only view: no Sync Now for them on any connection.
    const staff = await pageAs(browser, 'staff');
    try {
      await open(staff.page, `/integrations/${XERO}`);
      await expect(
        staff.page
          .getByTestId('integration-header')
          .getByRole('button', { name: 'Sync Now', exact: true }),
      ).toBeDisabled();
      expect(staff.tried).toEqual([]);
    } finally {
      await staff.done();
    }
  });

  test('I-R2-07 API & Webhooks reads as built in, one way out, and says what connecting does', async ({
    page,
  }, info) => {
    await open(page, '/integrations/custom_api/connect');
    await expect(page.getByRole('heading', { name: 'Set Up API & Webhooks' })).toBeVisible();
    const facts = page.getByTestId('provider-facts');
    await expect(facts).toContainText('Out of Firmivra');
    await expect(facts).not.toContainText('Into Firmivra');
    await expect(facts).toContainText('Built in (no outside account)');
    const note = page.getByTestId('api-webhooks-note');
    for (const term of ['Endpoint', 'Events', 'Signing secret', 'First send'])
      await expect(note.getByText(term, { exact: true })).toBeVisible();
    await expect(page.getByText('Secure Authorization')).toHaveCount(0);
    await expect(page.getByText('Built into Firmivra')).toBeVisible();
    await expect(page.getByText('Create the connection here', { exact: true })).toBeVisible();
    const complete = page.getByTestId('setup-complete');
    await expect(complete).toContainText(
      'Nothing is sent until you set the endpoint and events on the API & Webhooks setup',
    );
    await expect(complete).not.toContainText('initial sync');
    await expect(complete).toContainText('Create the connection to complete setup.');
    await expect(complete).not.toContainText('Authorize your account');
    await expect(page.getByText('Authorize and link your account')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Connect integration', exact: true }),
    ).toBeVisible();
    await shot(page, TAB, 'I-R2-07-custom-api', info);
    // A provider that signs in says what connecting really does: a test, then the schedule.
    await open(page, '/integrations/quickbooks/connect');
    const qb = page.getByTestId('setup-complete');
    await expect(qb).toContainText(
      'The first sync runs at its scheduled time, or when you choose Sync Now.',
    );
    await expect(qb).not.toContainText('starts the initial sync');
    await expect(qb).toContainText('No data is synced by the test.');
    await expect(page.getByText('Secure Authorization')).toBeVisible();
  });

  test('I-R2-08 a request dialog closed and opened again shows no errors from the last attempt', async ({
    page,
  }, info) => {
    await open(page, '/integrations/marketplace');
    const openDialog = () =>
      page
        .getByTestId('marketplace-request')
        .getByRole('button', { name: 'Request Integration', exact: true })
        .click();
    await openDialog();
    const dialog = page.getByRole('dialog', { name: 'Request an integration' });
    const name = dialog.getByLabel('Provider / software name');
    // An empty Submit: the browser checks the form; nothing is sent.
    await dialog.getByRole('button', { name: 'Submit request' }).click();
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    // Nothing typed: Cancel closes, and the dialog comes back clean.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await openDialog();
    await expect(name).not.toHaveAttribute('aria-invalid', 'true');
    // A started draft with a bad website (still missing the required "connect to"): Keep draft
    // keeps what was typed, not the error.
    await name.fill(`LIVE-CHECK Example CRM (fake)`);
    const website = dialog.getByLabel('Website URL (optional)');
    await website.fill('not-a-url');
    await dialog.getByRole('button', { name: 'Submit request' }).click();
    await expect(website).toHaveAttribute('aria-invalid', 'true');
    await shot(page, TAB, 'I-R2-08-errors', info);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Keep draft' }).click();
    await expect(dialog).toBeHidden();
    await openDialog();
    await expect(name).toHaveValue('LIVE-CHECK Example CRM (fake)');
    await expect(website).not.toHaveAttribute('aria-invalid', 'true');
    await expect(name).not.toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await shot(page, TAB, 'I-R2-08-reopened', info);
    // Leave without a request: Discard.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'Discard' }).click();
  });

  test('I-R2-09 the request dialog keeps Tab and Shift+Tab inside; Escape closes and returns focus', async ({
    page,
  }) => {
    await open(page, '/integrations/marketplace');
    const opener = page
      .getByTestId('custom-integration')
      .getByRole('button', { name: 'Request Integration', exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Request an integration' });
    await expect(dialog).toBeVisible();
    // The dialog's first and last Tab stops (shown, enabled, in page order).
    await page.evaluate(() => {
      const box = document.querySelector('dialog[open]');
      const stops = [
        ...(box?.querySelectorAll<HTMLElement>(
          'a[href], button, input, select, textarea, [tabindex]',
        ) ?? []),
      ].filter((e) => e.tabIndex >= 0 && !e.matches(':disabled') && e.getClientRects().length > 0);
      stops[0]?.setAttribute('data-live-stop', 'first');
      stops.at(-1)?.setAttribute('data-live-stop', 'last');
    });
    const first = dialog.locator('[data-live-stop="first"]');
    const last = dialog.locator('[data-live-stop="last"]');
    await expect(first).toHaveAccessibleName('Close dialog');
    await last.focus();
    await page.keyboard.press('Tab');
    await expect(first).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(last).toBeFocused();
    // Through every stop with Tab: focus never leaves the dialog.
    await first.focus();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(
        await page.evaluate(() => !!document.activeElement?.closest('dialog[open]')),
        `Tab ${i + 1} stays in the dialog`,
      ).toBe(true);
    }
    // Escape is unchanged: an untouched request closes, and focus is back on the button.
    await first.focus();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('I-UA01 every Manage tab, the connect steps and Sync Now have their own Help', async ({
    page,
  }, info) => {
    await needFixture(XERO, 'CONNECTED');
    const tabs: [string, string[]][] = [
      ['/sync-settings', ['Sync schedule', 'Data to sync', 'Provider options', 'Sync Now']],
      ['/data-mapping', ['Data mapping']],
      ['/permissions', ['Granted permissions']],
      ['/sync-history', ['Sync history']],
      ['/troubleshooting', ['Connection health']],
    ];
    for (const [path, topics] of tabs) {
      await open(page, `/integrations/${XERO}${path}`);
      for (const topic of topics) await expect(help(page, topic).first()).toBeVisible();
    }
    // Each says what the area does and its consequence.
    await expect(help(page, 'Connection health')).toHaveAccessibleDescription(/syncs no data/);
    await open(page, `/integrations/${XERO}/sync-settings`);
    await expect(help(page, 'Data to sync')).toHaveAccessibleDescription(
      /what is already in Firmivra stays/,
    );
    await expect(help(page, 'Sync Now')).toHaveAccessibleDescription(
      /cannot run while the connection is disconnected/,
    );
    await shot(page, TAB, 'I-UA01-sync-settings', info);
    // The connect steps: Permissions and Complete.
    await open(page, '/integrations/custom_api/connect');
    await expect(help(page, 'Permissions step')).toHaveAccessibleDescription(
      /Only the permissions the ticked objects need/,
    );
    await expect(help(page, 'Complete setup')).toHaveAccessibleDescription(/syncs no data/);
    // Rotate Secret's Help is on an API & Webhooks connection's settings: Test Firm B has none,
    // and making one is a connect (not here).
  });

  test('I-UA02 @narrow browse, my connections and my requests are one step apart, in the same environment', async ({
    page,
    browser,
  }, info) => {
    await open(page, '/integrations?environment=TEST');
    const nav = page.getByTestId('integrations-nav');
    await expect(nav.getByRole('link', { name: 'My connections' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.getByRole('link', { name: 'Browse integrations' })).toHaveAttribute(
      'href',
      '/integrations/marketplace?environment=TEST',
    );
    await expect(nav.getByRole('link', { name: 'My requests' })).toHaveAttribute(
      'href',
      '/integrations/requests?environment=TEST',
    );
    await expect(page.getByRole('link', { name: 'View Integration Marketplace' })).toHaveAttribute(
      'href',
      '/integrations/marketplace?environment=TEST',
    );
    await shot(page, TAB, 'I-UA02-overview-test', info);
    // Browse keeps Test: its cards with a Test connection carry the Test badge.
    await nav.getByRole('link', { name: 'Browse integrations' }).click();
    await expect(page).toHaveURL(/\/integrations\/marketplace\?environment=TEST$/);
    await settled(page);
    const browse = page.getByTestId('integrations-nav');
    await expect(browse.getByRole('link', { name: 'Browse integrations' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    for (const name of ['Xero', 'HubSpot', 'Mailchimp'])
      await expect(marketCard(page, name).getByTestId('test-badge'), name).toBeVisible();
    await expect(marketCard(page, 'Firmivra Mail').getByTestId('test-badge')).toHaveCount(0);
    await shot(page, TAB, 'I-UA02-marketplace-test', info);
    // My requests, still in Test, and back to My connections in Test.
    await browse.getByRole('link', { name: 'My requests' }).click();
    await expect(page).toHaveURL(/\/integrations\/requests\?environment=TEST$/);
    await settled(page);
    await expect(page.getByRole('heading', { name: 'My integration requests' })).toBeVisible();
    const reqNav = page.getByTestId('integrations-nav');
    await expect(reqNav.getByRole('link', { name: 'My requests' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await shot(page, TAB, 'I-UA02-requests', info);
    await reqNav.getByRole('link', { name: 'My connections' }).click();
    await expect(page).toHaveURL(/\/integrations\?(?=.*tab=connected)(?=.*environment=TEST)/);
    // Noted, not failed (no row asks it): Staff may not request an integration (the Marketplace
    // disables Request for them and the API answers 403); what does the new My requests page
    // offer them? Nothing is pressed.
    const staff = await pageAs(browser, 'staff');
    try {
      await open(staff.page, '/integrations/requests');
      await expect(
        staff.page.getByRole('heading', { name: 'My integration requests' }),
      ).toBeVisible();
      const ask = staff.page.getByRole('button', { name: 'Request an integration', exact: true });
      info.annotations.push({
        type: 'staff-requests-page',
        description: `Staff: "Request an integration" on My requests is ${(await ask.isEnabled()) ? 'ENABLED (the Marketplace disables it for Staff; the API refuses them)' : 'disabled'}`,
      });
      await open(staff.page, '/integrations/marketplace');
      await expect(
        staff.page
          .getByTestId('marketplace-request')
          .getByRole('button', { name: 'Request Integration', exact: true }),
      ).toBeDisabled();
      expect(staff.tried).toEqual([]);
    } finally {
      await staff.done();
    }
  });

  test('I-UA03 My requests lists each request with its reference, day and status', async ({
    page,
  }, info) => {
    const api = await apiAs('owner');
    type Req = {
      id: string;
      providerName: string;
      status: string;
      createdAt: string;
      statusChangedAt: string | null;
    };
    const rows = (
      (await (await api.get('business/integration-requests')).json()) as {
        items: Req[];
      }
    ).items;
    await api.dispose();
    await open(page, '/integrations/requests');
    const table = page.getByTestId('integration-requests');
    if (!rows.length) {
      await expect(table).toContainText('No requests yet');
      await shot(page, TAB, 'I-UA03-empty', info);
      // The receipt (reference, day, status, View my requests) shows only after a request is
      // submitted, and a request is a record for the Firmivra team that the firm cannot remove.
      test.skip(
        true,
        'NOT LIVE: Test Firm B has no integration request, and submitting one is a write this check may not make (the empty list was checked)',
      );
      return;
    }
    const day = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' });
    const labels: Record<string, string> = {
      NEW: 'New',
      REVIEWING: 'In review',
      PLANNED: 'Planned',
      IN_DEVELOPMENT: 'In development',
      AVAILABLE: 'Available',
      DECLINED: 'Declined',
    };
    const sorted = [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const trs = table.getByRole('table').getByRole('row');
    await expect(trs).toHaveCount(sorted.length + 1);
    for (const [i, r] of sorted.entries()) {
      const tr = trs.nth(i + 1);
      await expect(tr).toContainText(`IR-${r.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`);
      await expect(tr).toContainText(r.providerName);
      await expect(tr).toContainText(day.format(new Date(r.createdAt)));
      await expect(tr).toContainText(labels[r.status]!);
      await expect(tr).toContainText(
        r.statusChangedAt ? day.format(new Date(r.statusChangedAt)) : 'Not yet',
      );
    }
    await shot(page, TAB, 'I-UA03-list', info);
  });

  test('I-UA04 a problem says what it affects and what to do; last success apart from a later failed attempt', async ({
    page,
  }, info) => {
    await needFixture(HUBSPOT, 'NEEDS_ATTENTION');
    await needFixture(XERO, 'CONNECTED');
    // HubSpot's fixture reason is a code the API does not know: the general advice.
    await open(page, `/integrations/${HUBSPOT}`);
    const advice = page.getByTestId('status-advice');
    await expect(advice).toContainText('What it affects:Syncs may not be running.');
    await expect(advice).toContainText('What to do:Open Sync History to see what failed.');
    // Never a success: none; its failed attempt is shown apart.
    await expect(page.getByTestId('last-success')).toContainText('Last Successful Sync');
    await expect(page.getByTestId('last-success')).toContainText('Not yet');
    await expect(page.getByTestId('last-attempt')).toContainText('Last Attempt');
    await expect(page.getByTestId('last-attempt')).toContainText(/\d+ (hours?|minutes?) ago/);
    await shot(page, TAB, 'I-UA04-attention', info);
    // A failed sync does not move "last sync" on the card either.
    await open(page, `/integrations/${HUBSPOT}/troubleshooting`);
    await expect(page.getByTestId('health-syncs')).toContainText(
      /Last successful sync: none yet · Last attempt: [A-Z][a-z]{2} \d/,
    );
    // Xero: its last sync worked, so one time and no advice.
    await open(page, `/integrations/${XERO}`);
    await expect(page.getByTestId('last-success')).toContainText(/\d+ (hours?|minutes?) ago/);
    await expect(page.getByTestId('last-attempt')).toHaveCount(0);
    await expect(page.getByTestId('status-advice')).toHaveCount(0);
  });

  test('I-UA05 each provider says how close it is to Connect and who acts next', async ({
    page,
  }, info) => {
    await open(page, '/integrations');
    const cases: [string, string, string][] = [
      [
        'QuickBooks Online',
        'Developer setup pending',
        'Next: Firmivra. Firmivra finishes its developer setup with QuickBooks Online. Then you sign in here.',
      ],
      [
        'Textmagic',
        'Supported, not turned on yet',
        'Next: Firmivra. Firmivra turns on the Textmagic connection. Then you connect it here.',
      ],
      [
        'Payroll Providers',
        'Not offered yet',
        'Next: Your firm. Not one system yet. Use Request Integration to name the software you use.',
      ],
    ];
    for (const [name, label, next] of cases) {
      const card = overviewCard(page, name);
      await expect(card.getByText(label, { exact: true }), name).toBeVisible();
      await expect(card.getByTestId('next-step')).toHaveText(next);
      await expect(card.getByRole('link', { name: /^(Connect|Configure)$/ })).toHaveCount(0);
    }
    await shot(page, TAB, 'I-UA05-overview', info);
    // The marketplace details: readiness and who acts next, also for one that is ready.
    await open(page, '/integrations/marketplace');
    const details = async (name: string) => {
      await marketCard(page, name)
        .getByRole('button', { name: `Options for ${name}` })
        .click();
      await page.getByRole('menuitem', { name: 'View details' }).click();
      return page.getByRole('dialog', { name }).getByTestId('readiness-facts');
    };
    let facts = await details('QuickBooks Online');
    await expect(facts).toContainText('Readiness:Developer setup pending');
    await expect(facts).toContainText('Who acts next:Firmivra.');
    await shot(page, TAB, 'I-UA05-details', info);
    await page.keyboard.press('Escape');
    facts = await details('API & Webhooks');
    await expect(facts).toContainText('Readiness:Ready to connect');
    await expect(facts).toContainText(
      'Who acts next:Your firm. Set it up here. Nothing outside Firmivra is needed.',
    );
    await page.keyboard.press('Escape');
    // The connect page says the same, with no way to start a connection that would fail.
    await open(page, '/integrations/quickbooks/connect');
    await expect(page.getByText('Connection unavailable')).toBeVisible();
    await expect(
      page.getByText(
        'Developer setup pending. Next: Firmivra. Firmivra finishes its developer setup with QuickBooks Online. Then you sign in here.',
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Sign in with QuickBooks Online' }),
    ).toBeDisabled();
  });

  test('I-UA06 connecting and saving sync settings first show a review; Back keeps every choice', async ({
    page,
  }, info) => {
    await needFixture(XERO, 'CONNECTED');
    // Connect (API & Webhooks: nothing to sign in to): a review first; Back sends nothing.
    await open(page, '/integrations/custom_api/connect');
    await page.getByRole('button', { name: 'Connect integration', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Review before connecting API & Webhooks' });
    const facts = review.getByTestId('setup-review');
    await expect(facts).toContainText('EnvironmentLive');
    await expect(facts).toContainText('DestinationAPI & Webhooks');
    await expect(facts).toContainText('ObjectsEvents');
    await expect(facts).toContainText('DirectionExport to provider');
    await expect(facts).toContainText('Schedule');
    await expect(facts).toContainText(
      'What happens nextConnecting saves your choices. Nothing is sent until the endpoint and events are set',
    );
    await expect(review.getByRole('button', { name: 'Confirm and create' })).toBeVisible();
    await shot(page, TAB, 'I-UA06-connect-review', info);
    await review.getByRole('button', { name: 'Back' }).click();
    await expect(review).toBeHidden();

    // Sync Settings of Xero (Test): a change is reviewed first, marked changed, with the Test
    // note; Back keeps it, and Reset puts the saved settings back. Nothing is saved.
    await open(page, `/integrations/${XERO}/sync-settings`);
    const manual = page.getByLabel('Manual: only when someone selects Sync Now');
    const auto = page.getByLabel('Automatic: sync on a schedule');
    await expect(auto).toBeChecked();
    await manual.check();
    await page.getByRole('button', { name: 'Save Sync Settings' }).click();
    const settings = page.getByRole('dialog', { name: 'Review sync settings' });
    const sf = settings.getByTestId('setup-review');
    await expect(sf).toContainText('EnvironmentTest');
    await expect(sf).toContainText('Schedule(changed)Manual (Sync Now)');
    await expect(sf).toContainText('Saving changes no data.');
    await expect(settings.getByTestId('setup-review-test')).toContainText('Test mode works with');
    await shot(page, TAB, 'I-UA06-settings-review', info);
    await settings.getByRole('button', { name: 'Back' }).click();
    await expect(settings).toBeHidden();
    await expect(manual).toBeChecked();
    await page.getByRole('button', { name: 'Reset' }).click();
    await expect(auto).toBeChecked();
  });

  test('I-F03 each state reads as itself, and the overview says where its date comes from', async ({
    page,
  }, info) => {
    await needFixture(XERO, 'CONNECTED');
    // Stale: a sync over a week ago and no test since (the fixture's Oct 28 sync).
    await open(page, `/integrations/${XERO}/troubleshooting`);
    await expect(page.getByTestId('health-summary')).toHaveText(SUMMARY['STALE']!);
    await expect(page.getByTestId('health-suggestions')).toContainText(
      'Run a connection test to check it again.',
    );
    // Unknown: a connection never tested and never synced (Firmivra Mail, Live), if it is so.
    const api = await apiAs('owner');
    const live = (await (await api.get('business/integrations?environment=LIVE')).json()) as {
      summary: { connected: number; lastCheckAt: string | null };
      items: { provider: { name: string }; connections: { id: string }[] }[];
    };
    const unknown: { id: string; name: string }[] = [];
    for (const item of live.items)
      for (const c of item.connections) {
        const h = (await (
          await api.get(`business/integrations/connections/${c.id}/health`)
        ).json()) as Health;
        if (h.state === 'UNKNOWN') unknown.push({ id: c.id, name: item.provider.name });
      }
    await api.dispose();
    if (unknown[0]) {
      await open(page, `/integrations/${unknown[0].id}/troubleshooting`);
      await expect(page.getByTestId('health-summary')).toHaveText(SUMMARY['UNKNOWN']!);
      for (const t of [
        'Authentication valid',
        'API connection healthy',
        'Data syncing as expected',
      ])
        await expect(page.getByTestId('health-checks')).not.toContainText(t);
      await shot(page, TAB, 'I-F03-unknown', info);
    }
    // The overview's Last System Check is the newest test or sync of the Live connections it
    // counts, and with none it says so instead of a date.
    await open(page, '/integrations');
    const check = stat(page, 'Last System Check');
    if (live.summary.lastCheckAt === null) {
      await expect(check.value).toHaveText('Not checked yet');
      await expect(check.note).toHaveText(
        live.summary.connected ? 'Not checked yet' : 'No connected integrations',
      );
      await expect(check.note).not.toHaveText('All systems operational');
    } else {
      await expect(check.value).not.toHaveText('Not checked yet');
    }
    await shot(page, TAB, 'I-F03-live-overview', info);
  });
});
