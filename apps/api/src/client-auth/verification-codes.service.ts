import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
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
/** "Resend Code" works again 45 s after the last code (counted from the database's createdAt). */
export const RESEND_GAP_MS = 45_000;
/** Wrong guesses allowed per code; then only a new code helps. */
export const MAX_ATTEMPTS = 5;
/** HKDF label for the key that hashes codes; a new label (v2) voids every open code. */
const CODE_KEY_LABEL = 'fv-client-code-v1';

const rateLimited = () =>
  new HttpException(
    { code: 'RATE_LIMITED', message: 'Wait a moment before asking for a new code' },
    HttpStatus.TOO_MANY_REQUESTS,
  );

/**
 * Sign-up codes in R0's verification_codes table: only an HMAC of the code is stored, and the
 * attempts, expiry and use live on the server, so replaying an old sign-up cookie resets nothing.
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
   * Stores a new code for `target` and returns it for sending. 429 RATE_LIMITED within the
   * resend gap of the previous code to the same target.
   */
  async issue(
    businessId: string,
    clientAccountId: string,
    channel: Channel,
    target: string,
  ): Promise<string> {
    const latest = await this.latest(businessId, clientAccountId, channel);
    // A changed email or phone gets its code at once; the same target waits for the gap.
    const sameTarget = latest?.target === target;
    if (latest && sameTarget && Date.now() < latest.createdAt.getTime() + RESEND_GAP_MS) {
      throw rateLimited();
    }
    const code = this.localMode ? LOCAL_CODE : String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.db.forBusiness(businessId).verificationCode.create({
      data: {
        businessId,
        clientAccountId,
        channel,
        target,
        codeHash: this.hash(clientAccountId, channel, code),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
      },
    });
    return code;
  }

  /** When "Resend Code" works again for this channel, or null when no code was sent. */
  async resendAvailableAt(
    businessId: string,
    clientAccountId: string,
    channel: Channel,
  ): Promise<Date | null> {
    const latest = await this.latest(businessId, clientAccountId, channel);
    return latest ? new Date(latest.createdAt.getTime() + RESEND_GAP_MS) : null;
  }

  /**
   * True when `code` matches the newest open code for this exact target; it is then used up.
   * A wrong guess counts an attempt; after MAX_ATTEMPTS the code no longer works.
   */
  async check(
    businessId: string,
    clientAccountId: string,
    channel: Channel,
    target: string,
    code: string,
  ): Promise<boolean> {
    const latest = await this.latest(businessId, clientAccountId, channel);
    if (
      !latest ||
      latest.consumedAt ||
      latest.expiresAt.getTime() <= Date.now() ||
      latest.target !== target ||
      latest.attempts >= MAX_ATTEMPTS
    ) {
      return false;
    }
    const scope = this.db.forBusiness(businessId);
    if (!this.matches(this.hash(clientAccountId, channel, code), latest.codeHash)) {
      await scope.verificationCode.update({
        where: { id: latest.id },
        data: { attempts: { increment: 1 } },
      });
      return false;
    }
    // The database refuses this for an expired or no longer newest code.
    await scope.verificationCode.update({
      where: { id: latest.id },
      data: { consumedAt: new Date() },
    });
    return true;
  }

  private latest(businessId: string, clientAccountId: string, channel: Channel) {
    return this.db.forBusiness(businessId).verificationCode.findFirst({
      where: { clientAccountId, channel },
      orderBy: { createdAt: 'desc' },
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

  /** Bound to the account and channel, so a stored hash means nothing anywhere else. */
  private hash(clientAccountId: string, channel: Channel, code: string): string {
    return createHmac('sha256', this.key)
      .update(`${clientAccountId}:${channel}:${code}`)
      .digest('hex');
  }

  private matches(hash: string, stored: string): boolean {
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(stored, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
