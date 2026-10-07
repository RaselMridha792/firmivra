import { createHmac, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import type { Database } from '@firmivra/db';
import {
  type AccountType,
  portalCookies,
  type SignUpRequest,
  type SignUpState,
} from '@firmivra/types';
import { AuditService, type AuditEntity } from '../audit/audit.service.js';
import { requestContext } from '../common/request-context.js';
import { runFlow } from '../auth/auth-errors.js';
import { IDENTITY_PROVIDER, type IdentityProvider } from '../auth/identity/identity-provider.js';
import { deriveKey, poolSecrets } from '../auth/sealed.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { CLIENT_CODE_SENDER, type ClientCodeSender } from './client-code-sender.js';
import { PortalInfoService } from './portal-info.controller.js';
import {
  SIGN_UP_SECONDS,
  type SignUpSession,
  SignUpSessions,
  signUpErrors,
  writeSignUpCookie,
} from './sign-up-session.js';
import {
  type Channel,
  CODE_LIMITS,
  type CodeOwner,
  VerificationCodesService,
} from './verification-codes.service.js';

type Step = SignUpState['step'];
type Firm = { id: string; slug: string; name: string };

/**
 * Sign-up limits counted in the database (#51 review), the same on every path. Mutable for tests.
 * - perEmailPerDay, perFirmPerDay: sign-ups (and changes to a new email) for one email at a firm,
 *   and at the firm, in a day; then 429. They also bound the logins sign-up creates.
 * - sendsPerSession: requests for a code (sign-up, resend, changes) in one sign-up session.
 * - noticeGapMs: at most one "already registered" email to an account in this window.
 */
export const SIGN_UP_LIMITS = {
  perEmailPerDay: 5,
  perFirmPerDay: 200,
  sendsPerSession: 10,
  noticeGapMs: 60 * 60_000,
  /** Sign-ups and code requests from one IP in an hour, across every firm (SMS cost guard). */
  perIpPerHour: 10,
};
/** In AWS every sign-up answer takes at least this long, so its timing shows nothing. */
export const COGNITO_MIN_RESPONSE_MS = 1_000;
const DAY_MS = 24 * 60 * 60_000;
const SIGN_UP_ATTEMPT = 'client_auth.sign_up_attempt';
/** A request that may send a code (sign-up, resend, a changed email or phone), counted per IP. */
const CODE_REQUEST = 'client_auth.code_request';
const HOUR_MS = 60 * 60_000;
const REGISTERED_NOTICE = 'client_account.registered_notice';
/** Same key as portal sign-in's per-email limit: an email is counted per firm. */
const EMAIL_KEY_LABEL = 'fv-auth-email-key-v1';

const isUniqueViolation = (e: unknown) => (e as { code?: string }).code === 'P2002';

type AccountRow = {
  id: string;
  email: string;
  status: string;
  emailVerifiedAt: Date | null;
  phoneVerifiedAt: Date | null;
  clientId: string | null;
  userId: string;
};
const ACCOUNT = {
  id: true,
  email: true,
  status: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
  clientId: true,
  userId: true,
} as const;

/** A sign-up nobody finished: another attempt may take it over, once it proves the email. */
const unfinished = (a: Pick<AccountRow, 'status' | 'emailVerifiedAt' | 'clientId'>) =>
  a.status === 'PENDING_APPROVAL' && !a.emailVerifiedAt && !a.clientId;
const stepOf = (a: AccountRow): Step =>
  !a.emailVerifiedAt ? 'VERIFY_EMAIL' : !a.phoneVerifiedAt ? 'VERIFY_PHONE' : 'DONE';

/** "(770) ***-0123" for US numbers, "+44 *** 0123" elsewhere. */
export function maskPhone(phone: string): string {
  return /^\+1\d{10}$/.test(phone)
    ? `(${phone.slice(2, 5)}) ***-${phone.slice(-4)}`
    : `${phone.slice(0, 3)} *** ${phone.slice(-4)}`;
}

/** Runs `work`, then waits until at least `ms` have passed, also when it fails. */
export async function atLeast<T>(ms: number, work: () => Promise<T>): Promise<T> {
  const until = Date.now() + ms;
  try {
    return await work();
  } finally {
    const wait = until - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

/**
 * Client portal sign-up (docs/api/client-auth.yaml): account, then the email code, then the SMS
 * code. Every answer, cookie and Cognito call is the same whether or not the email has an account
 * at the firm (#51 review):
 * - Each sign-up makes its own attempt login (Cognito user and user row) with the password, name
 *   and phone. Sign-up never changes an existing account or its login.
 * - A new email gets a pending account owned by the attempt. An unfinished sign-up's account is
 *   left as it is: the attempt takes it over only when it proves the email with its own code.
 *   Any other existing account: the attempt goes nowhere, and the owner gets one email saying so.
 * The pages store nothing: the sealed cookie says which attempt and account.
 */
@Injectable()
export class SignUpService {
  private readonly secure: boolean;
  private readonly minResponseMs: number;
  private readonly emailKeySecret: Uint8Array;
  private readonly logger = new Logger(SignUpService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    @Inject(CLIENT_CODE_SENDER) private readonly sender: ClientCodeSender,
    private readonly portal: PortalInfoService,
    private readonly codes: VerificationCodesService,
    private readonly sessions: SignUpSessions,
    private readonly audit: AuditService,
    @Inject(ENV) env: Env,
  ) {
    this.secure = env.NODE_ENV === 'production';
    this.minResponseMs = env.AUTH_MODE === 'cognito' ? COGNITO_MIN_RESPONSE_MS : 0;
    const secret = poolSecrets(env).CLIENT;
    if (!secret) throw new Error('No key for client email hashes');
    this.emailKeySecret = deriveKey(secret, 'CLIENT', EMAIL_KEY_LABEL);
  }

  signUp(
    firmSlug: string,
    input: z.output<typeof SignUpRequest>,
    req: Request,
    res: Response,
  ): Promise<SignUpState> {
    return atLeast(this.minResponseMs, async () => {
      await this.countIp();
      const firm = await this.portal.activeFirm(firmSlug);
      const documents = await this.currentDocuments(firm.id, input.accepted);
      await this.countAttempt(firm.id, input.email);
      // Every path makes the attempt's login, so the work, timing and errors are the same.
      const userId = await this.createAttemptUser(input);
      const accountId = await this.attach(firm, userId, input, documents, req);
      if (accountId) {
        await this.sendCode(this.owner(firm.id, accountId, userId), 'EMAIL', input.email, firm);
      }
      const session: SignUpSession = {
        pool: 'CLIENT',
        businessId: firm.id,
        firmSlug: firm.slug,
        clientAccountId: accountId ?? randomUUID(),
        userId,
        email: input.email,
        phone: input.phone,
        accountType: input.accountType,
        resendAt: Date.now() + CODE_LIMITS.resendGapMs,
        sends: 1,
      };
      await this.writeSession(res, session, Math.floor(Date.now() / 1000) + SIGN_UP_SECONDS);
      return this.stateOf(session);
    });
  }

  async state(firmSlug: string, req: Request): Promise<SignUpState> {
    const { value: session } = await this.session(firmSlug, req);
    return this.stateOf(session);
  }

  /**
   * The email code. On success this attempt owns the account (taking over an unfinished sign-up
   * replaces its login, which is then disabled), and the SMS code is sent.
   */
  verifyEmail(firmSlug: string, code: string, req: Request): Promise<SignUpState> {
    return atLeast(this.minResponseMs, async () => {
      const { value: s } = await this.session(firmSlug, req);
      const account = await this.attemptAccount(s);
      if (!account) throw signUpErrors.codeInvalid();
      if (account.emailVerifiedAt) throw signUpErrors.wrongStep();
      const owner = this.owner(s.businessId, account.id, s.userId);
      if (!(await this.codes.check(owner, 'EMAIL', account.email, code))) {
        throw signUpErrors.codeInvalid();
      }
      const user = await this.attemptUser(s.userId);
      await this.db.withScope({ kind: 'business', businessId: s.businessId }, async (tx) => {
        const proved = await tx.clientAccount.updateMany({
          where: { id: account.id, status: 'PENDING_APPROVAL', emailVerifiedAt: null },
          data: { emailVerifiedAt: new Date(), userId: s.userId, accountType: s.accountType },
        });
        if (proved.count !== 1) throw signUpErrors.codeInvalid();
        // In the transaction: if Cognito fails, the account is not marked verified either.
        await this.identity.updateContact('CLIENT', user.cognitoSub, { emailVerified: true });
      });
      const tookOver = account.userId !== s.userId;
      if (tookOver) await this.retireLogin(account.userId);
      await this.log(s.businessId, s.userId, 'client_account.email_verified', account.id, {
        tookOver,
      });
      const firm = await this.portal.activeFirm(s.firmSlug);
      await this.sendCode(owner, 'PHONE', user.phone ?? s.phone, firm);
      return this.stateOf(s);
    });
  }

  /** The SMS code, only for the attempt that proved the email. The account then waits for the firm. */
  verifyPhone(firmSlug: string, code: string, req: Request): Promise<SignUpState> {
    return atLeast(this.minResponseMs, async () => {
      const { value: s } = await this.session(firmSlug, req);
      const account = await this.attemptAccount(s);
      // Without an account this session looks like the email step, as a real one would.
      if (!account?.emailVerifiedAt || account.phoneVerifiedAt) throw signUpErrors.wrongStep();
      const user = await this.attemptUser(s.userId);
      const owner = this.owner(s.businessId, account.id, s.userId);
      if (!(await this.codes.check(owner, 'PHONE', user.phone ?? s.phone, code))) {
        throw signUpErrors.codeInvalid();
      }
      await this.db.withScope({ kind: 'business', businessId: s.businessId }, async (tx) => {
        const proved = await tx.clientAccount.updateMany({
          where: { id: account.id, userId: s.userId, phoneVerifiedAt: null },
          data: { phoneVerifiedAt: new Date() },
        });
        if (proved.count !== 1) throw signUpErrors.codeInvalid();
        await this.identity.updateContact('CLIENT', user.cognitoSub, { phoneVerified: true });
      });
      await this.log(s.businessId, s.userId, 'client_account.verified', account.id);
      return this.stateOf(s);
    });
  }

  resend(
    firmSlug: string,
    channel: 'email' | 'phone',
    req: Request,
    res: Response,
  ): Promise<SignUpState> {
    return atLeast(this.minResponseMs, async () => {
      const { value: s, expiresAt } = await this.session(firmSlug, req);
      if (s.sends >= SIGN_UP_LIMITS.sendsPerSession) throw signUpErrors.rateLimited();
      await this.countIp();
      const account = await this.attemptAccount(s);
      const step = account ? stepOf(account) : 'VERIFY_EMAIL';
      if (channel === 'email' ? step !== 'VERIFY_EMAIL' : step === 'DONE') {
        throw signUpErrors.alreadyVerified();
      }
      if (channel === 'phone' && step !== 'VERIFY_PHONE') throw signUpErrors.wrongStep();
      const firm = await this.portal.activeFirm(s.firmSlug);
      if (account) {
        const user = await this.attemptUser(s.userId);
        const target = channel === 'email' ? account.email : (user.phone ?? s.phone);
        const owner = this.owner(s.businessId, account.id, s.userId);
        const ch = channel === 'email' ? 'EMAIL' : 'PHONE';
        const issued = await this.sendCode(owner, ch, target, firm);
        if (!issued.sent && issued.reason === 'gap') throw signUpErrors.rateLimited();
      } else {
        if (Date.now() < s.resendAt) throw signUpErrors.rateLimited();
        await this.noticeIfRegistered(firm, s.email);
      }
      const next = { ...s, resendAt: Date.now() + CODE_LIMITS.resendGapMs, sends: s.sends + 1 };
      await this.writeSession(res, next, expiresAt);
      return this.stateOf(next);
    });
  }

  /**
   * A different email, until it is verified. The attempt's login follows it: its own pending
   * account moves to the new email if that is free; otherwise the new email is attached like a
   * sign-up (new account, an unfinished one, or nowhere). Its code waits for the resend gap.
   */
  changeEmail(firmSlug: string, email: string, req: Request, res: Response) {
    return atLeast(this.minResponseMs, async () => {
      const { value: s, expiresAt } = await this.session(firmSlug, req);
      if (s.sends >= SIGN_UP_LIMITS.sendsPerSession) throw signUpErrors.rateLimited();
      await this.countIp();
      const firm = await this.portal.activeFirm(s.firmSlug);
      const scope = this.db.forBusiness(firm.id);
      const owned = await scope.clientAccount.findUnique({
        where: { userId: s.userId },
        select: ACCOUNT,
      });
      if (owned?.emailVerifiedAt) throw signUpErrors.alreadyVerified();
      await this.countAttempt(firm.id, email);

      let accountId: string | null;
      if (owned) {
        const taken = await scope.clientAccount.findUnique({
          where: { businessId_email: { businessId: firm.id, email } },
          select: ACCOUNT,
        });
        if (!taken || taken.id === owned.id) {
          if (owned.email !== email) {
            await scope.clientAccount.update({ where: { id: owned.id }, data: { email } });
          }
          accountId = owned.id;
        } else {
          // The login already owns its first account, so it cannot take over another one.
          if (!unfinished(taken)) await this.notifyRegistered(firm, taken.id, email);
          accountId = null;
        }
      } else {
        const documents = await this.currentDocuments(firm.id);
        accountId = await this.attach(
          firm,
          s.userId,
          { email, accountType: s.accountType },
          documents,
          req,
        );
      }
      await this.moveLoginEmail(s.userId, email);
      if (accountId) {
        await this.sendCode(this.owner(firm.id, accountId, s.userId), 'EMAIL', email, firm);
        await this.log(firm.id, s.userId, 'client_account.email_changed', accountId);
      }
      const next: SignUpSession = {
        ...s,
        clientAccountId: accountId ?? randomUUID(),
        email,
        resendAt: Date.now() + CODE_LIMITS.resendGapMs,
        sends: s.sends + 1,
      };
      await this.writeSession(res, next, expiresAt);
      return this.stateOf(next);
    });
  }

  /** A different phone, until it is verified: the attempt's own login only. */
  changePhone(firmSlug: string, phone: string, req: Request, res: Response) {
    return atLeast(this.minResponseMs, async () => {
      const { value: s, expiresAt } = await this.session(firmSlug, req);
      if (s.sends >= SIGN_UP_LIMITS.sendsPerSession) throw signUpErrors.rateLimited();
      await this.countIp();
      const owned = await this.db.forBusiness(s.businessId).clientAccount.findUnique({
        where: { userId: s.userId },
        select: ACCOUNT,
      });
      if (owned?.phoneVerifiedAt) throw signUpErrors.alreadyVerified();
      const user = await this.attemptUser(s.userId);
      if (user.phone !== phone) {
        await this.db.forPlatform().user.update({ where: { id: s.userId }, data: { phone } });
        await this.identity.updateContact('CLIENT', user.cognitoSub, {
          phone,
          phoneVerified: false,
        });
      }
      if (owned) {
        if (owned.emailVerifiedAt && owned.id === s.clientAccountId) {
          const firm = await this.portal.activeFirm(s.firmSlug);
          await this.sendCode(this.owner(s.businessId, owned.id, s.userId), 'PHONE', phone, firm);
        }
        await this.log(s.businessId, s.userId, 'client_account.phone_changed', owned.id);
      }
      const next = { ...s, phone, sends: s.sends + 1 };
      await this.writeSession(res, next, expiresAt);
      return this.stateOf(next);
    });
  }

  /**
   * The attempt's own login: a Cognito user with the password, and its user row. A refused
   * password disables the half-made login and answers PASSWORD_REJECTED, on every path alike.
   */
  private async createAttemptUser(input: z.output<typeof SignUpRequest>): Promise<string> {
    const sub = await this.identity.createUser('CLIENT', input.email, {
      phone: input.phone,
      emailVerified: false,
    });
    try {
      await runFlow(() => this.identity.setPassword('CLIENT', sub, input.password));
    } catch (e) {
      await this.identity.disableUser('CLIENT', sub).catch(() => undefined);
      throw e;
    }
    // Identities are created in platform scope, then linked to the firm (the users policy).
    const user = await this.db.forPlatform().user.create({
      data: {
        cognitoSub: sub,
        pool: 'CLIENT',
        email: input.email,
        name: input.name,
        phone: input.phone,
      },
      select: { id: true },
    });
    return user.id;
  }

  /**
   * Which account an attempt is for: a new pending account it owns (with both legal
   * acceptances), an unfinished sign-up it may take over (left unchanged), or none (null) when
   * the email belongs to any other account, whose owner then gets one email.
   */
  private async attach(
    firm: Firm,
    userId: string,
    details: { email: string; accountType: AccountType },
    documents: string[],
    req: Request,
    retried = false,
  ): Promise<string | null> {
    const { email, accountType } = details;
    const scope = this.db.forBusiness(firm.id);
    const existing = await scope.clientAccount.findUnique({
      where: { businessId_email: { businessId: firm.id, email } },
      select: ACCOUNT,
    });
    if (existing && !unfinished(existing)) {
      await this.notifyRegistered(firm, existing.id, email);
      return null;
    }
    if (existing) {
      await scope.legalAcceptance.createMany({
        data: documents.map((d) => acceptance(firm.id, existing.id, d, req)),
        skipDuplicates: true,
      });
      await this.log(firm.id, userId, 'client_account.sign_up_restarted', existing.id);
      return existing.id;
    }
    try {
      const accountId = await this.db.withScope(
        { kind: 'business', businessId: firm.id },
        async (tx) => {
          const account = await tx.clientAccount.create({
            data: { businessId: firm.id, userId, email, accountType },
            select: { id: true },
          });
          await tx.legalAcceptance.createMany({
            data: documents.map((d) => acceptance(firm.id, account.id, d, req)),
          });
          return account.id;
        },
      );
      await this.log(firm.id, userId, 'client_account.signed_up', accountId);
      return accountId;
    } catch (e) {
      // A sign-up with this email at this firm a moment ago: attach to it like any unfinished one.
      if (isUniqueViolation(e) && !retried) {
        return this.attach(firm, userId, details, documents, req, true);
      }
      throw e;
    }
  }

  /**
   * The account this session's attempt may still act on, or null when it goes nowhere: no such
   * account (a random id), or another attempt proved the email first. The owner keeps it while
   * pending and once approved (the done page).
   */
  private async attemptAccount(s: SignUpSession): Promise<AccountRow | null> {
    const account = await this.db.forBusiness(s.businessId).clientAccount.findUnique({
      where: { id: s.clientAccountId },
      select: ACCOUNT,
    });
    if (!account) return null;
    if (account.userId === s.userId) {
      return account.status === 'PENDING_APPROVAL' || account.status === 'ACTIVE' ? account : null;
    }
    return unfinished(account) ? account : null;
  }

  private attemptUser(userId: string) {
    return this.db.forPlatform().user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, cognitoSub: true, phone: true, email: true },
    });
  }

  /** The login of an unfinished sign-up that another attempt took over: disabled and removed. */
  private async retireLogin(userId: string): Promise<void> {
    try {
      const user = await this.attemptUser(userId);
      await this.identity.disableUser('CLIENT', user.cognitoSub);
      await this.db.forPlatform().user.delete({ where: { id: userId } });
    } catch {
      this.logger.warn(`Could not retire the replaced sign-up login ${userId}`);
    }
  }

  /** The attempt's login follows a changed email (unverified until its code). */
  private async moveLoginEmail(userId: string, email: string): Promise<void> {
    const user = await this.attemptUser(userId);
    if (user.email === email) return;
    await this.db.forPlatform().user.update({ where: { id: userId }, data: { email } });
    await this.identity.updateContact('CLIENT', user.cognitoSub, { email, emailVerified: false });
  }

  /**
   * Sign-up limits per email and per firm, then the attempt is recorded (with a keyed hash of the
   * email, never the email). The same for every email, registered or not.
   */
  private async countAttempt(businessId: string, email: string): Promise<void> {
    const emailKey = createHmac('sha256', this.emailKeySecret)
      .update(`${businessId}:${email}`)
      .digest('hex');
    const since = new Date(Date.now() - DAY_MS);
    const scope = this.db.forBusiness(businessId);
    const where = { businessId, action: SIGN_UP_ATTEMPT, createdAt: { gt: since } };
    const [forEmail, forFirm] = await Promise.all([
      scope.auditLog.count({
        where: { ...where, metadata: { path: ['emailKey'], equals: emailKey } },
      }),
      scope.auditLog.count({ where }),
    ]);
    if (forEmail >= SIGN_UP_LIMITS.perEmailPerDay || forFirm >= SIGN_UP_LIMITS.perFirmPerDay) {
      throw signUpErrors.rateLimited();
    }
    await this.audit.log(SIGN_UP_ATTEMPT, { type: 'sign_up' }, { emailKey }, { businessId });
  }

  /**
   * The SMS cost guard: at most SIGN_UP_LIMITS.perIpPerHour sign-ups and code requests from one IP
   * in an hour, across every firm (platform audit rows, so every API task shares the count). The
   * IP is req.ip (trust proxy), never a raw header. Keyed by IP only, so it shows nothing about
   * any email.
   */
  private async countIp(): Promise<void> {
    const ip = requestContext.getStore()?.ip;
    if (!ip) return;
    const recent = await this.db.forPlatform().auditLog.count({
      where: {
        businessId: null,
        action: CODE_REQUEST,
        ip,
        createdAt: { gt: new Date(Date.now() - HOUR_MS) },
      },
    });
    if (recent >= SIGN_UP_LIMITS.perIpPerHour) throw signUpErrors.rateLimited();
    // No firm and no actor: a platform row that holds only the IP (from the request context).
    await this.audit.log(CODE_REQUEST, { type: 'sign_up' });
  }

  /** The current Terms and Privacy for a sign-up: their ids, checked against the accepted versions. */
  private async currentDocuments(
    businessId: string,
    accepted?: { termsVersion: number; privacyVersion: number },
  ): Promise<string[]> {
    const policy = await this.portal.signUpPolicy(businessId);
    if (!policy.open || !policy.terms || !policy.privacy) throw signUpErrors.closed();
    if (
      accepted &&
      (accepted.termsVersion !== policy.terms.version ||
        accepted.privacyVersion !== policy.privacy.version)
    ) {
      throw signUpErrors.termsOutdated();
    }
    return [policy.terms.id, policy.privacy.id];
  }

  /** Sends a code when the gap and the daily caps allow; otherwise the answer stays the same. */
  private async sendCode(owner: CodeOwner, channel: Channel, target: string, firm: Firm) {
    const issued = await this.codes.issue(owner, channel, target);
    if (issued.sent) {
      const message = { to: target, code: issued.code, businessName: firm.name };
      await (channel === 'EMAIL' ? this.sender.emailCode(message) : this.sender.smsCode(message));
    }
    return issued;
  }

  /** "You already have an account here" to the owner of a registered email, at most hourly. */
  private async notifyRegistered(firm: Firm, accountId: string, email: string): Promise<void> {
    const recent = await this.db.forBusiness(firm.id).auditLog.count({
      where: {
        businessId: firm.id,
        action: REGISTERED_NOTICE,
        entityId: accountId,
        createdAt: { gt: new Date(Date.now() - SIGN_UP_LIMITS.noticeGapMs) },
      },
    });
    if (recent > 0) return;
    await this.audit.log(
      REGISTERED_NOTICE,
      { type: 'client_account', id: accountId },
      {},
      { businessId: firm.id },
    );
    await this.sender.alreadyRegistered({ to: email, businessName: firm.name });
  }

  private async noticeIfRegistered(firm: Firm, email: string): Promise<void> {
    const account = await this.db.forBusiness(firm.id).clientAccount.findUnique({
      where: { businessId_email: { businessId: firm.id, email } },
      select: ACCOUNT,
    });
    if (account && !unfinished(account)) await this.notifyRegistered(firm, account.id, email);
  }

  private owner(businessId: string, clientAccountId: string, attemptUserId: string): CodeOwner {
    return { businessId, clientAccountId, attemptUserId };
  }

  private async session(firmSlug: string, req: Request) {
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const sealed = cookies?.[portalCookies(firmSlug).signUp];
    const opened = sealed ? await this.sessions.open(sealed, 'CLIENT') : undefined;
    if (!opened || opened.value.firmSlug !== firmSlug.toLowerCase()) throw signUpErrors.expired();
    return opened;
  }

  /** Every sign-up answer that changes something sets the cookie, on every path alike. */
  private writeSession(res: Response, session: SignUpSession, expiresAt: number) {
    return this.sessions
      .sealUntil(session, expiresAt)
      .then((sealed) => writeSignUpCookie(res, session.firmSlug, sealed, expiresAt, this.secure));
  }

  private async stateOf(s: SignUpSession): Promise<SignUpState> {
    const shown = { email: s.email, phoneMasked: maskPhone(s.phone) };
    const account = await this.attemptAccount(s);
    if (!account) {
      return {
        step: 'VERIFY_EMAIL',
        ...shown,
        resendAvailableAt: new Date(s.resendAt).toISOString(),
      };
    }
    const step = stepOf(account);
    if (step === 'DONE') return { step, ...shown, resendAvailableAt: null };
    const at = await this.codes.resendAvailableAt(
      s.businessId,
      account.id,
      step === 'VERIFY_EMAIL' ? 'EMAIL' : 'PHONE',
    );
    return { step, ...shown, resendAvailableAt: (at ?? new Date(s.resendAt)).toISOString() };
  }

  /** Audit rows belong to the firm even on these signed-out routes; the actor is the attempt. */
  private log(
    businessId: string,
    actorUserId: string,
    action: string,
    clientAccountId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const entity: AuditEntity = { type: 'client_account', id: clientAccountId };
    return this.audit.log(action, entity, metadata, { businessId, actorUserId });
  }
}

function acceptance(
  businessId: string,
  clientAccountId: string,
  legalDocumentId: string,
  req: Request,
) {
  return {
    businessId,
    clientAccountId,
    legalDocumentId,
    ip: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, 500) ?? null,
  };
}
