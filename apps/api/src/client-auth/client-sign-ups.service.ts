import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import { type Database, Prisma, type TxClient } from '@firmivra/db';
import {
  type ApproveSignUpResponse,
  type ClientSignUp,
  ClientSignUpDetail,
  ClientSignUpList,
  type ClientSignUpsQuery,
  ClientSignUpSettings,
  type DeclineSignUpResponse,
  type SignUpEvent,
  type SignUpListStatus,
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
  user: { select: { name: true, phone: true } },
  client: { select: { id: true, clientNumber: true, displayName: true } },
} satisfies Prisma.ClientAccountSelect;
type Row = Prisma.ClientAccountGetPayload<{ select: typeof ROW }>;

/** A client record of the firm a waiting sign-up may belong to, and what matched. */
interface Candidate {
  accountId: string;
  clientId: string;
  clientNumber: number;
  displayName: string;
  byEmail: boolean;
  byPhone: boolean;
}
/** A phone's last 10 digits: "+1 (770) 555-0123" and "7705550123" are the same number. */
const tenDigits = (column: Prisma.Sql) =>
  Prisma.sql`right(regexp_replace(coalesce(${column}, ''), '[^0-9]', '', 'g'), 10)`;
const clientRef = (c: { id: string; clientNumber: number; displayName: string }) => ({
  clientId: c.id,
  clientNumber: `CL-${c.clientNumber}`,
  displayName: c.displayName,
});

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
    const matched = waiting ? await this.inFirm(actor.businessId, (tx) => this.candidates(tx)) : [];
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
        ? await this.inFirm(actor.businessId, (tx) => this.candidates(tx, row.id))
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
    return ClientSignUpDetail.parse({
      ...this.item(row, candidates.length > 0),
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
   * Opens the portal for a pending sign-up, in one transaction: claims the sign-up (only one
   * approval or decline can), then creates the firm's client record from it or, with `clientId`,
   * links an existing record that passes `linkable` (409 CLIENT_NOT_LINKABLE otherwise, 404 if
   * the firm has no such record). Never a second client with one email: without `clientId`, a
   * record with the sign-up's email is 409 DUPLICATE_EMAIL. Any refusal rolls the claim back.
   */
  async approve(
    actor: Actor,
    clientAccountId: string,
    clientId: string | undefined,
  ): Promise<ApproveSignUpResponse> {
    const approvedAt = new Date();
    const { account, linkedTo } = await this.db.withScope(
      { kind: 'business', businessId: actor.businessId },
      async (tx) => {
        const account = await this.pendingSignUp(tx, actor.businessId, clientAccountId);
        const claimed = await tx.clientAccount.updateMany({
          where: { id: account.id, status: 'PENDING_APPROVAL' },
          data: { status: 'ACTIVE', approvedAt, approvedByUserId: actor.userId },
        });
        if (claimed.count !== 1) throw notPending();
        const linkedTo = clientId
          ? await this.lockLinkable(tx, actor.businessId, clientId, account.email)
          : await this.createUnlessTaken(tx, actor.businessId, account);
        await tx.clientAccount.update({
          where: { id: account.id },
          data: { clientId: linkedTo, portalRole: 'PRIMARY' },
        });
        return { account, linkedTo };
      },
    );

    if (!clientId) {
      await this.audit.log(
        'client.created',
        { type: 'client', id: linkedTo },
        { from: 'portal_sign_up', clientAccountId: account.id },
      );
    }
    await this.audit.log(
      'client_account.approved',
      { type: 'client_account', id: account.id },
      { clientId: linkedTo, linked: clientId !== undefined },
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
    return {
      clientAccountId: account.id,
      clientId: linkedTo,
      status: 'ACTIVE',
      approvedAt: approvedAt.toISOString(),
    };
  }

  /**
   * Declines a pending sign-up and disables its login. Our database already keeps a declined
   * client out (auth/portal-clients.ts); disabling the Cognito login also ends its sessions.
   */
  async decline(
    actor: Actor,
    clientAccountId: string,
    reason: string | undefined,
  ): Promise<DeclineSignUpResponse> {
    const declinedAt = new Date();
    const account = await this.db.withScope(
      { kind: 'business', businessId: actor.businessId },
      async (tx) => {
        const account = await this.pendingSignUp(tx, actor.businessId, clientAccountId);
        const declined = await tx.clientAccount.updateMany({
          where: { id: account.id, status: 'PENDING_APPROVAL' },
          data: {
            status: 'DECLINED',
            declinedAt,
            declinedByUserId: actor.userId,
            declineReason: reason ?? null,
          },
        });
        if (declined.count !== 1) throw notPending();
        return account;
      },
    );
    try {
      await this.identity.disableUser('CLIENT', account.user.cognitoSub);
    } catch {
      // Ids only (hard rule 4). The decline stands: the database refuses this client anyway.
      this.logger.warn(`Could not disable the login of declined client account ${account.id}`);
    }
    await this.audit.log(
      'client_account.declined',
      { type: 'client_account', id: account.id },
      { withReason: reason !== undefined },
    );
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
    return {
      clientAccountId: account.id,
      status: 'DECLINED',
      declinedAt: declinedAt.toISOString(),
    };
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
    if ((await this.candidates(tx, account.id)).length > 0) throw potentialMatch();
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
    };
  }

  /**
   * The firm's client records (archived ones too) that waiting sign-ups may belong to: the same
   * email (both lower-cased) or the same phone's last 10 digits. A name alone never counts.
   */
  private candidates(tx: TxClient, accountId?: string): Promise<Candidate[]> {
    // One request whatever its state (approve checks it after claiming it), or every waiting one.
    const which = accountId
      ? Prisma.sql`a.id = ${accountId}::uuid`
      : Prisma.sql`a.status = 'PENDING_APPROVAL'`;
    const phone = Prisma.sql`(length(${tenDigits(Prisma.sql`u.phone`)}) = 10
      AND ${tenDigits(Prisma.sql`c.phone`)} = ${tenDigits(Prisma.sql`u.phone`)})`;
    return tx.$queryRaw<Candidate[]>`
      SELECT a.id::text AS "accountId", c.id::text AS "clientId", c.client_number AS "clientNumber",
        c.display_name AS "displayName",
        coalesce(lower(c.email) = lower(a.email), false) AS "byEmail", ${phone} AS "byPhone"
      FROM client_accounts a
      JOIN users u ON u.id = a.user_id
      JOIN clients c ON c.business_id = a.business_id
        AND (lower(c.email) = lower(a.email) OR ${phone})
      WHERE ${which}
      ORDER BY a.id, c.client_number`;
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

  private firm(businessId: string) {
    return this.db.forBusiness(businessId).business.findUniqueOrThrow({
      where: { id: businessId },
      select: { name: true, slug: true },
    });
  }
}
