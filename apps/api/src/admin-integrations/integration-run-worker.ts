import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import type { PlatformIntegrationStatus } from '@firmivra/types';
import { DATABASE } from '../database/database.module.js';
import { logIn } from './integration-records.js';
import { CLEARED_BY_TEST, ENVIRONMENT_LABELS, type TestOutcome } from './integrations.rules.js';

export interface FinishTest {
  runId: string;
  integration: {
    id: string;
    name: string;
    provider: string;
    environment: 'LIVE' | 'TEST';
    status: PlatformIntegrationStatus;
    statusReason: string | null;
  };
  outcome: TestOutcome;
  latencyMs: number;
  correlationId: string;
  requestedByUserId: string;
}

/**
 * The worker's side of a connection test (B8: only the platform scope moves a run, records a
 * check's result and moves an integration's health). The admin route queues the TEST run in admin
 * scope, then this finishes it at once, because the screen waits for the answer: the run goes
 * RUNNING and then SUCCEEDED or FAILED, the log gets the result, and the integration its check
 * time, its result and its health. Sync runs stay QUEUED for R1's sync worker.
 */
@Injectable()
export class IntegrationRunWorker {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** Returns the log row's id. */
  async finishTest(t: FinishTest): Promise<string> {
    const { outcome, integration } = t;
    return this.database.withScope({ kind: 'platform' }, async (tx) => {
      await tx.platformIntegrationRun.update({
        where: { id: t.runId },
        data: { status: 'RUNNING' },
      });
      await tx.platformIntegrationRun.update({
        where: { id: t.runId },
        data: outcome.ok
          ? { status: 'SUCCEEDED' }
          : {
              status: 'FAILED',
              errorCode: outcome.errorCode ?? 'test_failed',
              errorMessage: outcome.message.slice(0, 1000),
            },
      });
      const logId = await logIn(tx, {
        integration,
        eventType: 'connection.test',
        action: 'test_connection',
        message: outcome.ok
          ? `${integration.name} connection test passed (${ENVIRONMENT_LABELS[integration.environment]})`
          : `${integration.name} connection test failed`,
        severity: outcome.ok ? 'INFO' : 'ERROR',
        succeeded: outcome.ok,
        errorCode: outcome.errorCode,
        details: { result: outcome.message, latencyMs: t.latencyMs, kind: outcome.kind },
        correlationId: t.correlationId,
        actorUserId: t.requestedByUserId,
      });
      // The health check's view: a failed test puts a running service in Error; a passing one
      // clears a credential problem (not a provider's slowness, which health checks clear).
      const health: { status?: PlatformIntegrationStatus; statusReason?: string | null } =
        !outcome.ok && integration.status === 'ACTIVE'
          ? { status: 'ERROR', statusReason: outcome.errorCode ?? 'test_failed' }
          : outcome.ok &&
              (integration.status === 'ERROR' || integration.status === 'NEEDS_ATTENTION') &&
              (integration.statusReason === null || CLEARED_BY_TEST.has(integration.statusReason))
            ? { status: 'ACTIVE', statusReason: null }
            : outcome.ok &&
                integration.statusReason &&
                CLEARED_BY_TEST.has(integration.statusReason)
              ? { statusReason: null }
              : {};
      await tx.platformIntegration.update({
        where: { id: integration.id },
        data: { lastCheckAt: new Date(), lastCheckOk: outcome.ok, ...health },
      });
      return logId;
    });
  }
}
