import { expect, type Page, test } from '@playwright/test';

// R60, MSG-F12 for New Message (Octavia's Messages review of Oct 27): files go with the message to
// clients through their portal. Mock mode as the Owner: Jamie Sample has the portal; the mock scans
// a file at once (as SCAN_MODE=local) and sends nothing anywhere.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const PDF = { name: 'Engagement_Letter.pdf', mimeType: 'application/pdf' };

/** New Message to Jamie with a message written, on the Portal channel. */
async function start(page: Page) {
  await page.goto(app('/messages/new'));
  const recipients = page.getByRole('region', { name: 'Select Recipients' });
  await recipients.getByRole('checkbox', { name: 'Jamie Sample', exact: true }).check();
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Your engagement letter is attached. (synthetic)');
}
const attach = (page: Page, name = PDF.name) =>
  page.getByLabel('Attach files').setInputFiles({
    name,
    mimeType: PDF.mimeType,
    buffer: Buffer.from('%PDF-1.4 synthetic'),
  });

test('MSG-F12: a file goes with New Message to the client’s portal conversation', async ({
  page,
}) => {
  await start(page);
  const files = page.getByTestId('compose-files');
  await attach(page);
  const list = files.getByRole('list', { name: 'Attached files' });
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await expect(list).toContainText(PDF.name);
  // Remove, then attach again.
  await files.getByRole('button', { name: `Remove ${PDF.name}` }).click();
  await expect(list).toHaveCount(0);
  await attach(page);
  await expect(files.getByRole('list', { name: 'Attached files' })).toContainText(PDF.name);
  await page.getByRole('button', { name: 'Review and Send' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send Message' }).click();
  const outcome = page.getByTestId('compose-outcome');
  await expect(outcome).toContainText('Message sent');
  await outcome.getByRole('link', { name: 'Open conversation' }).click();
  const conversation = page.getByTestId('conversation');
  await expect(conversation).toContainText('Your engagement letter is attached.');
  await expect(conversation.getByTestId('message-files')).toContainText(PDF.name);
});

test('MSG-F12: files go only through the portal; Email with a file says why and sends nothing', async ({
  page,
}) => {
  await start(page);
  await attach(page);
  await expect(page.getByTestId('compose-files')).toContainText(PDF.name);
  await page
    .getByRole('radiogroup', { name: 'Channel' })
    .getByRole('radio', { name: /Email/ })
    .click();
  await page.getByLabel('Subject (required for email)').fill('Your letter');
  await expect(page.getByTestId('compose-files').getByRole('alert')).toContainText(
    'Files go to clients through their portal',
  );
  await page.getByRole('button', { name: 'Review and Send' }).click();
  await expect(page.getByTestId('compose-review')).toContainText(
    'Files go to clients through their portal',
  );
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Send Message' }),
  ).toBeDisabled();
});

test('MSG-F12: a type Messages Settings do not allow is refused before it goes up', async ({
  page,
}) => {
  await start(page);
  await page.getByLabel('Attach files').setInputFiles({
    name: 'Budget.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: Buffer.from('PK synthetic'),
  });
  await expect(page.getByTestId('compose-files').getByRole('listitem')).toHaveCount(0);
});

test('No sideways scroll at 375 px with a file attached', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await start(page);
  await attach(page);
  await expect(page.getByTestId('compose-files')).toContainText(PDF.name);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
