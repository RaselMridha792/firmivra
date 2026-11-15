import { expect, type Page, test } from '@playwright/test';

// R55, Clients Review 2: the Clients list's Last Activity date filter (a small panel under its
// button). It closes on Escape and on a click outside it, gives focus back to its button, and
// every control in it has a name (C2-018, C2-019, N8-10).
// Mock mode as the Owner, at her 1165 x 747 window. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

async function openClients(page: Page) {
  await page.setViewportSize({ width: 1165, height: 747 });
  await page.goto(app('/clients'));
  await expect(page.getByTestId('page-title')).toHaveText('Clients', { timeout: 60_000 });
}
const trigger = (page: Page) =>
  page.getByRole('button', { name: 'Last activity: any time', exact: true });
const panel = (page: Page) => page.getByRole('dialog', { name: 'Last activity', exact: true });

// Clients Review 2 (C2-018): the panel stayed open after Escape and after a click outside it.
test('the Last Activity panel closes on Escape and on a click outside, and focus goes back to its button', async ({
  page,
}) => {
  await openClients(page);

  // Escape right after opening it.
  await trigger(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger(page)).toBeFocused();

  // Escape from inside a date field.
  await trigger(page).click();
  await panel(page).getByRole('textbox', { name: 'Last activity: To, end date' }).focus();
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await expect(trigger(page)).toBeFocused();

  // A click outside it: on the page heading, where she clicked.
  await trigger(page).click();
  await expect(panel(page)).toBeVisible();
  await page.getByTestId('page-title').click();
  await expect(panel(page)).toBeHidden();
  await expect(trigger(page)).toHaveAttribute('aria-expanded', 'false');
});
