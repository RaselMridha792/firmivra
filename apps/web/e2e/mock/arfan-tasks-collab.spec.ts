import { expect, test } from '@playwright/test';

// Q36, Tasks Review Two T-C01 and T-C02 in mock mode: the signed-in member's first open task waits
// for their acknowledgment (a badge in the list, Acknowledge on the task) and has a comment by
// a coworker; the member posts, edits and deletes their own comment. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('a pending acknowledgment shows in the list and is given on the task', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/tasks'));
  const badge = page.getByTestId('ack-badge').first();
  await expect(badge).toBeVisible();
  const row = page.locator('tbody tr').filter({ has: badge });
  await row.getByTestId('task-link').click();

  const card = page.getByTestId('detail-acknowledgment');
  await expect(card.getByTestId('ack-pending')).toBeVisible();
  await expect(card.getByText('Awaiting acknowledgment')).toBeVisible();
  await card.getByRole('button', { name: 'Acknowledge' }).click();
  await expect(card.getByTestId('ack-pending')).toHaveCount(0);
  await expect(card.getByText(/Acknowledged/)).toBeVisible();

  // Back in the list, the badge is gone.
  await page.goBack();
  await expect(page.getByTestId('task-link').first()).toBeVisible();
  await expect(page.getByTestId('ack-badge')).toHaveCount(0);
});

test('the discussion: read, post, edit and delete your own comment', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/tasks'));
  const row = page.locator('tbody tr').filter({ has: page.getByTestId('ack-badge') });
  await row.getByTestId('task-link').click();

  const card = page.getByTestId('detail-discussion');
  await expect(card.getByText('I have started on the bank statements.')).toBeVisible();
  // A coworker's comment cannot be changed by me.
  const theirs = card.getByTestId('task-comment').first();
  await expect(theirs.getByRole('button', { name: 'Edit' })).toHaveCount(0);

  const post = card.getByRole('button', { name: 'Post Comment' });
  await expect(post).toBeDisabled();
  await card.getByLabel('Add a comment').fill('Fake: totals checked.');
  await card.getByRole('button', { name: 'Mention a teammate' }).click();
  await card.getByTestId('mention-list').getByRole('checkbox').first().check();
  await post.click();
  const mine = card.getByTestId('task-comment').filter({ hasText: 'Fake: totals checked.' });
  await expect(mine).toBeVisible();
  await expect(card.getByLabel('Add a comment')).toHaveValue('');

  await mine.getByRole('button', { name: 'Edit' }).click();
  // While it is edited the words are in the box, so find the comment by its place.
  const editing = card.getByTestId('task-comment').last();
  await editing.getByLabel('Edit comment').fill('Fake: totals checked twice.');
  await editing.getByRole('button', { name: 'Save' }).click();
  const edited = card
    .getByTestId('task-comment')
    .filter({ hasText: 'Fake: totals checked twice.' });
  await expect(edited).toContainText('(edited)');

  await edited.getByRole('button', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete this comment?' })
    .getByRole('button', { name: 'Delete' })
    .click();
  await expect(card.getByText('Fake: totals checked twice.')).toHaveCount(0);
});

test('the task with its discussion fits a phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(app('/tasks'));
  await page.getByTestId('task-link').first().click();
  await expect(page.getByTestId('detail-discussion')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
