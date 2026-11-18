import { expect, type Locator, test } from '@playwright/test';

// Clients Review 2 P4-7 (§23, platform heading and action-row consistency, Clients scope): every
// tab of a client's profile has the one heading row: an h2 of one size, the tab's primary action
// at the row's right end and its secondary actions in the row's More Actions menu. In mock mode
// (playwright.mock.config.ts) as the Owner, on mock client 1 (Jamie Sample, not archived, Firm
// Sign on). Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const clientId = '0199b6a1-0000-7000-8000-000000000001';
const profile = `http://app.localhost:${port}/clients/${clientId}`;

type Tab = {
  path: string;
  title: string;
  primary?: { role: 'button' | 'link'; name: string };
  /** The More Actions menu's choices; none, no menu. */
  menu?: string[];
};
const TABS: Tab[] = [
  { path: '', title: 'Overview' },
  { path: '/services', title: 'Services', primary: { role: 'button', name: 'Enroll in Service' } },
  {
    path: '/documents',
    title: 'Documents',
    primary: { role: 'button', name: 'Request a document' },
    menu: ['Upload Document'],
  },
  {
    path: '/intake-forms',
    title: 'Intake Forms',
    primary: { role: 'link', name: 'Send an Intake Form' },
  },
  { path: '/invoices', title: 'Invoices', primary: { role: 'button', name: 'New invoice' } },
  {
    path: '/messages',
    title: 'Messages and Notes',
    primary: { role: 'button', name: 'New Message' },
    menu: ['Hide Internal Notes'],
  },
  { path: '/tasks', title: 'Tasks', primary: { role: 'link', name: 'New Task' } },
  { path: '/notes', title: 'Notes' },
  { path: '/activity', title: 'Activity' },
  {
    path: '/signatures',
    title: 'Signatures',
    primary: { role: 'link', name: 'Send for signature' },
  },
];

/** The primary action ends where the row ends, on the title's line when there is room. */
async function atRightEnd(header: Locator, primary: Locator, sameLine: boolean) {
  await expect(primary).toBeVisible({ timeout: 60_000 });
  const row = (await header.boundingBox())!;
  const action = (await primary.boundingBox())!;
  expect(Math.abs(action.x + action.width - (row.x + row.width))).toBeLessThanOrEqual(1);
  if (sameLine) {
    const title = (await header.getByRole('heading', { level: 2 }).boundingBox())!;
    const middle = title.y + title.height / 2;
    expect(middle).toBeGreaterThanOrEqual(action.y);
    expect(middle).toBeLessThanOrEqual(action.y + action.height);
  }
}

test('P4-7: every client tab has the one heading row, one title size, primary right, the rest in More Actions', async ({
  page,
}) => {
  // Ten profile screens, each compiled on first visit in the dev server.
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const sizes = new Map<string, string>();
  for (const tab of TABS) {
    await page.goto(`${profile}${tab.path}`);
    const header = page.getByTestId('client-tab-header');
    const title = header.getByRole('heading', { level: 2 });
    await expect(title).toHaveText(tab.title, { timeout: 60_000 });
    await expect(header).toHaveCount(1);
    sizes.set(tab.title, await title.evaluate((el) => getComputedStyle(el).fontSize));

    if (tab.primary) {
      const primary = header.getByRole(tab.primary.role, { name: tab.primary.name, exact: true });
      await atRightEnd(header, primary, true);
    }
    const more = header.getByRole('button', { name: 'More Actions' });
    if (tab.menu) {
      await more.click();
      const menu = page.getByRole('menu', { name: 'More Actions' });
      for (const item of tab.menu) {
        await expect(menu.getByRole('menuitem', { name: item, exact: true })).toBeVisible();
      }
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
    } else {
      await expect(more).toHaveCount(0);
    }
  }
  // One size on every tab.
  expect(new Set(sizes.values()).size, JSON.stringify(Object.fromEntries(sizes))).toBe(1);

  // A secondary action runs from the menu: Messages' Hide Internal Notes, then Show again.
  await page.goto(`${profile}/messages`);
  const notes = page.locator('#client-internal-notes');
  await expect(notes).toBeVisible({ timeout: 60_000 });
  const more = page.getByTestId('client-tab-header').getByRole('button', { name: 'More Actions' });
  await more.click();
  await page.getByRole('menuitem', { name: 'Hide Internal Notes' }).click();
  await expect(notes).toBeHidden();
  await more.click();
  await page.getByRole('menuitem', { name: 'Show Internal Notes' }).click();
  await expect(notes).toBeVisible();
});

test('P4-7: at 375 px the heading row wraps, its actions on the right, with no sideways scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`${profile}/messages`);
  const header = page.getByTestId('client-tab-header');
  await expect(header.getByRole('heading', { level: 2 })).toHaveText('Messages and Notes', {
    timeout: 60_000,
  });
  const primary = header.getByRole('button', { name: 'New Message', exact: true });
  await atRightEnd(header, primary, false);
  const more = header.getByRole('button', { name: 'More Actions' });
  const box = (await more.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  await page.waitForLoadState('networkidle');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await more.click();
  await expect(page.getByRole('menuitem', { name: 'Hide Internal Notes' })).toBeVisible();
});
