import { expect, test } from '@playwright/test';

// R55, Leads Review Two R2 6a: at her window (1165 x 747) the Leads table scrolls sideways inside
// its frame while the select box and the name stay at its left edge and the actions at its right,
// whichever way it is scrolled. Mock mode as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('R2 6a: the select box, the name and the actions stay in view while the table scrolls', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1165, height: 747 });
  await page.goto(`http://app.localhost:${port}/leads`);
  const table = page.getByRole('table', { name: 'Leads' });
  const frame = table.locator('xpath=..');
  const row = table.getByRole('row', { name: /Avery Lawson/ });
  const pinned = [
    row.getByRole('checkbox'),
    row.getByRole('link', { name: /Avery Lawson/ }),
    row.getByRole('button', { name: 'More actions for Avery Lawson' }),
  ];
  // A column between them: the lead's source.
  const middle = row.getByText('Back Taxes Campaign');
  await expect(middle).toBeVisible();
  await row.scrollIntoViewIfNeeded();
  // The table is wider than its frame here, and only the frame scrolls sideways, not the page.
  const overflow = await frame.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow).toBeGreaterThan(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);

  const xs = () => Promise.all([...pinned, middle].map(async (l) => (await l.boundingBox())!.x));
  const scrollTo = async (left: number) => {
    await frame.evaluate((el, x) => (el.scrollLeft = x), left);
    await expect.poll(() => frame.evaluate((el) => el.scrollLeft)).toBe(left);
  };
  await scrollTo(0);
  const start = await xs();
  for (const cell of pinned) await expect(cell).toBeInViewport({ ratio: 1 });
  await scrollTo(overflow);
  const end = await xs();
  for (const cell of pinned) await expect(cell).toBeInViewport({ ratio: 1 });
  // The pinned cells stayed where they were; the column between them moved with the scroll.
  for (const i of [0, 1, 2]) expect(Math.abs(end[i]! - start[i]!)).toBeLessThan(1);
  expect(Math.abs(start[3]! - end[3]! - overflow)).toBeLessThan(1);
});
