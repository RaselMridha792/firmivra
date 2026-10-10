import { randomUUID } from 'node:crypto';
import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { EsignErrorCode, EsignReadinessCode } from '@firmivra/types';
import { type RequestStore, requestContext } from '../../common/request-context.js';
import { esignJobsOn } from '../lifecycle/lifecycle.job.js';
import {
  type EsignLifecycleRepository,
  LIFECYCLE_REPOSITORY,
} from '../lifecycle/lifecycle.repository.js';
import { ESIGN_DIRECTORY, type EsignDirectory } from '../requests/esign-directory.js';
import { ESIGN_REPOSITORY, type EsignRepository } from '../requests/esign.repository.js';
import type { EsignActor } from '../requests/requests.service.js';
import { EsignSendService } from '../requests/send.service.js';
import { EsignTemplateUseService } from '../templates/template-use.service.js';
import {
  BULK_REPOSITORY,
  type EsignBulkBatchRecord,
  type EsignBulkItemRecord,
  type EsignBulkProblem,
  type EsignBulkRepository,
} from './bulk.repository.js';

/** How often the job looks for QUEUED rows (shorter than the lifecycle's: someone is waiting). */
export const BULK_JOB_INTERVAL_MS = 15_000;
/** Rows per firm and run; the rest waits for the next run. */
const BATCH = 10;
/** A run stops starting work here (the lock's transaction is capped at 30 s). */
const BUDGET_MS = 20_000;
/** A row whose run keeps failing on something other than a refusal gives up after this. */
export const BULK_MAX_ATTEMPTS = 3;

/** A refusal's own code when it is a readiness or Firm Sign code (NOT_READY: its first problem). */
export function problemOf(error: HttpException, fallback: EsignBulkProblem): EsignBulkProblem {
  const body = error.getResponse() as { code?: unknown; details?: { code?: unknown }[] };
  const first = EsignReadinessCode.safeParse(body.details?.[0]?.code);
  if (body.code === 'NOT_READY' && first.success) return first.data;
  const code = EsignErrorCode.safeParse(body.code);
  return code.success ? code.data : fallback;
}

export interface BulkJobOptions {
  /** Only these firms (tests); otherwise every ACTIVE firm with Firm Sign on. */
  businessIds?: string[];
}

/**
 * Bulk send's runner, like the lifecycle job: each run holds bulk send's advisory lock (one API
 * task at a time) and works firm by firm, a few rows each. A row makes its DRAFT with `use` (source
 * BULK, the batch's template version, the id chosen with the batch), then sends it with `send`,
 * both in the name of whoever made the batch, as they are now (a member who left or became a
 * Viewer sends nothing). Every step is safe to repeat: a DRAFT already made is found by its id, and
 * a request no longer a DRAFT counts as sent, so a retry never makes or sends twice. A refusal
 * ends the row NOT_SENT with its code (the DRAFT stays); any other failure is tried again next run,
 * at most BULK_MAX_ATTEMPTS times. Off unless ESIGN_JOBS=on.
 */
@Injectable()
export class EsignBulkJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EsignBulkJob.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(BULK_REPOSITORY) private readonly bulk: EsignBulkRepository,
    @Inject(LIFECYCLE_REPOSITORY)
    private readonly lifecycle: Pick<EsignLifecycleRepository, 'firms'>,
    @Inject(ESIGN_REPOSITORY) private readonly repo: EsignRepository,
    @Inject(ESIGN_DIRECTORY) private readonly directory: EsignDirectory,
    @Inject(EsignTemplateUseService) private readonly uses: Pick<EsignTemplateUseService, 'use'>,
    @Inject(EsignSendService) private readonly sender: Pick<EsignSendService, 'send'>,
  ) {}

  onApplicationBootstrap(): void {
    if (!esignJobsOn() || this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = true;
      void this.run().finally(() => (this.running = false));
    }, BULK_JOB_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One run; `{ skipped: true }` when another task holds the lock. Never throws. */
  async run(options: BulkJobOptions = {}) {
    try {
      const done = await this.bulk.withJobLock(() => this.work(options));
      return done === null ? ({ skipped: true } as const) : { skipped: false, ...done };
    } catch (error) {
      this.logger.warn(`esign bulk: run failed (${error instanceof Error ? error.name : 'Error'})`);
      return { skipped: false, processed: 0 };
    }
  }

  private async work(options: BulkJobOptions) {
    const deadline = Date.now() + BUDGET_MS;
    let processed = 0;
    for (const businessId of options.businessIds ?? (await this.lifecycle.firms())) {
      const batches = new Map<string, EsignBulkBatchRecord | null>();
      for (const { batchId, position } of await this.bulk.queued(businessId, BATCH)) {
        if (Date.now() > deadline) return { processed };
        if (!batches.has(batchId)) batches.set(batchId, await this.bulk.find(businessId, batchId));
        const batch = batches.get(batchId);
        const item = batch?.items.find((i) => i.position === position);
        if (!batch || item?.state !== 'QUEUED') continue;
        await this.step(businessId, batch, item).catch(async (error: unknown) => {
          const name = error instanceof Error ? error.name : 'Error';
          this.logger.warn(`esign bulk: batch ${batchId} row ${position} failed (${name})`);
          const attempts = item.attempts + 1;
          const end = attempts >= BULK_MAX_ATTEMPTS;
          await this.bulk.updateItem(businessId, batchId, position, {
            attempts,
            ...(end && { state: 'NOT_SENT', problem: item.created ? 'NOT_READY' : 'NO_CLIENT' }),
          });
        });
        processed += 1;
      }
    }
    return { processed };
  }

  /** One row, in a context naming the firm and the batch's maker (their audit rows). */
  private async step(businessId: string, b: EsignBulkBatchRecord, item: EsignBulkItemRecord) {
    const set = (patch: Parameters<EsignBulkRepository['updateItem']>[3]) =>
      this.bulk.updateItem(businessId, b.id, item.position, patch);
    const end = (problem: EsignBulkProblem) => set({ state: 'NOT_SENT', problem });
    const [role, member] = await Promise.all([
      this.repo.esignRole(businessId, b.createdByUserId),
      this.directory.member(businessId, b.createdByUserId),
    ]);
    if (!role || !member?.active) return end('NOT_A_MEMBER');
    const actor: EsignActor = { userId: b.createdByUserId, role };
    const store: RequestStore = {
      requestId: randomUUID(),
      auth: { userId: actor.userId, cognitoSub: '', pool: 'STAFF' as const },
      tenant: { businessId, kind: 'staff' as const, role: firmRole(role) },
    };
    return requestContext.run(store, async () => {
      if (!item.created) {
        if (!(await this.repo.findRequest(businessId, item.requestId))) {
          const engagementId = item.engagementId ?? (await this.onlyService(businessId, item));
          const body = {
            ...{ clientId: item.clientId, roles: b.roles },
            ...(engagementId && { engagementId }),
            ...(b.title && { title: b.title }),
          };
          const options = {
            id: item.requestId,
            source: 'BULK' as const,
            version: b.templateVersion,
          };
          try {
            await this.uses.use(businessId, actor, b.templateId, body, options);
          } catch (error) {
            if (error instanceof HttpException) return end(problemOf(error, 'NO_CLIENT'));
            throw error;
          }
        }
        await set({ created: true });
        item.created = true;
      }
      const request = await this.repo.findRequest(businessId, item.requestId);
      if (!request) return end('INVALID_STATE'); // discarded by someone since
      if (request.status === 'NEEDS_APPROVAL') return end('APPROVAL_PENDING');
      if (request.status !== 'DRAFT') return set({ state: 'SENT' }); // sent before a retry
      try {
        await this.sender.send(businessId, actor, item.requestId);
      } catch (error) {
        if (error instanceof HttpException) return end(problemOf(error, 'NOT_READY'));
        throw error;
      }
      return set({ state: 'SENT' });
    });
  }

  /** The client's only open service; none when it has none or several (NO_ENGAGEMENT then). */
  private async onlyService(businessId: string, item: EsignBulkItemRecord) {
    const open = await this.directory.openEngagements(businessId, item.clientId);
    return open.length === 1 ? open[0]!.id : null;
  }
}

/** The tenant context's firm role for a Firm Sign role (MANAGER and VIEWER are Staff). */
const firmRole = (role: EsignActor['role']): 'OWNER' | 'ADMIN' | 'STAFF' =>
  role === 'OWNER' || role === 'ADMIN' ? role : 'STAFF';
