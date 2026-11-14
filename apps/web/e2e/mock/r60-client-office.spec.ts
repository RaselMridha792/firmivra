import { expect, test } from '@playwright/test';

// R60, PRT-1 (Client Portal guide 2, 7.4 and 9.1; LVP Client Portal Sign-Up Page.png): the
// sign-up form lists the firm's active locations with their full addresses and asks the person
// to choose the office they will visit or work with; nothing is picked from their city or state.
// Mock mode (two synthetic locations). Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;
const shots = 'e2e/screenshots/r60-client-office';

test('the sign-up form asks for the office, with full addresses', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(portal('/lvp/sign-up'));
  const form = page.getByTestId('sign-up-form');
  const offices = form.getByTestId('sign-up-offices');
  await expect(offices.getByRole('radio')).toHaveCount(2, { timeout: 60_000 });
  await expect(offices).toContainText('Lawrenceville Office');
  await expect(offices).toContainText('456 Pine Rd, Suite 200');
  await expect(offices).toContainText('Lawrenceville, GA 30046');
  // None is chosen for the person.
  await expect(offices.getByRole('radio', { checked: true })).toHaveCount(0);

  await form.getByLabel('Full Name *').fill('Jamie Example');
  await form.getByLabel('Email Address *').fill('jamie@example.test');
  await form.getByLabel('Phone Number *').fill('(404) 555-0123');
  await form.getByLabel('Create a Password *').fill('Sample-pass-2026');
  await form.getByLabel('Confirm Password *').fill('Sample-pass-2026');
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: 'Create Account' }).click();
  await expect(offices).toContainText('Choose the office you will work with');
  await offices.getByRole('radio', { name: /Lawrenceville Office/ }).check();
  await page.mouse.move(5, 5);
  await page.screenshot({ path: `${shots}/sign-up.png`, fullPage: true });
  await form.getByRole('button', { name: 'Create Account' }).click();
  await expect(page).toHaveURL(portal('/lvp/sign-up/verify-email'), { timeout: 60_000 });
});
