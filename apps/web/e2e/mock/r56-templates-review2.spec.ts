import { expect, test } from '@playwright/test';

// R56, Templates Review Two (the rows still open after the check; F: checks, not in the repo):
// Y06 a template's description, Y07 and Y08 Help in every area with the import limits, P03 the
// composer's Campaign templates for an email, P04 why an announcement is not for automations.
// Mock mode (playwright.mock.config.ts) as the Owner; a reload resets the mock. Synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;
const base = `${app}/templates`;
test.use({ viewport: { width: 1440, height: 1000 } });

test('Y06: a template’s description is saved, kept and shown under its name in Recent', async ({
  page,
}) => {
  await page.goto(`${base}/new?kind=EMAIL`);
  await page.getByLabel('Template Name *').fill('Welcome note (fake)');
  await page.getByLabel('Description').fill('For a new client’s first week (fake).');
  await page.getByLabel('Subject Line').fill('Welcome');
  await page.getByRole('textbox', { name: 'Email Content' }).click();
  await page.keyboard.type('Welcome to the firm (fake).');
  await page.getByRole('button', { name: 'Save as Draft' }).click();
  // Saved: the address becomes the template's own, and the description is still there.
  await expect(page).toHaveURL(/\/templates\/[0-9a-f-]{36}\/edit/, { timeout: 60_000 });
  await expect(page.getByLabel('Description')).toHaveValue('For a new client’s first week (fake).');
  // In the same page (a reload starts the mock over): the breadcrumb back to the overview.
  await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Templates', exact: true })
    .first()
    .click();
  const recent = page.getByTestId('recent-description').filter({ hasText: 'first week' });
  await expect(recent).toHaveText('For a new client’s first week (fake).', { timeout: 60_000 });
});

test('Y07, Y08: Preview, Share, Archive, bulk actions, Tags and Lead sequences each explain themselves', async ({
  page,
}) => {
  await page.goto(`${base}/library/email`);
  const row = page.getByTestId('library-table').getByRole('row').nth(1);
  await expect(row).toBeVisible({ timeout: 60_000 });
  const about = (topic: string) =>
    page.getByRole('button', { name: `About ${topic}`, exact: true });

  await row.getByRole('button', { name: /actions/i }).click();
  await page.getByRole('menuitem', { name: 'Share' }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'About Sharing a template' }),
  ).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  await row.getByRole('button', { name: /actions/i }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(about('Archiving a template')).toHaveAccessibleDescription(
    /Restore brings it back as a draft/,
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Keep' }).click();

  await row.getByRole('checkbox').check();
  await expect(about('Bulk actions')).toBeVisible();

  await row
    .getByRole('button', { name: /^Preview/ })
    .first()
    .click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'About Preview and Test Send' }),
  ).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();

  await page.goto(`${base}/new?kind=EMAIL`);
  await expect(about('Tags')).toHaveAccessibleDescription(/press Enter/, { timeout: 60_000 });

  await page.goto(`${base}/lead-sequences`);
  await expect(about('Lead follow-up sequences')).toHaveAccessibleDescription(
    /never sends anything by itself/,
    { timeout: 60_000 },
  );
});

test('Y08: the import help names its limits', async ({ page }) => {
  await page.goto(base);
  const help = page.getByRole('button', { name: 'About Importing a template', exact: true });
  await page
    .getByRole('button', { name: /Import Template/ })
    .first()
    .click();
  await expect(help.first()).toHaveAccessibleDescription(/50,000 characters/, { timeout: 60_000 });
  await expect(help.first()).toHaveAccessibleDescription(/10 MB/);
});

test('P04: an announcement says why automations cannot send it', async ({ page }) => {
  await page.goto(`${base}/new?kind=ANNOUNCEMENT`);
  await expect(page.getByLabel('Include in Automations')).toBeDisabled({ timeout: 60_000 });
  await expect(page.getByTestId('automation-ineligible')).toContainText(
    'an announcement or a campaign goes to many clients at once',
  );
});

test('P03: an email draft offers the Campaign templates too, asked of the server by kind', async ({
  page,
}) => {
  await page.goto(`${app}/communications`);
  await page.getByRole('tab', { name: 'Bulk Campaigns' }).click();
  await page.getByRole('link', { name: 'Referral Request' }).click();
  await expect(page.getByTestId('composer')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('template-card').getByRole('button', { name: 'Use a Template' }).click();
  await expect(page.getByTestId('template-list')).toContainText(
    'Monthly Tax & Business Newsletter',
  );
});
