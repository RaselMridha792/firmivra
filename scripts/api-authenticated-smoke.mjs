import { pathToFileURL } from 'node:url';
import { runApiSmoke } from './api-smoke.mjs';

/** Read-only checks using pre-provisioned synthetic identities; never creates users or logs bodies. */
export async function runAuthenticatedApiSmoke({
  baseUrl,
  firmSlug = 'lvp',
  firmId,
  otherFirmId,
  ownerToken,
  clientToken,
  fetchImpl = globalThis.fetch,
}) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    !uuid.test(firmId ?? '') ||
    !uuid.test(otherFirmId ?? '') ||
    firmId === otherFirmId ||
    ![ownerToken, clientToken].every(
      (token) => typeof token === 'string' && token.length && !/\s/.test(token),
    )
  )
    throw new Error(
      'Provide two distinct firm IDs and pre-provisioned synthetic owner/client tokens',
    );
  const results = await runApiSmoke({ baseUrl, firmSlug, fetchImpl });
  if (results.some((row) => !row.ok)) return results;
  const owner = { authorization: `Bearer ${ownerToken}`, 'x-business-id': firmId };
  const client = { authorization: `Bearer ${clientToken}` };
  async function probe(path, headers, expected = 200, verify) {
    let status = null,
      ok = false;
    try {
      const response = await fetchImpl(baseUrl.replace(/\/$/, '') + path, {
        method: 'GET',
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      });
      status = response.status;
      ok = status === expected && (!verify || verify(await response.json()));
    } catch {
      /* Never echo transport errors: they can contain credential-bearing request data. */
    }
    results.push({ path, status, expected, ok });
    return ok;
  }
  const ownerReady = await probe(
    '/me',
    owner,
    200,
    (body) =>
      body?.user?.pool === 'STAFF' &&
      body.memberships?.some(
        (row) =>
          row.business?.id === firmId &&
          row.business?.status === 'ACTIVE' &&
          row.status === 'ACTIVE' &&
          row.role === 'OWNER',
      ) &&
      !body.memberships?.some((row) => row.business?.id === otherFirmId),
  );
  const clientReady = await probe(
    '/me',
    client,
    200,
    (body) =>
      body?.user?.pool === 'CLIENT' &&
      body.clientAccounts?.some(
        (row) =>
          row.business?.id === firmId &&
          row.business?.status === 'ACTIVE' &&
          row.status === 'ACTIVE',
      ),
  );
  if (!ownerReady || !clientReady) return results;
  for (const path of [
    '/business/settings',
    '/business/team',
    '/business/tax-statuses',
    '/business/notifications/unread-count',
    '/business/notification-preferences',
    '/business/audit-logs',
  ])
    await probe(path, owner);
  for (const path of [
    `/portal/${firmSlug}/settings`,
    `/portal/${firmSlug}/notifications`,
    `/portal/${firmSlug}/appointment-types`,
    `/portal/${firmSlug}/external-links`,
  ])
    await probe(path, client);
  await probe('/business/team', client, 403);
  await probe('/admin/applications', owner, 401);
  await probe('/business/settings', { ...owner, 'x-business-id': otherFirmId }, 404);
  return results;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const results = await runAuthenticatedApiSmoke({
      baseUrl: process.env.API_BASE_URL,
      firmSlug: process.env.FIRM_SLUG || 'lvp',
      firmId: process.env.SMOKE_FIRM_ID,
      otherFirmId: process.env.SMOKE_OTHER_FIRM_ID,
      ownerToken: process.env.SMOKE_OWNER_TOKEN,
      clientToken: process.env.SMOKE_CLIENT_TOKEN,
    });
    for (const row of results)
      process.stdout.write(
        `${row.ok ? 'PASS' : 'FAIL'} ${row.path}: ${row.status ?? 'unreachable'} (expected ${row.expected})\n`,
      );
    if (results.some((row) => !row.ok)) process.exitCode = 1;
  } catch {
    process.stderr.write(
      'Authenticated smoke configuration failed; check synthetic identities and API URL\n',
    );
    process.exitCode = 1;
  }
}
