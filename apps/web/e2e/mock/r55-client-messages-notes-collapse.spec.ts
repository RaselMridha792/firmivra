import { expect, test } from '@playwright/test';

// R55, Clients Review 2 (§23): on a client's Messages, Internal Notes can be hidden and shown
// again; hidden, the messages take the whole width (a wider Subject), and a note being typed is
// still there when the notes come back. Mock mode as the Owner, at her 1165 px width.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const JAMIE = '0199b6a1-0000-7000-8000-000000000001';

test('Hide Internal Notes widens the Subject and keeps the draft note', async ({ page }) => {
  await page.setViewportSize({ width: 1165, height: 747 });
  await page.goto(app(`/clients/${JAMIE}/messages`));
  const toggle = page.getByRole('button', { name: 'Hide Internal Notes' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 60_000 });
  const notes = page.locator('#client-internal-notes');
  await expect(notes).toBeVisible();
  const draft = notes.getByRole('textbox');
  await draft.fill('Synthetic draft note that must survive hiding.');
  const subject = page.getByRole('columnheader', { name: 'Subject' });
  const before = (await subject.boundingBox())!.width;

  await toggle.click();
  const show = page.getByRole('button', { name: 'Show Internal Notes' });
  await expect(show).toHaveAttribute('aria-expanded', 'false');
  await expect(notes).toBeHidden();
  await expect.poll(async () => (await subject.boundingBox())!.width).toBeGreaterThan(before);

  await show.click();
  await expect(notes).toBeVisible();
  await expect(draft).toHaveValue('Synthetic draft note that must survive hiding.');
});
