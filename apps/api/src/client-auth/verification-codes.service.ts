import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { poolSecrets, deriveKey } from '../auth/sealed.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';

export type Channel = 'EMAIL' | 'PHONE';

/** Locally every code is this (docs/api/client-auth.yaml, "Local development"). */
export const LOCAL_CODE = '000000';
/** A code works for 10 minutes; the database refuses more than 15. */
const CODE_TTL_MS = 10 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
/**
 * Limits on codes, counted in the database (#51 review). Mutable for tests only.
 * - resendGapMs: after a code for an account and channel, the next one waits, whatever its
 *   address (a changed email or phone included), so alternating addresses sends nothing extra.
 * - perAccountPerDay / perTargetPerDay: codes a day for one account and channel, and to one
 *   address at the firm. Above them nothing is sent, and the answer stays the same.
 * - maxAttempts: wrong or right guesses per code, counted before comparing.
 */
export const CODE_LIMITS = {
  resendGapMs: 45_000,
  perAccountPerDay: 10,
  perTargetPerDay: 10,
  maxAttempts: 5,
};
/** HKDF label for the key that hashes codes; a new label (v2) voids every open code. */
const CODE_KEY_LABEL = 'fv-client-code-v2';

/** Who a code is for: one sign-up attempt (its own login) on one account. */
export interface CodeOwner {
  businessId: string;
  clientAccountId: string;
  attemptUserId: string;
}

export type Issued = { sent: true; code: string } | { sent: false; reason: 'gap' | 'cap' };

/** A refusal from R0's verification_codes trigger (expired, or no longer the newest). */
const refusedByDatabase = (e: unknown) =>
  e instanceof Error && e.message.includes('verification codes:');

/**
 * Sign-up codes in R0's verification_codes table: only an HMAC of the code is stored, bound to the
 * account, the attempt and the channel. Attempts, expiry and use live on the server, so replaying
 * an old sign-up cookie resets nothing, and a code issued for one attempt never verifies another.
 */
@Injectable()
export class VerificationCodesService {
  private readonly key: Uint8Array;
  private readonly localMode: boolean;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) env: Env,
  ) {
    const secret = poolSecrets(env).CLIENT;
    if (!secret) throw new Error('No key for client verification codes');
    this.key = deriveKey(secret, 'CLIENT', CODE_KEY_LABEL);
    this.localMode = env.AUTH_MODE === 'local';
  }

  /**
   * A new code for `target`, unless the gap since the last code for this account and channel has
   * not passed (`gap`) or a daily cap is reached (`cap`). Issues for one account and channel run
   * one at a time (a transaction-scoped advisory lock), so parallel resends send one code.
   */
  issue(owner: CodeOwner, channel: Channel, target: string): Promise<Issued> {
    const { businessId, clientAccountId } = owner;
    return this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${clientAccountId}:${channel}`}, 0))`;
      const latest = await tx.verificationCode.findFirst({
        where: { clientAccountId, channel },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { createdAt: true },
      });
      if (latest && Date.now() < latest.createdAt.getTime() + CODE_LIMITS.resendGapMs) {
        return { sent: false, reason: 'gap' };
      }
      const since = new Date(Date.now() - DAY_MS);
      const [forAccount, forTarget] = await Promise.all([
        tx.verificationCode.count({
          where: { clientAccountId, channel, createdAt: { gt: since } },
        }),
        tx.verificationCode.count({ where: { channel, target, createdAt: { gt: since } } }),
      ]);
      if (forAccount >= CODE_LIMITS.perAccountPerDay || forTarget >= CODE_LIMITS.perTargetPerDay) {
        return { sent: false, reason: 'cap' };
      }
      const code = this.localMode ? LOCAL_CODE : String(randomInt(0, 1_000_000)).padStart(6, '0');
      await tx.verificationCode.create({
        data: {
          businessId,
          clientAccountId,
          channel,
          target,
          codeHash: this.hash(owner, channel, code),
          expiresAt: new Date(Date.now() + CODE_TTL_MS),
        },
      });
      return { sent: true, code };
    });
  }

  /** When "Resend Code" works again for this account and channel, or null when none was sent. */
  async resendAvailableAt(
    businessId: string,
    clientAccountId: string,
    channel: Channel,
  ): Promise<Date | null> {
    const latest = await this.db.forBusiness(businessId).verificationCode.findFirst({
      where: { clientAccountId, channel },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { createdAt: true },
    });
    return latest ? new Date(latest.createdAt.getTime() + CODE_LIMITS.resendGapMs) : null;
  }

  /**
   * True when `code` is this attempt's newest open code for this exact target; it is then used
   * up. Each guess, right or wrong, first takes one attempt with a conditional update, so even
   * parallel guesses get at most CODE_LIMITS.maxAttempts comparisons.
   */
  async check(owner: CodeOwner, channel: Channel, target: string, code: string): Promise<boolean> {
    const scope = this.db.forBusiness(owner.businessId);
    const latest = await scope.verificationCode.findFirst({
      where: { clientAccountId: owner.clientAccountId, channel },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, target: true, codeHash: true },
    });
    if (!latest || latest.target !== target) return false;
    const attempt = await scope.verificationCode.updateMany({
      where: {
        id: latest.id,
        attempts: { lt: CODE_LIMITS.maxAttempts },
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { attempts: { increment: 1 } },
    });
    if (attempt.count !== 1) return false;
    if (!this.matches(this.hash(owner, channel, code), latest.codeHash)) return false;
    try {
      const used = await scope.verificationCode.updateMany({
        where: { id: latest.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      return used.count === 1;
    } catch (e) {
      // Expired by the database's clock, or a newer code arrived meanwhile.
      if (refusedByDatabase(e)) return false;
      throw e;
    }
  }

  /** Bound to the account, the attempt and the channel: a hash means nothing anywhere else. */
  private hash(owner: CodeOwner, channel: Channel, code: string): string {
    return createHmac('sha256', this.key)
      .update(`${owner.clientAccountId}:${owner.attemptUserId}:${channel}:${code}`)
      .digest('hex');
  }

  private matches(hash: string, stored: string): boolean {
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(stored, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
