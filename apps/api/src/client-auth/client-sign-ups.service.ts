import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  type ApproveSignUpRequest,
  type ApproveSignUpResponse,
  type ClientSignUp,
  ClientSignUpDetail,
  ClientSignUpList,
  type ClientSignUpsQuery,
  ClientSignUpSettings,
  type DeclineSignUpRequest,
  type DeclineSignUpResponse,
  type KeepSignUpPendingRequest,
  type KeepSignUpPendingResponse,
  type LinkSignUpRequest,
  type RecordSignUpChecksRequest,
  type RestoreSignUpAccessRequest,
  type RestoreSignUpAccessResponse,
  SIGN_UP_CHECKS_HOURS,
  type SignUpEvent,
  type SignUpListStatus,
  type SignUpNotAMatchRequest,
  type SignUpNotAMatchResponse,
  type UpdateClientSignUpSettingsRequest,
} from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { IDENTITY_PROVIDER, type IdentityProvider } from '../auth/identity/identity-provider.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { CLIENT_CODE_SENDER, type ClientCodeSender } from './client-code-sender.js';
import {
  createClientFromSignUp,
  linkable,
  lockClientEmails,
  PRIMARY_LOGINS,
} from './client-records.js';
import {
  holdsBack,
  priorOutcome,
  recordOperation,
  requestHash,
  type SignUpCandidate,
  signUpCandidates,
  staleVersion,
} from './sign-up-decisions.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A sign-up is in the queue once both email and phone are verified. */
/**
 * A completed sign-up: email verified, and the phone verified or (SIGNUP_PHONE_VERIFICATION=
 * optional) its legal acceptances written when it completed at the email step (sign-up.service.ts).
 */
const VERIFIED: Prisma.ClientAccountWhereInput = {
  emailVerifiedAt: { not: null },
  AND: [{ OR: [{ phoneVerifiedAt: { not: null } }, { legalAcceptances: { some: {} } }] }],
};

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const notPending = () =>
  new ConflictException({ code: 'NOT_PENDING', message: 'This sign-up was already handled' });
const notLinkable = () =>
  new ConflictException({
    code: 'CLIENT_NOT_LINKABLE',
    message: 'This client record cannot be linked to this sign-up',
  });
const duplicateEmail = () =>
  new ConflictException({
    code: 'DUPLICATE_EMAIL',
    message: 'A client of this firm already has this email. Link the sign-up to that record.',
  });
const isUniqueViolation = (e: unknown) => (e as { code?: string }).code === 'P2002';

const potentialMatch = () =>
  new ConflictException({
    code: 'POTENTIAL_MATCH',
    message: 'This sign-up may belong to a client your firm already has. It stays waiting.',
  });
const notACandidate = () =>
  new ConflictException({
    code: 'NOT_A_CANDIDATE',
    message: 'That client record is not one this sign-up may belong to',
  });
const noSuchContact = () =>
  new ConflictException({
    code: 'NO_SUCH_CONTACT',
    message: 'The client record has no such contact. Call a contact already on the record.',
  });
const checksRequired = () =>
  new ConflictException({
    code: 'CHECKS_REQUIRED',
    message: `Record the three checks for this client record first (they count for ${SIGN_UP_CHECKS_HOURS} hours)`,
  });
const noPortalLogin = () =>
  new ConflictException({
    code: 'NO_PORTAL_LOGIN',
    message: 'This client record has no portal login to restore. Link the record instead.',
  });

/** The reason a request closes with when the person's existing login gets its access back. */
const ACCESS_RESTORED = 'access restored';
/** What each check allows: all three passed, and the permission covers the action. */
const allows = (
  v: { callOutcome: string; identityResult: string; permissionScope: string | null },
  action: 'LINK' | 'RESTORE_ACCESS',
) =>
  v.callOutcome === 'REACHED' &&
  v.identityResult === 'VERIFIED' &&
  (v.permissionScope === 'BOTH' ||
    v.permissionScope === (action === 'LINK' ? 'LINK_RECORD' : 'RESTORE_ACCESS'));
const checksSince = () => new Date(Date.now() - SIGN_UP_CHECKS_HOURS * 3_600_000);

/** Each tab's requests (Octavia's Client Sign-ups, section 5). */
const VIEWS: Record<SignUpListStatus, Prisma.ClientAccountWhereInput> = {
  PENDING_APPROVAL: { status: 'PENDING_APPROVAL', ...VERIFIED },
  APPROVED: { approvedAt: { not: null } },
  DECLINED: { status: 'DECLINED' },
};
const ROW = {
  id: true,
  email: true,
  accountType: true,
  status: true,
  createdAt: true,
  approvedAt: true,
  declinedAt: true,
  declineReason: true,
  version: true,
  decidedAutomatically: true,
  user: { select: { name: true, phone: true } },
  client: { select: { id: true, clientNumber: true, displayName: true } },
} satisfies Prisma.ClientAccountSelect;
type Row = Prisma.ClientAccountGetPayload<{ select: typeof ROW }>;

const clientRef = (c: { id: string; clientNumber: number; displayName: string }) => ({
  clientId: c.id,
  clientNumber: `CL-${c.clientNumber}`,
  displayName: c.displayName,
});

type ApproveBody = z.output<typeof ApproveSignUpRequest>;
type DeclineBody = z.output<typeof DeclineSignUpRequest>;
type ChecksBody = z.output<typeof RecordSignUpChecksRequest>;
type CandidateBody = z.output<typeof LinkSignUpRequest | typeof RestoreSignUpAccessRequest>;
type NotAMatchBody = z.output<typeof SignUpNotAMatchRequest>;
type KeepPendingBody = z.output<typeof KeepSignUpPendingRequest>;
type SettingsBody = z.output<typeof UpdateClientSignUpSettingsRequest>;
/** A write's outcome: committed now, or the one an earlier attempt with the same key committed. */
type Once<T, F> = { replay: T } | { fresh: F };

/** Who acts: the firm (from TenantGuard) and the signed-in owner or admin. */
export interface Actor {
  businessId: string;
  userId: string;
}

/**
 * The firm's queue of portal sign-ups (client-auth.yaml, "Firm side"): list, approve, decline.
 * Owner and admins only (the controller's roles). Every change is audited and the client is told.
 */
@Injectable()
export class ClientSignUpsService {
  private readonly logger = new Logger(ClientSignUpsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    @Inject(CLIENT_CODE_SENDER) private readonly sender: ClientCodeSender,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * One tab of the firm's requests, newest first by default (the id breaks ties), with each
   * tab's count whatever the search and filters. A waiting request carries its match, checked
   * against the firm's records now. Audited: it returns names, emails and phones
   * (`client_sign_ups.listed`, the count only).
   */
  async list(actor: Actor, query: z.output<typeof ClientSignUpsQuery>): Promise<ClientSignUpList> {
    const firm = this.db.forBusiness(actor.businessId);
    const waiting = query.status === 'PENDING_APPROVAL';
    const matched = waiting
      ? await this.inFirm(actor.businessId, (tx) => signUpCandidates(tx))
      : [];
    const matchedIds = [...new Set(matched.filter(holdsBack).map((c) => c.accountId))];
    const days = await this.dayBounds(actor.businessId, query.from, query.to);
    const term = query.search?.trim();
    const where: Prisma.ClientAccountWhereInput = {
      AND: [
        VIEWS[query.status],
        term
          ? {
              OR: [
                { email: { contains: term, mode: 'insensitive' } },
                { user: { name: { contains: term, mode: 'insensitive' } } },
              ],
            }
          : {},
        days ? { createdAt: { gte: days.start, lt: days.end } } : {},
        waiting && query.match === 'POTENTIAL_MATCH' ? { id: { in: matchedIds } } : {},
        waiting && query.match === 'NO_MATCH' ? { id: { notIn: matchedIds } } : {},
      ],
    };
    const order = query.sort === 'oldest' ? 'asc' : 'desc';
    const [rows, total, pending, approved, declined] = await Promise.all([
      firm.clientAccount.findMany({
        where,
        orderBy: [{ createdAt: order }, { id: order }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: ROW,
      }),
      firm.clientAccount.count({ where }),
      firm.clientAccount.count({ where: VIEWS.PENDING_APPROVAL }),
      firm.clientAccount.count({ where: VIEWS.APPROVED }),
      firm.clientAccount.count({ where: VIEWS.DECLINED }),
    ]);
    await this.audit.log(
      'client_sign_ups.listed',
      { type: 'client_account' },
      { status: query.status, count: rows.length },
    );
    const isMatched = new Set(matchedIds);
    return ClientSignUpList.parse({
      items: rows.map((r) => this.item(r, isMatched.has(r.id))),
      total,
      page: query.page,
      limit: query.limit,
      counts: { PENDING_APPROVAL: pending, APPROVED: approved, DECLINED: declined },
    });
  }

  /**
   * One request of this firm, in any tab, with its history and, while it waits, the firm's
   * records it may belong to (name, Client ID and which fields matched). 404 for any other id.
   * Audited (`client_sign_up.viewed`, with the number of candidates shown).
   */
  async get(actor: Actor, clientAccountId: string): Promise<ClientSignUpDetail> {
    if (!UUID.test(clientAccountId)) throw notFound();
    const firm = this.db.forBusiness(actor.businessId);
    const row = await firm.clientAccount.findFirst({
      where: { id: clientAccountId, OR: Object.values(VIEWS) },
      select: {
        ...ROW,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        approvedByUserId: true,
        declinedByUserId: true,
      },
    });
    if (!row) throw notFound();
    const waiting = row.status === 'PENDING_APPROVAL';
    const { candidates, reviews, steps } = await this.inFirm(actor.businessId, async (tx) => {
      const found = waiting ? await signUpCandidates(tx, row.id) : [];
      return {
        candidates: found,
        reviews: await this.reviewOf(tx, row.id, found),
        steps: await this.reviewSteps(tx, row.id),
      };
    });
    const deciders = [
      row.approvedByUserId,
      row.declinedByUserId,
      ...steps.map((st) => st.actorUserId),
      ...[...reviews.values()].map((r) => r.checks?.actorUserId ?? null),
    ].filter((id): id is string => id !== null);
    const names = new Map(
      (
        await firm.membership.findMany({
          where: { businessId: actor.businessId, userId: { in: deciders } },
          select: { userId: true, user: { select: { name: true } } },
        })
      ).map((m) => [m.userId, m.user.name]),
    );
    const step = (kind: SignUpEvent['kind'], at: Date | null, by: string | null = null) =>
      at ? [{ kind, at: at.toISOString(), actorName: (by && names.get(by)) ?? null }] : [];
    const history = [
      ...step('SUBMITTED', row.createdAt),
      ...step('EMAIL_VERIFIED', row.emailVerifiedAt),
      ...step('PHONE_VERIFIED', row.phoneVerifiedAt),
      ...steps.map((st) => ({
        kind: st.kind,
        at: st.at.toISOString(),
        actorName: (st.actorUserId && names.get(st.actorUserId)) ?? null,
        note: st.note,
      })),
      ...step('APPROVED', row.approvedAt, row.approvedByUserId),
      ...step('DECLINED', row.declinedAt, row.declinedByUserId),
    ].sort((a, b) => a.at.localeCompare(b.at));
    await this.audit.log(
      'client_sign_up.viewed',
      { type: 'client_account', id: row.id },
      { candidates: candidates.length },
    );
    const open = candidates.filter(holdsBack);
    // Not a Match is for phone matches only: an email match never (one email, one client).
    const resolvable =
      open.length > 0 && !open.some((c) => c.byEmail) && open.every((c) => c.resolution === 'OPEN');
    return ClientSignUpDetail.parse({
      ...this.item(row, open.length > 0),
      automatic: row.decidedAutomatically,
      allowedActions: waiting
        ? [
            ...(open.length ? [] : ['APPROVE']),
            'DECLINE',
            'KEEP_PENDING',
            ...(resolvable ? ['NOT_A_MATCH'] : []),
          ]
        : [],
      history,
      candidates: candidates.map((c) => {
        const review = reviews.get(c.clientId);
        const checks = review?.checks ?? null;
        const login = review?.login ?? false;
        const can = (action: 'LINK' | 'RESTORE_ACCESS') => !!checks && allows(checks, action);
        return {
          ...clientRef({
            id: c.clientId,
            clientNumber: c.clientNumber,
            displayName: c.displayName,
          }),
          matchedOn: [...(c.byEmail ? ['email'] : []), ...(c.byPhone ? ['phone'] : [])],
          resolution: c.resolution,
          hasPortalLogin: login,
          checks: checks && {
            id: checks.id,
            candidateClientId: c.clientId,
            contactRef: checks.contactRef,
            callOutcome: checks.callOutcome,
            identityResult: checks.identityResult,
            permissionScope: checks.permissionScope,
            recordedAt: checks.createdAt.toISOString(),
            expiresAt: new Date(
              checks.createdAt.getTime() + SIGN_UP_CHECKS_HOURS * 3_600_000,
            ).toISOString(),
            actorName: names.get(checks.actorUserId) ?? null,
          },
          actions: [
            ...(login && can('RESTORE_ACCESS') ? ['RESTORE_ACCESS'] : []),
            ...(!login && !review?.archived && can('LINK') ? ['LINK'] : []),
          ],
        };
      }),
    });
  }

  /** The firm's approval mode and policy version; a firm without settings is in Manual Review. */
  async settings(actor: Actor): Promise<ClientSignUpSettings> {
    const row = await this.db.forBusiness(actor.businessId).businessSettings.findUnique({
      where: { businessId: actor.businessId },
      select: {
        clientSignupMode: true,
        clientSignupPolicyVersion: true,
        clientSignupPolicyChangedAt: true,
      },
    });
    return ClientSignUpSettings.parse({
      mode: row?.clientSignupMode ?? 'MANUAL',
      version: row?.clientSignupPolicyVersion ?? 1,
      changedAt: row?.clientSignupPolicyChangedAt?.toISOString() ?? null,
    });
  }

  /**
   * Changes the firm's approval mode (Octavia's spec, section 5): the version read must be the
   * current one (409 STALE_VERSION otherwise), the change raises it, and it applies to sign-ups
   * completed from now on; requests already waiting stay waiting. The same mode changes nothing.
   * Audited with the old and new mode and the new policy version.
   */
  async updateSettings(actor: Actor, body: SettingsBody): Promise<ClientSignUpSettings> {
    const hash = requestHash({ kind: 'POLICY_CHANGE', mode: body.mode, version: body.version });
    const correlationId = randomUUID();
    const done = await this.once<
      ClientSignUpSettings,
      { result: ClientSignUpSettings; from: string; changed: boolean }
    >(actor.businessId, body.idempotencyKey, hash, async (tx) => {
      // The firm's row, locked, so an automatic decision at the same moment waits for the change.
      const [row] = await tx.$queryRaw<
        { mode: string; version: number; changedAt: Date | null }[]
      >`SELECT client_signup_mode::text AS mode, client_signup_policy_version AS version,
          client_signup_policy_changed_at AS "changedAt"
        FROM business_settings WHERE business_id = ${actor.businessId}::uuid FOR UPDATE`;
      const current = row ?? { mode: 'MANUAL', version: 1, changedAt: null };
      if (current.version !== body.version) throw staleVersion();
      const changed = current.mode !== body.mode;
      const changedAt = changed ? new Date() : current.changedAt;
      if (changed) {
        await tx.businessSettings.upsert({
          where: { businessId: actor.businessId },
          create: {
            businessId: actor.businessId,
            clientSignupMode: body.mode,
            clientSignupPolicyVersion: current.version + 1,
            clientSignupPolicyChangedAt: changedAt,
            clientSignupPolicyChangedByUserId: actor.userId,
          },
          update: {
            clientSignupMode: body.mode,
            clientSignupPolicyVersion: { increment: 1 },
            clientSignupPolicyChangedAt: changedAt,
            clientSignupPolicyChangedByUserId: actor.userId,
          },
        });
      }
      const result = ClientSignUpSettings.parse({
        mode: body.mode,
        version: changed ? current.version + 1 : current.version,
        changedAt: changedAt?.toISOString() ?? null,
      });
      await recordOperation(tx, {
        businessId: actor.businessId,
        clientAccountId: null,
        kind: 'POLICY_CHANGE',
        idempotencyKey: body.idempotencyKey,
        hash,
        result,
        correlationId,
        actorUserId: actor.userId,
      });
      return { result, from: current.mode, changed };
    });
    if ('replay' in done) return done.replay;
    if (done.fresh.changed) {
      await this.audit.log(
        'client_sign_up_policy.changed',
        { type: 'business_settings', id: actor.businessId },
        {
          from: done.fresh.from,
          to: body.mode,
          version: done.fresh.result.version,
          correlationId,
        },
      );
    }
    return done.fresh.result;
  }

  /**
   * Opens the portal for a pending sign-up, in one transaction: claims the sign-up at the version
   * read (only one approval or decline can; a newer version is 409 STALE_VERSION), then creates
   * the firm's client record from it or, with `clientId`, links an existing record that passes
   * `linkable` (409 CLIENT_NOT_LINKABLE otherwise, 404 if the firm has no such record). Never a
   * second client with one email: without `clientId`, a record with the sign-up's email is 409
   * DUPLICATE_EMAIL. Any refusal rolls the claim back. A retry with the same key returns the
   * committed outcome and sends nothing again.
   */
  async approve(
    actor: Actor,
    clientAccountId: string,
    body: ApproveBody,
  ): Promise<ApproveSignUpResponse> {
    const { clientId, version, idempotencyKey } = body;
    const hash = requestHash({
      kind: 'APPROVE',
      clientAccountId,
      clientId: clientId ?? null,
      version,
    });
    const approvedAt = new Date();
    const correlationId = randomUUID();
    const done = await this.once<
      ApproveSignUpResponse,
      {
        result: ApproveSignUpResponse;
        account: Awaited<ReturnType<ClientSignUpsService['pendingSignUp']>>;
        policy: number;
      }
    >(actor.businessId, idempotencyKey, hash, async (tx) => {
      const account = await this.pendingSignUp(tx, actor.businessId, clientAccountId);
      if (account.version !== version) throw staleVersion();
      const policy = await this.policyVersion(tx, actor.businessId);
      const claimed = await tx.clientAccount.updateMany({
        where: { id: account.id, status: 'PENDING_APPROVAL', version },
        data: {
          status: 'ACTIVE',
          approvedAt,
          approvedByUserId: actor.userId,
          decisionPolicyVersion: policy,
          matchStatus: clientId ? 'LINKED' : 'NO_MATCH',
          matchCheckedAt: approvedAt,
          version: { increment: 1 },
        },
      });
      if (claimed.count !== 1) throw staleVersion();
      const linkedTo = clientId
        ? await this.lockLinkable(tx, actor.businessId, clientId, account.email)
        : await this.createUnlessTaken(tx, actor.businessId, account);
      await tx.clientAccount.update({
        where: { id: account.id },
        data: { clientId: linkedTo, portalRole: 'PRIMARY' },
      });
      const result: ApproveSignUpResponse = {
        clientAccountId: account.id,
        clientId: linkedTo,
        status: 'ACTIVE',
        approvedAt: approvedAt.toISOString(),
        version: version + 1,
        correlationId,
      };
      await recordOperation(tx, {
        businessId: actor.businessId,
        clientAccountId: account.id,
        kind: 'APPROVE',
        idempotencyKey,
        hash,
        result,
        correlationId,
        actorUserId: actor.userId,
      });
      return { result, account, policy };
    });
    if ('replay' in done) return done.replay;
    const { result, account, policy } = done.fresh;

    if (!clientId) {
      await this.audit.log(
        'client.created',
        { type: 'client', id: result.clientId },
        { from: 'portal_sign_up', clientAccountId: account.id },
      );
    }
    await this.audit.log(
      'client_account.approved',
      { type: 'client_account', id: account.id },
      {
        clientId: result.clientId,
        linked: clientId !== undefined,
        policyVersion: policy,
        correlationId,
      },
    );
    const firm = await this.firm(actor.businessId);
    try {
      await this.sender.signUpApproved({
        to: account.email,
        businessId: actor.businessId,
        businessName: firm.name,
        name: account.user.name,
        signInUrl: `${this.env.PORTAL_BASE_URL.replace(/\/+$/, '')}/${firm.slug}/sign-in`,
      });
    } catch {
      // Ids only (hard rule 4). The approval stands; R6's retries own delivery.
      this.logger.warn(`Could not send the approval notice for client account ${account.id}`);
    }
    return result;
  }

  /**
   * Declines a pending sign-up at the version read and disables its login. Our database already
   * keeps a declined client out (auth/portal-clients.ts); disabling the Cognito login also ends
   * its sessions. The applicant gets one email unless `notify` is false.
   */
  async decline(
    actor: Actor,
    clientAccountId: string,
    body: DeclineBody,
  ): Promise<DeclineSignUpResponse> {
    const { reason, notify, version, idempotencyKey } = body;
    const hash = requestHash({
      kind: 'DECLINE',
      clientAccountId,
      reason: reason ?? null,
      notify,
      version,
    });
    const declinedAt = new Date();
    const correlationId = randomUUID();
    const done = await this.once<
      DeclineSignUpResponse,
      {
        result: DeclineSignUpResponse;
        account: Awaited<ReturnType<ClientSignUpsService['pendingSignUp']>>;
      }
    >(actor.businessId, idempotencyKey, hash, async (tx) => {
      const account = await this.pendingSignUp(tx, actor.businessId, clientAccountId);
      if (account.version !== version) throw staleVersion();
      const policy = await this.policyVersion(tx, actor.businessId);
      const declined = await tx.clientAccount.updateMany({
        where: { id: account.id, status: 'PENDING_APPROVAL', version },
        data: {
          status: 'DECLINED',
          declinedAt,
          declinedByUserId: actor.userId,
          declineReason: reason ?? null,
          decisionPolicyVersion: policy,
          version: { increment: 1 },
        },
      });
      if (declined.count !== 1) throw staleVersion();
      const result: DeclineSignUpResponse = {
        clientAccountId: account.id,
        status: 'DECLINED',
        declinedAt: declinedAt.toISOString(),
        version: version + 1,
        correlationId,
        notified: notify,
      };
      await recordOperation(tx, {
        businessId: actor.businessId,
        clientAccountId: account.id,
        kind: 'DECLINE',
        idempotencyKey,
        hash,
        result,
        correlationId,
        actorUserId: actor.userId,
      });
      return { result, account };
    });
    if ('replay' in done) return done.replay;
    const { result, account } = done.fresh;
    try {
      await this.identity.disableUser('CLIENT', account.user.cognitoSub);
    } catch {
      // Ids only (hard rule 4). The decline stands: the database refuses this client anyway.
      this.logger.warn(`Could not disable the login of declined client account ${account.id}`);
    }
    await this.audit.log(
      'client_account.declined',
      { type: 'client_account', id: account.id },
      { withReason: reason !== undefined, notified: notify, correlationId },
    );
    if (notify) {
      const firm = await this.firm(actor.businessId);
      try {
        await this.sender.signUpDeclined({
          to: account.email,
          businessId: actor.businessId,
          businessName: firm.name,
          name: account.user.name,
        });
      } catch {
        // Ids only (hard rule 4). The decline stands; R6's retries own delivery.
        this.logger.warn(`Could not send the decline notice for client account ${account.id}`);
      }
    }
    return result;
  }

  // ---------- Resolve Existing Account (Octavia's D2; Rasel's rules of Oct 26) ----------

  /**
   * Records the three checks for one record the waiting request may belong to: the call to a
   * contact already on that record, the identity result and the permission with its scope. They
   * count for 24 hours. Audited with the outcomes only, never the evidence. Answers the detail.
   */
  async recordChecks(
    actor: Actor,
    clientAccountId: string,
    body: ChecksBody,
  ): Promise<ClientSignUpDetail> {
    await this.inFirm(actor.businessId, async (tx) => {
      const account = await this.pendingSignUp(tx, actor.businessId, clientAccountId);
      const candidate = await this.candidate(tx, account.id, body.candidateClientId);
      const record = await tx.client.findUniqueOrThrow({
        where: { id: candidate.clientId },
        select: { email: true, phone: true },
      });
      if (
        (body.contactRef === 'CLIENT_PHONE' && !record.phone) ||
        (body.contactRef === 'CLIENT_EMAIL' && !record.email)
      ) {
        throw noSuchContact();
      }
      await tx.clientSignupVerification.create({
        data: {
          businessId: actor.businessId,
          clientAccountId: account.id,
          candidateClientId: candidate.clientId,
          contactRef: body.contactRef,
          callOutcome: body.callOutcome,
          identityResult: body.identityResult,
          permissionScope: body.permissionScope,
          permissionRecordedAt: body.permissionScope ? new Date() : null,
          actorUserId: actor.userId,
        },
      });
    });
    await this.audit.log(
      'client_sign_up.checks_recorded',
      { type: 'client_account', id: clientAccountId },
      {
        candidateClientId: body.candidateClientId,
        contactRef: body.contactRef,
        callOutcome: body.callOutcome,
        identityResult: body.identityResult,
        permissionScope: body.permissionScope,
      },
    );
    return this.get(actor, clientAccountId);
  }

  /**
   * Link Existing Record: the login joins that record, whose Client ID and contacts stay as they
   * are, even when its email is not the sign-up's, once the three checks for it allow a link
   * (409 CHECKS_REQUIRED). The record has no primary portal login and is not archived (409
   * CLIENT_NOT_LINKABLE). Then as an approval: versioned, retry-safe, audited, the email sent.
   */
  async link(
    actor: Actor,
    clientAccountId: string,
    body: CandidateBody,
  ): Promise<ApproveSignUpResponse> {
    const { candidateClientId, version, idempotencyKey } = body;
    const hash = requestHash({
      kind: 'LINK_EXISTING',
      clientAccountId,
      candidateClientId,
      version,
    });
    const approvedAt = new Date();
    const correlationId = randomUUID();
    const done = await this.once<
      ApproveSignUpResponse,
      {
        result: ApproveSignUpResponse;
        account: Awaited<ReturnType<ClientSignUpsService['pendingSignUp']>>;
        policy: number;
      }
    >(actor.businessId, idempotencyKey, hash, async (tx) => {
      const account = await this.pendingSignUp(tx, actor.businessId, clientAccountId);
      if (account.version !== version) throw staleVersion();
      const candidate = await this.checkedCandidate(tx, account.id, candidateClientId, 'LINK');
      const policy = await this.policyVersion(tx, actor.businessId);
      const claimed = await tx.clientAccount.updateMany({
        where: { id: account.id, status: 'PENDING_APPROVAL', version },
        data: {
          status: 'ACTIVE',
          approvedAt,
          approvedByUserId: actor.userId,
          decisionPolicyVersion: policy,
          matchStatus: 'LINKED',
          matchCheckedAt: approvedAt,
          version: { increment: 1 },
        },
      });
      if (claimed.count !== 1) throw staleVersion();
      await this.lockUnlinked(tx, actor.businessId, candidateClientId);
      await tx.clientAccount.update({
        where: { id: account.id },
        data: { clientId: candidateClientId, portalRole: 'PRIMARY' },
      });
      await this.resolve(tx, actor, account.id, candidate, 'VERIFIED', null);
      const result: ApproveSignUpResponse = {
        clientAccountId: account.id,
        clientId: candidateClientId,
        status: 'ACTIVE',
        approvedAt: approvedAt.toISOString(),
        version: version + 1,
        correlationId,
      };
      await recordOperation(tx, {
        businessId: actor.businessId,
        clientAccountId: account.id,
        kind: 'LINK_EXISTING',
        idempotencyKey,
        hash,
        result,
        correlationId,
        actorUserId: actor.userId,
      });
      return { result, account, policy };
    });
    if ('replay' in done) return done.replay;
    const { result, account, policy } = done.fresh;
    await this.audit.log(
      'client_account.approved',
      { type: 'client_account', id: account.id },
      {
        clientId: result.clientId,
        linked: true,
        checked: true,
        policyVersion: policy,
        correlationId,
      },
    );
    const firm = await this.firm(actor.businessId);
    try {
      await this.sender.signUpApproved({
        to: account.email,
        businessId: actor.businessId,
        businessName: firm.name,
        name: account.user.name,
        signInUrl: `${this.env.PORTAL_BASE_URL.replace(/\/+$/, '')}/${firm.slug}/sign-in`,
      });
    } catch {
      // Ids only (hard rule 4). The link stands; R6's retries own delivery.
      this.logger.warn(`Could not send the approval notice for client account ${account.id}`);
    }
    return result;
  }

  /**
   * Restore Access: the person already has a login on that record. Once the three checks for it
   * allow a restore (409 CHECKS_REQUIRED), the request closes as declined with the reason "access
   * restored", no client is made, and the record's own login (409 NO_PORTAL_LOGIN without one)
   * gets the portal's usual recovery email, sent to the contact on file, never the sign-up's.
   */
  async restoreAccess(
    actor: Actor,
    clientAccountId: string,
    body: CandidateBody,
  ): Promise<RestoreSignUpAccessResponse> {
    const { candidateClientId, version, idempotencyKey } = body;
    const hash = requestHash({
      kind: 'RESTORE_ACCESS',
      clientAccountId,
      candidateClientId,
      version,
    });
    const declinedAt = new Date();
    const correlationId = randomUUID();
    const done = await this.once<
      RestoreSignUpAccessResponse,
      {
        result: RestoreSignUpAccessResponse;
        account: Awaited<ReturnType<ClientSignUpsService['pendingSignUp']>>;
        existingSub: string | null;
      }
    >(actor.businessId, idempotencyKey, hash, async (tx) => {
      const account = await this.pendingSignUp(tx, actor.businessId, clientAccountId);
      if (account.version !== version) throw staleVersion();
      const candidate = await this.checkedCandidate(
        tx,
        account.id,
        candidateClientId,
        'RESTORE_ACCESS',
      );
      const login = await tx.clientAccount.findFirst({
        where: { clientId: candidateClientId, portalRole: 'PRIMARY', status: 'ACTIVE' },
        select: { user: { select: { cognitoSub: true } } },
      });
      if (!login) throw noPortalLogin();
      const policy = await this.policyVersion(tx, actor.businessId);
      const closed = await tx.clientAccount.updateMany({
        where: { id: account.id, status: 'PENDING_APPROVAL', version },
        data: {
          status: 'DECLINED',
          declinedAt,
          declinedByUserId: actor.userId,
          declineReason: ACCESS_RESTORED,
          decisionPolicyVersion: policy,
          version: { increment: 1 },
        },
      });
      if (closed.count !== 1) throw staleVersion();
      await this.resolve(tx, actor, account.id, candidate, 'VERIFIED', null);
      const result: RestoreSignUpAccessResponse = {
        clientAccountId: account.id,
        status: 'DECLINED',
        declinedAt: declinedAt.toISOString(),
        clientId: candidateClientId,
        version: version + 1,
        correlationId,
      };
      await recordOperation(tx, {
        businessId: actor.businessId,
        clientAccountId: account.id,
        kind: 'RESTORE_ACCESS',
        idempotencyKey,
        hash,
        result,
        correlationId,
        actorUserId: actor.userId,
      });
      return { result, account, existingSub: login.user.cognitoSub };
    });
    if ('replay' in done) return done.replay;
    const { result, account, existingSub } = done.fresh;
    try {
      await this.identity.disableUser('CLIENT', account.user.cognitoSub);
    } catch {
      // Ids only (hard rule 4). The request is closed; the database refuses this login anyway.
      this.logger.warn(`Could not disable the login of closed client account ${account.id}`);
    }
    try {
      await this.identity.forgotPassword('CLIENT', existingSub ?? undefined);
    } catch {
      // Ids only (hard rule 4). The person can still use Forgot Password on the portal.
      this.logger.warn(`Could not send the recovery email for client ${result.clientId}`);
    }
    await this.audit.log(
      'client_account.access_restored',
      { type: 'client_account', id: account.id },
      { clientId: result.clientId, correlationId },
    );
    return result;
  }

  /**
   * Not a Match (Owner and Admin): the open phone matches are not this person. Each is recorded
   * with who, when and the reason, and stops holding the request back; approving checks again
   * for new matches. An email match is never resolved this way (409 DUPLICATE_EMAIL).
   */
  async notAMatch(
    actor: Actor,
    clientAccountId: string,
    body: NotAMatchBody,
  ): Promise<SignUpNotAMatchResponse> {
    const { reason, version, idempotencyKey } = body;
    const hash = requestHash({ kind: 'NOT_A_MATCH', clientAccountId, reason, version });
    const correlationId = randomUUID();
    const done = await this.once<SignUpNotAMatchResponse, SignUpNotAMatchResponse>(
      actor.businessId,
      idempotencyKey,
      hash,
      async (tx) => {
        const account = await this.pendingSignUp(tx, actor.businessId, clientAccountId);
        if (account.version !== version) throw staleVersion();
        const open = (await signUpCandidates(tx, account.id)).filter(holdsBack);
        if (open.some((c) => c.byEmail)) throw duplicateEmail();
        const phone = open.filter((c) => c.resolution === 'OPEN');
        if (!phone.length) throw notACandidate();
        const claimed = await tx.clientAccount.updateMany({
          where: { id: account.id, status: 'PENDING_APPROVAL', version },
          data: { version: { increment: 1 } },
        });
        if (claimed.count !== 1) throw staleVersion();
        for (const c of phone) await this.resolve(tx, actor, account.id, c, 'NOT_A_MATCH', reason);
        const result: SignUpNotAMatchResponse = {
          clientAccountId: account.id,
          resolved: phone.length,
          version: version + 1,
          correlationId,
        };
        await recordOperation(tx, {
          businessId: actor.businessId,
          clientAccountId: account.id,
          kind: 'NOT_A_MATCH',
          idempotencyKey,
          hash,
          result: { ...result, note: reason },
          correlationId,
          actorUserId: actor.userId,
        });
        return result;
      },
    );
    if ('replay' in done) return done.replay;
    await this.audit.log(
      'client_sign_up.not_a_match',
      { type: 'client_account', id: clientAccountId },
      { resolved: done.fresh.resolved, correlationId },
    );
    return done.fresh;
  }

  /** Keep Pending: nothing changes; the note (firm only) and who kept it are in the history. */
  async keepPending(
    actor: Actor,
    clientAccountId: string,
    body: KeepPendingBody,
  ): Promise<KeepSignUpPendingResponse> {
    const note = body.note ?? null;
    const hash = requestHash({ kind: 'KEEP_PENDING', clientAccountId, note });
    const correlationId = randomUUID();
    const done = await this.once<KeepSignUpPendingResponse, KeepSignUpPendingResponse>(
      actor.businessId,
      body.idempotencyKey,
      hash,
      async (tx) => {
        const account = await this.pendingSignUp(tx, actor.businessId, clientAccountId);
        const result: KeepSignUpPendingResponse = { clientAccountId: account.id, correlationId };
        await recordOperation(tx, {
          businessId: actor.businessId,
          clientAccountId: account.id,
          kind: 'KEEP_PENDING',
          idempotencyKey: body.idempotencyKey,
          hash,
          result: { ...result, note },
          correlationId,
          actorUserId: actor.userId,
        });
        return result;
      },
    );
    if ('replay' in done) return done.replay;
    await this.audit.log(
      'client_sign_up.kept_pending',
      { type: 'client_account', id: clientAccountId },
      { withNote: note !== null, correlationId },
    );
    return done.fresh;
  }

  /**
   * One of the request's candidates whose newest checks, recorded in the last 24 hours, allow the
   * action: 409 NOT_A_CANDIDATE for any other record, 409 CHECKS_REQUIRED otherwise.
   */
  private async checkedCandidate(
    tx: TxClient,
    clientAccountId: string,
    candidateClientId: string,
    action: 'LINK' | 'RESTORE_ACCESS',
  ): Promise<SignUpCandidate> {
    const candidate = await this.candidate(tx, clientAccountId, candidateClientId);
    const checks = await tx.clientSignupVerification.findFirst({
      where: { clientAccountId, candidateClientId, createdAt: { gt: checksSince() } },
      orderBy: { createdAt: 'desc' },
      select: { callOutcome: true, identityResult: true, permissionScope: true },
    });
    if (!checks || !allows(checks, action)) throw checksRequired();
    return candidate;
  }

  /**
   * One of the request's candidates: 404 for a record this firm does not have (another firm's is
   * out of reach), 409 NOT_A_CANDIDATE for one of its records the request may not belong to.
   */
  private async candidate(
    tx: TxClient,
    clientAccountId: string,
    candidateClientId: string,
  ): Promise<SignUpCandidate> {
    const found = (await signUpCandidates(tx, clientAccountId)).find(
      (c) => c.clientId === candidateClientId,
    );
    if (found) return found;
    const exists = await tx.client.findFirst({
      where: { id: candidateClientId },
      select: { id: true },
    });
    throw exists ? notACandidate() : notFound();
  }

  /** The record to link to, locked, with no primary portal login and not archived. */
  private async lockUnlinked(tx: TxClient, businessId: string, clientId: string): Promise<void> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM clients WHERE id = ${clientId}::uuid AND business_id = ${businessId}::uuid
      FOR UPDATE`;
    if (locked.length !== 1) throw notFound();
    const record = await tx.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { archivedAt: true, ...PRIMARY_LOGINS },
    });
    if (record.archivedAt || record._count.accounts > 0) throw notLinkable();
  }

  /** Records a member's resolution of one candidate (who, when, and Not a Match's reason). */
  private async resolve(
    tx: TxClient,
    actor: Actor,
    clientAccountId: string,
    c: SignUpCandidate,
    resolution: 'NOT_A_MATCH' | 'VERIFIED',
    rationale: string | null,
  ): Promise<void> {
    const reviewed = {
      resolution,
      reviewedByUserId: actor.userId,
      reviewedAt: new Date(),
      rationale,
    };
    await tx.clientSignupMatchCandidate.upsert({
      where: {
        businessId_clientAccountId_candidateClientId: {
          businessId: actor.businessId,
          clientAccountId,
          candidateClientId: c.clientId,
        },
      },
      create: {
        businessId: actor.businessId,
        clientAccountId,
        candidateClientId: c.clientId,
        matchedOn: [...(c.byEmail ? ['email'] : []), ...(c.byPhone ? ['phone'] : [])],
        ...reviewed,
      },
      update: reviewed,
    });
  }

  /**
   * For the detail: per candidate, its newest checks of the last 24 hours, whether it has an
   * active primary portal login, and whether it is archived.
   */
  private async reviewOf(tx: TxClient, clientAccountId: string, candidates: SignUpCandidate[]) {
    const ids = candidates.map((c) => c.clientId);
    const out = new Map<
      string,
      {
        checks: {
          id: string;
          contactRef: 'CLIENT_PHONE' | 'CLIENT_EMAIL' | 'CLIENT_CONTACT';
          callOutcome: 'REACHED' | 'NOT_REACHED';
          identityResult: 'VERIFIED' | 'NOT_VERIFIED';
          permissionScope: 'RESTORE_ACCESS' | 'LINK_RECORD' | 'BOTH' | null;
          createdAt: Date;
          actorUserId: string;
        } | null;
        login: boolean;
        archived: boolean;
      }
    >();
    if (!ids.length) return out;
    const [checks, logins, records] = await Promise.all([
      tx.clientSignupVerification.findMany({
        where: {
          clientAccountId,
          candidateClientId: { in: ids },
          createdAt: { gt: checksSince() },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          candidateClientId: true,
          contactRef: true,
          callOutcome: true,
          identityResult: true,
          permissionScope: true,
          createdAt: true,
          actorUserId: true,
        },
      }),
      tx.clientAccount.findMany({
        where: { clientId: { in: ids }, portalRole: 'PRIMARY', status: 'ACTIVE' },
        select: { clientId: true },
      }),
      tx.client.findMany({ where: { id: { in: ids } }, select: { id: true, archivedAt: true } }),
    ]);
    for (const id of ids) {
      out.set(id, {
        checks: checks.find((v) => v.candidateClientId === id) ?? null,
        login: logins.some((l) => l.clientId === id),
        archived: records.some((r) => r.id === id && r.archivedAt !== null),
      });
    }
    return out;
  }

  /** The review's own steps for the history: checks recorded and the members' decisions. */
  private async reviewSteps(tx: TxClient, clientAccountId: string) {
    const KIND = {
      KEEP_PENDING: 'KEPT_PENDING',
      NOT_A_MATCH: 'NOT_A_MATCH',
      LINK_EXISTING: 'LINKED',
      RESTORE_ACCESS: 'ACCESS_RESTORED',
    } as const;
    const [checks, ops] = await Promise.all([
      tx.clientSignupVerification.findMany({
        where: { clientAccountId },
        select: { createdAt: true, actorUserId: true },
      }),
      tx.clientSignupOperation.findMany({
        where: { clientAccountId, kind: { in: Object.keys(KIND) as (keyof typeof KIND)[] } },
        select: { kind: true, createdAt: true, actorUserId: true, result: true },
      }),
    ]);
    const noteOf = (result: unknown) => {
      const note = (result as { note?: unknown } | null)?.note;
      return typeof note === 'string' ? note : null;
    };
    return [
      ...checks.map((c) => ({
        kind: 'CHECKS_RECORDED' as const,
        at: c.createdAt,
        actorUserId: c.actorUserId as string | null,
        note: null as string | null,
      })),
      ...ops.map((o) => ({
        kind: KIND[o.kind as keyof typeof KIND],
        at: o.createdAt,
        actorUserId: o.actorUserId,
        note: noteOf(o.result),
      })),
    ];
  }

  /**
   * A sign-up in this firm's queue: 404 for any other id (another firm's, or one that never
   * verified both email and phone), 409 NOT_PENDING once it was approved or declined.
   */
  private async pendingSignUp(tx: TxClient, businessId: string, clientAccountId: string) {
    if (!UUID.test(clientAccountId)) throw notFound();
    const account = await tx.clientAccount.findUnique({
      where: { id: clientAccountId },
      select: {
        id: true,
        businessId: true,
        status: true,
        email: true,
        accountType: true,
        version: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        legalAcceptances: { select: { id: true }, take: 1 },
        user: { select: { name: true, phone: true, cognitoSub: true } },
      },
    });
    if (!account || account.businessId !== businessId) throw notFound();
    if (
      !account.emailVerifiedAt ||
      (!account.phoneVerifiedAt && account.legalAcceptances.length === 0)
    ) {
      throw notFound();
    }
    if (account.status !== 'PENDING_APPROVAL') throw notPending();
    return account;
  }

  /**
   * A new client record from the sign-up, unless one of the firm's clients already has its email
   * (409 DUPLICATE_EMAIL). R0's unique index on clients (business_id, email) (R10 step 3) closes
   * the gap between the check and the insert: its violation is the same 409.
   */
  private async createUnlessTaken(
    tx: TxClient,
    businessId: string,
    account: Awaited<ReturnType<ClientSignUpsService['pendingSignUp']>>,
  ): Promise<string> {
    // R10's per-firm email lock first, so a client created or changed at the same time waits.
    await lockClientEmails(tx, businessId);
    const taken = await tx.client.findFirst({
      where: { email: account.email },
      select: { id: true },
    });
    if (taken) throw duplicateEmail();
    // Checked again here, under the lock: a record with the same phone may be this person.
    if ((await signUpCandidates(tx, account.id)).some(holdsBack)) throw potentialMatch();
    try {
      return await createClientFromSignUp(tx, businessId, {
        name: account.user.name,
        email: account.email,
        phone: account.user.phone,
        accountType: account.accountType,
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw duplicateEmail();
      throw e;
    }
  }

  /**
   * The record to link to, locked first (SELECT ... FOR UPDATE) so two links to the same record
   * at once cannot both find it without a primary login; then the `linkable` rule.
   */
  private async lockLinkable(
    tx: TxClient,
    businessId: string,
    clientId: string,
    verifiedEmail: string,
  ): Promise<string> {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM clients WHERE id = ${clientId}::uuid AND business_id = ${businessId}::uuid
      FOR UPDATE`;
    if (locked.length !== 1) throw notFound();
    const record = await tx.client.findUniqueOrThrow({
      where: { id: clientId },
      select: { email: true, archivedAt: true, ...PRIMARY_LOGINS },
    });
    const rule = { ...record, primaryLogins: record._count.accounts };
    if (!linkable(verifiedEmail, rule)) {
      throw notLinkable();
    }
    return clientId;
  }

  /** A row as the list shows it; `matched` only counts while the request waits. */
  private item(r: Row, matched: boolean): ClientSignUp {
    const waiting = r.status === 'PENDING_APPROVAL';
    return {
      clientAccountId: r.id,
      name: r.user.name,
      email: r.email,
      phone: r.user.phone ?? '',
      accountType: r.accountType,
      status: r.approvedAt ? 'APPROVED' : waiting ? 'PENDING_APPROVAL' : 'DECLINED',
      signedUpAt: r.createdAt.toISOString(),
      approvedAt: r.approvedAt?.toISOString() ?? null,
      declinedAt: r.declinedAt?.toISOString() ?? null,
      declineReason: r.declineReason,
      match: waiting ? (matched ? 'POTENTIAL_MATCH' : 'NO_MATCH') : null,
      client: r.approvedAt && r.client ? clientRef(r.client) : null,
      version: r.version,
    };
  }

  /** The firm's calendar days as instants: the start of `from` and the end of `to`. */
  private async dayBounds(businessId: string, from?: string, to?: string) {
    if (!from && !to) return null;
    const [row] = await this.inFirm(
      businessId,
      (tx) => tx.$queryRaw<{ start: Date | null; end: Date | null }[]>`
        WITH s AS (SELECT COALESCE(
          (SELECT timezone FROM business_settings WHERE business_id = ${businessId}::uuid),
          'America/New_York') AS tz)
        SELECT (${from ?? null}::date::timestamp AT TIME ZONE s.tz) AS start,
          ((${to ?? null}::date + 1)::timestamp AT TIME ZONE s.tz) AS "end"
        FROM s`,
    );
    return { start: row?.start ?? undefined, end: row?.end ?? undefined };
  }

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.db.withScope({ kind: 'business', businessId }, fn);
  }

  /**
   * Runs a write once per idempotency key, in one transaction with its operation record. A retry
   * with the key and the same data returns the first outcome; two attempts at the same moment
   * find each other through the key (the loser's conflict or unique violation).
   */
  private async once<T, F>(
    businessId: string,
    key: string,
    hash: string,
    work: (tx: TxClient) => Promise<F>,
  ): Promise<Once<T, F>> {
    try {
      return await this.inFirm(businessId, async (tx): Promise<Once<T, F>> => {
        const prior = await priorOutcome<T>(tx, businessId, key, hash);
        return prior ? { replay: prior } : { fresh: await work(tx) };
      });
    } catch (e) {
      if (e instanceof ConflictException || isUniqueViolation(e)) {
        const prior = await this.inFirm(businessId, (tx) =>
          priorOutcome<T>(tx, businessId, key, hash),
        );
        if (prior) return { replay: prior };
      }
      throw e;
    }
  }

  /** The firm's sign-up policy version now (1 for a firm that never changed it). */
  private async policyVersion(tx: TxClient, businessId: string): Promise<number> {
    const row = await tx.businessSettings.findUnique({
      where: { businessId },
      select: { clientSignupPolicyVersion: true },
    });
    return row?.clientSignupPolicyVersion ?? 1;
  }

  private firm(businessId: string) {
    return this.db.forBusiness(businessId).business.findUniqueOrThrow({
      where: { id: businessId },
      select: { name: true, slug: true },
    });
  }
}
