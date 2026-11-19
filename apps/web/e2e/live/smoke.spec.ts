import { expect, test } from '@playwright/test';
import { app, as, expectNoSideScroll, portal, settled } from './helpers';

// The harness itself: each saved session opens its home, at both widths.
for (const role of ['owner', 'admin', 'staff'] as const) {
  test.describe(`${role} session`, () => {
    test.use(as(role));
    test(`@narrow ${role} opens the firm workspace`, async ({ page }) => {
      await page.goto(app('/'));
      await expect(page).not.toHaveURL(/\/sign-in/);
      await settled(page);
      await expectNoSideScroll(page);
    });
  });
}

test.describe('client session', () => {
  test.use(as('client'));
  test('@narrow client opens the portal', async ({ page }) => {
    await page.goto(portal('/'));
    await expect(page).not.toHaveURL(/\/sign-in/);
    await settled(page);
    await expectNoSideScroll(page);
  });
});
