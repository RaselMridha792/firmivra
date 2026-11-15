import { expect, type Page } from '@playwright/test';

// R60, Octavia's report of Nov 14 ("lots of overlap when the side menu is expanded"): a shared
// check for any screen at 1280, 1366 and 1440 with the sidebar expanded and collapsed, and at 390.
// It fails on the page scrolling sideways, text leaving the block that holds it, and the Client
// Portal header's name under its actions. Synthetic data only.

export const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
export const app = (path: string) => `http://app.localhost:${port}${path}`;

/** What spills: the page's sideways scroll, text out of its box, a header name under its actions. */
export async function layoutIssues(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) {
      out.push(`page scrolls sideways (${doc.scrollWidth} > ${doc.clientWidth})`);
    }
    const main = document.querySelector('main');
    if (!main) return out;
    // Inside a scroll or clip container (a table that scrolls, a truncated line) is not a spill.
    const clipped = (el: Element) => {
      for (let a = el.parentElement; a && a !== main; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.overflowX !== 'visible' || cs.position === 'fixed') return true;
      }
      return false;
    };
    // Text that leaves the block that holds it (a label out of its KPI card, say).
    for (const el of Array.from(
      main.querySelectorAll('p, span, h1, h2, h3, h4, a, label, dt, dd'),
    )) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const cs = getComputedStyle(el);
      if (cs.position === 'absolute' || cs.position === 'fixed' || clipped(el)) continue;
      // The block that holds it: past inline wrappers, and `display: contents` ones (no box).
      let box = el.parentElement;
      while (box) {
        const display = getComputedStyle(box).display;
        if (!display.startsWith('inline') && display !== 'contents') break;
        box = box.parentElement;
      }
      if (!box) continue;
      const b = box.getBoundingClientRect();
      if (r.right > b.right + 2 || r.left < b.left - 2) {
        out.push(`"${(el.textContent ?? '').trim().slice(0, 40)}" leaves its box`);
      }
    }
    // The Client Portal header: the name never under the actions.
    const name = document.querySelector('[data-testid="client-portal-name"]');
    const actions = document.querySelector('[data-testid="client-portal-actions"]');
    if (name && actions) {
      const n = name.getBoundingClientRect();
      const a = actions.getBoundingClientRect();
      if (n.left < a.right && a.left < n.right && n.top < a.bottom && a.top < n.bottom) {
        out.push('the client name sits under the header actions');
      }
    }
    return [...new Set(out)].slice(0, 10);
  });
}

async function check(page: Page, label: string) {
  // Let the layout settle after a resize.
  await page.waitForTimeout(300);
  expect(await layoutIssues(page), label).toEqual([]);
}

/**
 * Opens `path` with the sidebar expanded at the first width (screenshot), then the others,
 * collapses the sidebar for them all again, and ends at 390. `widths` defaults to 1280, 1366 and
 * 1440. `ready` is a test id the page shows once loaded (the page's main heading when left out).
 */
export async function checkLayout(
  page: Page,
  {
    name,
    path,
    ready,
    shots,
    widths = [1280, 1366, 1440],
    url = app,
    menu = true,
  }: {
    name: string;
    path: string;
    ready?: string;
    shots: string;
    widths?: number[];
    /** Another site (the client portal): its own address. */
    url?: (path: string) => string;
    /** False for a screen without the side menu: each width once, then 390. */
    menu?: boolean;
  },
) {
  const [firstWidth = 1280, ...otherWidths] = widths;
  await page.setViewportSize({ width: firstWidth, height: 900 });
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('firmivra.sidebar.collapsed', '0');
    } catch {
      // No storage: the menu starts expanded anyway.
    }
  });
  await page.goto(url(path));
  const shown = ready ? page.getByTestId(ready) : page.locator('main h1');
  await expect(shown.first()).toBeVisible({ timeout: 90_000 });
  // Lists and cards load after the heading.
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await check(page, `${name} at ${firstWidth}, sidebar expanded`);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/${name}-${firstWidth}-expanded.png`, fullPage: true });
  for (const width of otherWidths) {
    await page.setViewportSize({ width, height: 900 });
    await check(page, `${name} at ${width}, sidebar expanded`);
  }
  if (!menu) {
    await page.setViewportSize({ width: 390, height: 900 });
    await check(page, `${name} at 390`);
    return;
  }
  // The menu's own toggle shows at desktop widths: collapse it there.
  await page.setViewportSize({ width: Math.max(...widths, 1280), height: 900 });
  await page.getByRole('button', { name: 'Collapse menu' }).click();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await check(page, `${name} at ${width}, sidebar collapsed`);
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await check(page, `${name} at 390`);
}
