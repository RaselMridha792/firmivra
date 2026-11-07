import { expect, test, type Page } from '@playwright/test';

// R60, Octavia's Oct 27 Messages review, MSG-F19, F20 and F22 (playwright.mock.config.ts, as an
// Owner; the mock answers as the API and sends nothing). The client card's three-dot Thread
// Actions; the panel shows the client's tags and assigned staff and the conversation's owner;
// Schedule and Create Task open with the client chosen and Back returns to the thread. "Riley
// Example" is a client the mock's Staff member does not work with. A reload resets the mock.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const RILEY = '0199b6a1-0000-7000-8000-000000000003';
test.use({ viewport: { width: 1440, height: 1000 } });

const openRiley = async (page: Page) => {
  await page.goto(app('/messages'));
  await page.getByLabel('Search messages').fill('riley');
  // The search has settled: only Riley's active conversation is listed.
  await expect(page.getByTestId('thread-row')).toHaveCount(1);
  await page.getByTestId('thread-row').first().click();
  await expect(page.getByTestId('conversation')).toContainText('I signed the letter');
  // The address names the open thread once it is chosen (MSG-F08).
  await expect(page).toHaveURL(/thread=/);
  return page.getByTestId('contact-panel');
};
const shown = (page: Page, text: string | RegExp) => page.getByText(text).filter({ visible: true });

test('Thread Actions assign, mute, tag, archive and restore; the panel shows them (MSG-F19, F22)', async ({
  page,
}) => {
  const panel = await openRiley(page);
  await expect(panel.getByTestId('thread-owner')).toHaveText('Unassigned');
  await expect(panel.getByTestId('client-tags')).toContainText('No tags yet');
  await expect(panel.getByTestId('client-assigned')).not.toBeEmpty();
  const menu = panel.getByRole('button', { name: 'Thread actions for Riley Example' });
  await menu.click();
  await expect(page.getByRole('menuitem')).toHaveText([
    'View Profile',
    'Mark as Read',
    'Assign Staff',
    'Tags',
    'Create Task',
    'Schedule Appointment',
    'Mute',
    'Archive',
  ]);

  // Assign Staff: a Staff member owns only their own clients' conversations; an Admin may.
  await page.getByRole('menuitem', { name: 'Assign Staff' }).click();
  const assign = page.getByRole('dialog', { name: 'Assign Staff' });
  await assign
    .getByLabel('Owner of this conversation')
    .selectOption({ label: 'Sam Staff (Staff)' });
  await assign.getByRole('button', { name: 'Save' }).click();
  await expect(assign.getByRole('alert')).toHaveText(
    'A Staff member can own only conversations with their own clients. Choose someone else.',
  );
  await assign
    .getByLabel('Owner of this conversation')
    .selectOption({ label: 'Adam Admin (Admin)' });
  await assign.getByRole('button', { name: 'Save' }).click();
  await expect(shown(page, 'Adam Admin owns this conversation.')).toBeVisible();
  await expect(panel.getByTestId('thread-owner')).toHaveText('Adam Admin');
  // The client's own assigned staff member is not what changed.
  await expect(panel.getByTestId('client-assigned')).not.toHaveText('Adam Admin');

  // Mute: for me alone; the messages still arrive.
  await menu.click();
  await page.getByRole('menuitem', { name: 'Mute' }).click();
  await expect(panel.getByTestId('thread-muted')).toBeVisible();
  await menu.click();
  await expect(page.getByRole('menuitem', { name: 'Unmute' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Tags: the client's own, from the firm's list.
  await panel.getByRole('button', { name: 'Edit tags of Riley Example' }).click();
  const tags = page.getByRole('dialog', { name: 'Tags' });
  const box = tags.getByTestId('tag-picker').getByRole('combobox');
  await box.fill('high');
  await tags.getByRole('option', { name: 'High Value' }).click();
  await tags.getByRole('button', { name: 'Save Tags' }).click();
  await expect(panel.getByTestId('client-tags')).toContainText('High Value');

  // Archive keeps the history under Archived; Restore brings it back.
  await menu.click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await expect(shown(page, 'Archived. Its messages are kept, under Archived.')).toBeVisible();
  await expect(page.getByTestId('thread-list')).toContainText('No conversations match.');
  await page.getByRole('tab', { name: /^Archived/ }).click();
  await page.getByTestId('thread-row').filter({ hasText: 'Riley Example' }).first().click();
  await expect(page.getByTestId('conversation')).toContainText('I signed the letter');
  await panel.getByRole('button', { name: 'Thread actions for Riley Example' }).click();
  await page.getByRole('menuitem', { name: 'Restore' }).click();
  await expect(shown(page, 'Back in the inbox.')).toBeVisible();
  await page.getByRole('tab', { name: /^All Messages/ }).click();
  await expect(page.getByTestId('thread-row').filter({ hasText: 'Riley Example' })).not.toHaveCount(
    0,
  );
});

test('Schedule and Create Task open with the client chosen, and Back returns to the thread (MSG-F20, F22)', async ({
  page,
}) => {
  const panel = await openRiley(page);
  const there = page.url();
  await panel.getByTestId('contact-schedule').click();
  await expect(page).toHaveURL(new RegExp(`/calendar/new\\?clientId=${RILEY}&from=%2Fmessages`));
  await expect(page.getByTestId('back-to-origin')).toHaveText(/Back to Messages/);
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(there);
  await expect(page.getByTestId('conversation')).toContainText('I signed the letter');

  await panel.getByRole('button', { name: 'Thread actions for Riley Example' }).click();
  await page.getByRole('menuitem', { name: 'Create Task' }).click();
  await expect(page).toHaveURL(new RegExp(`/tasks/new\\?clientId=${RILEY}&from=%2Fmessages`));
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(there);
});
