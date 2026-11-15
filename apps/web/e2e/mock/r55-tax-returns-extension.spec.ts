import { expect, type Page, test } from '@playwright/test';

// Tax Returns Review 2, the Record Extension panel opened from a return's row. Mock mode
// (playwright.mock.config.ts) as the Owner, the mock answering as the API does. Synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const season = String(new Date().getFullYear() - 1);

test.describe.configure({ timeout: 180_000 });

/** Opens Record Extension from the row of the client's return for last season. */
async function openExtension(page: Page, client: string) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/tax-returns?year=${season}&q=${encodeURIComponent(client)}`));
  const row = page.getByRole('row').filter({ hasText: client });
  await row.getByRole('button', { name: /^Actions for/ }).click({ timeout: 60_000 });
  await page.getByRole('menuitem', { name: 'Record Extension', exact: true }).click();
  const panel = page.getByRole('dialog').filter({ has: page.getByTestId('extension-dialog') });
  await expect(panel).toBeVisible();
  return panel;
}

/** The return's Filing Deadline and Extension cards, as its workspace shows them. */
async function returnCards(page: Page, client: string) {
  await page.getByRole('row').filter({ hasText: client }).getByTestId('return-link').click();
  const cards = page.getByTestId('info-cards');
  await expect(cards).toBeVisible({ timeout: 60_000 });
  const deadline = cards.getByRole('listitem').filter({ hasText: 'Filing Deadline' });
  return { deadline, extension: page.getByTestId('extension-state') };
}

// Tax Returns Review 2 (EXT-1): staff confirm the exact return before recording anything.
test('the extension panel names the client, the tax year and the current filing deadline', async ({
  page,
}) => {
  const panel = await openExtension(page, 'Jamie Sample');
  const subtitle = panel.getByText(/^Jamie Sample, \d{4} 1040: due /);
  await expect(subtitle).toHaveText(
    new RegExp(`^Jamie Sample, ${season} 1040: due [A-Z][a-z]{2} \\d{1,2}, \\d{4}$`),
  );
  const due = ((await subtitle.textContent()) ?? '').split(': due ')[1]!;
  await panel.getByRole('button', { name: 'Cancel' }).click();
  // The deadline it names is the one the return itself shows.
  const { deadline } = await returnCards(page, 'Jamie Sample');
  await expect(deadline).toContainText(due);
});
