import { expect, test } from '@playwright/test';

// R56: the firm's message on a document request reaches the client in the portal (Frame 7's
// Messages tab), while the email and text only say a request is waiting. Mock mode:
// `myDocuments`' one synthetic request packet. Synthetic data only.
const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
const packet = '0199b6a6-0000-7000-8000-000000000024';

test('the request page’s Messages tab shows the firm’s message', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://portal.localhost:${port}/lvp/requests/${packet}`);
  const tabs = page.getByTestId('packet-tabs');
  await expect(tabs).toBeVisible({ timeout: 60_000 });
  const messages = tabs.getByRole('tab', { name: /Messages/ });
  await expect(messages).toContainText('1');
  await messages.click();
  const message = page.getByTestId('packet-message');
  await expect(message).toContainText('Hi Jamie Sample,');
  await expect(message).toContainText('Sam Staff');
  await expect(message.getByRole('link', { name: 'Message Your Firm' })).toHaveAttribute(
    'href',
    '/lvp/messages',
  );
});
