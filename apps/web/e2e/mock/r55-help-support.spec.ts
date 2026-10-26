import { expect, test } from '@playwright/test';

// R55, Octavia's dashboard review of Oct 25, D2: Help & Support offers an in-app message, a call,
// the support email, Report a Problem and common questions; only channels that exist (no live
// chat), and opening it sends nothing. In mock mode (playwright.mock.config.ts) as the Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('Help offers the configured channels, sends nothing on open, and sends a message on Send', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/`);
  await page.getByRole('button', { name: 'Help & Support' }).click();
  const help = page.getByRole('dialog', { name: 'Help & Support' });
  await expect(help.getByRole('link', { name: /Call Firmivra/ })).toHaveAttribute(
    'href',
    'tel:7702389815',
  );
  await expect(help.getByRole('link', { name: /Contact Support/ })).toHaveAttribute(
    'href',
    /^mailto:/,
  );
  await expect(help.getByText(/live chat/i)).toHaveCount(0);
  await expect(help.getByRole('status')).toHaveCount(0);

  // Send needs both fields; then the ticket number.
  await help.getByRole('button', { name: 'Send Message' }).click();
  await expect(help.getByRole('alert')).toHaveText('Enter a subject and your message.');
  await help.getByLabel('Subject').fill('Fake question');
  await help.getByLabel('Message', { exact: true }).fill('How do I resend an invoice? (fake)');
  await help.getByRole('button', { name: 'Send Message' }).click();
  await expect(help.getByRole('status')).toContainText('ticket #1041');

  await help.getByText('Who can see a client’s records?').click();
  await expect(help).toContainText('Staff see the clients assigned to them');
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/dashboard/help-support.png' });
});
