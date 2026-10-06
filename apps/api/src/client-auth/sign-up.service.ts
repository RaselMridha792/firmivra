import { randomUUID } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import type { Database } from '@firmivra/db';
import { portalCookies, type SignUpRequest, type SignUpState } from '@firmivra/types';
import { AuditService, type AuditEntity } from '../audit/audit.service.js';
import { runFlow } from '../auth/auth-errors.js';
import { IDENTITY_PROVIDER, type IdentityProvider } from '../auth/identity/identity-provider.js';
import { type AuthContext, requestContext } from '../common/request-context.js';
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
  RESEND_GAP_MS,
  VerificationCodesService,
} from './verification-codes.service.js';

type Step = SignUpState['step'];
type Account = NonNullable<Awaited<ReturnType<SignUpService['account']>>>;

const isUniqueViolation = (e: unknown) => (e as { code?: string }).code === 'P2002';
const isRateLimited = (e: unknown) =>
  e instanceof HttpException && e.getStatus() === HttpStatus.TOO_MANY_REQUESTS;
const stepOf = (a: Account): Step =>
  !a.emailVerifiedAt ? 'VERIFY_EMAIL' : !a.phoneVerifiedAt ? 'VERIFY_PHONE' : 'DONE';

/** "(770) ***-0123" for US numbers, "+44 *** 0123" elsewhere. */
export function maskPhone(phone: string): string {
  return /^\+1\d{10}$/.test(phone)
    ? `(${phone.slice(2, 5)}) ***-${phone.slice(-4)}`
    : `${phone.slice(0, 3)} *** ${phone.slice(-4)}`;
}

/**
 * Client portal sign-up (docs/api/client-auth.yaml): account, then the email code, then the SMS
 * code. Every answer is the same whether or not the email already has an account at the firm.
 * The pages store nothing: the sealed sign-up cookie says which account and firm.
 */
@Injectable()
export class SignUpService {
  private readonly secure: boolean;

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
  }

  async signUp(
    firmSlug: string,
    input: z.output<typeof SignUpRequest>,
    req: Request,
    res: Response,
  ): Promise<SignUpState> {
    const firm = await this.portal.activeFirm(firmSlug);
    const policy = await this.portal.signUpPolicy(firm.id);
    if (!policy.open || !policy.terms || !policy.privacy) throw signUpErrors.closed();
    if (
      input.accepted.termsVersion !== policy.terms.version ||
      input.accepted.privacyVersion !== policy.privacy.version
    ) {
      throw signUpErrors.termsOutdated();
    }
    const documents = [policy.terms.id, policy.privacy.id];

    const existing = await this.db.forBusiness(firm.id).clientAccount.findUnique({
      where: { businessId_email: { businessId: firm.id, email: input.email } },
      select: {
        id: true,
        userId: true,
        emailVerifiedAt: true,
        user: { select: { cognitoSub: true } },
      },
    });
    let accountId: string | null;
    if (existing?.emailVerifiedAt) {
      // Already an account here: the owner of the address hears so; the answer stays the same.
      await this.sender.alreadyRegistered({ to: input.email, businessName: firm.name });
      accountId = null;
    } else if (existing) {
      // A sign-up that never verified its email starts again with the new details.
      await runFlow(() =>
        this.identity.setPassword('CLIENT', existing.user.cognitoSub, input.password),
      );
      await this.identity.updateContact('CLIENT', existing.user.cognitoSub, {
        phone: input.phone,
        phoneVerified: false,
      });
      await this.db.forPlatform().user.update({
        where: { id: existing.userId },
        data: { name: input.name, phone: input.phone },
      });
      await this.db.withScope({ kind: 'business', businessId: firm.id }, async (tx) => {
        await tx.clientAccount.update({
          where: { id: existing.id },
          data: { accountType: input.accountType },
        });
        await tx.legalAcceptance.createMany({
          data: documents.map((legalDocumentId) =>
            acceptance(firm.id, existing.id, legalDocumentId, req),
          ),
          skipDuplicates: true,
        });
      });
      accountId = existing.id;
    } else {
      accountId = await this.createAccount(firm, input, documents, req);
    }

    if (accountId) await this.sendCode(firm, accountId, 'EMAIL', input.email, true);
    const session: SignUpSession = {
      pool: 'CLIENT',
      businessId: firm.id,
      firmSlug: firm.slug,
      clientAccountId: accountId,
      email: input.email,
      phone: input.phone,
      resendAt: Date.now() + RESEND_GAP_MS,
    };
    await this.writeSession(res, session, Math.floor(Date.now() / 1000) + SIGN_UP_SECONDS);
    return this.stateOf(session);
  }

  async state(firmSlug: string, req: Request): Promise<SignUpState> {
    const { value: session } = await this.session(firmSlug, req);
    return this.stateOf(session);
  }

  async verifyEmail(firmSlug: string, code: string, req: Request): Promise<SignUpState> {
    const { value: s } = await this.session(firmSlug, req);
    if (!s.clientAccountId) throw signUpErrors.codeInvalid();
    const account = await this.account(s);
    if (stepOf(account) !== 'VERIFY_EMAIL') throw signUpErrors.wrongStep();
    if (!(await this.codes.check(s.businessId, account.id, 'EMAIL', account.email, code))) {
      throw signUpErrors.codeInvalid();
    }
    await this.db
      .forBusiness(s.businessId)
      .clientAccount.update({ where: { id: account.id }, data: { emailVerifiedAt: new Date() } });
    await this.identity.updateContact('CLIENT', account.user.cognitoSub, { emailVerified: true });
    const firm = await this.portal.activeFirm(s.firmSlug);
    await this.sendCode(firm, account.id, 'PHONE', account.user.phone ?? s.phone, true);
    return this.stateOf(s);
  }

  async verifyPhone(firmSlug: string, code: string, req: Request): Promise<SignUpState> {
    const { value: s } = await this.session(firmSlug, req);
    if (!s.clientAccountId) throw signUpErrors.wrongStep();
    const account = await this.account(s);
    if (stepOf(account) !== 'VERIFY_PHONE') throw signUpErrors.wrongStep();
    const phone = account.user.phone ?? s.phone;
    if (!(await this.codes.check(s.businessId, account.id, 'PHONE', phone, code))) {
      throw signUpErrors.codeInvalid();
    }
    await this.db
      .forBusiness(s.businessId)
      .clientAccount.update({ where: { id: account.id }, data: { phoneVerifiedAt: new Date() } });
    await this.identity.updateContact('CLIENT', account.user.cognitoSub, { phoneVerified: true });
    await this.auditInFirm(
      s.businessId,
      { userId: account.user.id, cognitoSub: account.user.cognitoSub, pool: 'CLIENT' },
      'client_account.verified',
      { type: 'client_account', id: account.id },
    );
    return this.stateOf(s);
  }

  async resend(
    firmSlug: string,
    channel: 'email' | 'phone',
    req: Request,
    res: Response,
  ): Promise<SignUpState> {
    const { value: s, expiresAt } = await this.session(firmSlug, req);
    if (!s.clientAccountId) {
      if (channel === 'phone') throw signUpErrors.wrongStep();
      if (Date.now() < s.resendAt) throw rateLimited();
      const next = { ...s, resendAt: Date.now() + RESEND_GAP_MS };
      await this.writeSession(res, next, expiresAt);
      return this.stateOf(next);
    }
    const account = await this.account(s);
    const step = stepOf(account);
    if (channel === 'email' ? step !== 'VERIFY_EMAIL' : step === 'DONE') {
      throw signUpErrors.alreadyVerified();
    }
    if (channel === 'phone' && step !== 'VERIFY_PHONE') throw signUpErrors.wrongStep();
    const firm = await this.portal.activeFirm(s.firmSlug);
    const target = channel === 'email' ? account.email : (account.user.phone ?? s.phone);
    await this.sendCode(firm, account.id, channel === 'email' ? 'EMAIL' : 'PHONE', target, false);
    return this.stateOf(s);
  }

  async changeEmail(firmSlug: string, email: string, req: Request, res: Response) {
    const { value: s, expiresAt } = await this.session(firmSlug, req);
    const firm = await this.portal.activeFirm(s.firmSlug);
    if (!s.clientAccountId) {
      const next = { ...s, email, resendAt: Date.now() + RESEND_GAP_MS };
      await this.writeSession(res, next, expiresAt);
      return this.stateOf(next);
    }
    const account = await this.account(s);
    if (stepOf(account) !== 'VERIFY_EMAIL') throw signUpErrors.alreadyVerified();
    const scope = this.db.forBusiness(s.businessId);
    const taken = await scope.clientAccount.findUnique({
      where: { businessId_email: { businessId: s.businessId, email } },
      select: { id: true, emailVerifiedAt: true },
    });
    if (taken && taken.id !== account.id) {
      // As at sign-up: the same answer, and the session goes nowhere from here.
      if (taken.emailVerifiedAt) {
        await this.sender.alreadyRegistered({ to: email, businessName: firm.name });
      }
      const next = { ...s, clientAccountId: null, email, resendAt: Date.now() + RESEND_GAP_MS };
      await this.writeSession(res, next, expiresAt);
      return this.stateOf(next);
    }
    if (email !== account.email) {
      await scope.clientAccount.update({ where: { id: account.id }, data: { email } });
      await this.db.forPlatform().user.update({ where: { id: account.user.id }, data: { email } });
      await this.identity.updateContact('CLIENT', account.user.cognitoSub, {
        email,
        emailVerified: false,
      });
    }
    await this.sendCode(firm, account.id, 'EMAIL', email, false);
    const next = { ...s, email };
    await this.writeSession(res, next, expiresAt);
    return this.stateOf(next);
  }

  async changePhone(firmSlug: string, phone: string, req: Request, res: Response) {
    const { value: s, expiresAt } = await this.session(firmSlug, req);
    const next = { ...s, phone };
    if (s.clientAccountId) {
      const account = await this.account(s);
      const step = stepOf(account);
      if (step === 'DONE') throw signUpErrors.alreadyVerified();
      if (phone !== account.user.phone) {
        await this.db
          .forPlatform()
          .user.update({ where: { id: account.user.id }, data: { phone } });
        await this.identity.updateContact('CLIENT', account.user.cognitoSub, {
          phone,
          phoneVerified: false,
        });
      }
      if (step === 'VERIFY_PHONE') {
        const firm = await this.portal.activeFirm(s.firmSlug);
        await this.sendCode(firm, account.id, 'PHONE', phone, false);
      }
    }
    await this.writeSession(res, next, expiresAt);
    return this.stateOf(next);
  }

  /** New login, user and pending client account with both legal acceptances, in that order. */
  private async createAccount(
    firm: { id: string },
    input: z.output<typeof SignUpRequest>,
    documents: string[],
    req: Request,
  ): Promise<string | null> {
    const sub = await this.identity.createUser('CLIENT', input.email, {
      phone: input.phone,
      emailVerified: false,
    });
    await runFlow(() => this.identity.setPassword('CLIENT', sub, input.password));
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
    try {
      const accountId = await this.db.withScope(
        { kind: 'business', businessId: firm.id },
        async (tx) => {
          const account = await tx.clientAccount.create({
            data: {
              businessId: firm.id,
              userId: user.id,
              email: input.email,
              accountType: input.accountType,
            },
            select: { id: true },
          });
          await tx.legalAcceptance.createMany({
            data: documents.map((legalDocumentId) =>
              acceptance(firm.id, account.id, legalDocumentId, req),
            ),
          });
          return account.id;
        },
      );
      await this.auditInFirm(
        firm.id,
        { userId: user.id, cognitoSub: sub, pool: 'CLIENT' },
        'client_account.signed_up',
        { type: 'client_account', id: accountId },
        { accountType: input.accountType },
      );
      return accountId;
    } catch (e) {
      // Someone signed up with this email at this firm a moment ago: same answer, no code.
      if (isUniqueViolation(e)) return null;
      throw e;
    }
  }

  /** Issues and sends a code. `quiet`: within the resend gap, keep the code already sent. */
  private async sendCode(
    firm: { id: string; name: string },
    accountId: string,
    channel: Channel,
    target: string,
    quiet: boolean,
  ): Promise<void> {
    let code: string;
    try {
      code = await this.codes.issue(firm.id, accountId, channel, target);
    } catch (e) {
      if (quiet && isRateLimited(e)) return;
      throw e;
    }
    const message = { to: target, code, businessName: firm.name };
    await (channel === 'EMAIL' ? this.sender.emailCode(message) : this.sender.smsCode(message));
  }

  private async session(firmSlug: string, req: Request) {
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    const sealed = cookies?.[portalCookies(firmSlug).signUp];
    const opened = sealed ? await this.sessions.open(sealed, 'CLIENT') : undefined;
    if (!opened || opened.value.firmSlug !== firmSlug.toLowerCase()) throw signUpErrors.expired();
    return opened;
  }

  private writeSession(res: Response, session: SignUpSession, expiresAt: number) {
    return this.sessions
      .sealUntil(session, expiresAt)
      .then((sealed) => writeSignUpCookie(res, session.firmSlug, sealed, expiresAt, this.secure));
  }

  private account(s: SignUpSession) {
    return this.db.forBusiness(s.businessId).clientAccount.findUniqueOrThrow({
      where: { id: s.clientAccountId ?? '' },
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        user: { select: { id: true, cognitoSub: true, phone: true } },
      },
    });
  }

  private async stateOf(s: SignUpSession): Promise<SignUpState> {
    if (!s.clientAccountId) {
      return {
        step: 'VERIFY_EMAIL',
        email: s.email,
        phoneMasked: maskPhone(s.phone),
        resendAvailableAt: new Date(s.resendAt).toISOString(),
      };
    }
    const account = await this.account(s);
    const step = stepOf(account);
    const at =
      step === 'DONE'
        ? null
        : await this.codes.resendAvailableAt(
            s.businessId,
            account.id,
            step === 'VERIFY_EMAIL' ? 'EMAIL' : 'PHONE',
          );
    return {
      step,
      email: account.email,
      phoneMasked: maskPhone(account.user.phone ?? s.phone),
      resendAvailableAt: at ? at.toISOString() : null,
    };
  }

  /** Audit rows belong to the firm even on these signed-out routes. */
  private auditInFirm(
    businessId: string,
    actor: AuthContext,
    action: string,
    entity: AuditEntity,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const store = requestContext.getStore() ?? { requestId: randomUUID() };
    return requestContext.run(
      { ...store, auth: actor, tenant: { businessId, role: 'STAFF', kind: 'staff' } },
      () => this.audit.log(action, entity, metadata),
    );
  }
}

const rateLimited = () =>
  new HttpException(
    { code: 'RATE_LIMITED', message: 'Wait a moment before asking for a new code' },
    HttpStatus.TOO_MANY_REQUESTS,
  );

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
