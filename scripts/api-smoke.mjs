import { pathToFileURL } from 'node:url';

/** Read-only deployed API checks. No credentials, mutation requests or response-body logging. */
export async function runApiSmoke({ baseUrl, firmSlug = 'lvp', fetchImpl = globalThis.fetch }) {
  const base = new URL(baseUrl);
  if (
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    !['http:', 'https:'].includes(base.protocol)
  )
    throw new Error('Use a plain API base URL without credentials/query data');
  if (base.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))
    throw new Error('Remote API checks require HTTPS');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(firmSlug)) throw new Error('Invalid firm slug');
  const routes = [
    ['/health', 200],
    ['/business/settings', 401],
    ['/business/team', 401],
    ['/business/tax-statuses', 401],
    ['/admin/applications', 401],
    ['/business/notifications', 401],
    ['/business/appointments', 401],
    ['/business/audit-logs', 401],
    ['/business/external-links', 401],
    [`/portal/${firmSlug}/notifications`, 401],
    [`/portal/${firmSlug}/appointments`, 401],
  ];
  const results = [];
  for (const [path, expected] of routes) {
    try {
      const response = await fetchImpl(base.href.replace(/\/$/, '') + path, {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      });
      let ok = response.status === expected;
      if (path === '/health' && ok) {
        const body = await response.json();
        ok = body?.status === 'ok' && body?.db === 'ok';
      }
      results.push({ path, status: response.status, expected, ok });
    } catch {
      results.push({ path, status: null, expected, ok: false });
    }
  }
  return results;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.env.API_BASE_URL) throw new Error('Set API_BASE_URL to the deployed /api/v1 base');
    const results = await runApiSmoke({
      baseUrl: process.env.API_BASE_URL,
      firmSlug: process.env.FIRM_SLUG || 'lvp',
    });
    for (const row of results)
      process.stdout.write(
        `${row.ok ? 'PASS' : 'FAIL'} ${row.path}: ${row.status ?? 'unreachable'} (expected ${row.expected})\n`,
      );
    if (results.some((row) => !row.ok)) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Smoke configuration failed'}\n`,
    );
    process.exitCode = 1;
  }
}
