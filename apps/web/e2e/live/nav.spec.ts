import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { app, as, portal, settled, shot } from './helpers';

/**
 * CSP report-only (#1627): the browser logs what the policy would block. While this walks every
 * menu page and one page under it, those console lines are kept per page in
 * LIVE_SHOTS_DIR/csp/violations.jsonl and as an annotation. They never fail the test.
 */
function watchCsp(page: Page, info: TestInfo, site: string) {
  const seen: { site: string; path: string; text: string }[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (/Content Security Policy|Content-Security-Policy|\[Report Only\]/i.test(text)) {
      seen.push({ site, path: new URL(page.url()).pathname, text: text.slice(0, 300) });
    }
  });
  return () => {
    if (!seen.length) return;
    const dir = join(process.env['LIVE_SHOTS_DIR'] ?? '.', 'csp');
    mkdirSync(dir, { recursive: true });
    const at = new Date().toISOString();
    for (const v of seen)
      appendFileSync(
        join(dir, 'violations.jsonl'),
        `${JSON.stringify({ at, ...v })}
`,
      );
    const pages = new Set(seen.map((v) => v.path));
    info.annotations.push({
      type: 'CSP report-only',
      description: `${seen.length} console lines on ${pages.size} page(s): ${[...pages].slice(0, 10).join(', ')}`,
    });
  };
}

/**
 * Side menu active state, firm workspace and client portal (lead, Nov 18, after Octavia found My
 * Documents and Intake Forms lighting up Home in the portal). For every side-menu link: open it,
 * then one deeper page under it (the first link in the page whose path starts with the item's), and
 * each time exactly one menu link is current (aria-current="page"), and it is that item. Read only:
 * it clicks menu links and links into existing records, never a button. Runs with every tab run
 * (run-live.sh adds it). Each failing item is a soft failure, so one run lists them all.
 */
const TAB = 'nav';

type Item = { label: string; path: string };

/** The menu's links (also those in a collapsed group), without sign-out and outside links. */
async function menuItems(page: Page): Promise<Item[]> {
  const nav = page.getByRole('navigation', { name: 'Main' }).first();
  await expect(nav).toBeAttached();
  // Same-origin links only, decided in the page (where `location` is the site's).
  const items = await nav.locator('a[href]').evaluateAll((links) =>
    links
      .filter((a) => (a as HTMLAnchorElement).origin === location.origin)
      .map((a) => ({
        label: (a.textContent ?? '').replace(/\s+/g, ' ').trim(),
        href: (a as HTMLAnchorElement).href,
      })),
  );
  const seen = new Set<string>();
  return items
    .map((i) => ({ label: i.label, path: new URL(i.href).pathname }))
    .filter((i) => !/sign-?out|log-?out/i.test(i.path + i.label))
    .filter((i) => (seen.has(i.path) ? false : (seen.add(i.path), true)));
}

/** The menu's current links: exactly one, and it is `path`. */
async function expectCurrent(page: Page, item: Item, where: string) {
  const nav = page.getByRole('navigation', { name: 'Main' }).first();
  const current = () =>
    nav
      .locator('a[aria-current="page"]')
      .evaluateAll((links) => links.map((a) => new URL((a as HTMLAnchorElement).href).pathname));
  // The menu may mark its item a moment after the page settles (client-side route state): wait
  // up to 8 s for the right mark before calling it wrong.
  await expect.soft
    .poll(current, {
      message: `${where}: the menu should mark only "${item.label}" (${item.path}) as current`,
      timeout: 8_000,
    })
    .toEqual([item.path]);
}

/** The first link in the page (not the menu) one level or more under the item's path. */
async function deeperLink(page: Page, item: Item): Promise<string | null> {
  const main = page.locator('main').first();
  const hrefs = await main
    .locator('a[href]')
    .evaluateAll((links) => links.map((a) => (a as HTMLAnchorElement).href));
  for (const href of hrefs) {
    const path = new URL(href).pathname;
    if (path.startsWith(`${item.path}/`) && !/\/(new|create)(\/|$)/.test(path)) return href;
  }
  return null;
}

async function checkMenu(page: Page, home: string, info: TestInfo) {
  const flushCsp = watchCsp(page, info, home.includes('portal') ? 'portal' : 'firm');
  await page.goto(home);
  await settled(page);
  const items = await menuItems(page);
  expect(items.length, 'the side menu has links').toBeGreaterThan(2);
  const report: string[] = [];
  for (const item of items) {
    await page.goto(new URL(item.path, home).toString());
    await settled(page);
    await expectCurrent(page, item, `on ${item.path}`);
    const deeper = await deeperLink(page, item);
    if (deeper) {
      await page.goto(deeper);
      await settled(page);
      await expectCurrent(page, item, `on the sub-page ${new URL(deeper).pathname}`);
      report.push(`${item.label}: ${item.path} + ${new URL(deeper).pathname}`);
    } else {
      report.push(`${item.label}: ${item.path} (no sub-page link in the page)`);
    }
  }
  info.annotations.push({ type: 'menu items checked', description: report.join(' | ') });
  flushCsp();
  await shot(page, TAB, `menu-${home.includes('portal') ? 'portal' : 'firm'}`, info);
}

test.describe('side menu active state', () => {
  test.describe.configure({ timeout: 900_000 });

  test.describe('firm workspace as Owner', () => {
    test.use(as('owner'));
    test('NAV-FIRM every menu item and one sub-page mark only that item', async ({
      page,
    }, info) => {
      await checkMenu(page, app('/'), info);
    });
  });

  test.describe('client portal as the client', () => {
    test.use(as('client'));
    test('NAV-PORTAL every menu item and one sub-page mark only that item', async ({
      page,
    }, info) => {
      await checkMenu(page, portal('/home'), info);
    });
  });
});
