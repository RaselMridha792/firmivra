import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAuthenticatedApiSmoke } from './api-authenticated-smoke.mjs';
const firmId = '00000000-0000-4000-a000-000000000001';
const otherFirmId = '00000000-0000-4000-a000-000000000002';
const config = {
  baseUrl: 'https://api.example.test/api/v1',
  firmId,
  otherFirmId,
  ownerToken: 'synthetic-owner-token',
  clientToken: 'synthetic-client-token',
};
function fixture(calls, { missingPolicy = false, wrongOwner = false } = {}) {
  return async (url, options) => {
    calls.push({ url, options });
    const path = new URL(url).pathname;
    const owner = options.headers.authorization === 'Bearer ' + config.ownerToken;
    const signedIn = !!options.headers.authorization;
    const status = path.endsWith('/health')
      ? 200
      : !signedIn
        ? 401
        : options.headers['x-business-id'] === otherFirmId
          ? 404
          : path.endsWith('/admin/applications')
            ? 401
            : !owner && path.endsWith('/business/team')
              ? 403
              : missingPolicy && path.endsWith('/notification-preferences')
                ? 503
                : 200;
    return {
      status,
      json: async () =>
        path.endsWith('/health')
          ? { status: 'ok', db: 'ok' }
          : {
              user: { pool: owner ? 'STAFF' : 'CLIENT' },
              memberships: [
                {
                  business: { id: firmId, status: 'ACTIVE' },
                  status: 'ACTIVE',
                  role: wrongOwner ? 'STAFF' : 'OWNER',
                },
              ],
              clientAccounts: [{ business: { id: firmId, status: 'ACTIVE' }, status: 'ACTIVE' }],
            },
    };
  };
}
test('authenticated smoke checks identities/tenant denials with GET only and no credential output', async () => {
  const calls = [],
    results = await runAuthenticatedApiSmoke({ ...config, fetchImpl: fixture(calls) });
  assert.ok(results.every((row) => row.ok));
  assert.equal(calls.length, 26);
  assert.ok(
    calls.every(
      ({ options }) => options.method === 'GET' && !options.body && options.redirect === 'manual',
    ),
  );
  assert.ok(!JSON.stringify(results).includes(config.ownerToken));
  assert.ok(!JSON.stringify(results).includes(config.clientToken));
});
test('missing policy fails readiness and wrong owner identity stops before feature reads', async () => {
  const missing = await runAuthenticatedApiSmoke({
    ...config,
    fetchImpl: fixture([], { missingPolicy: true }),
  });
  assert.ok(missing.some((row) => row.status === 503 && !row.ok));
  const calls = [],
    denied = await runAuthenticatedApiSmoke({
      ...config,
      fetchImpl: fixture(calls, { wrongOwner: true }),
    });
  assert.ok(denied.some((row) => !row.ok));
  assert.equal(calls.filter((row) => row.options.headers.authorization).length, 2);
});
test('invalid credentials/scopes and credential-bearing or insecure URLs fail before credentials are sent', async () => {
  for (const override of [
    { otherFirmId: firmId },
    { ownerToken: 'bad\r\nheader' },
    { baseUrl: 'https://user:secret@api.example.test/api/v1' },
    { baseUrl: 'http://api.example.test/api/v1' },
  ]) {
    const calls = [];
    await assert.rejects(
      runAuthenticatedApiSmoke({ ...config, ...override, fetchImpl: fixture(calls) }),
    );
    assert.equal(calls.length, 0);
  }
});
