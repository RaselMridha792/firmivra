import { expect, type Page, test } from '@playwright/test';

// N02 steps 2-4 in mock mode: the in-memory sign-up (mocks/client-auth.ts) takes the code
// 000000. As in the API, the SMS code goes out only once the 45 s resend gap has passed.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

async function typeCode(page: Page, code: string) {
  await page.getByRole('textbox', { name: 'Verification code, digit 1' }).fill(code);
}

test('a sign-up verifies its email and phone and ends on Account Created', async ({
  page,
}, testInfo) => {
  await page.clock.install();
  await page.goto(portal('/lvp/sign-up'));
  const form = page.getByTestId('sign-up-form');
  await form.getByLabel('Full Name *').fill('Jamie Example');
  await form.getByLabel('Email Address *').fill('jamie@example.test');
  await form.getByLabel('Phone Number *').fill('4045550123');
  await form.getByLabel('Create a Password *').fill('Sample-pass-2026');
  await form.getByLabel('Confirm Password *').fill('Sample-pass-2026');
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: 'Create Account' }).click();

  await expect(page).toHaveURL(portal('/lvp/sign-up/verify-email'));
  await expect(page).toHaveTitle('Verify your email');
  await expect(page.getByTestId('code-sent-to')).toHaveText('jamie@example.test');
  await expect(page.getByRole('button', { name: /^Resend Code \(0:4\d\)$/ })).toBeDisabled();
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await page.screenshot({
      path: testInfo.outputPath(`verify-email-${width}.png`),
      fullPage: true,
    });
  }

  await typeCode(page, '123456');
  await page.getByRole('button', { name: 'Verify Email' }).click();
  await expect(page.getByText('That code is not right')).toBeVisible();
  await typeCode(page, '000000');
  await page.getByRole('button', { name: 'Verify Email' }).click();

  await expect(page).toHaveURL(portal('/lvp/sign-up/verify-phone'));
  await expect(page.getByTestId('code-sent-to')).toHaveText('(404) ***-0123');
  await page.clock.fastForward('00:50');
  await page.getByRole('button', { name: 'Resend Code' }).click();
  await expect(page.getByRole('button', { name: /^Resend Code \(0:4\d\)$/ })).toBeDisabled();
  await typeCode(page, '000000');
  await page.getByRole('button', { name: 'Verify Phone Number' }).click();

  await expect(page).toHaveURL(portal('/lvp/sign-up/done'));
  await expect(page.getByTestId('sign-up-done')).toContainText('Account Created!');
  await page.screenshot({ path: testInfo.outputPath('done-375.png'), fullPage: true });
  await expect(page.getByRole('link', { name: 'Go to Client Portal' })).toHaveAttribute(
    'href',
    '/lvp/sign-in',
  );
});

test('the email can be changed before it is verified', async ({ page }) => {
  await page.goto(portal('/lvp/sign-up'));
  const form = page.getByTestId('sign-up-form');
  await form.getByLabel('Full Name *').fill('Jamie Example');
  await form.getByLabel('Email Address *').fill('jamie@example.test');
  await form.getByLabel('Phone Number *').fill('4045550123');
  await form.getByLabel('Create a Password *').fill('Sample-pass-2026');
  await form.getByLabel('Confirm Password *').fill('Sample-pass-2026');
  await form.getByRole('checkbox').check();
  await form.getByRole('button', { name: 'Create Account' }).click();
  await expect(page).toHaveURL(portal('/lvp/sign-up/verify-email'));

  await page.getByRole('button', { name: 'Change Email Address' }).click();
  await page.getByLabel('New email address').fill('jamie.new@example.test');
  await page.getByRole('button', { name: 'Send a new code' }).click();
  await expect(page.getByTestId('code-sent-to')).toHaveText('jamie.new@example.test');
  await expect(page).toHaveURL(portal('/lvp/sign-up/verify-email'));
});

test('a step page opened with no sign-up offers a new one and stays put', async ({ page }) => {
  await page.goto(portal('/lvp/sign-up/verify-phone'));
  await expect(page.getByTestId('sign-up-expired')).toBeVisible();
  await expect(page).toHaveURL(portal('/lvp/sign-up/verify-phone'));
  await page.getByRole('link', { name: 'Start a new sign-up' }).click();
  await expect(page).toHaveURL(portal('/lvp/sign-up'));
});
