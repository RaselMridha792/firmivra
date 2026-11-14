import { expect, test } from '@playwright/test';

// R55, Leads Review Two (Octavia, Nov 8) R2 19: reusable follow-up sequences under Templates, and
// Apply Sequence on a lead with its steps previewed and edited first (nothing is sent). In mock mode
// (playwright.mock.config.ts) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = `http://app.localhost:${port}`;

test('Templates keeps reusable sequences: the starter one, and a new one saved', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${app}/templates`);
  await page.getByTestId('lead-sequences-link').click();
  const screen = page.getByTestId('lead-sequences');
  await expect(screen).toContainText('New lead welcome');
  await expect(screen).toContainText('Outreach (you send it)');

  await screen.getByTestId('sequence-new').click();
  const editor = page.getByRole('dialog', { name: 'New Sequence' });
  await editor.getByTestId('sequence-save').click();
  await expect(editor).toContainText('Name the sequence');
  await editor.getByLabel('Name *').fill('Quick check-in');
  await editor.getByRole('button', { name: 'Add Step' }).click();
  await expect(editor.getByTestId('sequence-step')).toHaveCount(2);
  await editor.getByTestId('sequence-save').click();
  await expect(editor).toHaveCount(0);
  await expect(screen).toContainText('Quick check-in');
});

test('Apply Sequence previews the steps, leaves one out, and adds the rest to the lead', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${app}/leads/0199c0c0-0a00-7000-8000-000000000001/tasks`);
  const card = page.getByTestId('card-sequences');
  await expect(card).toContainText('No sequence applied');
  await card.getByTestId('sequence-apply').click();
  const dialog = page.getByRole('dialog', { name: 'Apply a Follow-up Sequence' });
  await dialog.getByLabel('Sequence').selectOption({ label: 'New lead welcome' });
  const preview = dialog.getByTestId('sequence-preview');
  await expect(preview.getByRole('listitem')).toHaveCount(2);
  await expect(preview).toContainText('Outreach (you send it)');
  await dialog.getByRole('button', { name: 'Leave out step 2' }).click();
  await expect(preview.getByRole('listitem')).toHaveCount(1);
  await dialog.getByTestId('sequence-apply-confirm').click();
  await expect(dialog).toHaveCount(0);
  await expect(card).toContainText('New lead welcome');
  await expect(card).toContainText('Running');
});
