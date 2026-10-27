import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import type { StaffPhoneState } from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { deriveKey, poolSecrets } from '../auth/sealed.js';
import { CODE_LIMITS, LOCAL_CODE } from '../client-auth/verification-codes.service.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { NOTIFY_SERVICE, type NotifyService } from '../notify/notify.types.js';

/** The signed-in member, from AuthGuard and TenantGuard: never from the URL or the body. */
export interface PhoneOwner {
  businessId: string;
  userId: string;
}

/**
 * Limits on staff phone codes (R60's column request 13). Mutable for tests only.
 * - resendGapMs: one code a minute for a member.
 * - perUserPerDay: codes a day for a member at this firm.
 * - maxAttempts: guesses per code, counted before comparing.
 * - ttlMs: a code works for 10 minutes (the database refuses more than 15).
 * The firm's daily SMS cap is the client codes' (CODE_LIMITS.smsPerFirmPerDay), counted over both.
 */
export const STAFF_PHONE_LIMITS = {
  resendGapMs: 60_000,
  perUserPerDay: 10,
  maxAttempts: 5,
  ttlMs: 10 * 60_000,
};
const DAY_MS = 24 * 60 * 60_000;
/** HKDF label for the key that hashes staff codes; a new label (v2) voids every open code. */
const CODE_KEY_LABEL = 'fv-staff-phone-code-v1';

const fail = (status: HttpStatus, code: string, message: string, extra: object = {}) =>
  new HttpException({ code, message, ...extra }, status);
const ERRORS = {
  noPhone: () =>
    fail(
      HttpStatus.CONFLICT,
      'NO_PHONE',
      'Your staff record has no mobile number. Ask an administrator to add it.',
    ),
  wait: (seconds: number) =>
    fail(
      HttpStatus.TOO_MANY_REQUESTS,
      'CODE_WAIT',
      'A code was sent less than a minute ago. Wait a moment, then send another.',
      // The global filter sends it as Retry-After.
      { retryAfter: Math.max(1, seconds) },
    ),
  limit: () =>
    fail(
      HttpStatus.TOO_MANY_REQUESTS,
      'CODE_LIMIT',
      'No more codes can be sent today. Try again tomorrow.',
    ),
  invalid: () =>
    fail(
      HttpStatus.BAD_REQUEST,
      'CODE_INVALID',
      'That code is not right, has expired or was already used. Check the text or send a new code.',
    ),
  changed: () =>
    fail(
      HttpStatus.CONFLICT,
      'PHONE_CHANGED',
      'Your mobile number changed after the code was sent. Send a new code.',
    ),
  sendFailed: () =>
    fail(
      HttpStatus.BAD_GATEWAY,
      'SEND_FAILED',
      'The text could not be sent. Try again in a minute.',
    ),
};

/** A transaction-scoped advisory lock on `key` if free now; never waits. */
async function tryLock(tx: TxClient, key: string): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ ok: boolean }[]>`
    SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS ok`;
  return row?.ok === true;
}

/** A refusal from the staff_phone_codes trigger (expired, or no longer the newest). */
const refusedByDatabase = (e: unknown) =>
  e instanceof Error && e.message.includes('staff phone codes:');

/**
 * A member proves they hold the mobile number on their login (R60's column requests 9 and 13): a
 * 6-digit code by text to that number, kept in R1's staff_phone_codes as an HMAC bound to the
 * member and the number, with attempts, expiry and use on the server. A right code sets
 * `users.phone_verified_at`; the database clears it whenever the number changes. Codes and
 * numbers never reach a log or an audit row (hard rule 4): ids only.
 */
@Injectable()
export class StaffPhoneService {
  private readonly key: Uint8Array;
  private readonly localMode: boolean;
  private readonly logger = new Logger(StaffPhoneService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    private readonly audit: AuditService,
    @Inject(ENV) env: Env,
  ) {
    const secret = poolSecrets(env).STAFF;
    if (!secret) throw new Error('No key for staff phone codes');
    this.key = deriveKey(secret, 'STAFF', CODE_KEY_LABEL);
    this.localMode = env.AUTH_MODE === 'local';
  }

  async state(owner: PhoneOwner): Promise<StaffPhoneState> {
    const login = await this.login(owner.userId);
    const latest = await this.latest(owner);
    const now = Date.now();
    const verified = login.phone !== null && login.phoneVerifiedAt !== null;
    const open =
      latest !== null &&
      !verified &&
      latest.target === login.phone &&
      latest.consumedAt === null &&
      latest.expiresAt.getTime() > now &&
      latest.attempts < STAFF_PHONE_LIMITS.maxAttempts;
    const resend = latest ? latest.createdAt.getTime() + STAFF_PHONE_LIMITS.resendGapMs : 0;
    return {
      phone: login.phone,
      verifiedAt: verified ? (login.phoneVerifiedAt?.toISOString() ?? null) : null,
      codeSent: open,
      resendAt: !verified && resend > now ? new Date(resend).toISOString() : null,
    };
  }

  /** Texts a new code to the member's number, within the gap and the daily caps. */
  async sendCode(owner: PhoneOwner): Promise<StaffPhoneState> {
    const login = await this.login(owner.userId);
    const target = login.phone;
    if (!target) throw ERRORS.noPhone();
    if (login.phoneVerifiedAt) return this.state(owner);
    const code = this.localMode ? LOCAL_CODE : String(randomInt(0, 1_000_000)).padStart(6, '0');
    const { businessId, userId } = owner;
    await this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      // A parallel Send for the same member sends nothing.
      if (!(await tryLock(tx, `staff-phone:${userId}`))) throw ERRORS.wait(60);
      const latest = await tx.staffPhoneCode.findFirst({
        where: { businessId, userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { createdAt: true },
      });
      const opens = latest ? latest.createdAt.getTime() + STAFF_PHONE_LIMITS.resendGapMs : 0;
      if (opens > Date.now()) throw ERRORS.wait(Math.ceil((opens - Date.now()) / 1000));
      const since = new Date(Date.now() - DAY_MS);
      const mine = await tx.staffPhoneCode.count({
        where: { businessId, userId, createdAt: { gt: since } },
      });
      if (mine >= STAFF_PHONE_LIMITS.perUserPerDay) throw ERRORS.limit();
      // The firm's texts today: its staff codes and its clients' SMS codes.
      const staffTexts = await tx.staffPhoneCode.count({
        where: { businessId, createdAt: { gt: since } },
      });
      const clientTexts = await tx.verificationCode.count({
        where: { channel: 'PHONE', createdAt: { gt: since } },
      });
      if (staffTexts + clientTexts >= CODE_LIMITS.smsPerFirmPerDay) {
        // Ids only (hard rule 4). R8 turns this line into an alarm.
        this.logger.warn(`Firm ${businessId} is at its daily SMS cap; a staff code was not sent`);
        throw ERRORS.limit();
      }
      await tx.staffPhoneCode.create({
        data: {
          businessId,
          userId,
          target,
          codeHash: this.hash(userId, target, code),
          expiresAt: new Date(Date.now() + STAFF_PHONE_LIMITS.ttlMs),
        },
      });
    });
    try {
      await this.notify.send({
        template: 'staff.phone-code',
        to: target,
        businessId,
        data: { code },
      });
    } catch {
      this.logger.warn(`Could not text a phone code to member ${userId} at firm ${businessId}`);
      throw ERRORS.sendFailed();
    }
    await this.audit.log('staff_phone.code_sent', { type: 'user', id: userId });
    return this.state(owner);
  }

  /**
   * Checks the code against the newest one for this member and number. Each guess first takes one
   * attempt with a conditional update, so parallel guesses get at most five comparisons. A right
   * code is used up in the firm's scope, then the login is marked verified in the member's own
   * scope, only while it still has the number the code went to.
   */
  async verify(owner: PhoneOwner, code: string): Promise<StaffPhoneState> {
    const { businessId, userId } = owner;
    const login = await this.login(userId);
    if (!login.phone) throw ERRORS.noPhone();
    if (login.phoneVerifiedAt) return this.state(owner);
    const latest = await this.latest(owner);
    if (!latest) throw ERRORS.invalid();
    if (latest.target !== login.phone) throw ERRORS.changed();
    const scope = this.db.forBusiness(businessId);
    const attempt = await scope.staffPhoneCode.updateMany({
      where: {
        id: latest.id,
        attempts: { lt: STAFF_PHONE_LIMITS.maxAttempts },
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { attempts: { increment: 1 } },
    });
    const right = this.matches(this.hash(userId, latest.target, code), latest.codeHash);
    if (attempt.count !== 1 || !right) throw ERRORS.invalid();
    let used = 0;
    try {
      ({ count: used } = await scope.staffPhoneCode.updateMany({
        where: { id: latest.id, consumedAt: null, expiresAt: { gt: new Date() } },
        data: { consumedAt: new Date() },
      }));
    } catch (e) {
      // Expired by the database's clock, or a newer code arrived meanwhile.
      if (!refusedByDatabase(e)) throw e;
    }
    if (used !== 1) throw ERRORS.invalid();
    const marked = await this.db.forUser(userId).user.updateMany({
      where: { id: userId, phone: latest.target },
      data: { phoneVerifiedAt: new Date() },
    });
    if (marked.count !== 1) throw ERRORS.changed();
    await this.audit.log('staff_phone.verified', { type: 'user', id: userId });
    return this.state(owner);
  }

  private async login(userId: string) {
    const user = await this.db.forUser(userId).user.findFirst({
      where: { id: userId },
      select: { phone: true, phoneVerifiedAt: true },
    });
    if (!user) throw new Error('staff phone: the signed-in login has no users row');
    return user;
  }

  private latest({ businessId, userId }: PhoneOwner) {
    return this.db.forBusiness(businessId).staffPhoneCode.findFirst({
      where: { businessId, userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        target: true,
        codeHash: true,
        attempts: true,
        expiresAt: true,
        consumedAt: true,
        createdAt: true,
      },
    });
  }

  /** Bound to the member and the number: a hash means nothing anywhere else. */
  private hash(userId: string, target: string, code: string): string {
    return createHmac('sha256', this.key).update(`${userId}:${target}:${code}`).digest('hex');
  }

  private matches(hash: string, stored: string): boolean {
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(stored, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
