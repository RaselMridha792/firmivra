import { expect, type Locator, type Page, test } from '@playwright/test';

// R55, Clients Review 2: one-line tab strips (V-001, N8-09). She measured the Sign-ups strip at
// 43 px tall with 44 px of content, so a 1 px vertical scrollbar showed beside the tabs; the same
// on the client profile tabs and on Share Access. Each strip here is measured: it can never show
// a vertical scrollbar, a one-line strip needs no sideways scrolling, and a tab's keyboard focus
// ring is drawn inside the tab, inside the strip, so the hidden overflow never clips it.
// Mock mode as the Owner, at her 1165 x 747 window and at 1440. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const WIDTHS = [
  { width: 1165, height: 747 },
  { width: 1440, height: 900 },
];

/** The strip's own measurements: can it show a vertical scrollbar, and does it need sideways scroll? */
async function measure(strip: Locator) {
  return strip.evaluate((el) => {
    const cs = getComputedStyle(el);
    const scrollsY = cs.overflowY === 'auto' || cs.overflowY === 'scroll';
    return {
      verticalScrollbar:
        cs.overflowY === 'scroll' || (scrollsY && el.scrollHeight > el.clientHeight),
      overflowY: cs.overflowY,
      sideways: el.scrollWidth > el.clientWidth,
    };
  });
}

/** Where a keyboard-focused tab's ring is drawn, against the strip that clips it. */
async function focusRing(strip: Locator, focused: Locator) {
  const ring = await focused.evaluate((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      style: cs.outlineStyle,
      offset: parseFloat(cs.outlineOffset),
      width: parseFloat(cs.outlineWidth),
      top: r.top,
      bottom: r.bottom,
      left: r.left,
      right: r.right,
    };
  });
  const box = await strip.evaluate((el) => {
    const r = el.getBoundingClientRect();
    // The clip edge is the padding box: inside the borders.
    const cs = getComputedStyle(el);
    return {
      top: r.top + parseFloat(cs.borderTopWidth),
      bottom: r.bottom - parseFloat(cs.borderBottomWidth),
    };
  });
  return { ring, box };
}

async function expectStripClean(page: Page, strip: Locator, firstTab: Locator, name: string) {
  await expect(strip, name).toBeVisible({ timeout: 60_000 });
  expect(await measure(strip), name).toEqual({
    verticalScrollbar: false,
    overflowY: 'hidden',
    sideways: false,
  });
  // Keyboard focus: the ring is drawn inside the tab (a negative offset at least its width), so
  // its sides and top lie inside the strip's clip box. The tab sits 1 px over the strip's bottom
  // border (its underline covers that line), so at most that 1 px of the ring's bottom edge is
  // under the clip edge: the bottom of the ring still shows.
  await firstTab.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(firstTab).toBeFocused();
  const { ring, box } = await focusRing(strip, firstTab);
  expect(ring.style, `${name}: a focus ring shows`).not.toBe('none');
  expect(ring.offset, `${name}: the ring is drawn inside the tab`).toBeLessThanOrEqual(-ring.width);
  // The ring's outer edge: `offset + width` outside the tab's border edge (zero or less: inside).
  const out = ring.offset + ring.width;
  expect(ring.top - out, `${name}: ring top`).toBeGreaterThanOrEqual(box.top - 0.5);
  expect(ring.bottom + out, `${name}: ring bottom`).toBeLessThanOrEqual(box.bottom + 1.5);
  expect(ring.bottom + ring.offset, `${name}: ring bottom shows`).toBeLessThan(box.bottom);
}

// Clients Review 2 (V-001): the Sign-ups strip and Document Share Access tabs.
test('V-001: the Sign-ups and Share Access tab strips show no vertical scrollbar and keep focus rings in view', async ({
  page,
}) => {
  for (const size of WIDTHS) {
    await page.setViewportSize(size);
    await page.goto(app('/sign-ups'));
    const signUps = page.getByRole('tablist', { name: 'Sign-up status' });
    await expectStripClean(
      page,
      signUps,
      signUps.getByRole('tab', { selected: true }),
      `Sign-ups at ${size.width}`,
    );

    await page.goto(app('/documents/0199b6a5-0000-7000-8000-000000000006/share'));
    const sharing = page.getByRole('tablist', { name: 'Sharing' });
    await expectStripClean(
      page,
      sharing,
      sharing.getByRole('tab', { name: 'Share Access' }),
      `Share Access at ${size.width}`,
    );
  }
});
