import { randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  IntegrationConnectionDetail,
  IntegrationConnectionSummary,
  IntegrationEnvironment,
  IntegrationMappings,
  IntegrationProvider,
  IntegrationRequestRow,
  IntegrationSyncRun,
  IntegrationTestResult,
} from '@firmivra/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { type PoolSecrets, Sealer } from '../auth/sealed.js';
import type { TenantContext } from '../common/request-context.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { isUniqueViolation, memberNames, notFound } from '../workspaces/common.js';
import {
  type ConnectionRow,
  integrationErrors,
  reasonInfo,
  requireManage,
  toRun,
  toSummary,
} from './integrations.common.js';
import type {
  ConnectBody,
  CreateRequestBody,
  MappingsBody,
  ReconnectBody,
  SettingsBody,
  SyncBody,
} from './integrations-input.js';
import { IntegrationsReadService } from './integrations-read.service.js';
import {
  AdapterError,
  type AdapterCheck,
  type AdapterConnection,
  type AdapterGrant,
  type ProviderAdapter,
} from './provider-adapter.js';
import { ProviderRegistry } from './provider-registry.js';
import { SECRET_STORE, type SecretStore, secretRefOf } from './secret-store.js';

type Connect = z.output<typeof ConnectBody>;
type Reconnect = z.output<typeof ReconnectBody>;
type Settings = z.output<typeof SettingsBody>;
type Sync = z.output<typeof SyncBody>;
type Mappings = z.output<typeof MappingsBody>;
type NewRequest = z.output<typeof CreateRequestBody>;

/** The state of an authorization in progress: sealed, bound to the user and the browser that began it. */
const StateClaim = z.object({
  pool: z.literal('STAFF'),
  businessId: z.uuid(),
  userId: z.uuid(),
  provider: z.string(),
  environment: z.enum(['LIVE', 'TEST']),
  /** The firm's chosen settings, kept until the callback so a failed authorization loses nothing. */
  settings: z.record(z.string(), z.unknown()),
  testAfterConnect: z.boolean(),
  /** Reconnecting this connection (null: a new one). */
  connectionId: z.uuid().nullable(),
  /** Also in a cookie the connect response set: the callback needs both to match. */
  nonce: z.string(),
});
export type StateClaim = z.infer<typeof StateClaim>;
export const INTEGRATION_STATE_LABEL = 'fv-integration-oauth-v1';
export const INTEGRATION_STATE_SECONDS = 600;
export const STATE_COOKIE = 'fv_int_state';

export class IntegrationStateTokens extends Sealer<StateClaim> {
  constructor(secrets: PoolSecrets) {
    super(INTEGRATION_STATE_LABEL, StateClaim as never, secrets);
  }
}

/** A connect answer, with the cookie nonce the controller sets (and strips from the body). */
export type ConnectOutcome =
  | { mode: 'REDIRECT'; url: string; nonce: string }
  | { mode: 'CONNECTED'; connection: IntegrationConnectionSummary };

const ENTITY = 'integration_connection';

const nextSyncOf = (mode: 'AUTO' | 'MANUAL', minutes: number | null, from = new Date()) =>
  mode === 'AUTO' && minutes ? new Date(from.getTime() + minutes * 60_000) : null;

/** The permission keys of a provider, for the enabled objects: what the screen asks the provider for. */
const scopesFor = (provider: IntegrationProvider, entities: string[]) =>
  provider.permissions
    .filter((p) => p.entity === null || entities.includes(p.entity))
    .map((p) => p.key);

/**
 * Writes of the Integrations module: connect and reconnect (the provider's own authorization, or
 * write-only credentials), settings, sync now, pause, resume, test, disconnect, mappings and
 * requests. Provider logic is in the adapters; this service is the lifecycle. No secret is ever
 * returned or logged: a grant goes to the secret store and only `secret_ref` is kept. Everything is
 * the firm's own, audited with ids, provider codes and field names.
 */
@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
    private readonly registry: ProviderRegistry,
    private readonly reader: IntegrationsReadService,
    private readonly audit: AuditService,
    private readonly states: IntegrationStateTokens,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  private redirectUri() {
    return `${this.env.APP_BASE_URL.replace(/\/+$/, '')}/api/v1/integrations/callback`;
  }

  // ---------- Connect ----------

  async connect(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    key: string,
    body: Connect,
  ): Promise<ConnectOutcome> {
    requireManage(tenant);
    const provider = this.registry.get(key);
    if (!provider) throw notFound();
    const adapter = this.registry.adapter(key);
    if (provider.comingSoon && !adapter) throw integrationErrors.comingSoon(provider.name);
    if (!provider.environments.includes(body.environment)) {
      throw integrationErrors.notSupported(
        `${provider.name} has no ${body.environment === 'TEST' ? 'test' : 'live'} mode`,
      );
    }
    const settings = this.checkSettings(provider, body.settings ?? {});
    const existing = await this.inFirm(businessId, (tx) =>
      tx.integrationConnection.findUnique({
        where: {
          businessId_provider_environment: {
            businessId,
            provider: key,
            environment: body.environment,
          },
        },
        select: { id: true, status: true },
      }),
    );
    if (existing && existing.status !== 'DISCONNECTED')
      throw integrationErrors.alreadyConnected(provider.name);
    return this.begin(businessId, userId, provider, adapter, {
      environment: body.environment,
      settings,
      credentials: body.credentials,
      testAfterConnect: body.testAfterConnect,
      connectionId: existing?.id ?? null,
    });
  }

  async reconnect(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Reconnect,
  ): Promise<ConnectOutcome> {
    requireManage(tenant);
    const c = await this.inFirm(businessId, (tx) =>
      tx.integrationConnection.findFirst({ where: { businessId, id } }),
    );
    const provider = c ? this.registry.get(c.provider) : undefined;
    if (!c || !provider) throw notFound();
    const adapter = this.registry.adapter(c.provider);
    if (provider.comingSoon && !adapter) throw integrationErrors.comingSoon(provider.name);
    const settings = this.storedSettings(
      c.settings,
      c.entities,
      c.direction,
      c.syncMode,
      c.syncEveryMinutes,
    );
    return this.begin(businessId, userId, provider, adapter, {
      environment: c.environment,
      settings,
      credentials: body.credentials,
      testAfterConnect: true,
      connectionId: c.id,
    });
  }

  /** The settings a connection holds, in the shape connect takes (so a reconnect keeps them). */
  private storedSettings(
    raw: unknown,
    entities: string[],
    direction: string,
    syncMode: string,
    syncEveryMinutes: number | null,
  ): Record<string, unknown> {
    const options = (raw as { options?: unknown } | null)?.options;
    return { entities, direction, syncMode, syncEveryMinutes, ...(options ? { options } : {}) };
  }

  private async begin(
    businessId: string,
    userId: string,
    provider: IntegrationProvider,
    adapter: ProviderAdapter | undefined,
    input: {
      environment: IntegrationEnvironment;
      settings: Record<string, unknown>;
      credentials: Record<string, string> | undefined;
      testAfterConnect: boolean;
      connectionId: string | null;
    },
  ): Promise<ConnectOutcome> {
    const resolved = this.resolveSettings(provider, input.settings);
    if (provider.authMethod === 'NONE') {
      const connection = await this.save(
        businessId,
        userId,
        provider,
        input.environment,
        resolved,
        null,
        input.connectionId,
        input.testAfterConnect,
      );
      return { mode: 'CONNECTED', connection };
    }
    if (!adapter) throw integrationErrors.comingSoon(provider.name);
    if (provider.authMethod === 'API_KEY') {
      const credentials = input.credentials ?? {};
      const missing = provider.credentialFields.filter((f) => !credentials[f.key]);
      if (missing.length > 0 || !adapter.verifyCredentials) {
        throw integrationErrors.invalid(
          'credentials',
          missing.length
            ? `Enter ${missing.map((m) => m.label).join(', ')}`
            : 'This provider does not take credentials',
        );
      }
      const unknown = Object.keys(credentials).filter(
        (k) => !provider.credentialFields.some((f) => f.key === k),
      );
      if (unknown.length > 0)
        throw integrationErrors.invalid('credentials', 'Unknown credential field');
      const grant = await this.verify(adapter, credentials, input.environment);
      const connection = await this.save(
        businessId,
        userId,
        provider,
        input.environment,
        resolved,
        grant,
        input.connectionId,
        input.testAfterConnect,
      );
      return { mode: 'CONNECTED', connection };
    }
    // OAUTH2 and PROVIDER_LINK: the provider's own page; no password is ever collected here.
    if (!adapter.authorizeUrl) throw integrationErrors.comingSoon(provider.name);
    const nonce = randomBytes(24).toString('base64url');
    const state = await this.states.seal(
      {
        pool: 'STAFF',
        businessId,
        userId,
        provider: provider.provider,
        environment: input.environment,
        settings: input.settings,
        testAfterConnect: input.testAfterConnect,
        connectionId: input.connectionId,
        nonce,
      },
      INTEGRATION_STATE_SECONDS,
    );
    const url = adapter.authorizeUrl({
      redirectUri: this.redirectUri(),
      state,
      environment: input.environment,
      scopes: scopesFor(provider, resolved.entities),
    });
    return { mode: 'REDIRECT', url, nonce };
  }

  /** The provider refused or failed: a short, safe answer (credentials rejected, or unavailable). */
  private async verify(
    adapter: ProviderAdapter,
    credentials: Record<string, string>,
    environment: IntegrationEnvironment,
  ): Promise<AdapterGrant> {
    try {
      return await adapter.verifyCredentials!(credentials, environment);
    } catch (error) {
      if (error instanceof AdapterError && error.code === 'credentials_rejected') {
        throw integrationErrors.credentialsRejected();
      }
      this.logger.warn(`Provider ${adapter.provider}: credential check failed`);
      throw integrationErrors.providerUnavailable();
    }
  }

  /**
   * The callback's work: the state was opened and matched to the browser by the controller; the
   * code is exchanged for a grant and the connection saved. Returns the provider code for the
   * redirect back to the screen.
   */
  async complete(
    claim: StateClaim,
    code: string,
  ): Promise<{ provider: string; connectionId: string }> {
    const provider = this.registry.get(claim.provider);
    const adapter = this.registry.adapter(claim.provider);
    if (!provider || !adapter?.exchange) throw integrationErrors.authorizationFailed();
    let grant: AdapterGrant;
    try {
      grant = await adapter.exchange({
        code,
        redirectUri: this.redirectUri(),
        environment: claim.environment,
      });
    } catch {
      throw integrationErrors.authorizationFailed();
    }
    const settings = this.resolveSettings(provider, claim.settings);
    const connection = await this.save(
      claim.businessId,
      claim.userId,
      provider,
      claim.environment,
      settings,
      grant,
      claim.connectionId,
      claim.testAfterConnect,
    );
    return { provider: provider.provider, connectionId: connection.id };
  }

  /** Creates or updates (a reconnect, or a DISCONNECTED row coming back) the connection with its grant. */
  private async save(
    businessId: string,
    userId: string,
    provider: IntegrationProvider,
    environment: IntegrationEnvironment,
    s: ReturnType<IntegrationsService['resolveSettings']>,
    grant: AdapterGrant | null,
    connectionId: string | null,
    testAfterConnect: boolean,
  ): Promise<IntegrationConnectionSummary> {
    const id = connectionId ?? randomUUID();
    const ref = grant ? secretRefOf(businessId, id) : null;
    if (grant && ref) await this.secrets.put(ref, grant.secret);
    let row;
    try {
      row = await this.inFirm(businessId, async (tx) => {
        const data = {
          status: 'CONNECTED' as const,
          statusReason: null,
          accountLabel: grant?.accountLabel ?? null,
          accountIdLast4: grant?.accountId ? grant.accountId.slice(-4) : null,
          ...(ref ? { secretRef: ref, secretRotatedAt: new Date() } : {}),
          settings: {
            options: s.options,
            ...(grant?.grantedPermissions ? { granted: grant.grantedPermissions } : {}),
          } as Prisma.InputJsonObject,
          entities: s.entities,
          direction: s.direction,
          syncMode: s.syncMode,
          syncEveryMinutes: s.syncEveryMinutes,
          connectedAt: new Date(),
          connectedByUserId: userId,
          disconnectedAt: null,
          nextSyncAt: nextSyncOf(s.syncMode, s.syncEveryMinutes),
        };
        const saved = connectionId
          ? await tx.integrationConnection.update({ where: { id }, data })
          : await tx.integrationConnection.create({
              data: { id, businessId, provider: provider.provider, environment, ...data },
            });
        await this.audit.logIn(
          tx,
          connectionId ? 'integration.reconnected' : 'integration.connected',
          { type: ENTITY, id },
          { provider: provider.provider, environment },
          { businessId, actorUserId: userId },
        );
        return saved;
      });
    } catch (error) {
      if (ref) await this.secrets.remove(ref).catch(() => undefined);
      if (isUniqueViolation(error)) throw integrationErrors.alreadyConnected(provider.name);
      throw error;
    }
    if (testAfterConnect) {
      await this.runTest(businessId, userId, id).catch(() => undefined);
    }
    return (
      toSummary(
        (await this.inFirm(businessId, (tx) =>
          tx.integrationConnection.findFirstOrThrow({ where: { businessId, id } }),
        )) as ConnectionRow,
      ) ?? toSummary(row as ConnectionRow)
    );
  }

  // ---------- Settings ----------

  /**
   * The firm's choices checked against the provider's catalog: objects it has, a direction it and
   * every enabled object support, a frequency it offers (AUTO only), options it defines with values
   * of the right kind. Anything else is 409 INVALID_CONFIGURATION or NOT_SUPPORTED.
   */
  checkSettings(
    provider: IntegrationProvider,
    input: Record<string, unknown>,
  ): Record<string, unknown> {
    const entities = input.entities as string[] | undefined;
    if (entities) {
      const unknown = entities.filter((e) => !provider.entities.some((x) => x.key === e));
      if (unknown.length > 0)
        throw integrationErrors.invalidConfiguration(
          `${provider.name} has no “${unknown[0]}” data`,
        );
    }
    const direction = input.direction as IntegrationSyncRunDirection | undefined;
    const enabled = provider.entities.filter((e) =>
      (entities ?? provider.entities.filter((x) => x.defaultEnabled).map((x) => x.key)).includes(
        e.key,
      ),
    );
    if (direction) {
      if (!provider.directions.includes(direction)) {
        throw integrationErrors.notSupported(
          `${provider.name} does not support ${direction === 'TWO_WAY' ? 'two-way' : direction.toLowerCase()} sync`,
        );
      }
      const bad = enabled.find((e) => !e.directions.includes(direction));
      if (bad)
        throw integrationErrors.notSupported(
          `${bad.label} does not support ${direction === 'TWO_WAY' ? 'two-way' : direction.toLowerCase()} sync`,
        );
    }
    const minutes = input.syncEveryMinutes as number | null | undefined;
    if (minutes != null && !provider.frequencies.includes(minutes)) {
      throw integrationErrors.notSupported(
        `${provider.name} syncs every ${provider.frequencies.join(', ')} minutes`,
      );
    }
    if (minutes != null && input.syncMode === 'MANUAL') {
      throw integrationErrors.invalidConfiguration('A manual sync has no frequency');
    }
    const options = input.options as Record<string, unknown> | undefined;
    if (options) {
      for (const [k, v] of Object.entries(options)) {
        const def = provider.options.find((o) => o.key === k);
        if (!def) throw integrationErrors.invalidConfiguration(`Unknown option “${k}”`);
        const kindOk =
          def.type === 'TOGGLE'
            ? typeof v === 'boolean'
            : def.type === 'MULTI_SELECT'
              ? Array.isArray(v)
              : typeof v === 'string';
        if (!kindOk)
          throw integrationErrors.invalidConfiguration(
            `“${def.label}” has the wrong kind of value`,
          );
        if (def.choices.length > 0) {
          const values = Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : [];
          if (values.some((x) => !def.choices.some((c) => c.value === x))) {
            throw integrationErrors.invalidConfiguration(
              `“${def.label}” has a choice that is not offered`,
            );
          }
        }
      }
    }
    return input;
  }

  /** Defaults filled in for a connect: the provider's default objects, direction, frequency and options. */
  resolveSettings(provider: IntegrationProvider, input: Record<string, unknown>) {
    const entities =
      (input.entities as string[] | undefined) ??
      provider.entities.filter((e) => e.defaultEnabled).map((e) => e.key);
    const syncMode = (input.syncMode as 'AUTO' | 'MANUAL' | undefined) ?? 'AUTO';
    const direction =
      (input.direction as IntegrationSyncRunDirection | undefined) ??
      (provider.directions.includes('TWO_WAY') ? 'TWO_WAY' : provider.directions[0]!);
    const minutes =
      syncMode === 'MANUAL'
        ? null
        : ((input.syncEveryMinutes as number | null | undefined) ??
          provider.frequencies[Math.min(2, provider.frequencies.length - 1)] ??
          null);
    const options: Record<string, unknown> = {};
    for (const o of provider.options) {
      if (o.defaultValue !== null && !o.afterConnect) options[o.key] = o.defaultValue;
    }
    Object.assign(options, input.options ?? {});
    return { entities, syncMode, direction, syncEveryMinutes: minutes, options };
  }

  async updateSettings(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Settings,
  ): Promise<IntegrationConnectionDetail> {
    requireManage(tenant);
    await this.inFirm(businessId, async (tx) => {
      const c = await tx.integrationConnection.findFirst({ where: { businessId, id } });
      const provider = c ? this.registry.get(c.provider) : undefined;
      if (!c || !provider) throw notFound();
      if (c.status === 'DISCONNECTED') throw integrationErrors.notConnected();
      const merged = {
        entities: body.entities ?? c.entities,
        direction: body.direction ?? c.direction,
        syncMode: body.syncMode ?? c.syncMode,
        syncEveryMinutes:
          body.syncEveryMinutes === undefined ? c.syncEveryMinutes : body.syncEveryMinutes,
        options: {
          ...((c.settings as { options?: Record<string, unknown> } | null)?.options ?? {}),
          ...(body.options ?? {}),
        },
      };
      if (body.syncMode === 'MANUAL' && body.syncEveryMinutes != null) {
        throw integrationErrors.invalidConfiguration('A manual sync has no frequency');
      }
      if (merged.syncMode === 'MANUAL') merged.syncEveryMinutes = null;
      else if (merged.syncEveryMinutes === null)
        merged.syncEveryMinutes =
          provider.frequencies[Math.min(2, provider.frequencies.length - 1)] ?? null;
      this.checkSettings(provider, merged);
      const previous = (c.settings ?? {}) as Record<string, unknown>;
      await tx.integrationConnection.update({
        where: { id },
        data: {
          entities: merged.entities,
          direction: merged.direction,
          syncMode: merged.syncMode,
          syncEveryMinutes: merged.syncEveryMinutes,
          settings: { ...previous, options: merged.options } as Prisma.InputJsonObject,
          nextSyncAt:
            c.status === 'PAUSED' ? null : nextSyncOf(merged.syncMode, merged.syncEveryMinutes),
        },
      });
      await this.audit.logIn(
        tx,
        'integration.settings_changed',
        { type: ENTITY, id },
        { provider: c.provider, fields: Object.keys(body) },
        { businessId, actorUserId: userId },
      );
    });
    return this.reader.connection(businessId, tenant, id);
  }

  // ---------- Sync, pause, resume ----------

  async syncNow(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Sync,
  ): Promise<IntegrationSyncRun> {
    requireManage(tenant);
    const { run, provider, entities } = await this.inFirm(businessId, async (tx) => {
      // The connection row is the lock: two Sync Now clicks queue one run set.
      await tx.$queryRaw`SELECT id FROM integration_connections WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const c = await tx.integrationConnection.findFirst({ where: { businessId, id } });
      const provider = c ? this.registry.get(c.provider) : undefined;
      if (!c || !provider) throw notFound();
      if (c.status === 'DISCONNECTED' || c.status === 'NEEDS_ATTENTION')
        throw integrationErrors.notConnected();
      if (!this.registry.adapter(c.provider)?.sync)
        throw integrationErrors.notSupported(`${provider.name} has nothing to sync`);
      const busy = await tx.integrationSyncRun.count({
        where: { businessId, connectionId: id, status: { in: ['QUEUED', 'RUNNING'] } },
      });
      if (busy > 0) throw integrationErrors.syncInProgress();
      const entities = body.entities ?? c.entities;
      const unknown = entities.filter((e) => !c.entities.includes(e));
      if (unknown.length > 0)
        throw integrationErrors.invalidConfiguration(
          `“${unknown[0]}” is not switched on for this connection`,
        );
      if (entities.length === 0)
        throw integrationErrors.invalidConfiguration('Switch on at least one data type to sync');
      const created: { id: string; entity: string }[] = [];
      for (const entity of entities) {
        const r = await tx.integrationSyncRun.create({
          data: { businessId, connectionId: id, entity, manual: true, requestedByUserId: userId },
          select: { id: true, entity: true },
        });
        created.push(r);
      }
      await this.audit.logIn(
        tx,
        'integration.sync_requested',
        { type: ENTITY, id },
        { provider: c.provider, entities },
        { businessId, actorUserId: userId },
      );
      const first = await tx.integrationSyncRun.findFirstOrThrow({ where: { id: created[0]!.id } });
      return { run: first, provider, entities: created };
    });
    // Runs in the background: the browser need not stay open.
    void this.execute(businessId, id, entities).catch((error: unknown) => {
      this.logger.error(`Sync of ${id} failed to run: ${(error as Error).name}`);
    });
    const names = await this.inFirm(businessId, (tx) => memberNames(tx, businessId, [userId]));
    return toRun(run, provider, names);
  }

  /** Runs the queued entities one after another through the adapter; counts and errors go on the runs. */
  async execute(
    businessId: string,
    id: string,
    runs: { id: string; entity: string }[],
  ): Promise<void> {
    const c = await this.inFirm(businessId, (tx) =>
      tx.integrationConnection.findFirst({ where: { businessId, id } }),
    );
    if (!c) return;
    const adapter = this.registry.adapter(c.provider);
    const secret = c.secretRef ? await this.secrets.get(c.secretRef) : null;
    const connection = this.adapterConnection(c);
    await this.inFirm(businessId, (tx) =>
      tx.integrationConnection.update({
        where: { id },
        data: { status: c.status === 'PAUSED' ? 'PAUSED' : 'SYNCING' },
      }),
    );
    let failedWith: AdapterError | null = null;
    let anyFailed = false;
    for (const r of runs) {
      await this.inFirm(businessId, (tx) =>
        tx.integrationSyncRun.update({
          where: { id: r.id },
          data: { status: 'RUNNING', startedAt: new Date() },
        }),
      );
      try {
        const out = await adapter!.sync!({ secret, connection, entity: r.entity });
        await this.inFirm(businessId, (tx) =>
          tx.integrationSyncRun.update({
            where: { id: r.id },
            data: {
              status: out.failed > 0 ? 'PARTIAL' : 'SUCCEEDED',
              recordCount: out.records,
              failedCount: out.failed,
              finishedAt: new Date(),
            },
          }),
        );
        if (out.failed > 0) anyFailed = true;
      } catch (error) {
        const code = error instanceof AdapterError ? error.code : 'sync_failed';
        if (error instanceof AdapterError) failedWith = error;
        anyFailed = true;
        await this.inFirm(businessId, (tx) =>
          tx.integrationSyncRun.update({
            where: { id: r.id },
            data: {
              status: 'FAILED',
              errorCode: code,
              errorMessage: reasonInfo(code)?.message ?? 'The sync failed',
              finishedAt: new Date(),
            },
          }),
        );
      }
    }
    await this.inFirm(businessId, async (tx) => {
      const now = new Date();
      const attention =
        failedWith &&
        ['authorization_expired', 'authorization_revoked', 'permission_missing'].includes(
          failedWith.code,
        );
      await tx.integrationConnection.update({
        where: { id },
        data: attention
          ? {
              status: 'NEEDS_ATTENTION',
              statusReason: failedWith!.code,
              lastSyncAt: now,
              nextSyncAt: null,
            }
          : {
              status: c.status === 'PAUSED' ? 'PAUSED' : 'CONNECTED',
              statusReason: null,
              lastSyncAt: anyFailed ? c.lastSyncAt : now,
              nextSyncAt:
                c.status === 'PAUSED' ? null : nextSyncOf(c.syncMode, c.syncEveryMinutes, now),
            },
      });
    });
  }

  private adapterConnection(c: {
    id: string;
    businessId: string;
    provider: string;
    environment: IntegrationEnvironment;
    settings: unknown;
    entities: string[];
  }): AdapterConnection {
    return {
      id: c.id,
      businessId: c.businessId,
      provider: c.provider,
      environment: c.environment,
      settings: ((c.settings as { options?: Record<string, unknown> } | null)?.options ??
        {}) as Record<string, unknown>,
      entities: c.entities,
    };
  }

  pause(businessId: string, tenant: TenantContext, userId: string, id: string) {
    return this.setPaused(businessId, tenant, userId, id, true);
  }
  resume(businessId: string, tenant: TenantContext, userId: string, id: string) {
    return this.setPaused(businessId, tenant, userId, id, false);
  }

  private async setPaused(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    pause: boolean,
  ): Promise<IntegrationConnectionSummary> {
    requireManage(tenant);
    const row = await this.inFirm(businessId, async (tx) => {
      const c = await tx.integrationConnection.findFirst({ where: { businessId, id } });
      if (!c) throw notFound();
      if (c.status === 'DISCONNECTED' || c.status === 'NEEDS_ATTENTION')
        throw integrationErrors.notConnected();
      if (pause && c.status === 'PAUSED') throw integrationErrors.alreadyPaused(true);
      if (!pause && c.status !== 'PAUSED') throw integrationErrors.alreadyPaused(false);
      const saved = await tx.integrationConnection.update({
        where: { id },
        data: pause
          ? { status: 'PAUSED', nextSyncAt: null }
          : { status: 'CONNECTED', nextSyncAt: nextSyncOf(c.syncMode, c.syncEveryMinutes) },
      });
      await this.audit.logIn(
        tx,
        pause ? 'integration.paused' : 'integration.resumed',
        { type: ENTITY, id },
        { provider: c.provider },
        { businessId, actorUserId: userId },
      );
      return saved;
    });
    return toSummary(row as ConnectionRow);
  }

  // ---------- Test ----------

  async test(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<IntegrationTestResult> {
    requireManage(tenant);
    return this.runTest(businessId, userId, id);
  }

  async runTest(
    businessId: string,
    userId: string | null,
    id: string,
  ): Promise<IntegrationTestResult> {
    const c = await this.inFirm(businessId, (tx) =>
      tx.integrationConnection.findFirst({ where: { businessId, id } }),
    );
    if (!c) throw notFound();
    if (c.status === 'DISCONNECTED') throw integrationErrors.notConnected();
    const adapter = this.registry.adapter(c.provider);
    const secret = c.secretRef ? await this.secrets.get(c.secretRef) : null;
    let checks: AdapterCheck[];
    try {
      checks = adapter
        ? await adapter.test(secret, this.adapterConnection(c))
        : [
            { key: 'AUTHENTICATION', ok: true },
            { key: 'API', ok: true },
            { key: 'DATA_SYNC', ok: true },
            { key: 'RECENT_ERRORS', ok: true },
            { key: 'PERMISSIONS', ok: true },
          ];
    } catch {
      checks = [{ key: 'API', ok: false, message: 'The provider could not be reached' }];
    }
    const ok = checks.every((x) => x.ok);
    const failedAuth = checks.find((x) => x.key === 'AUTHENTICATION' && !x.ok);
    const failedPerm = checks.find((x) => x.key === 'PERMISSIONS' && !x.ok);
    const failedApi = checks.find((x) => x.key === 'API' && !x.ok);
    const reason = failedAuth
      ? 'authorization_expired'
      : failedPerm
        ? 'permission_missing'
        : failedApi
          ? 'provider_outage'
          : null;
    const runId = await this.inFirm(businessId, async (tx) => {
      const now = new Date();
      const run = await tx.integrationSyncRun.create({
        data: {
          businessId,
          connectionId: id,
          entity: 'test',
          manual: true,
          requestedByUserId: userId,
          status: ok ? 'SUCCEEDED' : 'FAILED',
          errorCode: ok ? null : (reason ?? 'sync_failed'),
          errorMessage: ok ? null : 'The connection test found a problem',
          startedAt: now,
          finishedAt: now,
        },
        select: { id: true },
      });
      await tx.integrationConnection.update({
        where: { id },
        data: {
          lastCheckAt: now,
          ...(!ok && reason && c.status !== 'PAUSED'
            ? { status: 'NEEDS_ATTENTION', statusReason: reason }
            : {}),
          ...(ok && c.status === 'NEEDS_ATTENTION'
            ? { status: 'CONNECTED', statusReason: null }
            : {}),
        },
      });
      await this.audit.logIn(
        tx,
        'integration.tested',
        { type: ENTITY, id },
        { provider: c.provider, ok },
        { businessId, ...(userId ? { actorUserId: userId } : {}) },
      );
      return run.id;
    });
    const health = await this.reader.health(businessId, id);
    const labels = new Map(health.checks.map((h) => [h.key, h]));
    return {
      ok,
      summary: ok
        ? 'Connection is active and working properly.'
        : (checks.find((x) => !x.ok)?.message ?? 'This connection needs attention.'),
      checks: checks.map((x) => ({
        key: x.key,
        label: labels.get(x.key)?.label ?? x.key,
        ok: x.ok,
        message: x.ok ? null : (x.message ?? labels.get(x.key)?.message ?? null),
      })),
      suggestions: health.suggestions,
      checkedAt: new Date().toISOString(),
      runId,
    };
  }

  // ---------- Disconnect ----------

  async disconnect(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<IntegrationConnectionSummary> {
    requireManage(tenant);
    const c = await this.inFirm(businessId, (tx) =>
      tx.integrationConnection.findFirst({ where: { businessId, id } }),
    );
    if (!c) throw notFound();
    if (c.status === 'DISCONNECTED') return toSummary(c as ConnectionRow);
    const adapter = this.registry.adapter(c.provider);
    if (c.secretRef) {
      const secret = await this.secrets.get(c.secretRef).catch(() => null);
      // Best effort at the provider; the secret is removed either way.
      await adapter?.revoke?.(secret, this.adapterConnection(c)).catch(() => {
        this.logger.warn(`Provider ${c.provider}: revoke failed`);
      });
      await this.secrets.remove(c.secretRef);
    }
    const saved = await this.inFirm(businessId, async (tx) => {
      const row = await tx.integrationConnection.update({
        where: { id },
        data: {
          status: 'DISCONNECTED',
          statusReason: null,
          disconnectedAt: new Date(),
          secretRef: null,
          nextSyncAt: null,
        },
      });
      await this.audit.logIn(
        tx,
        'integration.disconnected',
        { type: ENTITY, id },
        { provider: c.provider },
        { businessId, actorUserId: userId },
      );
      return row;
    });
    return toSummary(saved as ConnectionRow);
  }

  // ---------- Mappings ----------

  async saveMappings(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Mappings,
  ): Promise<IntegrationMappings> {
    requireManage(tenant);
    return this.inFirm(businessId, async (tx) => {
      const c = await tx.integrationConnection.findFirst({ where: { businessId, id } });
      const provider = c ? this.registry.get(c.provider) : undefined;
      if (!c || !provider) throw notFound();
      if (c.status === 'DISCONNECTED') throw integrationErrors.notConnected();
      const scope = provider.mappingScopes.find((s) => s.scope === body.scope);
      if (!scope)
        throw integrationErrors.invalidConfiguration(
          `${provider.name} has no “${body.scope}” fields to map`,
        );
      for (const [i, p] of body.pairs.entries()) {
        if (
          !scope.localFields.some((f) => f.key === p.localField) ||
          !scope.externalFields.some((f) => f.key === p.externalField)
        ) {
          throw integrationErrors.invalidConfiguration(
            `Pair ${i + 1} names a field that is not in the list`,
          );
        }
        if (!provider.directions.includes(p.direction)) {
          throw integrationErrors.notSupported(
            `${provider.name} does not support ${p.direction.toLowerCase()} mapping`,
          );
        }
      }
      await tx.integrationFieldMapping.deleteMany({
        where: { businessId, connectionId: id, scope: body.scope },
      });
      if (body.pairs.length > 0) {
        await tx.integrationFieldMapping.createMany({
          data: body.pairs.map((p, i) => ({
            businessId,
            connectionId: id,
            scope: body.scope,
            localField: p.localField,
            externalField: p.externalField,
            direction: p.direction,
            sortOrder: i,
          })),
        });
      }
      await this.audit.logIn(
        tx,
        'integration.mappings_changed',
        { type: ENTITY, id },
        { provider: c.provider, scope: body.scope, pairs: body.pairs.length },
        { businessId, actorUserId: userId },
      );
      return this.reader.mappingsIn(tx, businessId, id);
    });
  }

  // ---------- Requests ----------

  async createRequest(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    body: NewRequest,
  ): Promise<IntegrationRequestRow> {
    requireManage(tenant);
    const row = await this.inFirm(businessId, async (tx) => {
      const created = await tx.integrationRequest.create({
        data: {
          businessId,
          requestedByUserId: userId,
          providerName: body.providerName,
          websiteUrl: body.websiteUrl ?? null,
          category: body.category ?? null,
          connectTo: body.connectTo,
          businessReason: body.businessReason ?? null,
        },
      });
      await this.audit.logIn(
        tx,
        'integration_request.created',
        { type: 'integration_request', id: created.id },
        { category: body.category ?? null },
        { businessId, actorUserId: userId },
      );
      const names = await memberNames(tx, businessId, [userId]);
      return { created, names };
    });
    return this.reader.requestRow(row.created, row.names);
  }
}

type IntegrationSyncRunDirection = 'IMPORT' | 'EXPORT' | 'TWO_WAY';
