import { expect, test } from '@playwright/test';

// R60, PRT-1 part 2 (Client Portal guide 2, 7.4 and 9.1): the client's profile shows their local
// office and the one they chose at sign-up; an Owner or Admin changes it to one of the firm's
// active locations. Mock mode as the Owner (client 1 chose Lawrenceville). Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const shots = 'e2e/screenshots/r60-clients-office';
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

test('the Overview shows the local office, and an Owner changes it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(app(`/clients/${JAMIE}`));
  const card = page.getByTestId('client-office');
  await expect(card).toContainText('Lawrenceville Office', { timeout: 60_000 });
  await expect(card).toContainText('456 Pine Rd, Suite 200');
  await expect(card).toContainText('Chosen at sign-up');

  await card.getByRole('button', { name: 'Change Office' }).click();
  const select = card.getByLabel('Local office');
  await expect(select).toHaveValue('0199d000-0000-7000-8000-000000000002');
  await select.selectOption({ label: 'Auburn Office (123 Main St, Auburn, GA 30011)' });
  await card.scrollIntoViewIfNeeded();
  await page.mouse.move(5, 5);
  await card.screenshot({ path: `${shots}/change.png` });
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card.getByRole('status')).toHaveText('Local office changed.');
  await expect(card).toContainText('Auburn Office');
  await expect(card).toContainText('123 Main St');
  await card.screenshot({ path: `${shots}/changed.png` });

  // None is a choice too.
  await card.getByRole('button', { name: 'Change Office' }).click();
  await card.getByLabel('Local office').selectOption({ label: 'No office' });
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card).toContainText('None assigned');
});
