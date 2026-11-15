import { expect, test } from '@playwright/test';

// R55, Leads Review Two R2 6b: a long lead name stays readable in the Leads list at her window
// (1165 x 747). The whole name shows, wrapping onto as many lines as it needs (never cut after two
// lines), and the row's actions stay in view without the page scrolling sideways. Mock mode as the
// Owner; the lead is made here with a synthetic name.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const FIRST = 'Alexandrina Maximiliana';
const LAST = 'Montgomery-Fitzwilliam Vanderbilt';
const FULL = `${FIRST} ${LAST}`;

test('R2 6b: a long name shows in full at 1165 px, with the row actions in view', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1165, height: 747 });
  await page.goto(`http://app.localhost:${port}/leads`);
  await page.getByRole('button', { name: 'Add New Lead' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('First name').fill(FIRST);
  await dialog.getByLabel('Last name').fill(LAST);
  await dialog.getByRole('textbox', { name: 'Email' }).fill('alexandrina.vanderbilt@example.test');
  await dialog.getByRole('button', { name: 'Save Lead' }).click();
  await expect(dialog).toHaveCount(0);

  const row = page
    .getByRole('table', { name: 'Leads' })
    .getByRole('row', { name: new RegExp(LAST) });
  await expect(row).toHaveCount(1);
  const name = row.getByText(FULL, { exact: true });
  await expect(name).toBeVisible();
  // Not clipped: the text is the whole name and none of it is hidden below the element's box.
  const fit = await name.evaluate((el) => ({
    text: el.textContent,
    scroll: el.scrollHeight,
    client: el.clientHeight,
  }));
  expect(fit.text).toBe(FULL);
  expect(fit.scroll).toBeLessThanOrEqual(fit.client + 1);

  const more = row.getByRole('button', { name: `More actions for ${FULL}` });
  await more.scrollIntoViewIfNeeded();
  await expect(more).toBeInViewport({ ratio: 1 });
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(sideways).toBeLessThanOrEqual(0);
});
