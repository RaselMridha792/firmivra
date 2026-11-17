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

// Clients Review 2 (C2-019): the From and To dates and Done had no names a screen reader could
// read. Each is found here by its role and its exact name.
test('the Last Activity From, To, Clear and Done controls each have a name', async ({ page }) => {
  await openClients(page);
  await trigger(page).click();
  const from = panel(page).getByRole('textbox', {
    name: 'Last activity: From, start date',
    exact: true,
  });
  const to = panel(page).getByRole('textbox', { name: 'Last activity: To, end date', exact: true });
  const clear = panel(page).getByRole('button', { name: 'Clear last activity', exact: true });
  const done = panel(page).getByRole('button', { name: 'Done: close last activity', exact: true });
  await expect(from).toBeVisible();
  await expect(to).toBeVisible();
  await expect(clear).toBeDisabled();
  await expect(done).toBeVisible();

  // The button's name says the range in force once one is chosen.
  await from.fill('2026-11-01');
  await to.fill('2026-11-08');
  await expect(clear).toBeEnabled();
  await done.click();
  await expect(panel(page)).toBeHidden();
  await expect(
    page.getByRole('button', { name: 'Last activity: Nov 1, 2026 – Nov 8, 2026', exact: true }),
  ).toBeFocused();
});

// Clients Review 2 (N8-10): her retest of the same panel: Escape and a click on the Clients
// heading left it open, the accessibility tree showed two unnamed dates and an unnamed button,
// and Done closed it with no filter. Here the panel's accessibility tree names every control,
// Escape and the heading click close it, and Done closes it with no filter applied.
test('N8-10: the Last Activity panel names every control and closes on Escape, a heading click and Done', async ({
  page,
}) => {
  await openClients(page);
  const names = page.getByTestId('client-link').filter({ visible: true });
  await expect(names).toHaveCount(8);

  await trigger(page).click();
  await expect(panel(page)).toMatchAriaSnapshot(`
    - dialog "Last activity":
      - group "Last activity":
        - 'textbox "Last activity: From, start date"'
        - 'textbox "Last activity: To, end date"'
      - button "Clear last activity" [disabled]
      - 'button "Done: close last activity"'
  `);
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();

  await trigger(page).click();
  await page.getByTestId('page-title').click();
  await expect(panel(page)).toBeHidden();

  await trigger(page).click();
  await panel(page).getByRole('button', { name: 'Done: close last activity' }).click();
  await expect(panel(page)).toBeHidden();
  await expect(trigger(page)).toBeFocused();
  await expect(names).toHaveCount(8);
});
