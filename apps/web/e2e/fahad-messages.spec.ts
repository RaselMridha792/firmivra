import { expect, test } from '@playwright/test';
import { CreateMessageThreadRequest, SendMessageRequest } from '@firmivra/types';
import { clientFixtures, firstClientId } from '../src/mocks/clients';
import { createMessagesMock } from '../src/mocks/messages';
import { createMeMock, mockBusiness } from '../src/mocks/me';
test.describe.configure({ timeout: 90_000 });

const base = `http://app.localhost:${process.env['WEB_PORT'] ?? '3000'}`;
const clientPath = `/api/v1/business/clients/${firstClientId}`;
test.beforeEach(async ({ page }) => {
  const messages = createMessagesMock();
  const me = await createMeMock().me();
  me.user.email = 'owner@example.test';
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const post = route.request().method() === 'POST';
    let json: unknown;
    if (path === '/api/v1/me') json = me;
    else if (path === '/api/v1/business') json = mockBusiness;
    else if (path === clientPath) json = clientFixtures()[0];
    else if (path.endsWith('/esign/status')) json = { enabled: false, myEsignRole: null };
    else if (path === `${clientPath}/message-threads`) {
      json = post
        ? await messages.create(
            firstClientId,
            CreateMessageThreadRequest.parse(route.request().postDataJSON()),
          )
        : await messages.listForClient(firstClientId);
    } else {
      const match = path.match(/\/message-threads\/([^/]+)(?:\/(messages|read))?$/);
      if (!match?.[1]) return route.continue();
      json =
        match[2] === 'messages'
          ? await messages.send(match[1], SendMessageRequest.parse(route.request().postDataJSON()))
          : match[2] === 'read'
            ? await messages.markRead(match[1])
            : await messages.get(match[1]);
    }
    await route.fulfill({ status: post && !path.endsWith('/read') ? 201 : 200, json });
  });
});

for (const width of [375, 1440]) {
  test(`client conversations open and reply at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${base}/clients/${firstClientId}/messages`);
    await expect(page).toHaveTitle('Client messages');
    const list = page.getByTestId(width < 768 ? 'message-cards' : 'message-table');
    await expect(list).toContainText('Question About Deduction');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`messages-${width}.png`), fullPage: true });
    await list.getByRole('button', { name: 'View Question About Deduction', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Can the home office count as a deduction?');
    await dialog.getByRole('button', { name: 'Send reply', exact: true }).click();
    await expect(dialog.getByLabel('Reply', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    const body = `We will review the expense details for your return (${width}).`;
    await dialog.getByLabel('Reply', { exact: true }).fill(body);
    await dialog.getByRole('button', { name: 'Send reply', exact: true }).click();
    await expect(dialog.getByTestId('conversation-message').last()).toContainText(body);
    expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });
}
