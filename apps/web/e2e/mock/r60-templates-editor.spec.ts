import { expect, test, type Page } from '@playwright/test';

// R60, Octavia's Oct 28 Templates review, the editor (playwright.mock.config.ts, as an Owner; the
// mock answers as the API): TP-F04 Preview shows the unsaved words, TP-F05 Cancel and the
// breadcrumb ask Stay or Discard, TP-F06 files are named, refused in words, and downloadable,
// TP-F11 an active template with Include in Automations goes to Draft.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/templates`;

/** The seeded "Tax Season Reminder (2026)" email (mine, active, used by one automation). */
const openReminder = async (page: Page) => {
  await page.goto(`${base}/library/email`);
  await page.getByRole('link', { name: 'Tax Season Reminder (2026)' }).first().click();
  await page.waitForURL(/\/templates\/[^/]+\/edit$/);
  await expect(page.getByTestId('template-editor')).toBeVisible();
};

test('TP-F04: Preview shows the unsaved words and saves nothing', async ({ page }) => {
  await openReminder(page);
  const body = page.getByTestId('editor-main').locator('[contenteditable="true"]');
  await body.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' An unsaved closing line.');
  await page.getByRole('button', { name: 'Preview Template' }).click();
  const dialog = page.getByTestId('preview-dialog');
  await expect(dialog.getByTestId('preview-body')).toContainText('An unsaved closing line.');
  await expect(page.getByRole('dialog')).toContainText('your unsaved changes');
  await expect(dialog.getByTestId('test-saved-only')).toBeVisible();
});

test('TP-F05: Cancel and the breadcrumb ask; Stay keeps the words, Discard leaves', async ({
  page,
}) => {
  await openReminder(page);
  const name = page.getByLabel('Template Name *');
  await name.fill('Tax Season Reminder (edited)');
  await page.getByRole('link', { name: 'Cancel' }).click();
  const ask = page.getByRole('dialog', { name: 'Leave without saving?' });
  await ask.getByRole('button', { name: 'Stay' }).click();
  await expect(ask).toBeHidden();
  await expect(name).toHaveValue('Tax Season Reminder (edited)');

  await page
    .getByRole('navigation', { name: 'Breadcrumb' })
    .getByRole('link', { name: 'Templates', exact: true })
    .click();
  await ask.getByRole('button', { name: 'Discard' }).click();
  await expect(page).toHaveURL(base);
});

test('TP-F06: a file is attached and downloadable; a wrong type or size says why', async ({
  page,
}) => {
  await openReminder(page);
  const zone = page.getByTestId('attachments');
  const input = zone.locator('input[type="file"]');
  // A valid 1x1 PNG.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==',
    'base64',
  );
  await input.setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByText('Attachment added.')).toBeVisible();
  await expect(zone.getByText('tiny.png')).toBeVisible();
  await zone.getByRole('button', { name: 'Download tiny.png' }).click();
  await expect(page.getByText('tiny.png is ready to download.')).toBeVisible();

  await input.setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('x'),
  });
  await expect(
    page.getByText('notes.txt is not a PDF, DOCX, XLSX, JPG or PNG file.'),
  ).toBeVisible();
  await input.setInputFiles({
    name: 'big.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 0x25),
  });
  await expect(page.getByText('big.pdf is larger than 10 MB.')).toBeVisible();
});

test('TP-F11: an active template with Include in Automations saves as a Draft', async ({
  page,
}) => {
  await openReminder(page);
  const automations = page.getByLabel('Include in Automations');
  if (!(await automations.isChecked())) await automations.check();
  await page.getByTestId('editor-main').getByLabel('Status').selectOption('DRAFT');
  await expect(
    page.getByText('A draft is not offered to automations until it is active.'),
  ).toBeVisible();
  await page.getByTestId('save-template').click();
  // An automation uses it: the existing question first, then the draft keeps the choice.
  await page.getByRole('dialog').getByRole('button', { name: 'Save Anyway' }).click();
  await expect(page.getByText('Draft saved.')).toBeVisible();
  await expect(page.getByTestId('editor-main').getByLabel('Status')).toHaveValue('DRAFT');
  await expect(automations).toBeChecked();
});
