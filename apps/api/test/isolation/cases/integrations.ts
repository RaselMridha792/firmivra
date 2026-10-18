// Integrations (R55): connections, their settings, sync runs, mappings, permissions, the connection
// test and Custom API & Webhooks. A connection is unique per provider and environment, so each
// route needs one; a write case runs in a fresh world, so one record serves them all.
// The provider is a code from the catalog, not a record: see FIXED_PARAMS in
// tenant-isolation.test.ts.
import type { CaseModule, RecordDef } from '../world.js';

const BASE = '/api/v1/business';

/**
 * A connection is unique per provider and environment, and a firm holds many worlds (the shared
 * one and a fresh one for each write case), so a record that finds its connection puts it back to
 * its starting state instead of making a second one. A read case afterwards still finds it.
 */
const connection = (
  provider = 'website_forms',
  extra: Record<string, unknown> = {},
): RecordDef => ({
  async create({ tx, businessId, owner }) {
    const data = {
      status: 'CONNECTED' as const,
      statusReason: null,
      disconnectedAt: null,
      secretRef: null,
      nextSyncAt: null,
      settings: {},
      entities: ['leads'],
      direction: 'IMPORT' as const,
      syncMode: 'MANUAL' as const,
      syncEveryMinutes: null,
      connectedByUserId: owner.id,
      ...extra,
    };
    const existing = await tx.integrationConnection.findFirst({
      where: { businessId, provider, environment: 'LIVE' },
      select: { id: true },
    });
    if (existing) {
      await tx.integrationConnection.update({ where: { id: existing.id }, data });
      return existing.id;
    }
    const row = await tx.integrationConnection.create({
      data: { businessId, provider, ...data },
    });
    return row.id;
  },
});

export const records: CaseModule['records'] = {
  /** One connection serves every case: a write gets a fresh world of its own. */
  intConn: connection(),
  /** A paused connection (Resume needs one), of another provider so both fit in one world. */
  intConnPaused: connection('calendly', { status: 'PAUSED', entities: ['events'] }),
  intRun: {
    async create({ tx, businessId, get }) {
      const now = new Date();
      const row = await tx.integrationSyncRun.create({
        data: {
          businessId,
          connectionId: await get('intConn'),
          entity: 'leads',
          status: 'SUCCEEDED',
          startedAt: now,
          finishedAt: now,
        },
      });
      return row.id;
    },
  },
  intCustom: connection('custom_api', { entities: ['events'], direction: 'EXPORT' }),
};

export const cases: CaseModule['cases'] = {
  [`GET ${BASE}/integrations/connections/:id`]: { params: { id: 'intConn' } },
  [`PATCH ${BASE}/integrations/connections/:id/settings`]: {
    params: { id: 'intConn' },
    body: { syncMode: 'MANUAL' },
  },
  // A provider with no adapter has nothing to sync: the connection is found, the action refused.
  [`POST ${BASE}/integrations/connections/:id/sync`]: {
    params: { id: 'intConn' },
    body: {},
    expect: 409,
  },
  [`POST ${BASE}/integrations/connections/:id/pause`]: { params: { id: 'intConn' } },
  [`POST ${BASE}/integrations/connections/:id/resume`]: { params: { id: 'intConnPaused' } },
  [`POST ${BASE}/integrations/connections/:id/test`]: { params: { id: 'intConn' } },
  [`GET ${BASE}/integrations/connections/:id/health`]: { params: { id: 'intConn' } },
  [`POST ${BASE}/integrations/connections/:id/reconnect`]: {
    params: { id: 'intConn' },
    body: {},
  },
  [`POST ${BASE}/integrations/connections/:id/disconnect`]: {
    params: { id: 'intConn' },
    body: { confirm: true },
  },
  [`GET ${BASE}/integrations/connections/:id/history`]: { params: { id: 'intConn' } },
  [`GET ${BASE}/integrations/connections/:id/history/:runId`]: {
    params: { id: 'intConn', runId: 'intRun' },
  },
  [`GET ${BASE}/integrations/connections/:id/mappings`]: { params: { id: 'intConn' } },
  // website_forms has no fields to map: the connection is found, the scope refused.
  [`PUT ${BASE}/integrations/connections/:id/mappings`]: {
    params: { id: 'intConn' },
    body: { scope: 'client', pairs: [] },
    expect: 409,
  },
  [`GET ${BASE}/integrations/connections/:id/permissions`]: { params: { id: 'intConn' } },
  [`GET ${BASE}/integrations/connections/:id/custom`]: { params: { id: 'intCustom' } },
  [`PATCH ${BASE}/integrations/connections/:id/custom`]: {
    params: { id: 'intCustom' },
    body: { name: 'Fake custom integration' },
  },
  [`POST ${BASE}/integrations/connections/:id/custom/secret`]: {
    params: { id: 'intCustom' },
    body: { secret: 'fake-secret-value-0123456789' },
  },
  // No endpoint is set: the connection is found, the test refused.
  [`POST ${BASE}/integrations/connections/:id/custom/test`]: {
    params: { id: 'intCustom' },
    expect: 409,
  },
};

export const excluded: CaseModule['excluded'] = {
  'GET /api/v1/integrations/callback':
    'the provider redirects the browser here after an authorization; it is public, takes no record id, and connects only when its sealed, expiring state matches the HttpOnly cookie of the browser that began it (e2e: integrations.e2e.test.ts)',
};
