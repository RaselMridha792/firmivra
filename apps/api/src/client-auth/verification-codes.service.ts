import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import { poolSecrets, deriveKey } from '../auth/sealed.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { requestContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { networkOf } from '../common/network.js';

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
 *   address at the firm, from one network (#70 re-review: from anywhere, a stranger could use
 *   them up and silence a person's own sign-up). Above them nothing is sent, and the answer
 *   stays the same. targetAlertPerDay: codes to one address from anywhere before a warning.
 * - maxAttempts: wrong or right guesses per code, counted before comparing.
 * - smsPerFirmPerDay: SMS codes one firm sends in a day (#51 re-review); above it nothing is sent,
 *   the answer stays the same, and a warning is logged. R6 adds a platform-wide daily cap.
 */
export const CODE_LIMITS = {
  resendGapMs: 45_000,
  perAccountPerDay: 10,
  perTargetPerDay: 10,
  targetAlertPerDay: 30,
  maxAttempts: 5,
  smsPerFirmPerDay: 200,
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

/**
 * A code that went out: a firm audit row with the account, the channel, a keyed hash of the
 * address (never the address) and the request's network. The daily caps count these.
 */
const CODE_ISSUED = 'client_auth.code_issued';

/** A transaction-scoped advisory lock on `key` if free now; never waits (#70 re-review). */
async function tryLock(tx: TxClient, key: string): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ ok: boolean }[]>`
    SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS ok`;
  return row?.ok === true;
}

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
  private readonly logger = new Logger(VerificationCodesService.name);

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
   * one at a time under a transaction-scoped advisory try-lock, never waited for (a waiting lock
   * holds a pooled connection): a parallel issue for the same account sends nothing (`gap`). The
   * account and address caps count per network, so the person's own network always gets codes;
   * the firm's SMS cap is a plain count (at most a few over under concurrency, never a skip
   * because another firm member is verifying at the same moment).
   */
  issue(owner: CodeOwner, channel: Channel, target: string): Promise<Issued> {
    const { businessId, clientAccountId } = owner;
    return this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      if (!(await tryLock(tx, `${clientAccountId}:${channel}`)))
        return { sent: false, reason: 'gap' };
      const latest = await tx.verificationCode.findFirst({
        where: { clientAccountId, channel },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { createdAt: true },
      });
      if (latest && Date.now() < latest.createdAt.getTime() + CODE_LIMITS.resendGapMs) {
        return { sent: false, reason: 'gap' };
      }
      const since = new Date(Date.now() - DAY_MS);
      const net = networkOf(requestContext.getStore()?.ip);
      const tgt = this.targetKey(channel, target);
      const issued = { businessId, action: CODE_ISSUED, createdAt: { gt: since } };
      const meta = (key: string, value: string) => ({ metadata: { path: [key], equals: value } });
      const forAccount = await tx.auditLog.count({
        where: {
          AND: [issued, meta('acct', clientAccountId), meta('ch', channel), meta('net', net)],
        },
      });
      const forTarget = await tx.auditLog.count({
        where: { AND: [issued, meta('tgt', tgt), meta('net', net)] },
      });
      if (forAccount >= CODE_LIMITS.perAccountPerDay || forTarget >= CODE_LIMITS.perTargetPerDay) {
        return { sent: false, reason: 'cap' };
      }
      const toTarget = await tx.auditLog.count({ where: { AND: [issued, meta('tgt', tgt)] } });
      // At the level or above, not only at it: two codes at once can both read one short of it.
      if (toTarget + 1 >= CODE_LIMITS.targetAlertPerDay) {
        // Ids only (hard rule 4). R8 turns this line into an alarm.
        this.logger.warn(
          `An address (key ${tgt.slice(0, 12)}) at firm ${businessId} has ${toTarget + 1} codes in a day (alert at ${CODE_LIMITS.targetAlertPerDay})`,
        );
      }
      if (channel === 'PHONE') {
        // The firm's scope: its own SMS codes only.
        const smsToday = await tx.verificationCode.count({
          where: { channel: 'PHONE', createdAt: { gt: since } },
        });
        if (smsToday >= CODE_LIMITS.smsPerFirmPerDay) {
          // Each refused SMS, ids only (hard rule 4). R8 turns this line into an alarm.
          this.logger.warn(`Firm ${businessId} is at its daily SMS cap; a code was not sent`);
          return { sent: false, reason: 'cap' };
        }
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
      const store = requestContext.getStore();
      await tx.auditLog.create({
        data: {
          businessId,
          actorUserId: owner.attemptUserId,
          action: CODE_ISSUED,
          // A counter row, not a change to the account: the account id is in the metadata.
          entityType: 'sign_up',
          entityId: null,
          metadata: { acct: clientAccountId, ch: channel, tgt, net } as Prisma.InputJsonValue,
          ip: store?.ip ?? null,
          userAgent: store?.userAgent?.slice(0, 500) ?? null,
          requestId: store?.requestId ?? null,
        },
      });
      return { sent: true, code };
    });
  }

  /**
   * The id of this attempt's newest open code for this exact target when `code` matches it, else
   * null. Each guess, right or wrong, first takes one attempt with a conditional update, so even
   * parallel guesses get at most CODE_LIMITS.maxAttempts comparisons. The code is not used up
   * here: the step that depends on it does that, in its own transaction (`consume`), so a step
   * that fails afterwards leaves the code for the retry (#70 re-review).
   */
  async match(
    owner: CodeOwner,
    channel: Channel,
    target: string,
    code: string,
  ): Promise<string | null> {
    const scope = this.db.forBusiness(owner.businessId);
    const latest = await scope.verificationCode.findFirst({
      where: { clientAccountId: owner.clientAccountId, channel },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, target: true, codeHash: true },
    });
    if (!latest || latest.target !== target) return null;
    const attempt = await scope.verificationCode.updateMany({
      where: {
        id: latest.id,
        attempts: { lt: CODE_LIMITS.maxAttempts },
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { attempts: { increment: 1 } },
    });
    if (attempt.count !== 1) return null;
    return this.matches(this.hash(owner, channel, code), latest.codeHash) ? latest.id : null;
  }

  /**
   * Uses up a matched code, inside the caller's transaction: false when it was used, expired or
   * replaced meanwhile. The database's trigger refuses an expired or older code with an error,
   * which aborts the transaction; callers answer CODE_INVALID either way.
   */
  async consume(tx: TxClient, codeId: string): Promise<boolean> {
    try {
      const used = await tx.verificationCode.updateMany({
        where: { id: codeId, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      });
      return used.count === 1;
    } catch (e) {
      // Expired by the database's clock, or a newer code arrived meanwhile.
      if (refusedByDatabase(e)) return false;
      throw e;
    }
  }

  /** A keyed hash of a code's address: the caps count it; the audit log never holds the address. */
  private targetKey(channel: Channel, target: string): string {
    return createHmac('sha256', this.key).update(`target:${channel}:${target}`).digest('hex');
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
