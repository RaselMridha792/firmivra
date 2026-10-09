import { expect, type Page, test } from '@playwright/test';
import { MOCK_IN_PERSON_REQUEST_ID } from '../../src/mocks/esign';
import { MOCK_KIOSK_PASSWORD } from '../../src/mocks/esign-extras';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
// The first mock request (mocks/esign.ts): "Tax Engagement Letter 2026", signed by email only.
const emailOnly = '0199b6e0-0000-7000-8000-000000000001';

test('with no in-person signing open, the kiosk entry opens Firm Sign', async ({ page }) => {
  await page.goto(app('/firm-sign/in-person'));
  await expect(page).toHaveURL(/\/firm-sign$/);
});

test('a request with no in-person signer cannot start a kiosk', async ({ page }) => {
  await page.goto(app(`/firm-sign/in-person/${emailOnly}`));
  await expect(page.getByTestId('page-title')).toHaveText('In-person signing');
  await expect(page.getByText('No one on this request signs in person.')).toBeVisible();
  await page.getByRole('link', { name: 'Back to the request' }).click();
  await expect(page).toHaveURL(new RegExp(`/firm-sign/requests/${emailOnly}$`));
});

test('start with the in-person signer, hand over, then unlock with the password', async ({
  page,
}) => {
  await page.goto(app(`/firm-sign/in-person/${MOCK_IN_PERSON_REQUEST_ID}`));
  await page.getByRole('button', { name: 'Start signing with Taylor Sample' }).click();
  await expect(
    page.getByRole('heading', { name: 'Hand this device to Taylor Sample' }),
  ).toBeVisible();
  // The signer's pages open in a new tab, on the portal (PORTAL_BASE_URL may name another port
  // than this test server's: answer it here).
  await page.context().route(/\/lvp\/sign/, (route) => route.fulfill({ body: 'Signer pages' }));
  const [signer] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByRole('button', { name: 'Open the signing pages' }).click(),
  ]);
  await expect(signer).toHaveURL(/portal\.localhost:\d+\/lvp\/sign/);
  await signer.close();
  // Back on the staff tab: a wrong password keeps it locked.
  const password = page.getByLabel('Your password');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('Type your password to return')).toBeVisible();
  await password.fill('not-the-password');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('That password is not right.')).toBeVisible();
  await expect(password).toHaveValue('');
  await password.fill(MOCK_KIOSK_PASSWORD);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page).toHaveURL(new RegExp(`/firm-sign/requests/${MOCK_IN_PERSON_REQUEST_ID}$`));
});

/** In-app navigation, without a reload (the mock's open kiosk lives in the page). */
const navigate = (page: Page, path: string) =>
  page.evaluate((to) => {
    (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push(
      to,
    );
  }, path);

test('while the kiosk is open, the staff member can only get back to it', async ({ page }) => {
  await page.goto(app(`/firm-sign/in-person/${MOCK_IN_PERSON_REQUEST_ID}`));
  await page.getByRole('button', { name: 'Start signing with Taylor Sample' }).click();
  const handOver = page.getByRole('heading', { name: 'Hand this device to Taylor Sample' });
  await expect(handOver).toBeVisible();
  const kiosk = new RegExp(`/firm-sign/in-person/${MOCK_IN_PERSON_REQUEST_ID}$`);
  const visited: string[] = [];
  page.on(
    'framenavigated',
    (f) => f === page.mainFrame() && visited.push(new URL(f.url()).pathname),
  );
  // Where a locked session lands: it resumes the open kiosk.
  await navigate(page, '/firm-sign/in-person');
  await expect.poll(() => visited).toEqual(['/firm-sign/in-person', expect.stringMatching(kiosk)]);
  await expect(handOver).toBeVisible();
  // Another request's kiosk: never two at once, so back to this one.
  visited.length = 0;
  await navigate(page, `/firm-sign/in-person/${emailOnly}`);
  await expect
    .poll(() => visited)
    .toEqual([`/firm-sign/in-person/${emailOnly}`, expect.stringMatching(kiosk)]);
  await expect(handOver).toBeVisible();
});
