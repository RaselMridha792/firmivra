import { expect, type Page, test } from '@playwright/test';

// R55, Leads Review Two R2 5 (R61's live check, Nov 18): "Follow-up saved." shows on every save
// path of the Follow-Up card. On dev the lead's other queries refetch after the profile, so the
// card (keyed by the lead's version on Overview) was remounted before the save finished and the
// notice was lost. sessionStorage `fv-mock-fail` "<call>@slow" (lib/mock.ts) answers that call
// 1.5 s late, as on dev. Mock mode as the Owner; synthetic data.

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const lead = `http://app.localhost:${port}/leads/0199c0c0-0a00-7000-8000-000000000001`;

async function open(page: Page, path: string, slow: string) {
  await page.addInitScript((v) => window.sessionStorage.setItem('fv-mock-fail', v), slow);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${lead}${path}`);
  const card = page.getByTestId('card-follow-up');
  await expect(card.getByRole('button', { name: 'Save Follow-Up' })).toBeEnabled({
    timeout: 60_000,
  });
  return card;
}

test('Overview: Save Follow-Up, + Add Follow-Up and Save Step each confirm, with a slow refetch', async ({
  page,
}) => {
  const card = await open(page, '', 'leadPipeline.activity@slow');

  await card.getByRole('combobox', { name: /^Time/ }).selectOption('15:00');
  await card.getByRole('button', { name: 'Save Follow-Up' }).click();
  await expect(card.getByRole('status')).toHaveText('Follow-up saved.', { timeout: 10_000 });
  await expect(card).toContainText('3:00 PM');

  await card.getByLabel('Date', { exact: true }).fill('2026-12-01');
  await card.getByRole('button', { name: '+ Add Follow-Up' }).click();
  await expect(card.getByRole('status')).toHaveText('Follow-up added.', { timeout: 10_000 });
  // The notice comes as the API answers; the refetched lead (two steps) remounts the card.
  await expect(card.getByTestId('follow-up-steps').getByRole('listitem')).toHaveCount(2);

  await card.getByRole('button', { name: 'Edit follow-up' }).first().click();
  await card.getByRole('combobox', { name: /^Time/ }).selectOption('16:30');
  await card.getByRole('button', { name: 'Save Step' }).click();
  await expect(card.getByRole('status')).toHaveText('Follow-up saved.', { timeout: 10_000 });
  await expect(card).toContainText('4:30 PM');
});

test('Tasks tab: Save Follow-Up confirms, with a slow refetch', async ({ page }) => {
  const card = await open(page, '/tasks', 'leadPipeline.tasks@slow');
  await card.getByRole('combobox', { name: /^Time/ }).selectOption('15:00');
  await card.getByRole('button', { name: 'Save Follow-Up' }).click();
  await expect(card.getByRole('status')).toHaveText('Follow-up saved.', { timeout: 10_000 });
  await expect(card).toContainText('3:00 PM');
});
