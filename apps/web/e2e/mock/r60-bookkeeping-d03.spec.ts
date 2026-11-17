// Octavia's Bookkeeping Review 2, D03 (G5): a custom Report Due period changes the list at
// once, with no reload. Mock mode, as an Owner.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
/** "Nov 21, 2026" as 2026-11-21. */
const isoOf = (shown: string) => {
  const d = new Date(shown);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('D03 (G5): a custom Report Due period changes the rows at once, with no reload', async ({
  page,
}) => {
  await page.goto(`${app}/bookkeeping`);
  const links = page.getByTestId('bk-link');
  await expect(links.first()).toBeVisible();
  const table = page.getByRole('table', { name: 'Bookkeeping clients' });
  const column = (await table.getByRole('columnheader').allInnerTexts()).findIndex((h) =>
    h.includes('Next Report Due'),
  );
  expect(column).toBeGreaterThan(-1);
  const rows = page.getByRole('row').filter({ has: links });
  const dues = async () =>
    Promise.all((await rows.all()).map((r) => r.getByRole('cell').nth(column).innerText()));
  const days = [...new Set((await dues()).filter((d) => d !== '—'))].sort(
    (a, b) => Date.parse(a) - Date.parse(b),
  );
  expect(days.length).toBeGreaterThan(1);
  const [first, last] = [days[0]!, days[days.length - 1]!];
  const all = await links.count();
  // A mark on the page: a reload would clear it.
  await page.evaluate(() => {
    (window as unknown as { stayed?: boolean }).stayed = true;
  });

  await page.getByLabel('Report Due').selectOption('CUSTOM');
  const custom = page.getByTestId('due-custom');
  await custom.getByLabel('Due from').fill(isoOf(first));
  await custom.getByLabel('Due to').fill(isoOf(first));
  await expect(page).toHaveURL(new RegExp(`dueFrom=${isoOf(first)}&dueTo=${isoOf(first)}`));
  // Only the clients due that day, at once (once the list has loaded them).
  await expect
    .poll(async () => {
      const shown = await dues();
      return shown.length > 0 && shown.every((d) => d === first);
    })
    .toBe(true);
  const one = await links.count();
  expect(one).toBeLessThan(all);

  // To the last due day: more rows, still without a reload.
  await custom.getByLabel('Due to').fill(isoOf(last));
  await expect
    .poll(async () => (await dues()).filter((d) => d !== first).length)
    .toBeGreaterThan(0);
  expect(await links.count()).toBeGreaterThan(one);
  expect(await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed)).toBe(true);
});
