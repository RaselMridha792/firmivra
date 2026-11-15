import { expect, test } from '@playwright/test';

// R60, M27 (Messaging Review 2): the open conversation updates on its own: a firm reply says
// Delivered, then Read once the client opens it, with no refresh. The mock's client reads a new
// firm message ten seconds after it arrives; the test moves the clock on. Nothing is sent.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.describe.configure({ timeout: 180_000 });

test('M27: Delivered turns Read in the open conversation without a refresh', async ({ page }) => {
  await page.clock.install();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/messages'));
  await page.getByLabel('Search messages').fill('riley');
  await expect(page.getByTestId('thread-row')).toHaveCount(1, { timeout: 60_000 });
  await page.getByTestId('thread-row').first().click();
  const conversation = page.getByTestId('conversation');
  await conversation.getByRole('textbox').first().fill('We have it, thank you (synthetic).');
  await conversation.getByRole('button', { name: /^Send/ }).click();
  const mine = conversation.getByRole('listitem').filter({ hasText: 'We have it, thank you' });
  await expect(mine.getByTestId('message-delivery')).toHaveText(/Delivered/);
  // The client opens it; the conversation looks again on its own within 15 seconds.
  await page.clock.fastForward(20_000);
  await expect(mine.getByTestId('message-delivery')).toHaveText(/Read/, { timeout: 15_000 });
});
