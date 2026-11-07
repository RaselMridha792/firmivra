import { expect, test, type Page } from '@playwright/test';

// R60, Octavia's Oct 28 Templates review, TP-F02 (playwright.mock.config.ts, as an Owner; the mock
// answers as the API): a Help icon on every functional area, from the shared `HelpTip`, with its
// text in `template-help.tsx`. Each is named "About ..." and described by its text; it opens on a
// press, a hover or keyboard focus, and Escape closes it.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/templates`;
test.use({ viewport: { width: 1440, height: 1000 } });

const about = (page: Page, topic: string) =>
  page.getByRole('button', { name: `About ${topic}`, exact: true });
const tip = (page: Page) => page.getByTestId('help-tip');

test('the overview and a library explain each area; press, hover, focus and Escape (TP-F02)', async ({
  page,
}) => {
  await page.goto(base);
  for (const topic of [
    'Templates',
    'Views and template kinds',
    'Recent templates',
    'Template tools',
  ])
    await expect(about(page, topic)).toBeVisible();
  await expect(about(page, 'Templates')).toHaveAccessibleDescription(/^Reusable emails, texts/);
  await about(page, 'Templates').click();
  await expect(tip(page)).toContainText('a draft or an archived one cannot be used');
  await page.keyboard.press('Escape');
  await expect(tip(page)).toBeHidden();

  // Tools: each dialog says what it does beside its Help icon.
  await page
    .getByTestId('tools')
    .getByRole('button', { name: /^Template Categories/ })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Template Categories' });
  await dialog.getByRole('button', { name: 'About Managing categories' }).click();
  await expect(tip(page)).toContainText('Merge moves every template of one category');
  await page.keyboard.press('Escape');
  await expect(tip(page)).toBeHidden();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  for (const [tool, topic] of [
    ['Merge Fields', 'Merge fields'],
    ['Branding & Letterhead', 'Branding & Letterhead'],
  ] as const) {
    await page
      .getByTestId('tools')
      .getByRole('button', { name: new RegExp(`^${tool}`) })
      .click();
    const open = page.getByRole('dialog', { name: tool });
    await expect(open.getByRole('button', { name: `About ${topic}` })).toBeVisible();
    await open.getByRole('button', { name: 'Close dialog' }).click();
  }

  await page.goto(`${base}/library/email`);
  for (const topic of ['Template library', 'Search and filters', 'Categories'])
    await expect(about(page, topic)).toBeVisible();
  await about(page, 'Search and filters').hover();
  await expect(tip(page)).toContainText('Non-archived shows active templates and drafts');
  await page.mouse.move(0, 0);
  await expect(tip(page)).toBeHidden();
  await about(page, 'Categories').focus();
  await expect(tip(page)).toContainText('Uncategorized lists those in none');
  await page.getByRole('button', { name: 'Import Template' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Import Template' }).getByRole('button', {
      name: 'About Importing a template',
    }),
  ).toHaveAccessibleDescription(/private draft \(Only me, automations off\)/);
});

test('the editor explains its content, preview, merge fields, files, access, automations and versions (TP-F02)', async ({
  page,
}) => {
  await page.goto(`${base}/library/email`);
  await page.getByRole('link', { name: 'Tax Season Reminder (2026)', exact: true }).click();
  await expect(page.getByTestId('editor-title')).toHaveText('Edit Email Template');
  for (const topic of [
    'Writing a template',
    'Preview and Test Send',
    'Merge fields',
    'Attachments',
    'Who can use it',
    'Automations',
    'Version history',
  ])
    await expect(about(page, topic)).toBeVisible();
  await about(page, 'Automations').click();
  await expect(tip(page)).toContainText('only an active one is offered to them');
  await page.screenshot({ path: test.info().outputPath('help-tip.png') });

  await page.goto(`${base}/new?kind=task`);
  await about(page, 'Structure').click();
  await expect(tip(page)).toContainText('stands for that module’s own template');
});
