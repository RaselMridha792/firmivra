// R0 stage B8 (Oct 18): Super Admin Integrations. Firmivra's service connections (credentials by
// reference only), runs, the central log, the firm-facing catalog, API keys (hash only), webhook
// endpoints and deliveries, and the usage rollup. Credentials, signing secrets, keys, disabling
// and removal are a SUPER_ADMIN's; no firm scope reaches any of it.
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = { ceo: randomUUID(), member: randomUUID(), firm: '' };

const asAdmin = <T>(fn: (tx: TxClient) => Promise<T>, adminUserId = ids.ceo) =>
  runInScope(app, { kind: 'admin', adminUserId }, fn);
const asMember = <T>(fn: (tx: TxClient) => Promise<T>) => asAdmin(fn, ids.member);
const asPlatform = <T>(fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'platform' }, fn);
const asFirm = <T>(fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'business', businessId: ids.firm }, fn);
/** Settles a promise into its error message (or 'ok'), so a rejection is never unhandled. */
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of [ids.ceo, ids.member]) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'ADMIN', email: `${id}@sup.test`, name: 'Fake' },
      });
    }
    await tx.platformAdmin.create({ data: { userId: ids.ceo, role: 'SUPER_ADMIN' } });
    await tx.platformAdmin.create({ data: { userId: ids.member, role: 'TEAM_MEMBER' } });
    const code = run.toUpperCase();
    const dept = await tx.platformDepartment.create({
      data: { code: `B8_${code}`, name: 'Engineering' },
    });
    const ceoRole = await tx.platformRoleDefinition.create({
      data: {
        code: `B8_CEO_${code}`,
        title: 'CEO',
        level: 'CEO',
        departmentId: dept.id,
        defaultScopeType: 'COMPANY',
      },
    });
    const engRole = await tx.platformRoleDefinition.create({
      data: {
        code: `B8_ENG_${code}`,
        title: 'Engineer',
        level: 'INDIVIDUAL_CONTRIBUTOR',
        departmentId: dept.id,
        defaultReportsToRoleId: ceoRole.id,
        defaultScopeType: 'OWN_RECORDS',
      },
    });
    await tx.platformMember.create({
      data: {
        userId: ids.ceo,
        roleDefinitionId: ceoRole.id,
        departmentId: dept.id,
        scopeType: 'COMPANY',
      },
    });
    await tx.platformMember.create({
      data: {
        userId: ids.member,
        roleDefinitionId: engRole.id,
        departmentId: dept.id,
        reportsToUserId: ids.ceo,
        scopeType: 'OWN_RECORDS',
      },
    });
    ids.firm = (await tx.business.create({ data: { slug: `b8-${run}`, name: 'Firm' } })).id;
  });
});

afterAll(async () => {
  await owner.$disconnect();
  await app.$disconnect();
});

const integration = (extra: Record<string, unknown> = {}, as = asMember) =>
  as((tx) =>
    tx.platformIntegration.create({
      data: {
        provider: `p_${randomUUID().slice(0, 8)}`,
        name: 'Provider',
        category: 'COMMUNICATION',
        ...extra,
      },
    }),
  );
const setIntegration = (id: string, data: Record<string, unknown>, as = asAdmin) =>
  as((tx) => tx.platformIntegration.update({ where: { id }, data }));

describe('integrations: who reaches it', () => {
  it('the team and the platform; no firm', async () => {
    const i = await integration();
    expect(await asPlatform((tx) => tx.platformIntegration.count({ where: { id: i.id } }))).toBe(1);
    expect(await asFirm((tx) => tx.platformIntegration.count())).toBe(0);
    expect(await asFirm((tx) => tx.platformIntegrationCatalog.count())).toBe(0);
    expect(
      await outcome(
        asFirm((tx) =>
          tx.platformIntegrationLog.create({
            data: {
              source: 'API',
              severity: 'INFO',
              eventType: 'api.called',
              succeeded: true,
              message: 'x',
            },
          }),
        ),
      ),
    ).toMatch(/row-level security/);
  });
});

describe('integrations: platform connections', () => {
  it("a draft is activated only after a passing test, or with the admin's confirmation", async () => {
    expect(await outcome(integration({ status: 'ACTIVE' }))).toMatch(/starts as a draft/);
    const i = await integration();
    expect(i).toMatchObject({ status: 'DRAFT', version: 1, createdByUserId: ids.member });
    expect(await outcome(setIntegration(i.id, { status: 'ACTIVE' }, asMember))).toMatch(
      /after a passing connection test/,
    );
    await asPlatform((tx) =>
      tx.platformIntegration.update({
        where: { id: i.id },
        data: { lastCheckAt: new Date(), lastCheckOk: true },
      }),
    );
    const live = await setIntegration(i.id, { status: 'ACTIVE' }, asMember);
    expect(live.activatedAt).not.toBeNull();
    expect(await outcome(setIntegration(i.id, { status: 'DRAFT' }, asMember))).toMatch(
      /never goes back to draft/,
    );
    // Health moves it; only a SUPER_ADMIN disables or removes it.
    await asPlatform((tx) =>
      tx.platformIntegration.update({
        where: { id: i.id },
        data: { status: 'NEEDS_ATTENTION', statusReason: 'credential_expiring' },
      }),
    );
    expect(await outcome(setIntegration(i.id, { status: 'DISABLED' }, asMember))).toMatch(
      /only a SUPER_ADMIN/,
    );
    const off = await setIntegration(i.id, { status: 'DISABLED' });
    expect(off.disabledAt).not.toBeNull();
    const gone = await setIntegration(i.id, { status: 'REMOVED' });
    expect(gone.removedAt).not.toBeNull();
    expect(await outcome(setIntegration(i.id, { name: 'Back' }))).toMatch(
      /removed integration never changes/,
    );
    const noTest = await integration();
    await expect(
      setIntegration(noTest.id, { status: 'ACTIVE', activatedWithoutTest: true }, asMember),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
  });

  it('credentials are a reference, set by a SUPER_ADMIN; one live connection per provider and environment', async () => {
    const provider = `p_${randomUUID().slice(0, 8)}`;
    expect(await outcome(integration({ provider, secretRef: 'local:provider-key' }))).toMatch(
      /only a SUPER_ADMIN sets credentials/,
    );
    expect(
      await outcome(integration({ provider, secretRef: 'AKIA-and-a-plain-key' }, asAdmin)),
    ).toMatch(/platform_integrations_values/);
    const i = await integration({ provider, secretRef: 'local:provider-key' }, asAdmin);
    expect(i.secretRotatedAt).not.toBeNull();
    expect(await outcome(integration({ provider }))).toMatch(/already has a TEST connection/);
    await expect(integration({ provider, environment: 'LIVE' })).resolves.toMatchObject({
      environment: 'LIVE',
    });
    const changed = await setIntegration(i.id, { description: 'Edited' }, asMember);
    expect(changed.version).toBe(2);
    expect(await outcome(setIntegration(i.id, { secretRef: 'local:other-key' }, asMember))).toMatch(
      /only a SUPER_ADMIN sets credentials/,
    );
  });

  it('runs are moved only by the worker; the log is insert-only', async () => {
    const i = await integration();
    const r = await asMember((tx) =>
      tx.platformIntegrationRun.create({ data: { integrationId: i.id, kind: 'SYNC' } }),
    );
    expect(r.requestedByUserId).toBe(ids.member);
    expect(
      await outcome(
        asMember((tx) =>
          tx.platformIntegrationRun.update({ where: { id: r.id }, data: { status: 'RUNNING' } }),
        ),
      ),
    ).toMatch(/only the worker moves a run/);
    await asPlatform((tx) =>
      tx.platformIntegrationRun.update({ where: { id: r.id }, data: { status: 'RUNNING' } }),
    );
    expect(
      await outcome(
        asPlatform((tx) =>
          tx.platformIntegrationRun.update({ where: { id: r.id }, data: { status: 'FAILED' } }),
        ),
      ),
    ).toMatch(/platform_integration_runs_values/);
    await asPlatform((tx) =>
      tx.platformIntegrationRun.update({
        where: { id: r.id },
        data: { status: 'FAILED', errorCode: 'provider.timeout' },
      }),
    );
    expect(
      await outcome(
        asPlatform((tx) =>
          tx.platformIntegrationRun.update({ where: { id: r.id }, data: { retries: 1 } }),
        ),
      ),
    ).toMatch(/finished run never changes/);
    const log = await asMember((tx) =>
      tx.platformIntegrationLog.create({
        data: {
          source: 'FIRM_CONNECTION',
          provider: 'quickbooks_online',
          subjectBusinessId: ids.firm,
          severity: 'ERROR',
          eventType: 'sync.failed',
          succeeded: false,
          errorCode: 'auth.expired',
          message: 'Authorization expired.',
        },
      }),
    );
    expect(log.actorUserId).toBe(ids.member);
    expect(
      await outcome(
        asMember((tx) =>
          tx.platformIntegrationLog.create({
            data: {
              source: 'FIRM_CONNECTION',
              severity: 'INFO',
              eventType: 'sync.done',
              succeeded: true,
              message: 'x',
            },
          }),
        ),
      ),
    ).toMatch(/platform_integration_logs_values/);
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformIntegrationLog.updateMany({ where: { id: log.id }, data: { message: 'y' } }),
        ),
      ),
    ).toMatch(/permission denied/i);
  });
});

describe('integrations: the catalog', () => {
  it('keeps its provider key, versions every save, and takes plan and firm rules', async () => {
    const plan = await asAdmin((tx) => tx.platformPlan.findFirst({}));
    const entry = await asMember((tx) =>
      tx.platformIntegrationCatalog.create({
        data: {
          provider: `c_${randomUUID().slice(0, 8)}`,
          name: 'Calendar',
          category: 'COMMUNICATION',
          shortDescription: 'Sync appointments.',
          planAccess: 'SELECTED_PLANS',
          ...(plan ? { plans: { create: [{ planId: plan.id }] } } : {}),
          firmRules: {
            create: [{ businessId: ids.firm, access: 'DENY', reason: 'Pilot excluded.' }],
          },
        },
      }),
    );
    expect(entry).toMatchObject({ status: 'DISABLED', version: 1 });
    const saved = await asMember((tx) =>
      tx.platformIntegrationCatalog.update({
        where: { id: entry.id },
        data: { status: 'COMING_SOON' },
      }),
    );
    expect(saved.version).toBe(2);
    expect(
      await outcome(
        asMember((tx) =>
          tx.platformIntegrationCatalog.update({
            where: { id: entry.id },
            data: { provider: 'other' },
          }),
        ),
      ),
    ).toMatch(/keeps its provider/);
    expect(
      await outcome(
        asMember((tx) =>
          tx.platformIntegrationCatalog.update({
            where: { id: entry.id },
            data: { logoS3Key: `platform/integrations/${randomUUID()}/logo.png` },
          }),
        ),
      ),
    ).toMatch(/platform_integration_catalog_values/);
  });
});

describe('integrations: API keys and webhooks', () => {
  const key = (extra: Record<string, unknown> = {}, as = asAdmin) =>
    as((tx) =>
      tx.platformApiKey.create({
        data: {
          name: 'Export',
          prefix: `fv_test_${randomUUID().slice(0, 6).replace(/-/g, 'a')}`,
          lastFour: 'ab12',
          keyHash: createHash('sha256').update(randomUUID()).digest('hex'),
          environment: 'TEST',
          ...extra,
        },
      }),
    );

  it('issued by a SUPER_ADMIN, hash only, never changed, revoked once; a rotation replaces a live key', async () => {
    expect(await outcome(key({}, asMember))).toMatch(/row-level security/);
    expect(await outcome(key({ prefix: 'fv_live_abcd' }))).toMatch(/platform_api_keys_values/);
    const k = await key();
    expect(k.createdByUserId).toBe(ids.ceo);
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformApiKey.update({ where: { id: k.id }, data: { scopes: ['all'] } }),
        ),
      ),
    ).toMatch(/never changes; rotate it instead/);
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformApiKey.update({ where: { id: k.id }, data: { lastUsedAt: new Date() } }),
        ),
      ),
    ).toMatch(/only the platform records/);
    await asPlatform((tx) =>
      tx.platformApiKey.update({ where: { id: k.id }, data: { lastUsedAt: new Date() } }),
    );
    const next = await key({ rotatedFromId: k.id });
    const revoked = await asAdmin((tx) =>
      tx.platformApiKey.update({
        where: { id: k.id },
        data: { revokedAt: new Date('2020-01-01') },
      }),
    );
    expect(revoked).toMatchObject({ revokedByUserId: ids.ceo });
    expect(revoked.revokedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(await outcome(key({ rotatedFromId: k.id }))).toMatch(
      /Unique constraint|replaces a live key/,
    );
    expect(next.rotatedFromId).toBe(k.id);
  });

  it("signing secrets are a SUPER_ADMIN's; the platform writes a delivery's result once; a redelivery is a later attempt", async () => {
    const endpoint = (extra: Record<string, unknown>, as = asMember) =>
      as((tx) =>
        tx.platformWebhookEndpoint.create({
          data: {
            direction: 'OUTBOUND',
            url: 'https://hooks.example.test/in',
            events: ['firm.activated'],
            ...extra,
          },
        }),
      );
    expect(await outcome(endpoint({ signingSecretRef: 'local:hook-secret' }))).toMatch(
      /only a SUPER_ADMIN sets a signing secret/,
    );
    expect(await outcome(endpoint({ url: 'http://insecure.example.test/' }))).toMatch(
      /platform_webhook_endpoints_values/,
    );
    const e = await endpoint({ signingSecretRef: 'local:hook-secret' }, asAdmin);
    expect(e.secretRotatedAt).not.toBeNull();
    const d = await asPlatform((tx) =>
      tx.platformWebhookDelivery.create({
        data: { endpointId: e.id, eventType: 'firm.activated', eventId: 'evt_1' },
      }),
    );
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformWebhookDelivery.update({ where: { id: d.id }, data: { status: 'SUCCEEDED' } }),
        ),
      ),
    ).toMatch(/only the platform writes/);
    await asPlatform((tx) =>
      tx.platformWebhookDelivery.update({
        where: { id: d.id },
        data: { status: 'FAILED', responseStatusCode: 503 },
      }),
    );
    expect(
      await outcome(
        asPlatform((tx) =>
          tx.platformWebhookDelivery.update({ where: { id: d.id }, data: { status: 'SUCCEEDED' } }),
        ),
      ),
    ).toMatch(/only the platform writes a delivery's result, once/);
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformWebhookDelivery.create({
            data: {
              endpointId: e.id,
              eventType: 'firm.activated',
              eventId: 'evt_2',
              attempt: 2,
              redeliveryOfId: d.id,
            },
          }),
        ),
      ),
    ).toMatch(/later attempt of the same event/);
    const again = await asAdmin((tx) =>
      tx.platformWebhookDelivery.create({
        data: {
          endpointId: e.id,
          eventType: 'firm.activated',
          eventId: 'evt_1',
          attempt: 2,
          redeliveryOfId: d.id,
        },
      }),
    );
    expect(again.requestedByUserId).toBe(ids.ceo);
  });

  it('only the platform writes the usage rollup', async () => {
    const day = new Date('2026-10-01');
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.platformIntegrationUsageDaily.create({
            data: { day, scope: 'API', subjectKey: `k_${run}`, requests: 5 },
          }),
        ),
      ),
    ).toMatch(/row-level security/);
    await asPlatform((tx) =>
      tx.platformIntegrationUsageDaily.create({
        data: { day, scope: 'API', subjectKey: `k_${run}`, requests: 5, successes: 5 },
      }),
    );
    expect(
      await asMember((tx) =>
        tx.platformIntegrationUsageDaily.count({ where: { subjectKey: `k_${run}` } }),
      ),
    ).toBe(1);
  });
});
