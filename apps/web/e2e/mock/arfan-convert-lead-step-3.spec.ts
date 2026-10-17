import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { expect, test, type Page } from '@playwright/test';

const basePort = Number(process.env['WEB_PORT'] ?? '3000') + 1;
const leadId = '0199c0c0-0a00-7000-8000-000000000001';
const url = (port: number) => `http://app.localhost:${port}/leads/${leadId}/convert/portal`;
const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');

async function unusedPort() {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  if (!address || typeof address === 'string') throw new Error('Could not reserve a test port');
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

function everyMockExceptLeadPipeline() {
  const names = ['api.ts', 'auth.ts'].flatMap((file) =>
    [
      ...readFileSync(new URL(`../../src/lib/${file}`, import.meta.url), 'utf8').matchAll(
        /mocked\('(\w+)'\)/g,
      ),
    ].map((match) => match[1]),
  );
  return [...new Set(names)].filter((name) => name !== 'leadPipeline').join(',');
}

async function startMockServer(name: 'empty' | 'unreachable', port: number): Promise<ChildProcess> {
  const env =
    name === 'empty'
      ? { NEXT_PUBLIC_API_MOCK: 'all', NEXT_PUBLIC_API_MOCK_EMPTY: 'leadPipeline' }
      : { NEXT_PUBLIC_API_MOCK: everyMockExceptLeadPipeline() };
  const server = spawn(process.execPath, [nextBin, 'dev', '--port', String(port)], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      WEB_PORT: String(port),
      NEXT_DIST_DIR: `.next/mock-convert-step-3-${name}`,
      NEXT_PUBLIC_API_MOCK_ROLE: 'OWNER',
      ...env,
    },
  });

  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Mock web server (${name}) exited with code ${server.exitCode}`);
    }
    const healthy = await fetch(`http://localhost:${port}/healthz`).then(
      (response) => response.ok,
      () => false,
    );
    if (healthy) return server;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Mock web server (${name}) did not start`);
}

function stopMockServer(server: ChildProcess | undefined) {
  if (!server?.pid) return;
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(server.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      process.kill(-server.pid);
    }
  } catch {
    // The process tree already stopped.
  }
}

async function expectFrames(page: Page) {
  for (const id of [
    'convert-lead-lead-info',
    'convert-lead-details',
    'convert-lead-carry-over',
    'convert-lead-portal-access',
    'convert-lead-after-conversion',
  ]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expect(page.getByTestId('convert-lead-client-fields')).toHaveCount(0);
  await expect(page.getByTestId('convert-lead-staff-assignment')).toHaveCount(0);
  await expect(page.getByRole('list', { name: 'Convert lead progress' })).toBeVisible();
  await expect(
    page.getByRole('listitem').filter({ has: page.getByText('Portal & Settings') }),
  ).toHaveAttribute('aria-current', 'step');
  await expect(
    page.getByRole('listitem').filter({ has: page.getByText('Review Lead Information') }),
  ).toContainText('completed');
  await expect(
    page.getByRole('listitem').filter({ has: page.getByText('Client Details & Services') }),
  ).toContainText('completed');
  const portalColumn = page.getByTestId('convert-lead-portal-step-column');
  await expect(portalColumn.locator(':scope > section')).toHaveCount(3);
  for (const id of [
    'convert-lead-carry-over',
    'convert-lead-portal-access',
    'convert-lead-after-conversion',
  ]) {
    await expect(page.getByTestId(id)).toHaveClass(/border-info-soft/);
  }
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review & Continue' })).toBeVisible();
}

async function captureStepThree(page: Page, filename: string) {
  await page.screenshot({
    path: test.info().outputPath(filename),
    fullPage: true,
    style: '[data-testid="mock-badge"] { display: none !important; }',
  });
}

test('shows the five step 3 cards full width with mock data and fits mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url(basePort));

  await expect(page).toHaveTitle(/^Convert lead: Portal & settings/);
  await expectFrames(page);
  await expect(page.getByText('Avery Lawson', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Send portal invitation after conversion')).toBeVisible();
  const desktopWidth = await page
    .getByTestId('convert-lead-page')
    .evaluate((element) => element.clientWidth);
  const sectionWidth = await page
    .getByRole('region', { name: 'Lead conversion information' })
    .evaluate((element) => element.clientWidth);
  expect(sectionWidth).toBeGreaterThan(1000);
  expect(sectionWidth).toBeLessThanOrEqual(desktopWidth);
  await captureStepThree(page, 'convert-lead-step-3-data-1440.png');

  await page.setViewportSize({ width: 375, height: 812 });
  const dimensions = await page.getByTestId('convert-lead-page').evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
  await captureStepThree(page, 'convert-lead-step-3-data-375.png');
});

test('keeps the five step 3 cards visible when lead data is empty', async ({ page }) => {
  const port = await unusedPort();
  const server = await startMockServer('empty', port);
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(url(port));

    await expectFrames(page);
    await expect(page.getByText('Lead contact details will appear here.')).toBeVisible();
    await expect(page.getByText('Lead details will appear here when available.')).toBeVisible();
    await captureStepThree(page, 'convert-lead-step-3-empty-1440.png');
  } finally {
    stopMockServer(server);
  }
});

test('keeps the five step 3 cards visible when the lead API is unreachable', async ({ page }) => {
  const port = await unusedPort();
  const server = await startMockServer('unreachable', port);
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.route('**/api/v1/business/leads/**', (route) => route.abort());
    await page.goto(url(port));

    await expectFrames(page);
    await expect(page.getByText("Couldn't load lead information.").first()).toBeVisible();
    await captureStepThree(page, 'convert-lead-step-3-unreachable-1440.png');
  } finally {
    stopMockServer(server);
  }
});
