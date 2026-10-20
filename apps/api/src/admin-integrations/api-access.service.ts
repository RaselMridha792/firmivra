import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { databaseErrorCode, type Prisma } from '@firmivra/db';
import {
  ADMIN_WEBHOOK_EVENTS,
  type AdminApiKey,
  type AdminIssuedApiKey,
  type AdminWebhookDelivery,
  type AdminWebhookEndpoint,
  type AdminWebhookWithSecret,
  type CreateAdminApiKeyRequest,
  type CreateAdminWebhookRequest,
  type ListAdminApiKeysQuery,
  type ListAdminWebhookDeliveriesQuery,
  type ListAdminWebhookDeliveriesResponse,
  type ListAdminWebhooksQuery,
  type RevokeAdminApiKeyRequest,
  type UpdateAdminWebhookRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { auditIn, logIn } from './integration-records.js';
import { cleanUrl, failure, invalid, optionalText } from './integrations.rules.js';
import { PLATFORM_SECRETS, type PlatformSecretStore } from './platform-secrets.js';

type KeyRow = Prisma.PlatformApiKeyGetPayload<object>;
type EndpointRow = Prisma.PlatformWebhookEndpointGetPayload<object>;
type DeliveryRow = Prisma.PlatformWebhookDeliveryGetPayload<object>;

const DAY_MS = 86_400_000;
const BASE36 = 'abcdefghijklmnopqrstuvwxyz0123456789';
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** Random characters from `alphabet` (a byte below 256 - 256 % n keeps them uniform). */
function randomText(length: number, alphabet: string): string {
  const limit = 256 - (256 % alphabet.length);
  let out = '';
  while (out.length < length)
    for (const byte of randomBytes(length * 2))
      if (byte < limit && out.length < length) out += alphabet[byte % alphabet.length];
  return out;
}
const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const iso = (d: Date | null) => d?.toISOString() ?? null;
/** No last four is kept for a signing secret, so its mask is the same for every endpoint. */
const SIGNING_MASK = 'whsec_••••••••';

/** A key's state now: revoked, past its expiry, or live. */
export function keyStatus(row: Pick<KeyRow, 'revokedAt' | 'expiresAt'>, now = new Date()) {
  if (row.revokedAt) return 'REVOKED' as const;
  if (row.expiresAt && row.expiresAt <= now) return 'EXPIRED' as const;
  return 'ACTIVE' as const;
}

/**
 * A new Firmivra API key: `fv_live_` or `fv_test_` and 40 random characters. The database keeps
 * the prefix (the environment and the first 8 characters), the last four and the SHA-256 hash.
 */
export function newApiKey(environment: 'LIVE' | 'TEST') {
  const body = randomText(40, BASE36);
  const env = environment.toLowerCase();
  const secret = `fv_${env}_${body}`;
  return {
    secret,
    prefix: `fv_${env}_${body.slice(0, 8)}`,
    lastFour: body.slice(-4),
    hash: sha256(secret),
  };
}

/**
 * Firmivra's API keys and webhook endpoints (R0 stage B8, `platform_api_keys`,
 * `platform_webhook_endpoints`, `platform_webhook_deliveries`). Admin scope only. A full key or
 * signing secret is returned once, when it is issued, and never kept: a key as its hash, a signing
 * secret in the platform secret store under a reference. Sending deliveries is the webhook
 * worker's (R1); a redelivery is queued here as a later attempt.
 */
@Injectable()
export class ApiAccessService {
  private readonly logger = new Logger(ApiAccessService.name);

  constructor(
    private readonly admin: AdminPrisma,
    @Inject(PLATFORM_SECRETS) private readonly secrets: PlatformSecretStore,
  ) {}

  // ---------- API keys ----------

  async listKeys(q: z.output<typeof ListAdminApiKeysQuery>): Promise<AdminApiKey[]> {
    const now = new Date();
    const status: Prisma.PlatformApiKeyWhereInput =
      q.status === 'REVOKED'
        ? { revokedAt: { not: null } }
        : q.status === 'EXPIRED'
          ? { revokedAt: null, expiresAt: { lte: now } }
          : q.status === 'ACTIVE'
            ? { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }
            : {};
    const rows = await this.admin.db.platformApiKey.findMany({
      where: { ...status, ...(q.environment ? { environment: q.environment } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 500,
    });
    return this.shapeKeys(rows);
  }

  /** Super Admin: the full key comes back once. */
  async createKey(b: z.output<typeof CreateAdminApiKeyRequest>): Promise<AdminIssuedApiKey> {
    const name = optionalText(b.name, 'key name', 120);
    if (!name) throw invalid('Name the key.');
    const expiresAt = b.expiresAt ? new Date(b.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now() + 60_000)
      throw invalid('Choose an expiry date in the future.');
    const issued = newApiKey(b.environment);
    const scopes = [...new Set(b.scopes)];
    const id = await this.admin.transaction(async (tx) => {
      const row = await tx.platformApiKey.create({
        data: {
          name,
          prefix: issued.prefix,
          lastFour: issued.lastFour,
          keyHash: issued.hash,
          scopes,
          environment: b.environment,
          rateLimitPerMinute: b.rateLimitPerMinute ?? null,
          expiresAt,
        },
        select: { id: true },
      });
      await auditIn(tx, {
        action: 'integrations.api_key.created',
        entity: { type: 'platform_api_key', id: row.id },
        label: name,
        metadata: {
          fields: ['key', 'scopes'],
          prefix: issued.prefix,
          lastFour: issued.lastFour,
          scopes,
        },
        category: 'SECURITY',
        severity: b.environment === 'LIVE' ? 'HIGH' : 'MEDIUM',
      });
      await logIn(tx, {
        integration: null,
        source: 'API',
        environment: b.environment,
        eventType: 'api_key.created',
        action: 'issue_api_key',
        message: `API key ${name} issued (${issued.prefix}…${issued.lastFour})`,
      });
      return row.id;
    });
    return { key: await this.key(id), secret: issued.secret };
  }

  /** A new key naming the old one, which is revoked in the same transaction. */
  async rotateKey(id: string): Promise<AdminIssuedApiKey> {
    const old = await this.findKey(id);
    if (keyStatus(old) !== 'ACTIVE')
      throw failure('INVALID_STATE', 'Only an active key can be rotated.');
    const issued = newApiKey(old.environment);
    const newId = await this.admin
      .transaction(async (tx) => {
        const row = await tx.platformApiKey.create({
          data: {
            name: old.name,
            prefix: issued.prefix,
            lastFour: issued.lastFour,
            keyHash: issued.hash,
            scopes: old.scopes,
            environment: old.environment,
            rateLimitPerMinute: old.rateLimitPerMinute,
            expiresAt: old.expiresAt,
            rotatedFromId: old.id,
          },
          select: { id: true },
        });
        const { count } = await tx.platformApiKey.updateMany({
          where: { id: old.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        if (!count) throw failure('INVALID_STATE', 'Only an active key can be rotated.');
        await auditIn(tx, {
          action: 'integrations.api_key.rotated',
          entity: { type: 'platform_api_key', id: row.id },
          label: old.name,
          metadata: {
            fields: ['key'],
            from: `${old.prefix}…${old.lastFour}`,
            to: `${issued.prefix}…${issued.lastFour}`,
            rotatedFromId: old.id,
          },
          category: 'SECURITY',
          severity: 'HIGH',
        });
        await logIn(tx, {
          integration: null,
          source: 'API',
          environment: old.environment,
          eventType: 'api_key.rotated',
          action: 'rotate_api_key',
          message: `API key ${old.name} rotated`,
        });
        return row.id;
      })
      .catch((e: unknown) => {
        if (databaseErrorCode(e) === '23505' || databaseErrorCode(e) === '23514')
          throw failure('INVALID_STATE', 'This key was rotated or revoked meanwhile.');
        throw e;
      });
    return { key: await this.key(newId), secret: issued.secret };
  }

  /** Once, stamped by the database. */
  async revokeKey(id: string, b: z.output<typeof RevokeAdminApiKeyRequest>): Promise<AdminApiKey> {
    const row = await this.findKey(id);
    if (row.revokedAt) throw failure('INVALID_STATE', 'This key is already revoked.');
    const reason = optionalText(b.reason, 'reason', 300) ?? null;
    await this.admin.transaction(async (tx) => {
      const { count } = await tx.platformApiKey.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (!count) throw failure('INVALID_STATE', 'This key is already revoked.');
      await auditIn(tx, {
        action: 'integrations.api_key.revoked',
        entity: { type: 'platform_api_key', id },
        label: row.name,
        metadata: {
          fields: ['revoked'],
          key: `${row.prefix}…${row.lastFour}`,
          ...(reason ? { reason } : {}),
        },
        category: 'SECURITY',
        severity: 'HIGH',
      });
      await logIn(tx, {
        integration: null,
        source: 'API',
        environment: row.environment,
        eventType: 'api_key.revoked',
        action: 'revoke_api_key',
        message: `API key ${row.name} revoked`,
        severity: 'WARNING',
      });
    });
    return this.key(id);
  }

  // ---------- Webhooks ----------

  async listWebhooks(q: z.output<typeof ListAdminWebhooksQuery>): Promise<AdminWebhookEndpoint[]> {
    const rows = await this.admin.db.platformWebhookEndpoint.findMany({
      where: {
        ...(q.direction ? { direction: q.direction } : {}),
        ...(q.status ? { status: q.status } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 500,
    });
    return this.shapeEndpoints(rows);
  }

  /** Super Admin: https only; the signing secret comes back once. */
  async createWebhook(
    b: z.output<typeof CreateAdminWebhookRequest>,
  ): Promise<AdminWebhookWithSecret> {
    const url = cleanUrl(b.url, 'endpoint URL');
    if (!url) throw invalid('Enter the endpoint URL.');
    const events = this.checkEvents(b.events, b.direction);
    const description = optionalText(b.description, 'description', 500) ?? null;
    const id = randomUUID();
    const signingSecret = `whsec_${randomText(32, BASE62)}`;
    const ref = await this.secrets.write(`webhooks.${id}`, { signingSecret });
    try {
      await this.admin.transaction(async (tx) => {
        await tx.platformWebhookEndpoint.create({
          data: {
            id,
            direction: b.direction,
            url,
            description,
            events,
            maxRetries: b.maxRetries ?? 5,
            signingSecretRef: ref,
          },
        });
        await auditIn(tx, {
          action: 'integrations.webhook.created',
          entity: { type: 'platform_webhook', id },
          label: url,
          metadata: { fields: ['url', 'events', 'signingSecret'], direction: b.direction, events },
          category: 'SECURITY',
          severity: 'MEDIUM',
        });
      });
    } catch (e) {
      await this.revoke(ref);
      throw e;
    }
    return { endpoint: await this.endpoint(id), signingSecret };
  }

  /** URL, events, status and retries; `rotateSecret` returns a new signing secret once. */
  async updateWebhook(
    id: string,
    b: z.output<typeof UpdateAdminWebhookRequest>,
  ): Promise<AdminWebhookWithSecret> {
    const row = await this.findEndpoint(id);
    const data: Prisma.PlatformWebhookEndpointUpdateInput = {};
    if (b.url !== undefined) {
      const url = cleanUrl(b.url, 'endpoint URL');
      if (!url) throw invalid('Enter the endpoint URL.');
      if (url !== row.url) data.url = url;
    }
    if (b.description !== undefined) {
      const description = optionalText(b.description, 'description', 500) ?? null;
      if (description !== row.description) data.description = description;
    }
    if (b.events !== undefined) {
      const events = this.checkEvents(b.events, row.direction);
      if (events.join() !== row.events.join()) data.events = events;
    }
    if (b.status !== undefined && b.status !== row.status) data.status = b.status;
    if (b.maxRetries !== undefined && b.maxRetries !== row.maxRetries)
      data.maxRetries = b.maxRetries;
    const changed: string[] = Object.keys(data);
    let signingSecret: string | null = null;
    let ref: string | null = null;
    if (b.rotateSecret) {
      signingSecret = `whsec_${randomText(32, BASE62)}`;
      ref = await this.secrets.write(`webhooks.${id}`, { signingSecret });
      data.signingSecretRef = ref;
      changed.push('signingSecret');
    }
    if (changed.length) {
      try {
        await this.admin.transaction(async (tx) => {
          await tx.platformWebhookEndpoint.update({ where: { id }, data });
          await auditIn(tx, {
            action: ref ? 'integrations.webhook.secret_rotated' : 'integrations.webhook.updated',
            entity: { type: 'platform_webhook', id },
            label: (data.url as string | undefined) ?? row.url,
            metadata: { fields: changed, ...(data.status ? { status: data.status } : {}) },
            category: ref ? 'SECURITY' : 'INTEGRATION',
            severity: ref ? 'HIGH' : 'LOW',
          });
        });
      } catch (e) {
        if (ref) await this.revoke(ref);
        throw e;
      }
      if (ref && row.signingSecretRef) await this.revoke(row.signingSecretRef);
    }
    return { endpoint: await this.endpoint(id), signingSecret };
  }

  async deliveries(
    id: string,
    q: z.output<typeof ListAdminWebhookDeliveriesQuery>,
  ): Promise<ListAdminWebhookDeliveriesResponse> {
    const endpoint = await this.findEndpoint(id);
    const where: Prisma.PlatformWebhookDeliveryWhereInput = {
      endpointId: id,
      ...(q.status ? { status: q.status } : {}),
    };
    const db = this.admin.db;
    const [rows, total] = await Promise.all([
      db.platformWebhookDelivery.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      db.platformWebhookDelivery.count({ where }),
    ]);
    return {
      items: await this.shapeDeliveries(rows, endpoint),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** After the team's confirmation: a later attempt of the same event to the same endpoint. */
  async redeliver(deliveryId: string): Promise<AdminWebhookDelivery> {
    const original = await this.admin.db.platformWebhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { endpoint: true },
    });
    if (!original) throw failure('NOT_FOUND');
    if (!this.canRedeliver(original, original.endpoint))
      throw failure(
        'INVALID_STATE',
        'Only a finished outbound delivery to an active endpoint can be redelivered.',
      );
    const created = await this.admin
      .transaction(async (tx) => {
        const last = await tx.platformWebhookDelivery.aggregate({
          where: { endpointId: original.endpointId, eventId: original.eventId },
          _max: { attempt: true },
        });
        const row = await tx.platformWebhookDelivery.create({
          data: {
            endpointId: original.endpointId,
            eventType: original.eventType,
            eventId: original.eventId,
            attempt: (last._max.attempt ?? original.attempt) + 1,
            redeliveryOfId: original.id,
            requestedByUserId: this.admin.adminUserId,
          },
        });
        await auditIn(tx, {
          action: 'integrations.webhook.redelivered',
          entity: { type: 'platform_webhook', id: original.endpointId },
          label: original.endpoint.url,
          metadata: {
            fields: ['delivery'],
            eventType: original.eventType,
            eventId: original.eventId,
            attempt: row.attempt,
          },
        });
        await logIn(tx, {
          integration: null,
          source: 'WEBHOOK',
          eventType: 'webhook.redelivery_requested',
          action: 'redeliver',
          message: `Redelivery of ${original.eventType} queued`,
          details: {
            endpoint: original.endpoint.url,
            attempt: row.attempt,
            eventId: original.eventId,
          },
        });
        return row;
      })
      .catch((e: unknown) => {
        if (databaseErrorCode(e) === '23505')
          throw failure('INVALID_STATE', 'A redelivery of this event was just queued.');
        throw e;
      });
    const [item] = await this.shapeDeliveries([created], original.endpoint);
    return item as AdminWebhookDelivery;
  }

  // ---------- Helpers ----------

  private async findKey(id: string): Promise<KeyRow> {
    const row = await this.admin.db.platformApiKey.findUnique({ where: { id } });
    if (!row) throw failure('NOT_FOUND');
    return row;
  }
  private async key(id: string): Promise<AdminApiKey> {
    const [item] = await this.shapeKeys([await this.findKey(id)]);
    return item as AdminApiKey;
  }
  private async findEndpoint(id: string): Promise<EndpointRow> {
    const row = await this.admin.db.platformWebhookEndpoint.findUnique({ where: { id } });
    if (!row) throw failure('NOT_FOUND');
    return row;
  }
  private async endpoint(id: string): Promise<AdminWebhookEndpoint> {
    const [item] = await this.shapeEndpoints([await this.findEndpoint(id)]);
    return item as AdminWebhookEndpoint;
  }

  /** Outbound events come from the list; inbound ones are the provider's names. */
  private checkEvents(events: string[], direction: 'OUTBOUND' | 'INBOUND'): string[] {
    const list = [...new Set(events.map((e) => e.trim()).filter(Boolean))];
    if (!list.length) throw invalid('Choose at least one event.');
    if (
      direction === 'OUTBOUND' &&
      list.some((e) => !(ADMIN_WEBHOOK_EVENTS as readonly string[]).includes(e))
    )
      throw invalid('Choose events from the list.');
    return list;
  }

  private canRedeliver(
    d: Pick<DeliveryRow, 'status'>,
    e: Pick<EndpointRow, 'direction' | 'status'>,
  ) {
    return e.direction === 'OUTBOUND' && e.status === 'ACTIVE' && d.status !== 'PENDING';
  }

  private async revoke(ref: string): Promise<void> {
    await this.secrets.revoke(ref).catch((e: unknown) => {
      this.logger.warn(`a webhook signing secret was not revoked: ${(e as Error).name}`);
    });
  }

  private async names(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (!unique.length) return new Map();
    const users = await this.admin.db.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  private async shapeKeys(rows: KeyRow[]): Promise<AdminApiKey[]> {
    if (!rows.length) return [];
    const db = this.admin.db;
    const ids = rows.map((r) => r.id);
    const [names, successors, usage] = await Promise.all([
      this.names(rows.flatMap((r) => [r.createdByUserId, r.revokedByUserId])),
      db.platformApiKey.findMany({
        where: { rotatedFromId: { in: ids } },
        select: { id: true, rotatedFromId: true },
      }),
      db.platformIntegrationUsageDaily.findMany({
        where: {
          scope: 'API',
          subjectKey: { in: ids },
          day: { gte: new Date(Date.now() - 2 * DAY_MS) },
        },
        orderBy: { day: 'desc' },
        select: { subjectKey: true, requests: true },
      }),
    ]);
    const next = new Map(successors.map((s) => [s.rotatedFromId, s.id]));
    const latest = new Map<string, number>();
    for (const u of usage) if (!latest.has(u.subjectKey)) latest.set(u.subjectKey, u.requests);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      prefix: r.prefix,
      lastFour: r.lastFour,
      scopes: r.scopes,
      environment: r.environment,
      rateLimitPerMinute: r.rateLimitPerMinute,
      expiresAt: iso(r.expiresAt),
      lastUsedAt: iso(r.lastUsedAt),
      rotatedFromId: r.rotatedFromId,
      rotatedToId: next.get(r.id) ?? null,
      revokedAt: iso(r.revokedAt),
      revokedBy: r.revokedByUserId
        ? (names.get(r.revokedByUserId) ?? 'Firmivra team')
        : r.revokedAt
          ? 'Firmivra platform'
          : null,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdByUserId ? (names.get(r.createdByUserId) ?? 'Firmivra team') : null,
      status: keyStatus(r),
      usage24h: { requests: latest.get(r.id) ?? null, peakPerMinute: null, rateLimited: null },
    }));
  }

  private async shapeEndpoints(rows: EndpointRow[]): Promise<AdminWebhookEndpoint[]> {
    if (!rows.length) return [];
    const db = this.admin.db;
    const ids = rows.map((r) => r.id);
    const since = new Date(Date.now() - 7 * DAY_MS);
    const [recent, failed, last] = await Promise.all([
      db.platformWebhookDelivery.groupBy({
        by: ['endpointId'],
        where: { endpointId: { in: ids }, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      db.platformWebhookDelivery.groupBy({
        by: ['endpointId'],
        where: { endpointId: { in: ids }, createdAt: { gte: since }, status: 'FAILED' },
        _count: { _all: true },
      }),
      db.platformWebhookDelivery.findMany({
        where: { endpointId: { in: ids } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        distinct: ['endpointId'],
        select: { endpointId: true, createdAt: true, status: true },
      }),
    ]);
    const countOf = (list: typeof recent, id: string) =>
      list.find((c) => c.endpointId === id)?._count._all ?? 0;
    const lastOf = new Map(last.map((l) => [l.endpointId, l]));
    return rows.map((r) => ({
      id: r.id,
      direction: r.direction,
      url: r.url,
      description: r.description,
      events: r.events,
      status: r.status,
      maxRetries: r.maxRetries,
      signingSecretHint: r.signingSecretRef ? SIGNING_MASK : null,
      secretRotatedAt: iso(r.secretRotatedAt),
      integration: null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      stats: {
        deliveries7d: countOf(recent, r.id),
        failures7d: countOf(failed, r.id),
        lastDeliveryAt: iso(lastOf.get(r.id)?.createdAt ?? null),
        lastStatus: lastOf.get(r.id)?.status ?? null,
      },
    }));
  }

  private async shapeDeliveries(
    rows: DeliveryRow[],
    endpoint: Pick<EndpointRow, 'direction' | 'status'>,
  ): Promise<AdminWebhookDelivery[]> {
    const names = await this.names(rows.map((r) => r.requestedByUserId));
    return rows.map((r) => ({
      id: r.id,
      endpointId: r.endpointId,
      eventType: r.eventType,
      eventId: r.eventId,
      attempt: r.attempt,
      redeliveryOfId: r.redeliveryOfId,
      status: r.status,
      responseStatusCode: r.responseStatusCode,
      durationMs: r.durationMs,
      requestId: r.requestId,
      errorCode: r.errorCode ? r.errorCode.toUpperCase().replace(/\./g, '_') : null,
      retries: r.attempt - 1,
      requestedBy: r.requestedByUserId ? (names.get(r.requestedByUserId) ?? 'Firmivra team') : null,
      createdAt: r.createdAt.toISOString(),
      finishedAt: iso(r.finishedAt),
      payload: null,
      canRedeliver: this.canRedeliver(r, endpoint),
    }));
  }
}
