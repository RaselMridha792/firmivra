import { expect, type Page, test } from '@playwright/test';

// R55, Intake Forms Review Two INTAKE-ACCESS-02: Share & Publish on a published form (its link,
// a website button with the note that an inline embed comes once enabled, Share by link and
// Publish in client portal), and the shared link's page, which starts the form for anyone. Mock
// mode (playwright.mock.config.ts) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const httpsPort = String(Number(process.env['WEB_PORT'] ?? '3000') + 2);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const portal = (path: string) => `http://portal.localhost:${port}${path}`;
const httpsPortal = (path: string) => `https://portal.localhost:${httpsPort}${path}`;
const testWebsite = `https://portal.localhost:${httpsPort}`;
/** A share token as the mock makes them (mocks/intake-forms.ts): 32 hex characters + 11. */
const TOKEN = '0199c0d00f0070008000000000000002mockshare00';

const cardMenu = async (page: Page, name: string) => {
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  return page.getByRole('menu');
};

test('Share & Publish: the link and website button, Publish in client portal, sharing off', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/intake-forms/templates'));
  await (
    await cardMenu(page, 'Audit Support Intake Form')
  )
    .getByRole('menuitem', { name: 'Share & Publish' })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Audit Support Intake Form' });
  const share = dialog.getByTestId('form-share');
  await expect(share.getByLabel('Link', { exact: true })).toHaveValue(
    /\/lvp\/start\/[A-Za-z0-9_-]{43}$/,
  );
  await expect(share.getByLabel('Embed code', { exact: true })).toHaveValue(/^<iframe id=/);
  await expect(share.getByLabel('Embed code', { exact: true })).toHaveValue(/firmivra:height/);
  await expect(share.getByLabel('Button code', { exact: true })).toHaveValue(/^<a href=/);
  await expect(share).toContainText('Your website must be approved for embedding.');
  await expect(share.getByLabel('Portal sign-in link', { exact: true })).toHaveValue(
    'http://portal.localhost:3000/lvp/sign-in',
  );
  await expect(share).toContainText('Opens the portal sign-in page in a new tab.');
  await dialog.screenshot({ path: 'e2e/mock/screenshots/q45-intake-share.png' });

  // Off by default; on, it is listed in the client portal.
  const portalSwitch = share.getByRole('switch', { name: 'Publish in client portal' });
  await expect(portalSwitch).not.toBeChecked();
  await portalSwitch.click();
  await expect(portalSwitch).toBeChecked();

  // Sharing off: the link and button go, and say why.
  await share.getByRole('switch', { name: 'Share by link' }).click();
  await expect(share.getByRole('switch', { name: 'Share by link' })).not.toBeChecked();
  await expect(share.getByTestId('public-link-empty')).toContainText('Sharing by link is off');
  await expect(share.getByLabel('Link', { exact: true })).toHaveCount(0);
});

test('the shared link starts the form for anyone; a dead link says so', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal(`/lvp/start/${TOKEN}`));
  await page.getByLabel('First Name *').fill('Avery');
  await page.getByLabel('Last Name *').fill('Shared');
  await page.getByLabel('Email Address *').fill('avery.shared@example.test');
  await page.getByRole('button', { name: 'Start My Form' }).click();
  await expect(page.getByTestId('intake-next')).toBeVisible();
  await expect(page.locator('[aria-current="step"]')).toContainText(/./);

  await page.goto(portal(`/lvp/start/${'x'.repeat(43)}`));
  await expect(page.getByTestId('share-invalid')).toContainText(
    'This form link is not available any more',
  );
});

test('the published form frames on an approved website and reports its height', async ({
  browser,
}) => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route(`${testWebsite}/intake`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body style="margin:0;padding:24px;font-family:Arial,sans-serif"><h1>Test website</h1><iframe id="intake" title="Intake form" src="${httpsPortal(`/lvp/start/${TOKEN}`)}" style="display:block;width:100%;height:520px;border:1px solid #94a3b8"></iframe><script>window.addEventListener('message',event=>{if(event.data?.type==='firmivra:height'&&typeof event.data.height==='number'){document.querySelector('#intake').style.height=event.data.height+'px'}})</script></body></html>`,
    }),
  );
  await page.addInitScript(() => {
    (window as unknown as { heights: number[] }).heights = [];
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'firmivra:height' && typeof event.data.height === 'number') {
        (window as unknown as { heights: number[] }).heights.push(event.data.height);
        const frame = document.querySelector<HTMLIFrameElement>('#intake');
        if (frame) frame.style.height = `${event.data.height}px`;
      }
    });
  });

  await page.goto(`${testWebsite}/intake`);
  const frame = page.frameLocator('#intake');
  await expect(frame.getByLabel('First Name *')).toBeVisible();
  await expect(frame.locator('html')).toHaveAttribute('data-framed', '');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { heights: number[] }).heights))
    .toEqual(expect.arrayContaining([expect.any(Number)]));
  await page.screenshot({ path: 'e2e/mock/screenshots/q45-intake-framed.png' });

  // A portal sign-in link clicked from the embedded form must leave the frame.
  const signIn = frame.getByRole('link', { name: 'Client Portal', exact: true });
  const popupPromise = page.waitForEvent('popup');
  await signIn.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/\/lvp\/sign-in$/);
  await expect(signIn).toHaveAttribute('target', '_blank');
  await expect(signIn).toHaveAttribute('rel', 'noopener');
  await popup.close();
  await context.close();
});
