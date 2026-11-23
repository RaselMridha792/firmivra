import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';

/** Runs once a day; trials expiring during downtime are handled on the next pass. */
export const SUBSCRIPTION_TRIAL_EXPIRY_INTERVAL_MS = 24 * 60 * 60_000;
/** Dedicated advisory lock so only one API task expires trials at a time. */
export const SUBSCRIPTION_TRIAL_EXPIRY_LOCK_KEY = 0x5537_0044;

export function subscriptionTrialExpiryOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.PLATFORM_SUBSCRIPTION_TRIAL_EXPIRY;
  if (value === undefined || value === '') return env.NODE_ENV !== 'test';
  if (value === 'on' || value === 'off') return value === 'on';
  throw new Error('PLATFORM_SUBSCRIPTION_TRIAL_EXPIRY must be "on" or "off"');
}

export type SubscriptionTrialExpiryResult = { skipped: true } | { skipped: false; expired: number };

@Injectable()
export class SubscriptionTrialExpiryJob implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SubscriptionTrialExpiryJob.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  onApplicationBootstrap(): void {
    if (subscriptionTrialExpiryOn()) this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(intervalMs = SUBSCRIPTION_TRIAL_EXPIRY_INTERVAL_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
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

  async run(options: { now?: Date } = {}): Promise<SubscriptionTrialExpiryResult> {
    const now = options.now ?? new Date();
    try {
      return await this.database.withScope(
        { kind: 'platform' },
        async (tx) => {
          const [lock] = await tx.$queryRaw<{ locked: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(${SUBSCRIPTION_TRIAL_EXPIRY_LOCK_KEY}::bigint) AS locked`;
          if (!lock?.locked) return { skipped: true } as const;

          const due = await tx.platformFirmSubscription.findMany({
            where: { status: 'TRIAL', trialEndsAt: { lte: now } },
            select: {
              id: true,
              businessId: true,
              planId: true,
              seatsIncluded: true,
              seatsPurchased: true,
            },
            orderBy: { id: 'asc' },
            take: 500,
          });
          let expired = 0;
          for (const sub of due) {
            const changed = await tx.platformFirmSubscription.updateMany({
              where: { id: sub.id, status: 'TRIAL', trialEndsAt: { lte: now } },
              data: { status: 'EXPIRED' },
            });
            if (changed.count === 0) continue;

            await tx.platformSubscriptionChange.create({
              data: {
                businessId: sub.businessId,
                subscriptionId: sub.id,
                kind: 'STATUS_CHANGED',
                fromStatus: 'TRIAL',
                toStatus: 'EXPIRED',
                fromSeats: sub.seatsIncluded + sub.seatsPurchased,
                toSeats: sub.seatsIncluded + sub.seatsPurchased,
                reason: 'Trial ended',
                effectiveAt: now,
              },
            });
            await this.audit.logIn(
              tx,
              'subscription.trial_expired',
              { type: 'subscription', id: sub.id },
              { firmId: sub.businessId, planId: sub.planId },
              { businessId: null, withoutOrigin: true },
            );
            expired += 1;
          }
          return { skipped: false, expired } as const;
        },
        { timeout: 30_000 },
      );
    } catch (error) {
      this.logger.error(`run failed (${error instanceof Error ? error.name : 'Error'})`);
      throw error;
    }
  }
}
