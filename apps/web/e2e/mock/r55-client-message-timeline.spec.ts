import { expect, test } from '@playwright/test';

// R55, Clients Review 2 (N8-05): the client profile's New Message has Add to Client Timeline, on
// by default; once sent, the client's Activity shows the subject and who sent it, never the
// message. Mock mode as the Owner; the mock keeps its timeline in the browser, so the test moves
// through the app's own links.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

test.describe.configure({ timeout: 180_000 });

test('a message from the client’s Messages tab lands on their Activity, without its text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/clients/${JAMIE}/messages`));
  await page.getByRole('button', { name: 'New Message' }).click({ timeout: 60_000 });
  const dialog = page.getByRole('dialog', { name: 'New Message' });
  const box = dialog.getByRole('checkbox', { name: 'Add to Client Timeline' });
  await expect(box).toBeChecked();
  await dialog.getByLabel('Subject').fill('Profile timeline check (sample)');
  await dialog
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Synthetic private text that must not reach the timeline.');
  await dialog.getByRole('button', { name: 'Send Message' }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole('link', { name: 'Activity', exact: true }).click();
  const activity = page.getByTestId('client-activity');
  const entry = activity.getByTestId('activity-entry').first();
  await expect(entry).toContainText('Profile timeline check (sample)', { timeout: 60_000 });
  await expect(entry).toContainText('Sent through the client portal');
  await expect(activity).not.toContainText('Synthetic private text');
  await expect(entry.getByRole('link', { name: 'Open' })).toHaveAttribute(
    'href',
    /^\/messages\?thread=.+/,
  );
});

test('unticked, the message stays off the client’s Activity', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/clients/${JAMIE}/messages`));
  await page.getByRole('button', { name: 'New Message' }).click({ timeout: 60_000 });
  const dialog = page.getByRole('dialog', { name: 'New Message' });
  await dialog.getByRole('checkbox', { name: 'Add to Client Timeline' }).uncheck();
  await dialog.getByLabel('Subject').fill('Off the timeline (sample)');
  await dialog.getByRole('textbox', { name: 'Message', exact: true }).fill('Synthetic text.');
  await dialog.getByRole('button', { name: 'Send Message' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('link', { name: 'Activity', exact: true }).click();
  // N8-05: the client's recorded events are listed; the unticked message is not one of them.
  const activity = page.getByTestId('client-activity');
  await expect(activity).toContainText('Client added', { timeout: 60_000 });
  await expect(activity).not.toContainText('Off the timeline (sample)');
});
