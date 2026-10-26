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
  type SignUpEvent,
  type SignUpListStatus,
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
  priorOutcome,
  recordOperation,
  requestHash,
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
    const matchedIds = [...new Set(matched.map((c) => c.accountId))];
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
    const candidates =
      row.status === 'PENDING_APPROVAL'
        ? await this.inFirm(actor.businessId, (tx) => signUpCandidates(tx, row.id))
        : [];
    const deciders = [row.approvedByUserId, row.declinedByUserId].filter(
      (id): id is string => id !== null,
    );
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
      ...step('APPROVED', row.approvedAt, row.approvedByUserId),
      ...step('DECLINED', row.declinedAt, row.declinedByUserId),
    ].sort((a, b) => a.at.localeCompare(b.at));
    await this.audit.log(
      'client_sign_up.viewed',
      { type: 'client_account', id: row.id },
      { candidates: candidates.length },
    );
    const waiting = row.status === 'PENDING_APPROVAL';
    return ClientSignUpDetail.parse({
      ...this.item(row, candidates.length > 0),
      automatic: row.decidedAutomatically,
      allowedActions: waiting ? [...(candidates.length ? [] : ['APPROVE']), 'DECLINE'] : [],
      history,
      candidates: candidates.map((c) => ({
        ...clientRef({ id: c.clientId, clientNumber: c.clientNumber, displayName: c.displayName }),
        matchedOn: [...(c.byEmail ? ['email'] : []), ...(c.byPhone ? ['phone'] : [])],
      })),
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
    if ((await signUpCandidates(tx, account.id)).length > 0) throw potentialMatch();
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
