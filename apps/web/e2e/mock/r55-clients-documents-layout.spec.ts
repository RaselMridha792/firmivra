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

// Clients Review 2 (V-003): the narrow centre panel cut off the chosen client (a long name too), All Document Types,
// All Statuses and the search hint. Each filter shows its whole value (measured in its own font
// against the room inside it), none overlaps another, and all stay inside the filter card.
test('V-003: the Documents filters show their whole values, with no overlap or clipping', async ({
  page,
}) => {
  // A client chosen, as she had: a name of everyday length, and the longest (27 characters).
  for (const [size, client] of [
    [HER, 'Jamie Sample'],
    [HER, 'Northwind Bakery LLC (fake)'],
    [WIDE, 'Jamie Sample'],
    [WIDE, 'Northwind Bakery LLC (fake)'],
  ] as const) {
    await openDocuments(page, size, client);
    // The whole name on hover too.
    await expect(page.getByTestId('filter-client')).toHaveAttribute('title', client);
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
    ).toEqual([client, 'All Document Types', 'All Statuses', 'Search documents...']);
    for (const v of measured.values) {
      expect(v.need, `"${v.text}" at ${size.width}`).toBeLessThanOrEqual(v.room);
    }
    expect(measured.overlaps, `at ${size.width}`).toEqual([]);
    expect(measured.outside, `at ${size.width}`).toBe(0);
  }
});

// Clients Review 2 (V-004): seven columns were squeezed into the centre panel: headers overlapped,
// values collided and the file name link measured 0 px wide. Every header and value stays inside
// its own cell, the name has room, and the table scrolls sideways inside its region, never the page.
test('V-004: the Documents table keeps each header and value in its cell and scrolls inside its region', async ({
  page,
}) => {
  for (const size of [HER, WIDE]) {
    await openJamie(page, size);
    const table = page.getByTestId('documents-table').locator('table');
    await expect(table).toBeVisible();
    const measured = await table.evaluate((t) => {
      const spills: string[] = [];
      for (const cell of t.querySelectorAll('th, td')) {
        const c = cell.getBoundingClientRect();
        // Every element in the cell, and every run of text, inside the cell's box.
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          if (!n.textContent?.trim()) continue;
          // A truncated name is clipped (with "…") by its own link, which stays in the cell.
          const clip = n.parentElement?.closest('[data-testid="document-name"]');
          const range = document.createRange();
          range.selectNodeContents(clip ?? n);
          const r = clip ? clip.getBoundingClientRect() : range.getBoundingClientRect();
          if (r.width === 0) continue;
          if (r.left < c.left - 0.5 || r.right > c.right + 0.5)
            spills.push(`"${n.textContent.trim().slice(0, 30)}" leaves its cell`);
        }
      }
      const region = t.parentElement!;
      const doc = document.documentElement;
      return {
        spills: [...new Set(spills)],
        regionScrollsSideways: getComputedStyle(region).overflowX === 'auto',
        regionInsideItsColumn:
          region.getBoundingClientRect().right <=
          t.closest('[data-testid="documents-table"]')!.getBoundingClientRect().right + 0.5,
        pageScrollsSideways: doc.scrollWidth > doc.clientWidth,
        // Each name drawn (she measured the link at 0 px) and whole: these names fit their column.
        names: [...t.querySelectorAll<HTMLElement>('[data-testid="document-name"]')].map((a) => ({
          name: a.textContent,
          drawn: a.getBoundingClientRect().width > 0,
          cutOff: a.scrollWidth > a.clientWidth,
        })),
      };
    });
    expect(measured.spills, `at ${size.width}`).toEqual([]);
    expect(measured.regionScrollsSideways, `at ${size.width}`).toBe(true);
    expect(measured.regionInsideItsColumn, `at ${size.width}`).toBe(true);
    expect(measured.pageScrollsSideways, `at ${size.width}`).toBe(false);
    for (const n of measured.names) {
      expect(n, `at ${size.width}`).toEqual({ name: n.name, drawn: true, cutOff: false });
    }
  }
});

/** Every item of the open menu: inside the window, and the element on top at its centre. */
async function menuItemsInView(page: Page, name: string) {
  const menu = page.getByRole('menu', { name });
  await expect(menu).toBeVisible();
  return menu.evaluate((m) => {
    const table = document.querySelector('[data-testid="documents-table"]')!;
    const items = [...m.querySelectorAll<HTMLElement>('[role="menuitem"]')].map((item) => {
      const r = item.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return {
        label: item.textContent?.trim(),
        inWindow:
          r.top >= 0 &&
          r.left >= 0 &&
          r.bottom <= window.innerHeight &&
          r.right <= window.innerWidth,
        onTop: Boolean(top && item.contains(top)),
      };
    });
    return {
      outsideTable: !table.contains(m),
      menuScrolls: m.scrollHeight > m.clientHeight,
      items,
    };
  });
}

// Clients Review 2 (V-005): the row menu opened inside the table's scroll area, so only the top of
// Download showed and Share and the rest were hidden. The menu opens outside the table, and every
// item is inside the window, on top and works: Download asks for the file, Archive asks first,
// Share opens Share Access. A row at the bottom of the page is the one most likely to be cut off:
// Driver_License.jpg, a clean file, so its menu has every item.
test('V-005: the Documents row menu opens outside the table with every item in view and working', async ({
  page,
}) => {
  await openJamie(page);
  const last = 'Driver_License.jpg';
  const names = page.getByTestId('document-name');
  await expect(names.nth(8)).toHaveText(last);
  // Download goes to the file's own link (the mock's is a data: URL naming the file, which the
  // browser refuses to open in the tab and says so in the console).
  const said: string[] = [];
  page.on('console', (message) => said.push(message.text()));
  const steps: [string, () => Promise<void>][] = [
    [
      'Download',
      async () => {
        const link = encodeURIComponent(`Mock file: ${last}`);
        await expect.poll(() => said.some((text) => text.includes(link))).toBe(true);
      },
    ],
    [
      'Archive',
      async () => {
        const dialog = page.getByRole('dialog', { name: 'Archive Document' });
        await expect(dialog).toContainText(last);
        await dialog.getByRole('button', { name: 'Cancel' }).click();
        await expect(dialog).toBeHidden();
      },
    ],
    [
      'Share',
      async () => {
        await expect(page).toHaveURL(/\/documents\/[0-9a-f-]{36}\/share$/);
        await expect(page.getByTestId('share-file')).toContainText(last);
      },
    ],
  ];
  for (const [item, done] of steps) {
    await page.getByRole('button', { name: `Actions for ${last}` }).click();
    const measured = await menuItemsInView(page, `Actions for ${last}`);
    expect(measured.outsideTable).toBe(true);
    expect(measured.menuScrolls).toBe(false);
    expect(measured.items.map((i) => i.label)).toEqual([
      'Download',
      'Share',
      'Rename',
      'Move',
      'Request e-sign',
      'Archive',
    ]);
    for (const i of measured.items) {
      expect(i, `${i.label}`).toMatchObject({ inWindow: true, onTop: true });
    }
    await page.getByRole('menuitem', { name: item, exact: true }).click();
    await done();
  }
});

// Clients Review 2 (V-006): on Document Requests the counts sat at different heights (Partially
// Received higher than the rest). Every card's icon, count and label start on shared lines.
test('V-006: the Document Requests cards put their counts and labels on shared lines', async ({
  page,
}) => {
  for (const size of [HER, WIDE]) {
    await page.setViewportSize(size);
    await page.goto(app('/documents/requests'));
    const cards = page.getByTestId('request-cards').locator('> *');
    await expect(cards).toHaveCount(5, { timeout: 60_000 });
    await expect(cards.nth(2)).toContainText('Partially Received');
    await expect(cards.nth(2)).toContainText(/\d/);
    const tops = await cards.evaluateAll((all) =>
      all.map((card) => {
        const [icon, body] = [...card.children] as HTMLElement[];
        const [count, label] = [...(body?.children ?? [])] as HTMLElement[];
        const top = (el: HTMLElement | undefined) =>
          Math.round(el?.getBoundingClientRect().top ?? -1);
        return {
          icon: top(icon),
          count: top(count),
          label: top(label),
          card: Math.round(card.getBoundingClientRect().height),
        };
      }),
    );
    for (const key of ['icon', 'count', 'label', 'card'] as const) {
      const values = tops.map((t) => t[key]);
      expect(
        Math.max(...values) - Math.min(...values),
        `${key} at ${size.width}: ${values.join(', ')}`,
      ).toBeLessThanOrEqual(1);
    }
  }
});

// Clients Review 2 (V-008): a cut-off file name must show its whole name, extension included, on
// hover. A long name (renamed here) is truncated in the table, and its hover text is the full
// name with ".pdf"; every other name's hover text is its own full name too.
test('V-008: a truncated file name shows its full name with the extension on hover', async ({
  page,
}) => {
  await openJamie(page);
  const long = 'Quarterly_Estimated_Tax_Payment_Vouchers_and_Worksheets_2026_Final_Signed_Copy.pdf';
  const first = page.getByTestId('document-name').first();
  const was = ((await first.textContent()) ?? '').trim();
  await page.getByRole('button', { name: `Actions for ${was}` }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename Document' });
  await rename.getByLabel('File name *').fill(long);
  await rename.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByTestId('document-action-done')).toHaveText(`Renamed to ${long}.`);

  const link = page.getByTestId('document-name').filter({ hasText: long });
  await expect(link).toHaveAttribute('title', long);
  // It is cut off on screen: the hover text is what shows the rest.
  expect(await link.evaluate((a) => a.scrollWidth > a.clientWidth)).toBe(true);
  await link.hover();
  await expect(link).toHaveAttribute('title', long);
  for (const name of await page.getByTestId('document-name').all()) {
    const text = ((await name.textContent()) ?? '').trim();
    await expect(name).toHaveAttribute('title', text);
    expect(text).toMatch(/\.(pdf|jpg|png|xlsx|docx)$/);
  }
});

// Clients Review 2 (FC-03): with All Clients chosen, staff saw a note that began "Choose a client
// above" and went on with an API and source-code change. The note says only "Select a client to
// view their documents.", and nothing on the screen talks about code.
test('FC-03: with no client chosen the Documents note is plain words, with no code talk', async ({
  page,
}) => {
  await openDocuments(page, HER);
  await expect(page.getByTestId('filter-client')).toHaveValue('');
  await expect(page.getByTestId('documents-no-client')).toHaveText(
    'Select a client to view their documents.',
  );
  const main = (await page.getByRole('main').innerText()).replace(/\s+/g, ' ');
  expect(main).not.toMatch(
    /\bAPI\b|endpoint|source code|\/api\/|apps\/web|packages\/|\.tsx?\b|GET \/|POST \//i,
  );
});
