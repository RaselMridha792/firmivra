import { createHmac, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import type { Database, TxClient } from '@firmivra/db';
import {
  type AccountType,
  portalCookies,
  SIGN_UP_WRONG_EMAIL_CODES,
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
import { canonicalIp, networkOf } from './network.js';

export { canonicalIp, networkOf };
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
 * An attempt's code requests so far, when the next code may go out (ms since epoch), and its
 * wrong email codes (any path), which end it at CONTACT_FIRM.
 */
type AttemptState = { requests: number; resendAt: number; wrongEmailCodes: number };
/** A request let through (with the attempt's state as it was before it), or refused. */
type Admission = { ok: true; before: AttemptState | null } | { ok: false };

/**
 * Sign-up limits counted in the database (#51 and #70 reviews), the same on every path. Each is
 * counted and recorded in one transaction under an advisory lock, so parallel requests cannot pass
 * one together. Mutable for tests.
 * - perEmailNetworkPerDay: sign-ups and changes to one email at a firm from one network in a day
 *   (429). Only the network's own: a stranger elsewhere cannot block a person's sign-up.
 * - emailAlertPerDay, firmAlertPerDay: sign-ups for one email, and at one firm, in a day before a
 *   warning is logged (once a day). Never a block: nobody can close a person's or a firm's sign-up.
 * - sendsPerSession: requests (sign-up, resend, changes, the phone step's first SMS) in one attempt.
 * - perIpPerHour, perNetworkPerHour: those requests from one IP, and from one /24 (IPv4) or /48
 *   (IPv6) network, in an hour, across every firm (SMS cost guard).
 * - noticeGapMs: at most one "already registered" email to an account in this window.
 */
export const SIGN_UP_LIMITS = {
  perEmailNetworkPerDay: 5,
  emailAlertPerDay: 20,
  firmAlertPerDay: 200,
  sendsPerSession: 10,
  perIpPerHour: 10,
  perNetworkPerHour: 50,
  noticeGapMs: 60 * 60_000,
};
/** In AWS every sign-up answer takes at least this long, so its timing shows nothing. */
export const COGNITO_MIN_RESPONSE_MS = 1_000;
const DAY_MS = 24 * 60 * 60_000;
/** A sign-up or change to an email: a firm row with a keyed hash of the email and the network. */
const SIGN_UP_ATTEMPT = 'client_auth.sign_up_attempt';
/** A warning already logged today (firm row): `{ kind: 'firm' }` or `{ kind: 'email', emailKey }`. */
const SIGN_UP_ALERT = 'client_auth.sign_up_alert';
/**
 * A request that may send a code (sign-up, resend, a changed email or phone, the phone step's
 * first SMS): a platform row with the canonical IP and network and, after sign-up, the attempt's
 * login as actor. The IP limits and each attempt's gap and request count are counted from these
 * rows, on the server.
 */
const CODE_REQUEST = 'client_auth.code_request';
/** A wrong email code (on any path, the dead end included): a platform row, actor the attempt. */
const CODE_WRONG = 'client_auth.code_wrong';
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

/**
 * A sign-up nobody finished: no phone proof yet (with or without the email's), pending, no client
 * record. Another attempt may take it over, once it proves the email with its own code, so a
 * sign-up stopped after the email step (a closed tab, a refused SMS) can always be resumed.
 */
const unfinished = (a: Pick<AccountRow, 'status' | 'phoneVerifiedAt' | 'clientId'>) =>
  a.status === 'PENDING_APPROVAL' && !a.phoneVerifiedAt && !a.clientId;
const stepOf = (a: AccountRow): Step =>
  !a.emailVerifiedAt ? 'VERIFY_EMAIL' : !a.phoneVerifiedAt ? 'VERIFY_PHONE' : 'DONE';
/**
 * The step for this attempt: one that doesn't own the account yet must prove the email first, and
 * the email step ends at CONTACT_FIRM after SIGN_UP_WRONG_EMAIL_CODES wrong codes (Rasel, q13),
 * counted the same way on every path.
 */
const stepFor = (s: SignUpSession, a: AccountRow | null, attempt: AttemptState | null): Step => {
  const step = a && a.userId === s.userId ? stepOf(a) : 'VERIFY_EMAIL';
  return step === 'VERIFY_EMAIL' && (attempt?.wrongEmailCodes ?? 0) >= SIGN_UP_WRONG_EMAIL_CODES
    ? 'CONTACT_FIRM'
    : step;
};

/** "(770) ***-0123" for US numbers, "+44 *** 0123" elsewhere. */
export function maskPhone(phone: string): string {
  return /^\+1\d{10}$/.test(phone)
    ? `(${phone.slice(2, 5)}) ***-${phone.slice(-4)}`
    : `${phone.slice(0, 3)} *** ${phone.slice(-4)}`;
}

/**
 * A transaction-scoped advisory lock on `key`, without waiting (#70 re-review): false when another
 * request holds it. Waiting would hold a pooled connection, so a burst could starve every firm;
 * a contended key is a burst anyway, answered like any limit.
 */
async function tryLock(tx: TxClient, key: string): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ ok: boolean }[]>`
    SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS ok`;
  return row?.ok === true;
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
/** What `attemptState` reads, from a transaction or the platform client. */
type AttemptReader = {
  user: Pick<TxClient['user'], 'findUnique'>;
  auditLog: Pick<TxClient['auditLog'], 'count' | 'findFirst'>;
};

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
      await this.admitRequest(null);
      const firm = await this.portal.activeFirm(firmSlug);
      const documents = await this.currentDocuments(firm.id, input.accepted);
      await this.admitEmail(firm.id, input.email);
      // Every path makes the attempt's login, so the work, timing and errors are the same.
      const userId = await this.createAttemptUser(input);
      const accountId = await this.attach(firm, userId, input, true);
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
        documents,
      };
      const expiresAt = Math.floor(Date.now() / 1000) + SIGN_UP_SECONDS;
      await this.writeSession(res, session, expiresAt);
      return this.stateOf(session, expiresAt);
    });
  }

  async state(firmSlug: string, req: Request): Promise<SignUpState> {
    const { session, expiresAt } = await this.session(firmSlug, req);
    return this.stateOf(session, expiresAt);
  }

  /**
   * The email code. On success this attempt owns the account (taking over an unfinished sign-up,
   * also one stopped after its email step, replaces its login, which is then disabled), and the
   * SMS code is sent: a recorded request within the IP limits, not held to the attempt's own
   * count (else it waits for Resend). Once the email is proved, nothing fails the answer.
   */
  verifyEmail(firmSlug: string, code: string, req: Request): Promise<SignUpState> {
    return atLeast(this.minResponseMs, async () => {
      const { session: s, attempt, expiresAt } = await this.session(firmSlug, req);
      const account = await this.attemptAccount(s);
      if (stepFor(s, account, attempt) === 'CONTACT_FIRM') throw signUpErrors.wrongStep();
      if (!account) throw await this.wrongCode(s.userId);
      if (account.userId === s.userId && account.emailVerifiedAt) throw signUpErrors.wrongStep();
      // A login owns one account: an attempt that already owns another (a replayed older cookie)
      // can never take this one.
      const owns = await this.db.forBusiness(s.businessId).clientAccount.findUnique({
        where: { userId: s.userId },
        select: { id: true },
      });
      if (owns && owns.id !== account.id) throw await this.wrongCode(s.userId);
      const owner = this.owner(s.businessId, account.id, s.userId);
      const codeId = await this.codes.match(owner, 'EMAIL', account.email, code);
      if (!codeId) throw await this.wrongCode(s.userId);
      const user = await this.attemptUser(s.userId);
      const tookOver = account.userId !== s.userId;
      // Cognito first, outside any transaction (a network call must not hold a pooled
      // connection). It only marks this attempt's own login, so a later refusal leaves no harm.
      await this.identity.updateContact('CLIENT', user.cognitoSub, { emailVerified: true });
      try {
        await this.db.withScope({ kind: 'business', businessId: s.businessId }, async (tx) => {
          // The code is used up with the step it proves: a failure later leaves it for the retry.
          if (!(await this.codes.consume(tx, codeId))) throw signUpErrors.codeInvalid();
          // Exactly the account as it was read: same login, same email proof, still unfinished.
          const proved = await tx.clientAccount.updateMany({
            where: {
              id: account.id,
              status: 'PENDING_APPROVAL',
              userId: account.userId,
              emailVerifiedAt: account.emailVerifiedAt,
              phoneVerifiedAt: null,
              clientId: null,
            },
            data: { emailVerifiedAt: new Date(), userId: s.userId, accountType: s.accountType },
          });
          if (proved.count !== 1) throw signUpErrors.codeInvalid();
          await this.audit.logIn(
            tx,
            'client_account.email_verified',
            { type: 'client_account', id: account.id },
            { tookOver },
            { businessId: s.businessId, actorUserId: s.userId },
          );
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw signUpErrors.codeInvalid();
        throw e;
      }
      if (tookOver) await this.retireLogin(account.userId);
      // The email is proved: a busy database or a refused SMS never turns this into an error.
      try {
        const admitted = await this.admitRequest(s.userId, { soft: true, uncounted: true });
        if (admitted.ok) {
          const firm = await this.portal.activeFirm(s.firmSlug);
          await this.sendCode(owner, 'PHONE', user.phone ?? s.phone, firm);
        }
      } catch {
        this.logger.warn(`The first SMS code of client account ${account.id} was not sent`);
      }
      return this.stateOf(s, expiresAt).catch(() => ({
        step: 'VERIFY_PHONE' as const,
        email: s.email,
        phoneMasked: maskPhone(s.phone),
        resendAvailableAt: new Date(Date.now() + CODE_LIMITS.resendGapMs).toISOString(),
      }));
    });
  }

  /**
   * The SMS code, only for the attempt that proved the email. The sign-up is then complete: the
   * attempt's own acceptance of the Terms and Privacy it accepted (from its cookie) is written,
   * with this request's IP, and the account waits for the firm.
   */
  verifyPhone(firmSlug: string, code: string, req: Request): Promise<SignUpState> {
    return atLeast(this.minResponseMs, async () => {
      const { session: s, attempt, expiresAt } = await this.session(firmSlug, req);
      const account = await this.attemptAccount(s);
      // Without its own account this session is in the email step, as a real one would be.
      if (stepFor(s, account, attempt) !== 'VERIFY_PHONE' || !account) {
        throw signUpErrors.wrongStep();
      }
      const user = await this.attemptUser(s.userId);
      const owner = this.owner(s.businessId, account.id, s.userId);
      const codeId = await this.codes.match(owner, 'PHONE', user.phone ?? s.phone, code);
      if (!codeId) throw signUpErrors.codeInvalid();
      // Cognito first, outside any transaction (as for the email).
      await this.identity.updateContact('CLIENT', user.cognitoSub, { phoneVerified: true });
      await this.db.withScope({ kind: 'business', businessId: s.businessId }, async (tx) => {
        if (!(await this.codes.consume(tx, codeId))) throw signUpErrors.codeInvalid();
        const proved = await tx.clientAccount.updateMany({
          where: { id: account.id, userId: s.userId, phoneVerifiedAt: null },
          data: { phoneVerifiedAt: new Date() },
        });
        if (proved.count !== 1) throw signUpErrors.codeInvalid();
        await tx.legalAcceptance.createMany({
          data: s.documents.map((d) => acceptance(s.businessId, account.id, d, req)),
          skipDuplicates: true,
        });
      });
      await this.log(s.businessId, s.userId, 'client_account.verified', account.id);
      return this.stateOf(s, expiresAt);
    });
  }

  /**
   * A new code: after the attempt's gap (from the server, the same on every path), within its
   * request count and the IP limits. A gap or cap of the code itself is a silent skip.
   */
  resend(
    firmSlug: string,
    channel: 'email' | 'phone',
    req: Request,
    res: Response,
  ): Promise<SignUpState> {
    return atLeast(this.minResponseMs, async () => {
      const { session: s, attempt, expiresAt } = await this.session(firmSlug, req);
      const account = await this.attemptAccount(s);
      const step = stepFor(s, account, attempt);
      if (step === 'CONTACT_FIRM') throw signUpErrors.wrongStep();
      if (channel === 'email' ? step !== 'VERIFY_EMAIL' : step === 'DONE') {
        throw signUpErrors.alreadyVerified();
      }
      if (channel === 'phone' && step !== 'VERIFY_PHONE') throw signUpErrors.wrongStep();
      await this.admitRequest(s.userId, { gap: true });
      const firm = await this.portal.activeFirm(s.firmSlug);
      if (account) {
        const user = await this.attemptUser(s.userId);
        const target = channel === 'email' ? account.email : (user.phone ?? s.phone);
        const owner = this.owner(s.businessId, account.id, s.userId);
        await this.sendCode(owner, channel === 'email' ? 'EMAIL' : 'PHONE', target, firm);
      } else {
        await this.noticeIfRegistered(firm, s.email);
      }
      // Same cookie behaviour on every path.
      await this.writeSession(res, s, expiresAt);
      return this.stateOf(s, expiresAt);
    });
  }

  /**
   * A different email, until it is verified. The attempt's login follows it: its own pending
   * account moves to the new email if that is free; otherwise the new email is attached like a
   * sign-up (new account, an unfinished one, or nowhere). Every change is a request (IP limits,
   * the attempt's count; the wait restarts) and a sign-up attempt for the new email. Its code goes
   * out only outside the attempt's wait; inside it, nothing is sent on any path.
   */
  changeEmail(firmSlug: string, email: string, req: Request, res: Response) {
    return atLeast(this.minResponseMs, async () => {
      const { session: s, attempt, expiresAt } = await this.session(firmSlug, req);
      if (stepFor(s, await this.attemptAccount(s), attempt) === 'CONTACT_FIRM') {
        throw signUpErrors.wrongStep();
      }
      const firm = await this.portal.activeFirm(s.firmSlug);
      const scope = this.db.forBusiness(firm.id);
      const owned = await scope.clientAccount.findUnique({
        where: { userId: s.userId },
        select: ACCOUNT,
      });
      if (owned?.emailVerifiedAt) throw signUpErrors.alreadyVerified();
      // Inside the attempt's wait (read under its lock, before this request) the change sends
      // nothing, on every path.
      const sendNow = this.waitedOut(await this.admitRequest(s.userId));
      await this.admitEmail(firm.id, email);

      let accountId: string | null;
      if (owned) {
        const taken = await scope.clientAccount.findUnique({
          where: { businessId_email: { businessId: firm.id, email } },
          select: ACCOUNT,
        });
        if (!taken || taken.id === owned.id) {
          let moved = true;
          if (owned.email !== email) {
            try {
              await scope.clientAccount.update({ where: { id: owned.id }, data: { email } });
            } catch (e) {
              // Another sign-up took this email a moment ago: the same as a taken email.
              if (!isUniqueViolation(e)) throw e;
              moved = false;
            }
          }
          accountId = moved ? owned.id : null;
        } else {
          // The login already owns its first account, so it cannot take over another one.
          if (sendNow && !unfinished(taken) && taken.status !== 'DECLINED') {
            await this.notifyRegistered(firm, taken.id, email);
          }
          accountId = null;
        }
      } else {
        // The firm still takes sign-ups (409 or 403 otherwise, as on sign-up).
        await this.currentDocuments(firm.id);
        accountId = await this.attach(
          firm,
          s.userId,
          { email, accountType: s.accountType },
          sendNow,
        );
      }
      await this.moveLoginEmail(s.userId, email);
      if (accountId) {
        if (sendNow) {
          await this.sendCode(this.owner(firm.id, accountId, s.userId), 'EMAIL', email, firm);
        }
        await this.log(firm.id, s.userId, 'client_account.email_changed', accountId);
      }
      const next: SignUpSession = { ...s, clientAccountId: accountId ?? randomUUID(), email };
      await this.writeSession(res, next, expiresAt);
      return this.stateOf(next, expiresAt);
    });
  }

  /** A different phone, until it is verified: the attempt's own login only. */
  changePhone(firmSlug: string, phone: string, req: Request, res: Response) {
    return atLeast(this.minResponseMs, async () => {
      const { session: s, attempt, expiresAt } = await this.session(firmSlug, req);
      if (stepFor(s, await this.attemptAccount(s), attempt) === 'CONTACT_FIRM') {
        throw signUpErrors.wrongStep();
      }
      const owned = await this.db.forBusiness(s.businessId).clientAccount.findUnique({
        where: { userId: s.userId },
        select: ACCOUNT,
      });
      if (owned?.phoneVerifiedAt) throw signUpErrors.alreadyVerified();
      // Every change is a request (IP limits, the attempt's count; the wait restarts).
      const sendNow = this.waitedOut(await this.admitRequest(s.userId));
      const user = await this.attemptUser(s.userId);
      if (user.phone !== phone) {
        await this.db.forPlatform().user.update({ where: { id: s.userId }, data: { phone } });
        await this.identity.updateContact('CLIENT', user.cognitoSub, {
          phone,
          phoneVerified: false,
        });
      }
      if (owned) {
        // Only the phone step sends an SMS, and only outside the attempt's wait.
        if (owned.emailVerifiedAt && owned.id === s.clientAccountId && sendNow) {
          const firm = await this.portal.activeFirm(s.firmSlug);
          await this.sendCode(this.owner(s.businessId, owned.id, s.userId), 'PHONE', phone, firm);
        }
        await this.log(s.businessId, s.userId, 'client_account.phone_changed', owned.id);
      }
      const next = { ...s, phone };
      await this.writeSession(res, next, expiresAt);
      return this.stateOf(next, expiresAt);
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
   * Which account an attempt is for: a new pending account it owns, an unfinished sign-up it may
   * take over (left unchanged until it proves the email), or none (null) when the email belongs
   * to any other account, whose owner then gets one email (when `notify`). Legal acceptances wait
   * for the end of the sign-up.
   */
  private async attach(
    firm: Firm,
    userId: string,
    details: { email: string; accountType: AccountType },
    notify: boolean,
    retried = false,
  ): Promise<string | null> {
    const { email, accountType } = details;
    const scope = this.db.forBusiness(firm.id);
    const existing = await scope.clientAccount.findUnique({
      where: { businessId_email: { businessId: firm.id, email } },
      select: ACCOUNT,
    });
    if (existing && !unfinished(existing)) {
      // A declined sign-up is final and gets nothing (Rasel, q13); the others get one notice.
      if (notify && existing.status !== 'DECLINED') {
        await this.notifyRegistered(firm, existing.id, email);
      }
      return null;
    }
    if (existing) {
      await this.log(firm.id, userId, 'client_account.sign_up_restarted', existing.id);
      return existing.id;
    }
    try {
      const account = await scope.clientAccount.create({
        data: { businessId: firm.id, userId, email, accountType },
        select: { id: true },
      });
      await this.log(firm.id, userId, 'client_account.signed_up', account.id);
      return account.id;
    } catch (e) {
      // A sign-up with this email at this firm a moment ago: attach to it like any unfinished one.
      if (isUniqueViolation(e) && !retried) return this.attach(firm, userId, details, notify, true);
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
   * A sign-up or change to `email` at this firm, in one firm transaction under an advisory lock on
   * the email's keyed hash: at most `perEmailNetworkPerDay` a day from this network (429), then
   * the row is written. The day's count for the email and for the firm only log a warning, once a
   * day each. The row holds the keyed hash, never the email; the same on every path.
   */
  private async admitEmail(businessId: string, email: string): Promise<void> {
    const emailKey = this.emailKeyOf(businessId, email);
    const net = networkOf(requestContext.getStore()?.ip);
    const refused = await this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      // Busy: another request for this email right now (a burst), answered like the limit.
      if (!(await tryLock(tx, `fv-sign-up-email:${emailKey}`))) return true;
      const today = {
        businessId,
        action: SIGN_UP_ATTEMPT,
        createdAt: { gt: new Date(Date.now() - DAY_MS) },
      };
      const forEmail = { ...today, metadata: { path: ['emailKey'], equals: emailKey } };
      const fromNetwork = await tx.auditLog.count({
        where: { AND: [forEmail, { metadata: { path: ['net'], equals: net } }] },
      });
      if (fromNetwork >= SIGN_UP_LIMITS.perEmailNetworkPerDay) return true;
      await this.audit.logIn(
        tx,
        SIGN_UP_ATTEMPT,
        { type: 'sign_up' },
        { emailKey, net },
        {
          businessId,
        },
      );
      if ((await tx.auditLog.count({ where: forEmail })) >= SIGN_UP_LIMITS.emailAlertPerDay) {
        await this.alertOnce(
          tx,
          businessId,
          { kind: 'email', emailKey },
          `An email (key ${emailKey.slice(0, 12)}) at firm ${businessId} reached ${SIGN_UP_LIMITS.emailAlertPerDay} portal sign-ups in a day`,
        );
      }
      // The firm's lock is taken after the email's, never before; busy means another request is
      // logging this firm's warning right now.
      if (
        (await tx.auditLog.count({ where: today })) >= SIGN_UP_LIMITS.firmAlertPerDay &&
        (await tryLock(tx, `fv-sign-up-firm:${businessId}`))
      ) {
        await this.alertOnce(
          tx,
          businessId,
          { kind: 'firm' },
          `Firm ${businessId} reached ${SIGN_UP_LIMITS.firmAlertPerDay} portal sign-ups in a day`,
        );
      }
      return false;
    });
    if (refused) throw signUpErrors.rateLimited();
  }

  /** Logs `message` (ids only, hard rule 4) once a day per marker; R8 turns these into alarms. */
  private async alertOnce(
    tx: TxClient,
    businessId: string,
    marker: Record<string, string>,
    message: string,
  ): Promise<void> {
    const logged = await tx.auditLog.count({
      where: {
        AND: [
          { businessId, action: SIGN_UP_ALERT, createdAt: { gt: new Date(Date.now() - DAY_MS) } },
          ...Object.entries(marker).map(([key, value]) => ({
            metadata: { path: [key], equals: value },
          })),
        ],
      },
    });
    if (logged > 0) return;
    this.logger.warn(message);
    await this.audit.logIn(tx, SIGN_UP_ALERT, { type: 'sign_up' }, marker, { businessId });
  }

  /**
   * One request that may send a code, in one platform transaction under advisory try-locks (the
   * network's, then the attempt's; a busy one is refused, never waited for): the IP and network
   * limits across every firm (SMS cost guard), then, for an attempt, its request count (not for
   * `uncounted`, the phone step's first SMS) and, when `gap`, its wait; then the row is written.
   * Keyed by address only, so it shows nothing about any email; the IP is req.ip (trust proxy),
   * never a raw header. Refused: 429, or `{ ok: false }` when `soft`.
   */
  private async admitRequest(
    attemptUserId: string | null,
    options: { gap?: boolean; soft?: boolean; uncounted?: boolean } = {},
  ): Promise<Admission> {
    const rawIp = requestContext.getStore()?.ip;
    const ip = canonicalIp(rawIp);
    const net = networkOf(rawIp);
    const admission = await this.db.withScope(
      { kind: 'platform' },
      async (tx): Promise<Admission> => {
        if (!(await tryLock(tx, `fv-sign-up-net:${net}`))) return { ok: false };
        if (attemptUserId && !(await tryLock(tx, `fv-sign-up-attempt:${attemptUserId}`))) {
          return { ok: false };
        }
        const lastHour = {
          businessId: null,
          action: CODE_REQUEST,
          createdAt: { gt: new Date(Date.now() - HOUR_MS) },
        };
        const fromIp = await tx.auditLog.count({
          where: { ...lastHour, metadata: { path: ['ip'], equals: ip } },
        });
        const fromNetwork = await tx.auditLog.count({
          where: { ...lastHour, metadata: { path: ['net'], equals: net } },
        });
        if (
          fromIp >= SIGN_UP_LIMITS.perIpPerHour ||
          fromNetwork >= SIGN_UP_LIMITS.perNetworkPerHour
        ) {
          return { ok: false };
        }
        let before: AttemptState | null = null;
        if (attemptUserId) {
          before = await this.attemptState(attemptUserId, tx);
          if (!before) return { ok: false };
          if (!options.uncounted && before.requests >= SIGN_UP_LIMITS.sendsPerSession) {
            return { ok: false };
          }
          if (options.gap && Date.now() < before.resendAt) return { ok: false };
        }
        await this.audit.logIn(
          tx,
          CODE_REQUEST,
          { type: 'sign_up' },
          { ip, net },
          attemptUserId ? { actorUserId: attemptUserId } : {},
        );
        return { ok: true, before };
      },
    );
    if (!admission.ok && !options.soft) throw signUpErrors.rateLimited();
    return admission;
  }

  /**
   * A wrong email code, on any path (a real code, or a session that goes nowhere): recorded for
   * the attempt, so every sign-up reaches CONTACT_FIRM after the same number of them (q13).
   * Returns the answer to throw: 400 CODE_INVALID, also for the last one.
   */
  private async wrongCode(attemptUserId: string): Promise<Error> {
    await this.audit.log(CODE_WRONG, { type: 'sign_up' }, {}, { actorUserId: attemptUserId });
    return signUpErrors.codeInvalid();
  }

  /** Whether the attempt's wait had passed when this request was let in (read under its lock). */
  private waitedOut(admission: Admission): boolean {
    return admission.ok && admission.before !== null && Date.now() >= admission.before.resendAt;
  }

  /**
   * When this viewer's IP and network may make another request: the moment the oldest request
   * that keeps them at their hourly limit leaves the window (0 when they may now).
   */
  private async limitsOpenAt(): Promise<number> {
    const rawIp = requestContext.getStore()?.ip;
    const platform = this.db.forPlatform();
    const opensAt = async (key: 'ip' | 'net', value: string, limit: number) => {
      const row = await platform.auditLog.findFirst({
        where: {
          businessId: null,
          action: CODE_REQUEST,
          createdAt: { gt: new Date(Date.now() - HOUR_MS) },
          metadata: { path: [key], equals: value },
        },
        orderBy: { createdAt: 'desc' },
        skip: limit - 1,
        select: { createdAt: true },
      });
      return row ? row.createdAt.getTime() + HOUR_MS : 0;
    };
    return Math.max(
      await opensAt('ip', canonicalIp(rawIp), SIGN_UP_LIMITS.perIpPerHour),
      await opensAt('net', networkOf(rawIp), SIGN_UP_LIMITS.perNetworkPerHour),
    );
  }

  /** The keyed hash of an email at a firm: limits and notices count it, never the email. */
  private emailKeyOf(businessId: string, email: string): string {
    return createHmac('sha256', this.emailKeySecret).update(`${businessId}:${email}`).digest('hex');
  }

  /**
   * The attempt's requests so far (its sign-up, the login's creation, plus each later request)
   * and when the next code may go out. Only rows since the login's creation are read. Null when
   * the login is gone (taken over and retired).
   */
  private async attemptState(userId: string, tx?: TxClient): Promise<AttemptState | null> {
    // One narrow type for both clients: the union of the two Prisma clients is too deep for tsc.
    const platform: AttemptReader = tx ?? (this.db.forPlatform() as unknown as AttemptReader);
    const user = await platform.user.findUnique({
      where: { id: userId },
      select: { createdAt: true },
    });
    if (!user) return null;
    const where = {
      businessId: null,
      action: CODE_REQUEST,
      actorUserId: userId,
      createdAt: { gte: user.createdAt },
    };
    const count = await platform.auditLog.count({ where });
    const last = await platform.auditLog.findFirst({
      where,
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const wrongEmailCodes = await platform.auditLog.count({
      where: { ...where, action: CODE_WRONG },
    });
    const lastAt = Math.max(user.createdAt.getTime(), last?.createdAt.getTime() ?? 0);
    return { requests: 1 + count, resendAt: lastAt + CODE_LIMITS.resendGapMs, wrongEmailCodes };
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

  /**
   * Sends a code when the gap and the daily caps allow; otherwise the answer stays the same. A
   * failed send is logged by account id and the answer stays the same too (Resend works later).
   */
  private async sendCode(owner: CodeOwner, channel: Channel, target: string, firm: Firm) {
    const issued = await this.codes.issue(owner, channel, target);
    if (issued.sent) {
      const message = { to: target, code: issued.code, businessName: firm.name };
      try {
        await (channel === 'EMAIL' ? this.sender.emailCode(message) : this.sender.smsCode(message));
      } catch {
        this.logger.warn(`Could not send a ${channel} code for account ${owner.clientAccountId}`);
      }
    }
    return issued;
  }

  /**
   * "You already have an account here" to the owner of a registered email, at most hourly: counted
   * and recorded in one firm transaction under the email key's try-lock (busy: another request is
   * handling this email now, so this one sends nothing). Best effort: a failed send is logged.
   */
  private async notifyRegistered(firm: Firm, accountId: string, email: string): Promise<void> {
    const emailKey = this.emailKeyOf(firm.id, email);
    const send = await this.db.withScope({ kind: 'business', businessId: firm.id }, async (tx) => {
      if (!(await tryLock(tx, `fv-sign-up-email:${emailKey}`))) return false;
      const recent = await tx.auditLog.count({
        where: {
          businessId: firm.id,
          action: REGISTERED_NOTICE,
          entityId: accountId,
          createdAt: { gt: new Date(Date.now() - SIGN_UP_LIMITS.noticeGapMs) },
        },
      });
      if (recent > 0) return false;
      await this.audit.logIn(
        tx,
        REGISTERED_NOTICE,
        { type: 'client_account', id: accountId },
        {},
        { businessId: firm.id },
      );
      return true;
    });
    if (!send) return;
    try {
      await this.sender.alreadyRegistered({ to: email, businessName: firm.name });
    } catch {
      this.logger.warn(`Could not send the "already registered" notice for account ${accountId}`);
    }
  }

  private async noticeIfRegistered(firm: Firm, email: string): Promise<void> {
    const account = await this.db.forBusiness(firm.id).clientAccount.findUnique({
      where: { businessId_email: { businessId: firm.id, email } },
      select: ACCOUNT,
    });
    if (account && !unfinished(account) && account.status !== 'DECLINED') {
      await this.notifyRegistered(firm, account.id, email);
    }
  }

  private owner(businessId: string, clientAccountId: string, attemptUserId: string): CodeOwner {
    return { businessId, clientAccountId, attemptUserId };
  }

  /**
   * The sign-up session from its cookie, with the attempt's state from the server. 410
   * SIGN_UP_EXPIRED without a valid cookie for this firm, or once the attempt's login is gone.
   */
  private async session(firmSlug: string, req: Request) {
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const sealed = cookies?.[portalCookies(firmSlug).signUp];
    const opened = sealed ? await this.sessions.open(sealed, 'CLIENT') : undefined;
    if (!opened || opened.value.firmSlug !== firmSlug.toLowerCase()) throw signUpErrors.expired();
    const attempt = await this.attemptState(opened.value.userId);
    if (!attempt) throw signUpErrors.expired();
    return { session: opened.value, attempt, expiresAt: opened.expiresAt };
  }

  /** Every sign-up answer that changes something sets the cookie, on every path alike. */
  private writeSession(res: Response, session: SignUpSession, expiresAt: number) {
    return this.sessions
      .sealUntil(session, expiresAt)
      .then((sealed) => writeSignUpCookie(res, session.firmSlug, sealed, expiresAt, this.secure));
  }

  /**
   * What the pages show. `resendAvailableAt` is when Resend really works again, from the server
   * and the same on every path: after the attempt's wait and once this IP and network are under
   * their hourly limits; the sign-up's end (`expiresAt`) when the attempt has used its requests.
   */
  private async stateOf(s: SignUpSession, expiresAt: number): Promise<SignUpState> {
    const shown = { email: s.email, phoneMasked: maskPhone(s.phone) };
    const attempt = await this.attemptState(s.userId);
    const step = stepFor(s, await this.attemptAccount(s), attempt);
    if (step === 'DONE' || step === 'CONTACT_FIRM')
      return { step, ...shown, resendAvailableAt: null };
    const at =
      attempt && attempt.requests >= SIGN_UP_LIMITS.sendsPerSession
        ? expiresAt * 1000
        : Math.min(
            Math.max(attempt ? attempt.resendAt : Date.now(), await this.limitsOpenAt()),
            expiresAt * 1000,
          );
    return { step, ...shown, resendAvailableAt: new Date(at).toISOString() };
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
