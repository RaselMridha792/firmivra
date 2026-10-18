import { expect, test } from '@playwright/test';

const port = Number(process.env['WEB_PORT'] ?? '3000') + 1;
const modules = (process.env['PLAYWRIGHT_API_MOCK'] ?? 'all').split(',').map((item) => item.trim());
const communicationsMocked = modules.includes('all') || modules.includes('adminCommunications');
const emptyModules = (process.env['PLAYWRIGHT_API_MOCK_EMPTY'] ?? '')
  .split(',')
  .map((item) => item.trim());
const communicationsEmpty =
  emptyModules.includes('all') || emptyModules.includes('adminCommunications');

test('Super Admin Communications inbox renders its states and responsive layouts', async ({
  page,
}) => {
  await page.route('**/api/v1/**', (route) => route.abort());
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto(`http://admin.localhost:${port}/communications`);
  await page.addStyleTag({
    content: '[data-testid="mock-badge"], nextjs-portal { display: none !important; }',
  });

  await expect(page.getByRole('heading', { name: 'Communications', exact: true })).toBeVisible();

  if (!communicationsMocked) {
    await expect(
      page.getByText('Communications API is unavailable.', { exact: false }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Inbox unavailable' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No contact selected' })).toBeVisible();
    return;
  }

  if (communicationsEmpty) {
    await expect(page.getByRole('heading', { name: 'No conversations found' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No contact selected' })).toBeVisible();
    await expect(page.getByText(/0 of 0 conversations/)).toBeVisible();
    return;
  }

  await expect(page.getByText('24', { exact: true })).toBeVisible();
  await expect(page.getByText('56', { exact: true })).toBeVisible();
  await expect(page.getByText('Blue Ridge Consulting').first()).toBeVisible();
  await expect(page.getByText('Hi Octavia,')).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search conversations' }).fill('Jordan');
  await expect(page.getByRole('button', { name: /Jordan & Co\./ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Blue Ridge Consulting/ })).toBeHidden();
  await page.getByRole('searchbox', { name: 'Search conversations' }).clear();

  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 1024 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    if (width >= 1280) {
      const lastConversation = page.getByRole('button', { name: /Tom Edwards/ });
      await lastConversation.scrollIntoViewIfNeeded();
      await expect(lastConversation).toBeInViewport({ ratio: 0.99 });
      const lastActivity = page.getByText('Lead created', { exact: false });
      await lastActivity.scrollIntoViewIfNeeded();
      await expect(lastActivity).toBeInViewport({ ratio: 0.99 });
    }
    await expect(page.getByRole('heading', { name: 'Contact Details' })).toBeVisible();
  }
});
