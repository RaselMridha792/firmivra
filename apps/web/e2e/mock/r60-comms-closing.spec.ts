import { expect, test, type Page } from '@playwright/test';

// R60, Octavia's Oct 28 Communications review, CM-F11 (an approved addition;
// playwright.mock.config.ts, as an Owner; the mock answers as the API): a reusable closing, the
// firm's signature (set in Messages Settings by an Owner or Admin) or the member's own, added at
// the end of the message; text for an SMS. It sends nothing on its own.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/communications`;

const start = async (page: Page, channel: 'EMAIL' | 'SMS') => {
  await page.goto(`${base}/new?channel=${channel}`);
  await page.getByRole('button', { name: /^Start / }).click();
  await page.waitForURL(/\/edit$/);
  await expect(page.getByTestId('composer')).toBeVisible();
};
const closing = async (page: Page, item: string) => {
  await page.getByTestId('closing-menu').getByRole('button', { name: 'Insert Closing' }).click();
  const entry = page.getByRole('menuitem', { name: new RegExp(`^${item}`) });
  // The signatures load with the page; the menu says Loading until they have.
  await expect(entry).not.toContainText('Loading');
  await entry.click();
};

test("an email takes the firm's signature, and the member's own once saved (CM-F11)", async ({
  page,
}) => {
  await start(page, 'EMAIL');
  const content = page.getByRole('textbox', { name: 'Message' });
  await content.click();
  await page.keyboard.type('Thanks for your time.');
  await closing(page, 'Firm signature');
  await expect(content).toContainText('LVP Accounting & Taxes');
  await expect(content).toContainText('Phone: (555) 010-0100');

  // No signature of their own yet: the menu says how to make one.
  await closing(page, 'My signature');
  await expect(
    page.getByText('Save your own signature first: Edit My Signature.').filter({ visible: true }),
  ).toBeVisible();
  await closing(page, 'Edit My Signature');
  const dialog = page.getByTestId('my-signature');
  await dialog.getByRole('textbox', { name: 'Signature' }).click();
  await page.keyboard.type('Kind regards, Mock User');
  await page.getByRole('dialog').getByRole('button', { name: 'Save Signature' }).click();
  await expect(
    page.getByText('Your signature is saved. Insert it from Insert Closing.').filter({
      visible: true,
    }),
  ).toBeVisible();
  await closing(page, 'My signature');
  await expect(content).toContainText('Kind regards, Mock User');
});

test("an SMS takes the firm's signature as text (CM-F11)", async ({ page }) => {
  await start(page, 'SMS');
  const message = page
    .getByTestId('composer')
    .getByRole('textbox', { name: 'Message', exact: true });
  await message.fill('Your documents are ready.');
  await closing(page, 'Firm signature');
  await expect(message).toHaveValue(
    'Your documents are ready.\n\nLVP Accounting & Taxes\nPhone: (555) 010-0100',
  );
});
