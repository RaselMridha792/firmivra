import { expect, type Page, test } from '@playwright/test';

// R55, Clients Review 2: the firm's Documents screen as she measured it (V-002, V-003, V-004,
// V-005, V-006, V-008, FC-03). Mock mode as the Owner (mocks/documents.ts: Jamie Sample has twelve
// files), at her 1165 x 747 window and at 1440. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const HER = { width: 1165, height: 747 };
const WIDE = { width: 1440, height: 900 };

async function openDocuments(page: Page, size = HER, client?: string) {
  await page.setViewportSize(size);
  await page.goto(app('/documents'));
  await expect(page.getByTestId('documents-screen')).toBeVisible({ timeout: 60_000 });
  if (client) await page.getByTestId('filter-client').selectOption({ label: client });
}
/** Jamie Sample's first page of files, loaded. */
async function openJamie(page: Page, size = HER) {
  await openDocuments(page, size, 'Jamie Sample');
  await expect(page.getByTestId('document-name')).toHaveCount(10);
}

// Clients Review 2 (V-002): All Documents, Signed / Completed and Missing Documents ran past
// their cards and Recently Uploaded wrapped into a narrow column beside its icon. Each label sits
// inside its card, under its icon, and wraps only between words.
test('V-002: each Documents card label fits its card, under its icon, never broken inside a word', async ({
  page,
}) => {
  for (const size of [HER, WIDE]) {
    await openDocuments(page, size);
    const cards = page.getByTestId('stat-cards').locator('> *');
    await expect(cards).toHaveCount(5);
    const measured = await cards.evaluateAll((all) =>
      all.map((card) => {
        const c = card.getBoundingClientRect();
        const icon = card.firstElementChild!.getBoundingClientRect();
        const label = card.querySelectorAll('span.block')[1] as HTMLElement;
        const l = label.getBoundingClientRect();
        // Each word's own boxes: a word broken across two lines has two.
        const words: string[] = [];
        const text = label.firstChild!;
        const range = document.createRange();
        let at = 0;
        for (const word of (text.textContent ?? '').split(' ')) {
          range.setStart(text, at);
          range.setEnd(text, at + word.length);
          const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
          if (lines.size > 1) words.push(word);
          at += word.length + 1;
        }
        return {
          label: label.textContent,
          inside: l.left >= c.left - 0.5 && l.right <= c.right + 0.5,
          overflows: label.scrollWidth > label.clientWidth + 1,
          underIcon: l.top >= icon.bottom - 0.5,
          brokenWords: words,
        };
      }),
    );
    for (const card of measured) {
      expect(card, `${card.label} at ${size.width}`).toEqual({
        label: card.label,
        inside: true,
        overflows: false,
        underIcon: true,
        brokenWords: [],
      });
    }
  }
});

// Clients Review 2 (V-003): the narrow centre panel cut off the chosen client, All Document Types,
// All Statuses and the search hint. Each filter shows its whole value (measured in its own font
// against the room inside it), none overlaps another, and all stay inside the filter card.
test('V-003: the Documents filters show their whole values, with no overlap or clipping', async ({
  page,
}) => {
  for (const size of [HER, WIDE]) {
    // A client chosen, as she had (a name of everyday length).
    await openJamie(page, size);
    const filters = page.getByTestId('documents-filters');
    const measured = await filters.evaluate((root) => {
      const ctx = document.createElement('canvas').getContext('2d')!;
      const fits = (el: HTMLInputElement | HTMLSelectElement) => {
        const cs = getComputedStyle(el);
        ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
        const text =
          el instanceof HTMLSelectElement ? (el.selectedOptions[0]?.text ?? '') : el.placeholder;
        const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        return { text, need: Math.ceil(ctx.measureText(text).width), room: Math.floor(room) };
      };
      const fields = [
        ...root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('select, input'),
      ];
      const card = root.closest('[class*="rounded"]')!.getBoundingClientRect();
      const boxes = fields.map((f) =>
        (f instanceof HTMLInputElement ? f.parentElement! : f).getBoundingClientRect(),
      );
      const overlaps: string[] = [];
      boxes.forEach((a, i) =>
        boxes.slice(i + 1).forEach((b, j) => {
          if (
            a.left < b.right - 0.5 &&
            b.left < a.right - 0.5 &&
            a.top < b.bottom - 0.5 &&
            b.top < a.bottom - 0.5
          )
            overlaps.push(`${i} and ${i + j + 1}`);
        }),
      );
      return {
        values: fields.map(fits),
        overlaps,
        outside: boxes.filter((b) => b.left < card.left - 0.5 || b.right > card.right + 0.5).length,
      };
    });
    expect(
      measured.values.map((v) => v.text),
      `at ${size.width}`,
    ).toEqual(['Jamie Sample', 'All Document Types', 'All Statuses', 'Search documents...']);
    for (const v of measured.values) {
      expect(v.need, `"${v.text}" at ${size.width}`).toBeLessThanOrEqual(v.room);
    }
    expect(measured.overlaps, `at ${size.width}`).toEqual([]);
    expect(measured.outside, `at ${size.width}`).toBe(0);
  }
});
