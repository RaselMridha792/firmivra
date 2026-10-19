import { Inject, Injectable, Logger } from '@nestjs/common';
import { databaseErrorCode, type Prisma, type TxClient } from '@firmivra/db';
import {
  type ActivateAdminPlatformRequest,
  type AdminConnectionTestResult,
  type AdminIntegrationAccess,
  type AdminIntegrationSummary,
  type AdminPlatformIntegration,
  type AdminPlatformIntegrationDetail,
  type AdminPlatformRun,
  type AdminProviderTemplate,
  type CreateAdminPlatformRequest,
  type DisableAdminPlatformRequest,
  type ListAdminPlatformQuery,
  type ListAdminPlatformResponse,
  type ListAdminPlatformRunsQuery,
  type ListAdminPlatformRunsResponse,
  PlatformIntegrationCategory,
  type PlatformIntegrationStatus,
  type PutAdminCredentialsRequest,
  type RemoveAdminPlatformRequest,
  type UpdateAdminPlatformRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { requestContext } from '../common/request-context.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import {
  PLATFORM_TIME_ZONE,
  startOfDayIn,
} from '../admin-notifications/admin-notifications.rules.js';
import { auditIn, logIn, newCorrelationId, requestIdOf } from './integration-records.js';
import { IntegrationRunWorker } from './integration-run-worker.js';
import {
  checkValue,
  cleanText,
  cleanUrl,
  configured,
  connectionComplete,
  customProviderKey,
  ENVIRONMENT_LABELS,
  failure,
  invalid,
  localConnectionTest,
  maskSecret,
  newSettings,
  optionalText,
  optionalUrl,
  readSettings,
  type StoredPlatformSettings,
  statusReasonOf,
} from './integrations.rules.js';
import { PLATFORM_SECRETS, type PlatformSecretStore } from './platform-secrets.js';
import { isTemplateKey, PROVIDERS, providerFor, providerTemplates } from './providers.js';

type Row = Prisma.PlatformIntegrationGetPayload<object>;
type Json = Prisma.InputJsonValue;

const DAY_MS = 86_400_000;
const RUNNING: readonly PlatformIntegrationStatus[] = ['ACTIVE', 'NEEDS_ATTENTION', 'ERROR'];
const STATUS_RANK: Record<PlatformIntegrationStatus, number> = {
  ERROR: 0,
  NEEDS_ATTENTION: 1,
  ACTIVE: 2,
  INACTIVE: 3,
  DISABLED: 4,
  DRAFT: 5,
  REMOVED: 6,
};
const CATEGORY_RANK = (c: string) => PlatformIntegrationCategory.options.indexOf(c as never);
const pct = (part: number, whole: number) => Math.round((part / whole) * 10_000) / 100;
const iso = (d: Date | null) => d?.toISOString() ?? null;
/** Reasons a credential change replaces with "test the connection". */
const STALE_AFTER_CREDENTIALS = new Set([
  'credentials_required',
  'credential_expiring',
  'auth_failed',
  'missing_configuration',
]);

/** Who may do what (spec 14 §12); everyone who reaches these routes is a SUPER_ADMIN. */
const ACCESS_CONTROL: AdminPlatformIntegrationDetail['accessControl'] = [
  {
    permission: 'VIEW',
    label: 'View integration',
    description: 'See status, metadata, non-sensitive logs and usage.',
    roles: ['SUPER_ADMIN'],
    locked: false,
  },
  {
    permission: 'TEST',
    label: 'Test connection',
    description: 'Run a safe provider check and record the result.',
    roles: ['SUPER_ADMIN'],
    locked: false,
  },
  {
    permission: 'EDIT',
    label: 'Edit configuration',
    description: 'Change metadata, endpoints, schedules and enabled features.',
    roles: ['SUPER_ADMIN'],
    locked: false,
  },
  {
    permission: 'ROTATE_CREDENTIALS',
    label: 'Rotate credentials',
    description: 'Create, rotate or revoke credentials.',
    roles: ['SUPER_ADMIN'],
    locked: true,
  },
  {
    permission: 'DISABLE_REMOVE',
    label: 'Disable or remove',
    description: 'Stop or permanently remove the service, after an impact confirmation.',
    roles: ['SUPER_ADMIN'],
    locked: true,
  },
];

/** The first moment of this month in the platform's time zone. */
function startOfMonth(now = new Date()): Date {
  const day = Number(
    new Intl.DateTimeFormat('en-US', { timeZone: PLATFORM_TIME_ZONE, day: 'numeric' }).format(now),
  );
  return startOfDayIn(PLATFORM_TIME_ZONE, new Date(now.getTime() - (day - 1) * DAY_MS));
}
const daysAgo = (n: number) => {
  const d = new Date(Date.now() - n * DAY_MS);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

/**
 * Firmivra's own platform integrations (R0 stage B8, `platform_integrations`) for the Super Admin
 * console: the dashboard, the list, the setup wizard's draft, the manage page, credentials, the
 * connection test, the lifecycle and the run history. Admin scope only (`AdminPrisma`); the
 * worker's step of a test is `IntegrationRunWorker`'s. Provider definitions are in code
 * (providers.ts); the screens' extra fields live in the non-secret `settings` JSON; credentials go
 * to the secret store and the row keeps the reference.
 */
@Injectable()
export class PlatformIntegrationsService {
  private readonly logger = new Logger(PlatformIntegrationsService.name);

  constructor(
    private readonly admin: AdminPrisma,
    private readonly worker: IntegrationRunWorker,
    @Inject(PLATFORM_SECRETS) private readonly secrets: PlatformSecretStore,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ---------- Dashboard and options ----------

  access(): AdminIntegrationAccess {
    const role = requestContext.getStore()?.platform?.role ?? 'SUPER_ADMIN';
    return {
      role,
      canView: true,
      canManageConfiguration: true,
      canManageSecrets: true,
      canLifecycle: true,
    };
  }

  providers(): AdminProviderTemplate[] {
    return providerTemplates();
  }

  async summary(): Promise<AdminIntegrationSummary> {
    const db = this.admin.db;
    const [platform, catalog, addedThisMonth] = await Promise.all([
      db.platformIntegration.findMany({
        where: { status: { not: 'REMOVED' } },
        select: { id: true, status: true, provider: true },
      }),
      db.platformIntegrationCatalog.groupBy({ by: ['status'], _count: { _all: true } }),
      db.platformIntegrationCatalog.count({ where: { createdAt: { gte: startOfMonth() } } }),
    ]);
    const count = (s: PlatformIntegrationStatus) => platform.filter((p) => p.status === s).length;
    const running = platform.filter(
      (p) => RUNNING.includes(p.status) && providerFor(p.provider).supportsUptime,
    );
    const uptime = await this.uptimes(running.map((p) => p.id));
    const known = [...uptime.values()];
    const catalogCount = (s: string) => catalog.find((c) => c.status === s)?._count._all ?? 0;
    const catalogTotal = catalog.reduce((n, c) => n + c._count._all, 0);
    return {
      total: platform.length + catalogTotal,
      platformTotal: platform.length,
      active: count('ACTIVE'),
      inactive: count('INACTIVE'),
      needsAttention: count('NEEDS_ATTENTION'),
      errors: count('ERROR'),
      disabled: count('DISABLED'),
      drafts: count('DRAFT'),
      uptime30d: known.length
        ? Math.round((known.reduce((n, v) => n + v, 0) / known.length) * 100) / 100
        : null,
      catalog: {
        total: catalogTotal,
        enabled: catalogCount('ENABLED'),
        disabled: catalogCount('DISABLED'),
        comingSoon: catalogCount('COMING_SOON'),
        addedThisMonth,
      },
    };
  }

  // ---------- Reads ----------

  async list(q: z.output<typeof ListAdminPlatformQuery>): Promise<ListAdminPlatformResponse> {
    const statuses = q.status ? (q.status.split(',') as PlatformIntegrationStatus[]) : undefined;
    const rows = await this.admin.db.platformIntegration.findMany({
      where: {
        ...(statuses
          ? { status: { in: statuses } }
          : q.includeRemoved
            ? {}
            : { status: { not: 'REMOVED' } }),
        ...(q.category ? { category: q.category } : {}),
        ...(q.environment ? { environment: q.environment } : {}),
      },
      take: 1000,
    });
    const search = q.search?.toLowerCase();
    const found = search
      ? rows.filter((r) =>
          [r.name, r.provider, r.description ?? '', readSettings(r.settings).reference].some((t) =>
            t.toLowerCase().includes(search),
          ),
        )
      : rows;
    const sign = q.descending ? -1 : 1;
    const order = (r: Row) => readSettings(r.settings).sortOrder;
    const key = (r: Row): string | number =>
      q.sort === 'name'
        ? r.name.toLowerCase()
        : q.sort === 'category'
          ? CATEGORY_RANK(r.category)
          : q.sort === 'status'
            ? STATUS_RANK[r.status]
            : q.sort === 'lastSync'
              ? (r.lastSyncAt?.getTime() ?? 0)
              : order(r);
    const sorted = [...found].sort((a, b) => {
      const l = key(a);
      const r = key(b);
      const c =
        typeof l === 'number' && typeof r === 'number' ? l - r : String(l).localeCompare(String(r));
      return c * sign || order(a) - order(b) || a.createdAt.getTime() - b.createdAt.getTime();
    });
    const pageRows = sorted.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
    return {
      items: await this.shape(pageRows),
      total: sorted.length,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async get(id: string): Promise<AdminPlatformIntegrationDetail> {
    const row = await this.admin.db.platformIntegration.findUnique({ where: { id } });
    if (!row) throw failure('NOT_FOUND');
    const [[item], catalog, highlights] = await Promise.all([
      this.shape([row]),
      this.admin.db.platformIntegrationCatalog.findMany({
        where: { platformIntegrationId: id },
        select: { id: true, name: true, status: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.highlights(row),
    ]);
    return {
      ...(item as AdminPlatformIntegration),
      // Webhook endpoints name no integration in B8, so none is listed as depending on one.
      dependents: { catalog, webhooks: [] },
      highlights,
      accessControl: ACCESS_CONTROL,
    };
  }

  async runs(
    id: string,
    q: z.output<typeof ListAdminPlatformRunsQuery>,
  ): Promise<ListAdminPlatformRunsResponse> {
    await this.findAny(id);
    const where: Prisma.PlatformIntegrationRunWhereInput = {
      integrationId: id,
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.status ? { status: q.status } : {}),
    };
    const db = this.admin.db;
    const [rows, total] = await Promise.all([
      db.platformIntegrationRun.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      db.platformIntegrationRun.count({ where }),
    ]);
    return { items: await this.shapeRuns(rows), total, page: q.page, pageSize: q.pageSize };
  }

  // ---------- Writes ----------

  /** The wizard's step 1: a DRAFT; nothing runs until it is activated. */
  async create(
    b: z.output<typeof CreateAdminPlatformRequest>,
  ): Promise<AdminPlatformIntegrationDetail> {
    const name = cleanText(b.name, 'integration name', 120);
    const description = cleanText(b.description, 'short description', 2000);
    if (b.provider && !isTemplateKey(b.provider)) throw invalid('Choose a provider from the list.');
    const byName = PROVIDERS.find(
      (p) => p.key !== 'custom' && p.name.toLowerCase() === name.toLowerCase(),
    );
    const provider = b.provider ?? byName?.key ?? customProviderKey(name);
    const definition = providerFor(provider);
    const websiteUrl = cleanUrl(b.websiteUrl, 'provider website');
    const docsUrl = cleanUrl(b.docsUrl, 'documentation URL');
    const longDescription = optionalText(b.longDescription, 'detailed description', 500) ?? null;
    const id = await this.admin
      .transaction(async (tx) => {
        await this.checkDuplicate(tx, provider, b.environment, null);
        const number = (await tx.platformIntegration.count()) + 1;
        const settings = newSettings(definition, {
          reference: `int_${String(number).padStart(3, '0')}`,
          longDescription,
          logo: b.logo ?? null,
          sortOrder: number,
        });
        const row = await tx.platformIntegration.create({
          data: {
            provider,
            name,
            category: b.category,
            description,
            websiteUrl,
            docsUrl,
            environment: b.environment,
            settings: settings as Json,
          },
          select: { id: true },
        });
        await auditIn(tx, {
          action: 'integrations.platform.created',
          entity: { type: 'platform_integration', id: row.id },
          label: name,
          metadata: { provider, environment: b.environment },
        });
        return row.id;
      })
      .catch((e: unknown) => {
        throw this.duplicateOr(e);
      });
    return this.get(id);
  }

  /** A versioned save of the configuration (never secrets). */
  async update(
    id: string,
    b: z.output<typeof UpdateAdminPlatformRequest>,
  ): Promise<AdminPlatformIntegrationDetail> {
    const row = await this.findLive(id);
    if (b.version !== row.version) throw failure('CONFLICT');
    const definition = providerFor(row.provider);
    const settings = readSettings(row.settings);
    const next: StoredPlatformSettings = structuredClone(settings);
    const data: Prisma.PlatformIntegrationUpdateManyMutationInput = {};
    const changed: string[] = [];
    const now = new Date().toISOString();
    if (b.name !== undefined) data.name = cleanText(b.name, 'integration name', 120);
    if (b.category !== undefined) data.category = b.category;
    if (b.description !== undefined)
      data.description = cleanText(b.description, 'short description', 2000);
    if (b.websiteUrl !== undefined) data.websiteUrl = optionalUrl(b.websiteUrl, 'provider website');
    if (b.docsUrl !== undefined) data.docsUrl = optionalUrl(b.docsUrl, 'documentation URL');
    for (const [field, value] of Object.entries(data))
      if (value !== (row as Record<string, unknown>)[field]) changed.push(field);
    if (b.longDescription !== undefined) {
      next.longDescription = optionalText(b.longDescription, 'detailed description', 500) ?? null;
      if (next.longDescription !== settings.longDescription) changed.push('longDescription');
    }
    if (b.logo !== undefined) {
      next.logo = b.logo;
      changed.push('logo');
    }
    let environmentChanged = false;
    let revoke: string | null = null;
    const environment = b.environment ?? row.environment;
    if (environment !== row.environment) {
      if (configured(settings) && !b.confirmEnvironmentChange)
        throw failure(
          'CONFIRMATION_REQUIRED',
          'Changing the environment clears the saved credentials. Confirm to continue.',
        );
      environmentChanged = true;
      changed.push('environment');
      data.environment = environment;
      next.values = {};
      next.hints = {};
      next.oauth = definition.supportsOAuth
        ? { connected: false, account: null, connectedAt: null }
        : null;
      data.lastCheckAt = null;
      data.lastCheckOk = null;
      if (row.secretRef) {
        data.secretRef = null;
        revoke = row.secretRef;
      }
      if (row.status !== 'DRAFT' && row.status !== 'DISABLED') {
        data.status = 'NEEDS_ATTENTION';
        data.statusReason = 'credentials_required';
      }
    }
    if (b.connection) {
      for (const [key, raw] of Object.entries(b.connection)) {
        const field = definition.fields.find((f) => f.key === key);
        if (!field) throw invalid(`Unknown connection field: ${key}.`);
        if (field.secret)
          throw invalid(`${field.label} is a secret: save it with the credentials.`);
        if (!raw.trim()) {
          if (field.required) throw invalid(`Enter the ${field.label.toLowerCase()}.`);
          delete next.values[key];
        } else next.values[key] = { value: checkValue(field, raw, environment), updatedAt: now };
        if (next.values[key]?.value !== settings.values[key]?.value)
          changed.push(`connection.${key}`);
      }
    }
    if (b.settings) {
      const s = { ...next, ...b.settings };
      if (s.scopes.some((scope) => !definition.scopes.includes(scope)))
        throw invalid('Choose scopes this provider offers.');
      if (s.features.some((k) => !definition.features.some((f) => f.key === k)))
        throw invalid('Choose features this provider offers.');
      Object.assign(next, {
        scopes: [...new Set(s.scopes)],
        syncSchedule: s.syncSchedule,
        features: [...new Set(s.features)],
        dataAccess: s.dataAccess,
        retry: s.retry,
        firmExposure: s.firmExposure,
      });
      changed.push('settings');
    }
    if (b.setupStep !== undefined) next.setupStep = b.setupStep;
    data.settings = next as Json;
    await this.admin
      .transaction(async (tx) => {
        if (environmentChanged) await this.checkDuplicate(tx, row.provider, environment, row.id);
        const { count } = await tx.platformIntegration.updateMany({
          where: { id, version: b.version, status: { not: 'REMOVED' } },
          data,
        });
        if (!count) throw failure('CONFLICT');
        if (changed.length) {
          await auditIn(tx, {
            action: environmentChanged
              ? 'integrations.platform.environment_changed'
              : 'integrations.platform.updated',
            entity: { type: 'platform_integration', id },
            label: (data.name as string | undefined) ?? row.name,
            metadata: {
              fields: [...new Set(changed)],
              ...(environmentChanged ? { environment } : {}),
            },
            severity: environmentChanged ? 'MEDIUM' : 'LOW',
          });
          await logIn(tx, {
            integration: { id, provider: row.provider, environment },
            eventType: 'config.updated',
            action: environmentChanged ? 'change_environment' : 'update_configuration',
            message: `${row.name} configuration updated`,
            severity: environmentChanged ? 'WARNING' : 'INFO',
            details: { fields: [...new Set(changed)].join(', ') },
          });
        }
      })
      .catch((e: unknown) => {
        throw this.duplicateOr(e);
      });
    if (revoke) await this.revoke(revoke);
    return this.get(id);
  }

  /** Write-only: the values go to the secret store; the row keeps the reference and masked hints. */
  async putCredentials(
    id: string,
    b: z.output<typeof PutAdminCredentialsRequest>,
  ): Promise<AdminPlatformIntegrationDetail> {
    const row = await this.findLive(id);
    const definition = providerFor(row.provider);
    const settings = readSettings(row.settings);
    const secretValues: Record<string, string> = {};
    const plainValues: Record<string, string> = {};
    for (const [key, raw] of Object.entries(b.values)) {
      if (!raw.trim()) continue;
      const field = definition.fields.find((f) => f.key === key);
      if (!field) throw invalid(`Unknown connection field: ${key}.`);
      const value = checkValue(field, raw, row.environment);
      (field.secret ? secretValues : plainValues)[key] = value;
    }
    const keys = [...Object.keys(secretValues), ...Object.keys(plainValues)];
    if (!keys.length) throw invalid('Enter at least one value.');
    const now = new Date().toISOString();
    const prefixOf = (key: string) =>
      definition.fields.find((f) => f.key === key)?.prefix?.[row.environment] ?? null;
    const next: StoredPlatformSettings = structuredClone(settings);
    for (const [key, value] of Object.entries(plainValues))
      next.values[key] = { value, updatedAt: now };
    let ref: string | null = null;
    if (Object.keys(secretValues).length) {
      // The values already stored stay, unless the store lost them (then only the new ones count).
      const kept = row.secretRef ? ((await this.secrets.read(row.secretRef)) ?? {}) : {};
      const merged = { ...kept, ...secretValues };
      ref = await this.secrets.write(row.id, merged);
      next.hints = Object.fromEntries(
        Object.keys(merged).map((key) => [
          key,
          key in secretValues || !settings.hints[key]
            ? { display: maskSecret(merged[key] as string, prefixOf(key)), updatedAt: now }
            : settings.hints[key],
        ]),
      );
    }
    const rotation = row.secretRef !== null && ref !== null;
    const reason =
      row.statusReason && STALE_AFTER_CREDENTIALS.has(row.statusReason)
        ? { statusReason: 'test_required' }
        : {};
    try {
      await this.admin.transaction(async (tx) => {
        const { count } = await tx.platformIntegration.updateMany({
          where: { id, status: { not: 'REMOVED' } },
          data: {
            ...(ref ? { secretRef: ref } : {}),
            settings: next as Json,
            lastCheckAt: null,
            lastCheckOk: null,
            ...reason,
          },
        });
        if (!count) throw failure('INVALID_STATE');
        await auditIn(tx, {
          action: rotation ? 'integrations.credentials.rotated' : 'integrations.credentials.set',
          entity: { type: 'platform_integration', id },
          label: row.name,
          metadata: { fields: keys },
          category: 'SECURITY',
          severity: rotation ? 'HIGH' : 'MEDIUM',
        });
        await logIn(tx, {
          integration: row,
          eventType: rotation ? 'credentials.rotated' : 'credentials.set',
          action: rotation ? 'rotate_credentials' : 'set_credentials',
          message: `${row.name} credentials ${rotation ? 'rotated' : 'saved'}`,
          details: { fields: keys.join(', ') },
        });
      });
    } catch (e) {
      if (ref) await this.revoke(ref);
      throw e;
    }
    if (ref && row.secretRef) await this.revoke(row.secretRef);
    return this.get(id);
  }

  /** A connection test, recorded as a TEST run and a log row; never shows a secret. */
  async test(id: string): Promise<AdminConnectionTestResult> {
    const row = await this.findLive(id);
    if (!providerFor(row.provider).supportsTest)
      throw failure(
        'INVALID_STATE',
        `${row.name} has no test endpoint. Check it in the provider's console.`,
      );
    return this.runTest(row);
  }

  /**
   * OAuth providers: the account link again, then a test. The provider's sign-in round trip needs
   * its OAuth app (R1's secrets), so until then nothing is linked and the test says the account is
   * not linked; key-based providers update their credentials instead.
   */
  async reconnect(id: string): Promise<AdminConnectionTestResult> {
    const row = await this.findLive(id);
    if (!providerFor(row.provider).supportsOAuth)
      throw failure(
        'INVALID_STATE',
        `${row.name} connects with keys: update its credentials instead.`,
      );
    return this.runTest(row);
  }

  async activate(
    id: string,
    b: z.output<typeof ActivateAdminPlatformRequest>,
  ): Promise<AdminPlatformIntegrationDetail> {
    const row = await this.findLive(id);
    if (row.status !== 'DRAFT' && row.status !== 'INACTIVE')
      throw failure('INVALID_STATE', 'Only a draft or inactive integration can be activated.');
    const definition = providerFor(row.provider);
    const settings = readSettings(row.settings);
    const refuse = async (code: 'CREDENTIALS_REQUIRED' | 'TEST_REQUIRED', message: string) => {
      await this.admin.transaction((tx) =>
        logIn(tx, {
          integration: row,
          eventType: 'integration.activation_failed',
          action: 'activate',
          message: `${row.name} activation failed`,
          severity: 'ERROR',
          succeeded: false,
          errorCode: code.toLowerCase(),
          details: { reason: message },
        }),
      );
      return failure(code, message);
    };
    if (!connectionComplete(definition, settings))
      throw await refuse('CREDENTIALS_REQUIRED', 'Enter every required connection field first.');
    if (definition.supportsTest && row.lastCheckOk !== true)
      throw await refuse('TEST_REQUIRED', 'Run a passing connection test before activating.');
    if (!definition.supportsTest && !b.confirmWithoutTest)
      throw failure(
        'CONFIRMATION_REQUIRED',
        'This provider has no test endpoint. Confirm that you checked the connection to activate it.',
      );
    const withoutTest = row.status === 'DRAFT' && !definition.supportsTest;
    await this.admin.transaction(async (tx) => {
      const { count } = await tx.platformIntegration.updateMany({
        where: { id, status: row.status },
        data: {
          status: 'ACTIVE',
          statusReason: null,
          ...(withoutTest ? { activatedWithoutTest: true } : {}),
          settings: { ...settings, setupStep: 'REVIEW' } as Json,
        },
      });
      if (!count) throw failure('INVALID_STATE');
      await auditIn(tx, {
        action: 'integrations.platform.activated',
        entity: { type: 'platform_integration', id },
        label: row.name,
        metadata: { environment: row.environment, withoutTest },
        severity: row.environment === 'LIVE' ? 'MEDIUM' : 'LOW',
      });
      await logIn(tx, {
        integration: row,
        eventType: 'integration.activated',
        action: 'activate',
        message: `${row.name} activated (${ENVIRONMENT_LABELS[row.environment]})`,
        ...(withoutTest
          ? { details: { test: 'No test endpoint: activated with confirmation' } }
          : {}),
      });
    });
    return this.get(id);
  }

  /** Stops jobs and new calls; keeps the configuration. */
  async disable(
    id: string,
    b: z.output<typeof DisableAdminPlatformRequest>,
  ): Promise<AdminPlatformIntegrationDetail> {
    const row = await this.findLive(id);
    if (row.status === 'DISABLED' || row.status === 'DRAFT')
      throw failure('INVALID_STATE', 'This integration is not running.');
    const reason = optionalText(b.reason, 'reason', 500) ?? null;
    await this.admin.transaction(async (tx) => {
      const { count } = await tx.platformIntegration.updateMany({
        where: { id, status: row.status },
        data: { status: 'DISABLED' },
      });
      if (!count) throw failure('INVALID_STATE');
      await auditIn(tx, {
        action: 'integrations.platform.disabled',
        entity: { type: 'platform_integration', id },
        label: row.name,
        metadata: { from: row.status, ...(reason ? { reason } : {}) },
        severity: 'MEDIUM',
      });
      await logIn(tx, {
        integration: row,
        eventType: 'integration.disabled',
        action: 'disable',
        message: `${row.name} disabled`,
        severity: 'WARNING',
        ...(reason ? { details: { reason } } : {}),
      });
    });
    return this.get(id);
  }

  /** An explicit re-enable, never automatic. */
  async enable(id: string): Promise<AdminPlatformIntegrationDetail> {
    const row = await this.findLive(id);
    if (row.status !== 'DISABLED')
      throw failure('INVALID_STATE', 'This integration is not disabled.');
    const failed = row.lastCheckOk === false;
    await this.admin.transaction(async (tx) => {
      const { count } = await tx.platformIntegration.updateMany({
        where: { id, status: 'DISABLED' },
        data: failed
          ? { status: 'NEEDS_ATTENTION', statusReason: 'last_test_failed' }
          : { status: 'ACTIVE' },
      });
      if (!count) throw failure('INVALID_STATE');
      await auditIn(tx, {
        action: 'integrations.platform.enabled',
        entity: { type: 'platform_integration', id },
        label: row.name,
        severity: 'MEDIUM',
      });
      await logIn(tx, {
        integration: row,
        eventType: 'integration.enabled',
        action: 'enable',
        message: `${row.name} enabled`,
      });
    });
    return this.get(id);
  }

  /** A tombstone, never deleted; the credentials are revoked in the secret store. */
  async remove(
    id: string,
    b: z.output<typeof RemoveAdminPlatformRequest>,
  ): Promise<AdminPlatformIntegrationDetail> {
    const row = await this.findLive(id);
    const definition = providerFor(row.provider);
    if (
      definition.critical &&
      row.environment === 'LIVE' &&
      (b.confirmation ?? '').trim() !== row.name
    )
      throw failure(
        'CONFIRMATION_REQUIRED',
        `Type ${row.name} to confirm removing a critical service.`,
      );
    const settings = readSettings(row.settings);
    await this.admin.transaction(async (tx) => {
      const { count } = await tx.platformIntegration.updateMany({
        where: { id, status: { not: 'REMOVED' } },
        data: {
          status: 'REMOVED',
          secretRef: null,
          settings: { ...settings, values: {}, hints: {}, oauth: null } as Json,
        },
      });
      if (!count) throw failure('INVALID_STATE');
      const unlinked = await tx.platformIntegrationCatalog.updateMany({
        where: { platformIntegrationId: id },
        data: { platformIntegrationId: null },
      });
      await auditIn(tx, {
        action: 'integrations.platform.removed',
        entity: { type: 'platform_integration', id },
        label: row.name,
        metadata: {
          from: row.status,
          catalogUnlinked: unlinked.count,
          credentialsRevoked: !!row.secretRef,
        },
        severity: 'HIGH',
      });
      await logIn(tx, {
        integration: row,
        eventType: 'integration.removed',
        action: 'remove',
        message: `${row.name} removed; its credentials were revoked`,
        severity: 'WARNING',
      });
    });
    if (row.secretRef) await this.revoke(row.secretRef);
    return this.get(id);
  }

  /** Queues a sync now; R1's sync worker runs it. A sync already waiting is returned instead. */
  async sync(id: string): Promise<AdminPlatformRun> {
    const row = await this.findLive(id);
    if (!RUNNING.includes(row.status))
      throw failure('INVALID_STATE', 'Only a running integration can sync.');
    const runId = await this.admin.transaction(async (tx) => {
      const waiting = await tx.platformIntegrationRun.findFirst({
        where: { integrationId: id, kind: 'SYNC', status: { in: ['QUEUED', 'RUNNING'] } },
        select: { id: true },
      });
      if (waiting) return waiting.id;
      const correlationId = newCorrelationId();
      const run = await tx.platformIntegrationRun.create({
        data: {
          integrationId: id,
          kind: 'SYNC',
          requestedByUserId: this.admin.adminUserId,
          correlationId,
        },
        select: { id: true },
      });
      await logIn(tx, {
        integration: row,
        eventType: 'sync.requested',
        action: 'sync',
        message: `${row.name} synchronization queued`,
        correlationId,
      });
      return run.id;
    });
    const run = await this.admin.db.platformIntegrationRun.findUniqueOrThrow({
      where: { id: runId },
    });
    const [item] = await this.shapeRuns([run]);
    return item as AdminPlatformRun;
  }

  // ---------- Helpers ----------

  private async findAny(id: string): Promise<Row> {
    const row = await this.admin.db.platformIntegration.findUnique({ where: { id } });
    if (!row) throw failure('NOT_FOUND');
    return row;
  }

  private async findLive(id: string): Promise<Row> {
    const row = await this.findAny(id);
    if (row.status === 'REMOVED') throw failure('INVALID_STATE', 'This integration was removed.');
    return row;
  }

  /** One live connection per provider and environment (the database checks it too). */
  private async checkDuplicate(
    tx: TxClient,
    provider: string,
    environment: 'LIVE' | 'TEST',
    except: string | null,
  ) {
    const other = await tx.platformIntegration.findFirst({
      where: {
        provider,
        environment,
        status: { not: 'REMOVED' },
        ...(except ? { id: { not: except } } : {}),
      },
      select: { name: true },
    });
    if (other)
      throw failure(
        'DUPLICATE_CONNECTION',
        `${other.name} already has a ${ENVIRONMENT_LABELS[environment]} connection.`,
      );
  }

  /** The database's own duplicate check (a race between two saves) as 409. */
  private duplicateOr(e: unknown): unknown {
    const message = String(
      (e as { meta?: { driverAdapterError?: { cause?: { originalMessage?: string } } } }).meta
        ?.driverAdapterError?.cause?.originalMessage ?? '',
    );
    if (databaseErrorCode(e) === '23514' && message.includes('connection'))
      return failure('DUPLICATE_CONNECTION');
    return e;
  }

  private async revoke(ref: string): Promise<void> {
    await this.secrets.revoke(ref).catch((e: unknown) => {
      this.logger.warn(`a platform integration secret was not revoked: ${(e as Error).name}`);
    });
  }

  private async runTest(row: Row): Promise<AdminConnectionTestResult> {
    const definition = providerFor(row.provider);
    const settings = readSettings(row.settings);
    const me = this.admin.adminUserId;
    const correlationId = newCorrelationId();
    const run = await this.admin.db.platformIntegrationRun.create({
      data: { integrationId: row.id, kind: 'TEST', requestedByUserId: me, correlationId },
      select: { id: true },
    });
    const started = Date.now();
    const secrets = row.secretRef
      ? await this.secrets.read(row.secretRef)
      : Object.keys(settings.hints).length
        ? null
        : {};
    const outcome = localConnectionTest(definition, row.environment, settings, secrets);
    const latencyMs = Date.now() - started;
    const logId = await this.worker.finishTest({
      runId: run.id,
      integration: row,
      outcome,
      latencyMs,
      correlationId,
      requestedByUserId: me,
    });
    return {
      ok: outcome.ok,
      kind: outcome.kind,
      at: new Date().toISOString(),
      latencyMs,
      message: outcome.message,
      errorCode: outcome.errorCode?.toUpperCase() ?? null,
      requestId: requestIdOf() ?? correlationId,
      runId: run.id,
      logId,
      integration: await this.get(row.id),
    };
  }

  /** Success rates over 30 days from the rollup, per integration with any calls. */
  private async uptimes(ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const rows = await this.admin.db.platformIntegrationUsageDaily.groupBy({
      by: ['subjectKey'],
      where: { scope: 'PLATFORM_INTEGRATION', subjectKey: { in: ids }, day: { gte: daysAgo(29) } },
      _sum: { requests: true, successes: true },
    });
    return new Map(
      rows
        .filter((r) => (r._sum.requests ?? 0) > 0)
        .map((r) => [r.subjectKey, pct(r._sum.successes ?? 0, r._sum.requests ?? 1)]),
    );
  }

  /** The Usage card: the last 30 days in the provider's units, N/A without data. */
  private async highlights(row: Row): Promise<AdminPlatformIntegrationDetail['highlights']> {
    const definition = providerFor(row.provider);
    const agg = await this.admin.db.platformIntegrationUsageDaily.aggregate({
      where: { scope: 'PLATFORM_INTEGRATION', subjectKey: row.id, day: { gte: daysAgo(29) } },
      _sum: { requests: true, successes: true, volume: true },
      _count: { _all: true },
    });
    const any = agg._count._all > 0;
    const requests = agg._sum.requests ?? 0;
    return [
      {
        key: 'requests',
        label: definition.requestLabel,
        value: any ? requests : null,
        unit: 'COUNT',
      },
      {
        key: 'volume',
        label: definition.volumeLabel,
        value: any && agg._sum.volume !== null ? Number(agg._sum.volume) : null,
        unit: definition.volumeUnit,
      },
      {
        key: 'successRate',
        label: 'Success Rate',
        value: requests ? pct(agg._sum.successes ?? 0, requests) : null,
        unit: 'PERCENT',
      },
    ];
  }

  /** Rows to the contract's list shape, with their latest check, sync and error. */
  private async shape(rows: Row[]): Promise<AdminPlatformIntegration[]> {
    if (!rows.length) return [];
    const db = this.admin.db;
    const ids = rows.map((r) => r.id);
    const userIds = [
      ...new Set(rows.flatMap((r) => (r.updatedByUserId ? [r.updatedByUserId] : []))),
    ];
    const [users, tests, syncs, failures, uptime] = await Promise.all([
      userIds.length
        ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
        : [],
      db.platformIntegrationRun.findMany({
        where: {
          integrationId: { in: ids },
          kind: 'TEST',
          status: { in: ['SUCCEEDED', 'FAILED'] },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        distinct: ['integrationId'],
        select: { integrationId: true, errorMessage: true, correlationId: true },
      }),
      db.platformIntegrationRun.findMany({
        where: {
          integrationId: { in: ids },
          kind: 'SYNC',
          status: { in: ['SUCCEEDED', 'PARTIAL', 'FAILED'] },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        distinct: ['integrationId'],
        select: { integrationId: true, status: true },
      }),
      db.platformIntegrationLog.findMany({
        where: { integrationId: { in: ids }, succeeded: false },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        distinct: ['integrationId'],
        select: {
          id: true,
          integrationId: true,
          errorCode: true,
          message: true,
          details: true,
          createdAt: true,
          requestId: true,
        },
      }),
      this.uptimes(rows.filter((r) => providerFor(r.provider).supportsUptime).map((r) => r.id)),
    ]);
    const corr = tests.flatMap((t) => (t.correlationId ? [t.correlationId] : []));
    const testLogs = corr.length
      ? await db.platformIntegrationLog.findMany({
          where: { correlationId: { in: corr }, eventType: 'connection.test' },
          select: { correlationId: true, details: true },
        })
      : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    const resultOf = (details: unknown) => {
      const result = (details as { result?: unknown } | null)?.result;
      return typeof result === 'string' ? result : null;
    };
    const testResult = new Map(testLogs.map((l) => [l.correlationId, resultOf(l.details)]));
    const lastTest = new Map(tests.map((t) => [t.integrationId, t]));
    const lastSync = new Map(syncs.map((s) => [s.integrationId, s.status]));
    const lastFailure = new Map(failures.map((f) => [f.integrationId, f]));
    return rows.map((r) => {
      const definition = providerFor(r.provider);
      const s = readSettings(r.settings);
      const test = lastTest.get(r.id);
      const lastCheckMessage =
        r.lastCheckAt && test
          ? (test.errorMessage ??
            (test.correlationId ? testResult.get(test.correlationId) : null) ??
            null)
          : null;
      const sync = lastSync.get(r.id);
      const failed = lastFailure.get(r.id);
      const troubled =
        r.status === 'ERROR' || r.status === 'NEEDS_ATTENTION' || r.lastCheckOk === false;
      const latestError =
        troubled && failed
          ? {
              code: (failed.errorCode ?? 'error').toUpperCase().replace(/\./g, '_'),
              title:
                failed.errorCode === 'provider_unavailable'
                  ? 'Provider unavailable'
                  : 'Connection failed',
              message: resultOf(failed.details) ?? failed.message,
              at: failed.createdAt.toISOString(),
              logId: failed.id,
              requestId: failed.requestId,
            }
          : null;
      return {
        id: r.id,
        reference: s.reference || `int_${r.id.slice(-6)}`,
        provider: r.provider,
        name: r.name,
        category: r.category,
        description: r.description ?? '',
        longDescription: s.longDescription,
        logo: s.logo,
        websiteUrl: r.websiteUrl,
        docsUrl: r.docsUrl,
        statusUrl: definition.statusUrl,
        environment: r.environment,
        status: r.status,
        statusReason: statusReasonOf(
          r.statusReason,
          r.statusReason && r.statusReason === failed?.errorCode
            ? (latestError?.message ?? null)
            : null,
        ),
        connection: {
          authType: definition.authType,
          fields: definition.fields.map((f) => {
            const stored = f.secret ? s.hints[f.key] : s.values[f.key];
            return {
              ...f,
              display: stored ? ('display' in stored ? stored.display : stored.value) : null,
              updatedAt: stored?.updatedAt || null,
            };
          }),
          webhookUrl: definition.webhookPath
            ? `${this.env.APP_BASE_URL.replace(/\/$/, '')}/api/v1${definition.webhookPath}`
            : null,
          oauth: definition.supportsOAuth
            ? (s.oauth ?? { connected: false, account: null, connectedAt: null })
            : null,
          secretRotatedAt: iso(r.secretRotatedAt),
          complete: connectionComplete(definition, s),
        },
        settings: {
          scopes: s.scopes,
          syncSchedule: s.syncSchedule,
          features: s.features,
          dataAccess: s.dataAccess,
          retry: s.retry,
          firmExposure: s.firmExposure,
        },
        lastCheckAt: iso(r.lastCheckAt),
        lastCheckOk: r.lastCheckOk,
        lastCheckMessage,
        lastSyncAt: iso(r.lastSyncAt),
        lastSyncOk: sync ? sync === 'SUCCEEDED' : null,
        uptime30d: uptime.get(r.id) ?? null,
        supportsTest: definition.supportsTest,
        supportsUptime: definition.supportsUptime,
        critical: definition.critical && r.environment === 'LIVE',
        activatedWithoutTest: r.activatedWithoutTest,
        activatedAt: iso(r.activatedAt),
        disabledAt: iso(r.disabledAt),
        removedAt: iso(r.removedAt),
        setupStep: s.setupStep,
        latestError,
        sortOrder: s.sortOrder,
        version: r.version,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        updatedBy: r.updatedByUserId ? (names.get(r.updatedByUserId) ?? 'Firmivra team') : null,
      };
    });
  }

  private async shapeRuns(
    rows: Prisma.PlatformIntegrationRunGetPayload<object>[],
  ): Promise<AdminPlatformRun[]> {
    if (!rows.length) return [];
    const db = this.admin.db;
    const userIds = [
      ...new Set(rows.flatMap((r) => (r.requestedByUserId ? [r.requestedByUserId] : []))),
    ];
    const corr = rows.flatMap((r) => (r.correlationId ? [r.correlationId] : []));
    const [users, logs] = await Promise.all([
      userIds.length
        ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
        : [],
      corr.length
        ? db.platformIntegrationLog.findMany({
            where: { correlationId: { in: corr } },
            orderBy: { createdAt: 'desc' },
            select: { id: true, correlationId: true },
          })
        : [],
    ]);
    const names = new Map(users.map((u) => [u.id, u.name]));
    const logOf = new Map<string, string>();
    for (const l of logs)
      if (l.correlationId && !logOf.has(l.correlationId)) logOf.set(l.correlationId, l.id);
    return rows.map((r) => ({
      id: r.id,
      integrationId: r.integrationId,
      kind: r.kind,
      status: r.status,
      trigger: r.requestedByUserId ? 'MANUAL' : 'SCHEDULE',
      requestedBy: r.requestedByUserId ? (names.get(r.requestedByUserId) ?? 'Firmivra team') : null,
      createdAt: r.createdAt.toISOString(),
      startedAt: iso(r.startedAt),
      finishedAt: iso(r.finishedAt),
      durationMs:
        r.startedAt && r.finishedAt
          ? Math.max(0, r.finishedAt.getTime() - r.startedAt.getTime())
          : null,
      objectCount: r.objectCount,
      failedCount: r.failedCount,
      retries: r.retries,
      errorCode: r.errorCode ? r.errorCode.toUpperCase().replace(/\./g, '_') : null,
      errorMessage: r.errorMessage,
      correlationId: r.correlationId ?? r.id,
      logId: r.correlationId ? (logOf.get(r.correlationId) ?? null) : null,
    }));
  }
}
