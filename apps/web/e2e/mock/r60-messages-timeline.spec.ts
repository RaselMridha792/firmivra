import { expect, test } from '@playwright/test';

// R60, MSG-F16 (Octavia's Oct 27 Messages review): New Message's Add to Client Timeline. Once
// sent, the client's Activity tab shows the subject, the channel and the day, never the message.
// Mock mode as the Owner; the mock keeps its timeline in the browser, so the test moves through
// the app (New Message, the conversation, View Profile, Activity).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

test.describe.configure({ timeout: 180_000 });

test('a message sent with Add to Client Timeline shows on the client’s Activity, without its text', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/messages/new?clientId=${JAMIE}`));
  const box = page.getByRole('checkbox', { name: 'Add to Client Timeline' });
  await expect(box).toBeEnabled({ timeout: 60_000 });
  await expect(box).not.toBeChecked();
  await page.getByLabel('Subject (optional)').fill('Organizer reminder (sample)');
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Synthetic private text that must not reach the timeline.');
  await box.check();
  await page.screenshot({ path: 'e2e/screenshots/r60-messages-timeline/compose.png' });
  await page.getByRole('button', { name: 'Review and Send' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Send Message' }).click();
  const outcome = page.getByTestId('compose-outcome');
  await expect(outcome).toContainText('Message sent');
  await outcome.getByRole('link', { name: 'Open conversation' }).click();

  const panel = page.getByTestId('contact-panel');
  await panel.getByRole('button', { name: 'Thread actions for Jamie Sample' }).click();
  await page.getByRole('menuitem', { name: 'View Profile' }).click();
  await expect(page).toHaveURL(new RegExp(`/clients/${JAMIE}`), { timeout: 60_000 });
  await page.getByRole('link', { name: 'Activity', exact: true }).click();
  const activity = page.getByTestId('client-activity');
  const entry = activity.getByTestId('activity-entry').first();
  await expect(entry).toContainText('Organizer reminder (sample)', { timeout: 60_000 });
  await expect(entry).toContainText('Sent through the client portal');
  await expect(activity).not.toContainText('Synthetic private text');
  await expect(entry.getByRole('link', { name: 'Open' })).toHaveAttribute(
    'href',
    /^\/messages\?thread=.+&from=/,
  );
  await page.screenshot({ path: 'e2e/screenshots/r60-messages-timeline/activity.png' });
});

test('a client with nothing on their timeline says so', async ({ page }) => {
  await page.goto(app(`/clients/${JAMIE}/activity`));
  await expect(page.getByTestId('client-activity')).toContainText('No activity yet', {
    timeout: 60_000,
  });
});
