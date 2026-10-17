import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { expect, test, type Page } from '@playwright/test';

const basePort = Number(process.env['WEB_PORT'] ?? '3000') + 1;
const leadId = '0199c0c0-0a00-7000-8000-000000000001';
const url = (port: number) =>
  'http://app.localhost:' + port + '/leads/' + leadId + '/convert/review';
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
      ...readFileSync(new URL('../../src/lib/' + file, import.meta.url), 'utf8').matchAll(
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
      NEXT_DIST_DIR: '.next/mock-convert-step-4-' + name,
      NEXT_PUBLIC_API_MOCK_ROLE: 'OWNER',
      ...env,
    },
  });

  for (let attempt = 0; attempt < 180; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error('Mock web server (' + name + ') exited with code ' + server.exitCode);
    }
    const healthy = await fetch('http://localhost:' + port + '/healthz').then(
      (response) => response.ok,
      () => false,
    );
    if (healthy) return server;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('Mock web server (' + name + ') did not start');
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

async function expectReviewFrames(page: Page) {
  await expect(page.getByTestId('convert-lead-review-summary')).toBeVisible();
  await expect(page.getByTestId('convert-lead-review-selections')).toBeVisible();
  await expect(page.getByTestId('convert-lead-review-info')).toBeVisible();
  await expect(
    page.getByTestId('convert-lead-review-columns').locator(':scope > section'),
  ).toHaveCount(2);

  const stepper = page.getByRole('list', { name: 'Convert lead progress' });
  await expect(stepper).toBeVisible();
  for (const label of [
    'Review Lead Information',
    'Client Details & Services',
    'Portal & Settings',
  ]) {
    await expect(page.getByRole('listitem').filter({ has: page.getByText(label) })).toContainText(
      'completed',
    );
  }
  await expect(
    page.getByRole('listitem').filter({ has: page.getByText('Review & Confirm') }),
  ).toHaveAttribute('aria-current', 'step');
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Convert to Client/ })).toBeVisible();
}

async function captureStepFour(page: Page, filename: string) {
  await page.screenshot({
    path: test.info().outputPath(filename),
    fullPage: true,
    style: '[data-testid="mock-badge"], nextjs-portal { display: none !important; }',
  });
}

test('reviews the conversion details and confirms with mock data at desktop and mobile sizes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url(basePort));

  await expect(page).toHaveTitle(/^Convert lead: Review & confirm/);
  await expectReviewFrames(page);
  await expect(
    page.getByTestId('convert-lead-review-summary').getByText('Avery Lawson', { exact: true }),
  ).toBeVisible();
  const summary = page.getByTestId('convert-lead-review-summary');
  const selections = page.getByTestId('convert-lead-review-selections');
  await expect(summary.getByText('Personal Tax', { exact: true })).toBeVisible();
  await expect(summary.getByText('Bookkeeping', { exact: true })).toBeVisible();
  await expect(summary.getByText('Morgan Avery', { exact: true })).toBeVisible();
  await expect(selections.getByRole('img', { name: 'Selected: Notes' })).toBeVisible();
  await expect(selections.getByText('Send now', { exact: true })).toBeVisible();
  await expect(selections.getByText('Send later', { exact: true })).toBeVisible();
  await captureStepFour(page, 'convert-lead-step-4-data-1440.png');

  await page.setViewportSize({ width: 375, height: 812 });
  const dimensions = await page.getByTestId('convert-lead-page').evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
  }));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client);
  await captureStepFour(page, 'convert-lead-step-4-data-375.png');

  await page.getByRole('button', { name: /Convert to Client/ }).click();
  await expect(page).toHaveURL(/\/leads\/[^/]+\/convert\/done$/);
});

test('keeps both review card frames when lead data is empty', async ({ page }) => {
  const port = await unusedPort();
  const server = await startMockServer('empty', port);
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(url(port));

    await expectReviewFrames(page);
    await expect(page.getByText('No lead details are available to review.')).toBeVisible();
    await captureStepFour(page, 'convert-lead-step-4-empty-1440.png');
  } finally {
    stopMockServer(server);
  }
});

test('keeps both review card frames when the lead API is unreachable', async ({ page }) => {
  const port = await unusedPort();
  const server = await startMockServer('unreachable', port);
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.route('**/api/v1/business/leads/**', (route) => route.abort());
    await page.goto(url(port));

    await expectReviewFrames(page);
    await expect(page.getByText("Couldn't load lead information.")).toBeVisible();
    await captureStepFour(page, 'convert-lead-step-4-unreachable-1440.png');
  } finally {
    stopMockServer(server);
  }
});
