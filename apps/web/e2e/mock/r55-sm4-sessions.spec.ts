import { expect, test } from '@playwright/test';

// R55, SM4: Login History lists the sign-ins to this firm and says where failed attempts are.
// Mock mode, signed in as the Owner; the mock's sixth member is Hana Kim. 1440 px.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const HANA = '0199c0a0-0a00-7000-8000-000000000006';

test('Login History says it lists sign-ins to this firm, failed attempts kept by Firmivra (SM4)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/team/${HANA}/security/history`);
  const panel = page.getByTestId('login-history-all');
  await expect(panel).toContainText(
    'Sign-ins to this firm, newest first. Failed attempts are kept by Firmivra.',
  );
  // Loaded: the header and the mock's five sign-ins.
  await expect(panel.getByRole('row')).toHaveCount(6);
  await expect(page.getByTestId('sign-in-summary')).toContainText('Sign-ins shown5');
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/team-security/login-history.png' });
});
