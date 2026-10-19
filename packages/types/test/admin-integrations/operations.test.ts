import { describe, expect, it } from 'vitest';
import {
  AdminUsageQuery,
  createAdminIntegrationsClient,
  CreateAdminApiKeyRequest,
  CreateAdminWebhookRequest,
  createRequest,
  ExportAdminLogsRequest,
  ListAdminIntegrationLogsQuery,
  UpdateAdminWebhookRequest,
} from '../../src/index.js';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const id = '0199c4a0-0000-7000-8000-000000000002';
const client = (fn: typeof fetch) =>
  createAdminIntegrationsClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));

describe('admin integrations contract, part 2', () => {
  it('issues API keys with known scopes, a capped rate limit and an optional expiry', () => {
    const base = { name: 'Reporting', environment: 'TEST', scopes: ['usage:read'] };
    expect(CreateAdminApiKeyRequest.safeParse(base).success).toBe(true);
    expect(CreateAdminApiKeyRequest.safeParse({ ...base, scopes: [] }).success).toBe(false);
    expect(CreateAdminApiKeyRequest.safeParse({ ...base, scopes: ['admin:all'] }).success).toBe(
      false,
    );
    expect(CreateAdminApiKeyRequest.safeParse({ ...base, rateLimitPerMinute: 1001 }).success).toBe(
      false,
    );
    expect(
      CreateAdminApiKeyRequest.safeParse({ ...base, expiresAt: '2027-01-01T00:00:00.000Z' })
        .success,
    ).toBe(true);
  });

  it('rotates, revokes and redelivers on their routes, and checks the ids', async () => {
    const { fn, calls } = fakeFetch(200, {});
    const c = client(fn);
    await c.rotateApiKey(id).catch(() => undefined);
    await c.revokeApiKey(id, { reason: 'Fake leak' }).catch(() => undefined);
    await c.redeliver(id).catch(() => undefined);
    expect(calls.map((x) => `${x.method} ${x.url}`)).toEqual([
      `POST /api/v1/admin/integrations/api-keys/${id}/rotate`,
      `POST /api/v1/admin/integrations/api-keys/${id}/revoke`,
      `POST /api/v1/admin/integrations/deliveries/${id}/redeliver`,
    ]);
    await expect(c.rotateApiKey('not-an-id')).rejects.toThrow();
  });

  it('takes https webhook endpoints with event keys, and a rotation on its own', () => {
    const base = {
      direction: 'OUTBOUND',
      url: 'https://hooks.example.test/in',
      events: ['invoice.paid'],
    };
    expect(CreateAdminWebhookRequest.safeParse(base).success).toBe(true);
    expect(
      CreateAdminWebhookRequest.safeParse({ ...base, url: 'http://hooks.example.test' }).success,
    ).toBe(false);
    expect(CreateAdminWebhookRequest.safeParse({ ...base, events: ['Invoice Paid'] }).success).toBe(
      false,
    );
    expect(CreateAdminWebhookRequest.safeParse({ ...base, maxRetries: 11 }).success).toBe(false);
    expect(UpdateAdminWebhookRequest.safeParse({ rotateSecret: true }).success).toBe(true);
  });

  it('sends log filters as text, and the export body with real booleans', async () => {
    const { fn, calls } = fakeFetch(200, { items: [], total: 0, page: 1, pageSize: 20 });
    await client(fn).listLogs({ severity: 'ERROR', descending: 'false', requestId: 'req_1' });
    expect(calls[0]?.url).toContain('/api/v1/admin/integrations/logs?');
    expect(calls[0]?.url).toContain('descending=false');
    expect(calls[0]?.url).toContain('platformOnly=false');
    expect(ListAdminIntegrationLogsQuery.parse({}).descending).toBe(true);
    expect(ListAdminIntegrationLogsQuery.safeParse({ eventType: 'Sync' }).success).toBe(false);
    expect(ListAdminIntegrationLogsQuery.safeParse({ requestId: 'has space' }).success).toBe(false);
    const body = { query: { platformOnly: true, severity: 'ERROR' }, format: 'CSV' } as const;
    expect(ExportAdminLogsRequest.parse(body)).toEqual(body);
    expect(ExportAdminLogsRequest.safeParse({ format: 'JSON' }).success).toBe(false);
  });

  it('reads usage by scope over UTC days, and the audit trail by record', async () => {
    expect(AdminUsageQuery.parse({}).scope).toBe('PLATFORM_INTEGRATION');
    expect(AdminUsageQuery.safeParse({ from: '2026-10-01T00:00:00Z' }).success).toBe(false);
    const { fn, calls } = fakeFetch(200, {});
    const c = client(fn);
    await c.platformUsage(id, { from: '2026-10-01' }).catch(() => undefined);
    await c.auditTrail({ targetId: id }).catch(() => undefined);
    expect(calls[0]?.url).toBe(`/api/v1/admin/integrations/platform/${id}/usage?from=2026-10-01`);
    expect(calls[1]?.url).toContain(`/api/v1/admin/integrations/audit?targetId=${id}`);
  });
});
