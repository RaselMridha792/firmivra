import { expect, test } from '@playwright/test';

// R55, Clients Review 2 (§23): on a client's Messages, Internal Notes can be hidden and shown
// again; hidden, the messages take the whole width (a wider Subject), and a note being typed is
// still there when the notes come back. P4-7: Hide / Show Internal Notes is in the tab's More
// Actions menu. Mock mode as the Owner, at her 1165 px width.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

test('Hide Internal Notes widens the Subject and keeps the draft note', async ({ page }) => {
  await page.setViewportSize({ width: 1165, height: 747 });
  await page.goto(app(`/clients/${JAMIE}/messages`));
  const more = page.getByTestId('client-tab-header').getByRole('button', { name: 'More Actions' });
  await expect(more).toBeVisible({ timeout: 60_000 });
  const notes = page.locator('#client-internal-notes');
  await expect(notes).toBeVisible();
  const draft = notes.getByRole('textbox');
  await draft.fill('Synthetic draft note that must survive hiding.');
  const subject = page.getByRole('columnheader', { name: 'Subject' });
  const before = (await subject.boundingBox())!.width;

  await more.click();
  await page.getByRole('menuitem', { name: 'Hide Internal Notes' }).click();
  await expect(notes).toBeHidden();
  await expect.poll(async () => (await subject.boundingBox())!.width).toBeGreaterThan(before);

  await more.click();
  await expect(page.getByRole('menuitem', { name: 'Hide Internal Notes' })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Show Internal Notes' }).click();
  await expect(notes).toBeVisible();
  await expect(draft).toHaveValue('Synthetic draft note that must survive hiding.');
});
