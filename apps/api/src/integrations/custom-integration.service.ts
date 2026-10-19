import { createHmac, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type { CustomIntegrationConfig, CustomIntegrationTestResult } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../common/request-context.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { notFound } from '../workspaces/common.js';
import { CUSTOM_EVENTS } from './catalog.js';
import { integrationErrors, requireManage } from './integrations.common.js';
import type { RotateBody, SaveCustomBody } from './integrations-input.js';
import { checkWebhookUrl, OUTBOUND_HTTP, type OutboundHttp } from './safe-http.js';
import { SECRET_STORE, type SecretStore, secretRefOf } from './secret-store.js';

type Save = z.output<typeof SaveCustomBody>;
type Rotate = z.output<typeof RotateBody>;

interface Stored {
  name: string;
  enabled: boolean;
  documentationUrl: string | null;
  authMethod: CustomIntegrationConfig['authMethod'];
  endpointUrl: string | null;
  events: string[];
}

const DEFAULTS: Stored = {
  name: 'Custom integration',
  enabled: false,
  documentationUrl: null,
  authMethod: 'NONE',
  endpointUrl: null,
  events: [],
};

const ENTITY = 'integration_connection';

/**
 * The Custom API & Webhooks provider (`custom_api`): the firm's own endpoint, events and secret.
 * Non-secret setup lives in the connection's `settings.custom`; the secret is in the secret store
 * (only its last 4 characters are kept, in `account_id_last4`, with `secret_rotated_at`) and is
 * never returned. The endpoint must be https and public (see safe-http.ts). A test sends one signed
 * test event and records a `test` sync run.
 */
@Injectable()
export class CustomIntegrationService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
    @Inject(OUTBOUND_HTTP) private readonly http: OutboundHttp,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  events() {
    return CUSTOM_EVENTS.map((e) => ({ ...e }));
  }

  private async load(tx: TxClient, businessId: string, id: string) {
    const c = await tx.integrationConnection.findFirst({
      where: { businessId, id, provider: 'custom_api' },
    });
    if (!c) throw notFound();
    return c;
  }

  private storedOf(settings: unknown): Stored {
    const custom = (settings as { custom?: Partial<Stored> } | null)?.custom ?? {};
    return { ...DEFAULTS, ...custom };
  }

  private view(c: {
    id: string;
    accountIdLast4: string | null;
    secretRotatedAt: Date | null;
    settings: unknown;
  }): CustomIntegrationConfig {
    const s = this.storedOf(c.settings);
    return {
      connectionId: c.id,
      enabled: s.enabled,
      name: s.name,
      documentationUrl: s.documentationUrl,
      authMethod: s.authMethod,
      endpointUrl: s.endpointUrl,
      events: s.events,
      secretLast4: c.accountIdLast4,
      secretRotatedAt: c.secretRotatedAt?.toISOString() ?? null,
      inboundUrl: `${this.env.APP_BASE_URL.replace(/\/+$/, '')}/api/v1/integrations/inbound/${c.id}`,
    };
  }

  get(businessId: string, id: string): Promise<CustomIntegrationConfig> {
    return this.inFirm(businessId, async (tx) => this.view(await this.load(tx, businessId, id)));
  }

  async save(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Save,
  ): Promise<CustomIntegrationConfig> {
    requireManage(tenant);
    const config = await this.inFirm(businessId, async (tx) => {
      const c = await this.load(tx, businessId, id);
      if (c.status === 'DISCONNECTED') throw integrationErrors.notConnected();
      const cur = this.storedOf(c.settings);
      const next: Stored = {
        name: body.name ?? cur.name,
        enabled: body.enabled ?? cur.enabled,
        documentationUrl:
          body.documentationUrl === undefined ? cur.documentationUrl : body.documentationUrl,
        authMethod: body.authMethod ?? cur.authMethod,
        endpointUrl: body.endpointUrl === undefined ? cur.endpointUrl : body.endpointUrl,
        events: body.events ?? cur.events,
      };
      if (next.endpointUrl && !checkWebhookUrl(next.endpointUrl)) {
        throw integrationErrors.invalid('endpointUrl', 'Use a public https address');
      }
      const unknown = next.events.filter((e) => !CUSTOM_EVENTS.some((x) => x.key === e));
      if (unknown.length > 0)
        throw integrationErrors.invalidConfiguration(`Unknown event “${unknown[0]}”`);
      if (next.enabled && (!next.endpointUrl || next.events.length === 0)) {
        throw integrationErrors.invalidConfiguration(
          'Set an endpoint and choose at least one event before enabling',
        );
      }
      if (next.enabled && next.authMethod !== 'NONE' && !c.secretRef) {
        throw integrationErrors.invalidConfiguration('Set the secret before enabling');
      }
      const saved = await tx.integrationConnection.update({
        where: { id },
        data: {
          settings: {
            ...((c.settings ?? {}) as object),
            custom: next,
          } as unknown as Prisma.InputJsonObject,
        },
      });
      await this.audit.logIn(
        tx,
        'integration.custom_changed',
        { type: ENTITY, id },
        { fields: Object.keys(body) },
        { businessId, actorUserId: userId },
      );
      return this.view(saved);
    });
    return config;
  }

  /** Write-only: the secret goes to the store, the answer has its last 4 characters. */
  async rotateSecret(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Rotate,
  ): Promise<CustomIntegrationConfig> {
    requireManage(tenant);
    const c = await this.inFirm(businessId, (tx) => this.load(tx, businessId, id));
    if (c.status === 'DISCONNECTED') throw integrationErrors.notConnected();
    const ref = secretRefOf(businessId, id);
    await this.secrets.put(ref, body.secret);
    return this.inFirm(businessId, async (tx) => {
      const saved = await tx.integrationConnection.update({
        where: { id },
        data: {
          secretRef: ref,
          secretRotatedAt: new Date(),
          accountIdLast4: body.secret.slice(-4),
        },
      });
      await this.audit.logIn(
        tx,
        'integration.secret_rotated',
        { type: ENTITY, id },
        {},
        { businessId, actorUserId: userId },
      );
      return this.view(saved);
    });
  }

  /** One signed test event to the endpoint; the answer is the facts of the call. */
  async test(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<CustomIntegrationTestResult> {
    requireManage(tenant);
    const c = await this.inFirm(businessId, (tx) => this.load(tx, businessId, id));
    if (c.status === 'DISCONNECTED') throw integrationErrors.notConnected();
    const s = this.storedOf(c.settings);
    if (!s.endpointUrl) throw integrationErrors.invalidConfiguration('Set an endpoint first');
    const secret = c.secretRef ? await this.secrets.get(c.secretRef) : null;
    const eventId = randomUUID();
    const body = JSON.stringify({
      id: eventId,
      event: 'test',
      createdAt: new Date().toISOString(),
    });
    const headers: Record<string, string> = {
      'x-firmivra-event': 'test',
      'x-firmivra-delivery': eventId,
    };
    if (secret && s.authMethod === 'API_KEY') headers['x-api-key'] = secret;
    if (secret && s.authMethod === 'BEARER_TOKEN') headers.authorization = `Bearer ${secret}`;
    if (secret && s.authMethod === 'HMAC_SIGNATURE') {
      headers['x-firmivra-signature'] =
        `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    }
    const result = await this.http.post(s.endpointUrl, headers, body);
    const ok =
      result.failure === null &&
      result.status !== null &&
      result.status >= 200 &&
      result.status < 300;
    const message = ok
      ? `The endpoint answered ${result.status}`
      : result.failure === 'blocked'
        ? 'That address cannot be reached (use a public https address)'
        : result.failure === 'timeout'
          ? 'The endpoint did not answer in time'
          : result.failure === 'unreachable'
            ? 'The endpoint could not be reached'
            : `The endpoint answered ${result.status}`;
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
          errorCode: ok ? null : (result.failure ?? 'endpoint_error'),
          errorMessage: ok ? null : message,
          startedAt: now,
          finishedAt: now,
        },
        select: { id: true },
      });
      await tx.integrationConnection.update({ where: { id }, data: { lastCheckAt: now } });
      await this.audit.logIn(
        tx,
        'integration.custom_tested',
        { type: ENTITY, id },
        { ok },
        { businessId, actorUserId: userId },
      );
      return run.id;
    });
    return { ok, statusCode: result.status, durationMs: result.durationMs, message, runId };
  }
}
