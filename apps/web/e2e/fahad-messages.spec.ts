import { expect, test } from '@playwright/test';
import {
  CreateInternalNoteRequest,
  CreateMessageThreadRequest,
  SendMessageRequest,
} from '@firmivra/types';
import { clientFixtures, firstClientId } from '../src/mocks/clients';
import { createClientNotesMock, createMessagesMock } from '../src/mocks/messages';
import { createMeMock, mockBusiness } from '../src/mocks/me';
test.describe.configure({ timeout: 90_000 });

const base = `http://app.localhost:${process.env['WEB_PORT'] ?? '3000'}`;
const clientPath = `/api/v1/business/clients/${firstClientId}`;
test.beforeEach(async ({ page }) => {
  const messages = createMessagesMock();
  const notes = createClientNotesMock();
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
    else if (path === `${clientPath}/notes`) {
      json = post
        ? await notes.create(
            firstClientId,
            CreateInternalNoteRequest.parse(route.request().postDataJSON()),
          )
        : { items: await notes.list(firstClientId) };
    } else if (path === `${clientPath}/message-threads`) {
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

for (const width of [375, 768, 1024, 1440]) {
  test(`client conversations open and reply at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${base}/clients/${firstClientId}/messages`);
    await expect(page).toHaveTitle('Client messages');
    const list = page.getByTestId(width < 768 ? 'message-cards' : 'message-table');
    await expect(list).toContainText('Question About Deduction');
    const notes = page.getByTestId('client-internal-notes');
    await expect(notes).toContainText('Internal note, not visible to the client');
    await expect(notes).toContainText('Prefers calls after 3 pm.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: info.outputPath(`messages-${width}.png`), fullPage: true });
    await list.getByRole('button', { name: 'View Question About Deduction', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Can the home office count as a deduction?');
    await expect(dialog).not.toContainText('Prefers calls after 3 pm.');
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
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await notes.getByTestId('internal-note-save').click();
    await expect(notes.getByLabel('Internal note', { exact: true })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    const privateBody = `Staff review completed (${width}).`;
    await notes.getByLabel('Internal note', { exact: true }).fill(privateBody);
    await notes.getByTestId('internal-note-save').click();
    await expect(notes.getByTestId('internal-note').first()).toContainText(privateBody);
    await list.getByRole('button', { name: 'View Question About Deduction', exact: true }).click();
    await expect(page.getByTestId('message-thread')).not.toContainText(privateBody);
    await page.getByRole('dialog').getByRole('button', { name: 'Close dialog' }).click();
    await page.screenshot({ path: info.outputPath(`messages-notes-${width}.png`), fullPage: true });
  });
}

test('a new conversation is sent and firm replies stay open on a closed client thread', async ({
  page,
}) => {
  await page.goto(`${base}/clients/${firstClientId}/messages`);
  await page.getByRole('button', { name: 'Send a Message', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Subject').fill('Quarterly review');
  await dialog.getByLabel('Message', { exact: true }).fill('Please review the updated figures.');
  await dialog.getByTestId('message-send').click();
  await expect(dialog).toHaveCount(0);
  const list = page.getByTestId('message-table');
  await expect(list).toContainText('Quarterly review');
  await list.getByRole('button', { name: 'View Document Request', exact: true }).click();
  await expect(dialog).toContainText('Client replies closed');
  await dialog.getByLabel('Reply').fill('Your firm can still send an update.');
  await dialog.getByTestId('message-send').click();
  await expect(dialog.getByTestId('conversation-message').last()).toContainText(
    'Your firm can still send an update.',
  );
});

test('conversation loading state resolves', async ({ page }) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**${clientPath}/message-threads?*`, async (route) => {
    await gate;
    await route.fulfill({ json: { items: [], nextCursor: null } });
  });
  await page.goto(`${base}/clients/${firstClientId}/messages`);
  await expect(
    page.getByTestId('client-messages-screen').getByTestId('page-loading').first(),
  ).toBeVisible();
  release();
  await expect(page.getByTestId('client-messages-screen').getByTestId('page-empty')).toBeVisible();
});

for (const [status, code, state] of [
  [200, '', 'page-empty'],
  [403, 'FORBIDDEN', 'page-forbidden'],
  [500, 'INTERNAL_ERROR', 'page-error'],
] as const) {
  test(`conversation list has ${state}`, async ({ page }) => {
    await page.route(`**${clientPath}/message-threads?*`, (route) =>
      route.fulfill({
        status,
        json:
          status === 200
            ? { items: [], nextCursor: null }
            : { error: { code, message: 'Unable to load conversations.' } },
      }),
    );
    await page.goto(`${base}/clients/${firstClientId}/messages`);
    await expect(page.getByTestId('client-messages-screen').getByTestId(state)).toBeVisible();
  });
}
