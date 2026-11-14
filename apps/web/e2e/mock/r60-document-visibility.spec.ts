import { expect, test } from '@playwright/test';

// R60, Clients Review 2 C2-052: a firm file, internal by default, is shown to its client later
// with an explicit switch on Document Details, and hidden again. Mock mode (the documents mock's
// internal Preparer_Worksheet.pdf). Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const WORKSHEET = '0199b6a5-0000-7000-8000-000000000007';

test('an internal firm file is shown to its client with an explicit switch, and hidden again', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app(`/documents/${WORKSHEET}`));
  const card = page.getByTestId('document-visibility');
  await expect(card).toContainText('Internal: the client does not see it', { timeout: 60_000 });
  const toggle = card.getByRole('switch', { name: 'Visible to the client' });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(card).toContainText('Visible to the client in their portal');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(card).toContainText('Internal: the client does not see it');
});
