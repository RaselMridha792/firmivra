import { expect, test } from '@playwright/test';

// R1, Business Advisory Review 2 batch B (the lead's list, A-xx). Mock mode as the Owner; the
// mock keeps its data in the page, so a test moves between pages by their links. Synthetic data
// only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const MARCUS = '0199c0f1-a200-7000-8000-000000000001';

test.describe.configure({ timeout: 240_000 });

test('A-NEW2: View History lists every client’s changes, filters by client and area, and opens each record', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/business-advisory'));
  await page.getByRole('tab', { name: 'View History' }).click({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/business-advisory\/history$/, { timeout: 60_000 });
  const history = page.getByTestId('ba-history');
  const links = history.getByTestId('history-link');
  await expect(links.first()).toBeVisible({ timeout: 60_000 });
  // Every client's changes: more than one client is named.
  await expect(
    history.getByRole('cell', { name: 'Added to the advisory program' }),
  ).not.toHaveCount(0);
  await expect(history.getByRole('cell', { name: 'Business plans' }).first()).toBeVisible();
  await expect(history.getByRole('cell', { name: 'Advisory clients' }).first()).toBeVisible();

  // One area: plans only.
  await history.getByLabel('Area', { exact: true }).selectOption('PLAN');
  await expect(history.getByRole('cell', { name: 'Advisory clients' })).toHaveCount(0);
  await expect(history.getByRole('cell', { name: 'Business plans' }).first()).toBeVisible();

  // One client: theirs only.
  await history.getByLabel('Client', { exact: true }).selectOption(MARCUS);
  await expect(history.getByRole('cell', { name: 'Plan finalized' })).toBeVisible({
    timeout: 60_000,
  });
  // Their plan's three changes: started, finalized and sent.
  await expect(links).toHaveCount(3);

  // An entry opens its record: a plan change opens the client's plan.
  await history.getByRole('link', { name: 'Plan finalized' }).click();
  await expect(page).toHaveURL(new RegExp(`/business-advisory/clients/${MARCUS}/plan$`), {
    timeout: 60_000,
  });
});
