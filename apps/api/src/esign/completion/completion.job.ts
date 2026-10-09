import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { esignJobsOn } from '../lifecycle/lifecycle.job.js';
import { COMPLETION_REPOSITORY, type EsignCompletionRepository } from './completion.repository.js';
import { EsignCompletionService } from './completion.service.js';

/** How often the job looks for due completions (SYSTEM-DESIGN: a 60-second tick). */
export const COMPLETION_JOB_INTERVAL_MS = 60_000;
/** Per firm and run; the rest waits for the next run. */
const BATCH = 20;
/** A run stops starting work here (the lock's transaction is capped at 30 s). */
const BUDGET_MS = 20_000;

export interface CompletionJobOptions {
  now?: Date;
  /** Only these firms (tests); otherwise every ACTIVE firm with Firm Sign on. */
  businessIds?: string[];
}

/**
 * Completion retries, in-process like the reminder jobs (q30): each run holds the job's advisory
 * lock, so one API task runs it at a time, and works firm by firm, each in its own scope. A
 * request is due from the last signature (completion_due_at) until it is filed.
 */
@Injectable()
export class EsignCompletionJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EsignCompletionJob.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(COMPLETION_REPOSITORY) private readonly repo: EsignCompletionRepository,
    @Inject(EsignCompletionService)
    private readonly completion: Pick<EsignCompletionService, 'complete'>,
  ) {}

  onApplicationBootstrap(): void {
    if (!esignJobsOn() || this.timer) return;
    this.timer = setInterval(() => {
      if (this.running) return; // a run still going in this task is not started again
      this.running = true;
      void this.run().finally(() => (this.running = false));
    }, COMPLETION_JOB_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One run; `{ skipped: true }` when another task holds the lock. Never throws. */
  async run(options: CompletionJobOptions = {}) {
    try {
      const completed = await this.repo.withJobLock(() => this.completeDue(options));
      if (completed === null) return { skipped: true } as const;
      if (completed > 0) this.logger.log(`esign completions: ${completed} completed`);
      return { skipped: false, completed } as const;
    } catch (error) {
      const name = error instanceof Error ? error.name : 'Error';
      this.logger.warn(`esign completions: run failed (${name})`);
      return { skipped: false, completed: 0 } as const;
    }
  }

  private async completeDue(options: CompletionJobOptions): Promise<number> {
    const now = options.now ?? new Date();
    const deadline = Date.now() + BUDGET_MS;
    let completed = 0;
    for (const businessId of options.businessIds ?? (await this.repo.firms())) {
      for (const id of await this.repo.due(businessId, now, BATCH)) {
        if (Date.now() > deadline) return completed;
        if ((await this.completion.complete(businessId, id)) === 'COMPLETED') completed += 1;
      }
    }
    return completed;
  }
}
