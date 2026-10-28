import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Database } from '@firmivra/db';
import { requestContext } from '../common/request-context.js';
import { communicationJobsOn } from '../communications/communications-delivery.service.js';
import { DATABASE } from '../database/database.module.js';
import { OutboundMessagesService } from './outbound.service.js';

export const OUTBOUND_LOCK_KEY = 0x5260_0001;
export const OUTBOUND_JOB_INTERVAL_MS = 60_000;
const BUDGET_MS = 20_000;

/**
 * Sends New Message's scheduled messages when their time comes (MSG-F14). In process like the
 * other jobs, on the Communications jobs switch; one Postgres advisory lock so only one API task
 * runs it at a time. A firm's failure is logged with ids only and never stops the others.
 */
@Injectable()
export class OutboundMessagesJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('OutboundMessagesJob');
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly outbound: OutboundMessagesService,
  ) {}

  onApplicationBootstrap(): void {
    if (communicationJobsOn()) this.start();
  }

  onModuleDestroy(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  start(intervalMs = OUTBOUND_JOB_INTERVAL_MS): void {
    if (this.timers.length > 0) return;
    this.timers = [
      setTimeout(() => void this.tick(), 30_000),
      setInterval(() => void this.tick(), intervalMs),
    ];
    for (const timer of this.timers) timer.unref();
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.run();
    } catch (error) {
      this.logger.error(`tick failed (${error instanceof Error ? error.name : 'Error'})`);
    } finally {
      this.running = false;
    }
  }

  /** One run under the lock: each firm's due messages. `businessIds` narrows it (tests). */
  async run(options: { now?: Date; businessIds?: string[] } = {}): Promise<{ sent: number }> {
    return this.database.withScope({ kind: 'platform' }, async (tx) => {
      const [row] = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${OUTBOUND_LOCK_KEY}::bigint) AS locked`;
      if (!row?.locked) return { sent: 0 };
      const now = options.now ?? new Date();
      const deadline = Date.now() + BUDGET_MS;
      const firms = await this.database.forPlatform().business.findMany({
        where: {
          status: 'ACTIVE',
          ...(options.businessIds ? { id: { in: options.businessIds } } : {}),
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      let sent = 0;
      for (const { id: businessId } of firms) {
        if (Date.now() > deadline) break;
        try {
          for (const due of await this.outbound.due(businessId, now)) {
            // Work done by the job, not a request: the audit log and the Messages service read the
            // firm and the person from the request context, so it is opened as the author.
            await requestContext.run(
              {
                requestId: randomUUID(),
                tenant: { businessId, role: 'OWNER', kind: 'staff' },
                auth: { userId: due.authorUserId, cognitoSub: due.authorUserId, pool: 'STAFF' },
              },
              () => this.outbound.deliver(businessId, due.id),
            );
            sent += 1;
          }
        } catch (error) {
          this.logger.warn(
            `firm ${businessId} failed (${error instanceof Error ? error.name : 'Error'})`,
          );
        }
      }
      return { sent };
    });
  }
}
