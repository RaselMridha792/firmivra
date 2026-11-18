import { expect, test, type Page } from '@playwright/test';

// Intake Forms Review 2, R61's live-check rows (R1). Mock mode, as an Owner.
// - USABILITY-03: Assign Staff offers only those who can take the form: the Owner and Admins and
//   the client's own staff member (the first form's client works with the team mock's Sam Staff).
// - ACCESS-02d: after Make a New Link, a switch turned in the same window shows its new state.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const form = (n: number) =>
  `${app}/intake-forms/0199c0d0-0a00-7000-8000-${String(n).padStart(12, '0')}`;

const assignOptions = async (page: Page, n: number) => {
  await page.goto(form(n));
  await page.getByRole('button', { name: 'More actions' }).click();
  await page.getByRole('menuitem', { name: 'Assign Staff' }).click();
  const dialog = page.getByTestId('assign-dialog');
  await expect(dialog.getByTestId('assign-hint')).toHaveText(
    'Only staff who work with this client can be assigned.',
  );
  return dialog.getByLabel('Assigned to').locator('option');
};

test('USABILITY-03: Assign Staff lists the Owner, Admins and the client’s own staff only', async ({
  page,
}) => {
  await expect(await assignOptions(page, 1)).toHaveText([
    'Not assigned',
    'Olivia Owner',
    'Adam Admin',
    'Sam Staff',
  ]);
  // Another client: no Staff member works with them, and invited or former members never show.
  await expect(await assignOptions(page, 4)).toHaveText([
    'Not assigned',
    'Olivia Owner',
    'Adam Admin',
  ]);
});

test('ACCESS-02d: after Make a New Link, turning sharing off shows off and hides the link', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${app}/intake-forms/templates`);
  const name = 'Audit Support Intake Form';
  const card = page.getByTestId('template-card').filter({ hasText: name });
  await card.getByRole('button', { name: `Actions for ${name}` }).click({ timeout: 60_000 });
  await page.getByRole('menuitem', { name: 'Share & Publish' }).click();
  const dialog = page.getByTestId('form-share');
  const link = dialog.getByLabel('Link', { exact: true });
  await expect(link).toBeVisible({ timeout: 60_000 });
  const rotate = dialog.getByTestId('rotate-link');
  await rotate.getByRole('button', { name: 'Make a New Link' }).click();
  await rotate.getByRole('button', { name: 'Make New Link' }).click();
  await expect(rotate).toContainText('A new link is ready.');

  const sharing = dialog.getByRole('switch', { name: 'Share by link' });
  await sharing.click();
  await expect(sharing).not.toBeChecked();
  await expect(link).toHaveCount(0);
  await expect(dialog.getByTestId('public-link-empty')).toContainText('Sharing by link is off');

  const portal = dialog.getByRole('switch', { name: 'Publish in client portal' });
  const was = await portal.isChecked();
  await portal.click();
  await expect(portal).toBeChecked({ checked: !was });
});
