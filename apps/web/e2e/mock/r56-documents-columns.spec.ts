import { expect, type Locator, type Page, test } from '@playwright/test';

// R56, Clients Review Two V-009: Documents' side panels take the stat cards' columns, so their
// edges line up with the cards above: Folders under the first card, the table the widest region,
// the right rail under the last card at 2xl, or three across (one card's column each) at 1165 px
// while the cards are three across. Mock mode.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;

const box = async (l: Locator) => {
  const b = await l.boundingBox();
  if (!b) throw new Error('not visible');
  return { left: b.x, right: b.x + b.width, top: b.y };
};
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1);

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(`${app}/documents`);
  const cards = page.getByTestId('stat-cards').locator(':scope > *');
  await expect(cards.first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('folders-panel')).toBeVisible();
  const columns = page.getByTestId('documents-columns').locator(':scope > *');
  return {
    cards,
    folders: page.getByTestId('folders-panel'),
    table: columns.nth(1),
    rail: page.getByTestId('documents-rail').locator(':scope > *'),
  };
}

test('V-009 at 1165 px: Folders under the first card, the table under the other two, the rail three across', async ({
  page,
}) => {
  const { cards, folders, table, rail } = await open(page, 1165);
  const [c1, c2, c3] = await Promise.all([0, 1, 2].map(async (i) => box(cards.nth(i))));
  const f = await box(folders);
  const t = await box(table);
  near(f.left, c1!.left);
  near(f.right, c1!.right);
  near(t.left, c2!.left);
  near(t.right, c3!.right);
  for (const [i, c] of [c1, c2, c3].entries()) {
    const r = await box(rail.nth(i));
    near(r.left, c!.left);
    near(r.right, c!.right);
    expect(r.top).toBeGreaterThan(t.top);
  }
});

test('V-009 at 2xl: Folders under the first card, the table under the middle three, the rail under the last', async ({
  page,
}) => {
  const { cards, folders, table, rail } = await open(page, 1680);
  await expect(cards).toHaveCount(5);
  const first = await box(cards.nth(0));
  const second = await box(cards.nth(1));
  const fourth = await box(cards.nth(3));
  const last = await box(cards.nth(4));
  const f = await box(folders);
  const t = await box(table);
  const r = await box(rail.first());
  near(f.left, first.left);
  near(f.right, first.right);
  near(t.left, second.left);
  near(t.right, fourth.right);
  near(r.left, last.left);
  near(r.right, last.right);
  expect(t.right - t.left).toBeGreaterThan(f.right - f.left);
});
