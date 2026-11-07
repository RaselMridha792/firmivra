import { expect, test, type Page } from '@playwright/test';

// R60, Octavia's Oct 28 Communications review, the change list's Help icons (as TP-F02 and RP-F22;
// playwright.mock.config.ts, as an Owner; the mock answers as the API and sends nothing): a Help
// icon on every functional area, from the shared `HelpTip`, with its text in
// `communications-help.tsx`. Each is named "About ..." and described by its text; it opens on a
// press, a hover or keyboard focus, and Escape closes it.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/communications`;
test.use({ viewport: { width: 1440, height: 1000 } });

const about = (scope: Page | ReturnType<Page['getByRole']>, topic: string) =>
  scope.getByRole('button', { name: `About ${topic}`, exact: true });
const tip = (page: Page) => page.getByTestId('help-tip');

test('the overview, its lists and Segments & Lists explain each area', async ({ page }) => {
  await page.goto(base);
  for (const topic of [
    'Communications',
    'Starting a communication',
    'Recent communications',
    'Upcoming communications',
    'Saved templates',
    'Segments and lists',
  ])
    await expect(about(page, topic)).toBeVisible();
  await about(page, 'Communications').click();
  await expect(tip(page)).toContainText('one-to-one conversations are in Messages');
  await page.keyboard.press('Escape');
  await expect(tip(page)).toBeHidden();

  await page.getByRole('tab', { name: 'Sent History' }).click();
  await about(page, 'Lists and search').hover();
  await expect(tip(page)).toContainText('as its status allows');
  await page.mouse.move(0, 0);
  await expect(tip(page)).toBeHidden();

  await page.getByRole('tab', { name: 'Segments & Lists' }).click();
  // Keyboard focus: Tab from Show archived to the icon.
  await page.getByLabel('Show archived').focus();
  await page.keyboard.press('Tab');
  await expect(about(page, 'Managing segments and lists')).toBeFocused();
  await expect(tip(page)).toContainText('matches all or any of its rules');
});

test('the composer, Choose Recipients, Review & Send and the results explain each area', async ({
  page,
}) => {
  await page.goto(`${base}/new?channel=EMAIL`);
  await page.getByRole('button', { name: 'Start Bulk Email' }).click();
  await page.waitForURL(/\/edit$/);
  for (const topic of [
    'Writing a communication',
    'Communication type',
    'Recipients',
    'Message and personalization',
    'Attachments',
    'Delivery',
    'Template',
    'Message preview',
    'Pre-send checklist',
  ])
    await expect(about(page, topic)).toBeVisible();
  await expect(about(page, 'Recipients')).toHaveAccessibleDescription(
    /a mobile number with consent for texts/,
  );
  await about(page, 'Message and personalization').click();
  await expect(tip(page)).toContainText('an unknown field is flagged and blocks sending');
  await page.keyboard.press('Escape');

  await page.getByLabel('Campaign Name').fill('Help check');
  await page.getByLabel('Subject Line').fill('A quick hello');
  await page
    .getByTestId('composer-form')
    .getByRole('textbox', { name: /Message/ })
    .fill('Hello [Client First Name].');
  await page.getByRole('button', { name: 'Choose Recipients' }).click();
  const modal = page.getByRole('dialog', { name: 'Choose Recipients' });
  await expect(about(modal, 'Choosing the audience')).toBeVisible();
  await about(modal, 'Recipient total').click();
  await expect(tip(page)).toContainText('no consent for texts');
  await page.keyboard.press('Escape');
  await expect(modal).toBeVisible();
  await modal.getByLabel(/Small Business Clients/).check();
  await modal.getByRole('button', { name: /^Apply/ }).click();
  await page
    .getByRole('button', { name: /^Review/ })
    .first()
    .click();
  const review = page.getByRole('dialog', { name: 'Review & Send' });
  await expect(about(review, 'Review & Send')).toHaveAccessibleDescription(
    /if that number changes before you confirm, nothing is sent/,
  );
  await review.getByRole('button', { name: 'Back to editing' }).click();

  await page.getByRole('tab', { name: 'Announcement' }).click();
  await expect(about(page, 'Announcement window')).toBeVisible();

  await page.goto(base);
  await page.getByRole('tab', { name: 'Sent History' }).click();
  await page.getByRole('link', { name: '2026 Tax Season Reminder' }).click();
  for (const topic of ['Results', 'Performance and delivery', 'Actions'])
    await expect(about(page, topic)).toBeVisible();
  await about(page, 'Actions').click();
  await expect(tip(page)).toContainText('the original stays as it was');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Recipients' }).click();
  await expect(about(page, 'Recipient activity')).toBeVisible();
});
