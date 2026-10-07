import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import type { Database, ScopedClient, TxClient } from '@firmivra/db';
import {
  type ApproveSignUpResponse,
  type ClientSignUp,
  ClientSignUpList,
  type ClientSignUpsQuery,
  type DeclineSignUpResponse,
} from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { IDENTITY_PROVIDER, type IdentityProvider } from '../auth/identity/identity-provider.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { CLIENT_CODE_SENDER, type ClientCodeSender } from './client-code-sender.js';
import { createClientFromSignUp, linkable, PRIMARY_LOGINS } from './client-records.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A sign-up is in the queue once both email and phone are verified. */
const VERIFIED = { emailVerifiedAt: { not: null }, phoneVerifiedAt: { not: null } } as const;

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

/** Opaque paging cursor: the last item's sign-up time and id. */
const Cursor = z.object({ t: z.iso.datetime(), id: z.uuid() });
export const encodeCursor = (row: { createdAt: Date; id: string }) =>
  Buffer.from(JSON.stringify({ t: row.createdAt.toISOString(), id: row.id })).toString('base64url');
export function decodeCursor(cursor: string): { t: Date; id: string } {
  try {
    const c = Cursor.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    return { t: new Date(c.t), id: c.id };
  } catch {
    throw new BadRequestException({ code: 'VALIDATION_FAILED', message: 'Unknown cursor' });
  }
}

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

  /** Verified sign-ups waiting for the firm (or declined ones), oldest first. */
  async list(actor: Actor, query: z.output<typeof ClientSignUpsQuery>): Promise<ClientSignUpList> {
    const firm = this.db.forBusiness(actor.businessId);
    const after = query.cursor ? decodeCursor(query.cursor) : undefined;
    const rows = await firm.clientAccount.findMany({
      where: {
        status: query.status,
        ...(query.status === 'PENDING_APPROVAL' ? VERIFIED : {}),
        ...(after
          ? { OR: [{ createdAt: { gt: after.t } }, { createdAt: after.t, id: { gt: after.id } }] }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: query.limit + 1,
      select: {
        id: true,
        email: true,
        accountType: true,
        status: true,
        createdAt: true,
        declinedAt: true,
        declineReason: true,
        user: { select: { name: true, phone: true } },
      },
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const existing =
      query.status === 'PENDING_APPROVAL'
        ? await this.existingClients(
            firm,
            page.map((r) => r.email),
          )
        : new Map<string, ClientSignUp['existingClient']>();
    return ClientSignUpList.parse({
      items: page.map((r) => ({
        clientAccountId: r.id,
        name: r.user.name,
        email: r.email,
        phone: r.user.phone ?? '',
        accountType: r.accountType,
        status: r.status,
        signedUpAt: r.createdAt.toISOString(),
        declinedAt: r.declinedAt?.toISOString() ?? null,
        declineReason: r.declineReason,
        existingClient: existing.get(r.email) ?? null,
      })),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
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
    await this.sender.signUpApproved({
      to: account.email,
      businessName: firm.name,
      signInUrl: `${this.env.PORTAL_BASE_URL.replace(/\/+$/, '')}/${firm.slug}/sign-in`,
    });
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
    await this.sender.signUpDeclined({ to: account.email, businessName: firm.name });
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
        user: { select: { name: true, phone: true, cognitoSub: true } },
      },
    });
    if (!account || account.businessId !== businessId) throw notFound();
    if (!account.emailVerifiedAt || !account.phoneVerifiedAt) throw notFound();
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
    const taken = await tx.client.findFirst({
      where: { email: account.email },
      select: { id: true },
    });
    if (taken) throw duplicateEmail();
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
      select: { email: true, ...PRIMARY_LOGINS },
    });
    if (!linkable(verifiedEmail, { email: record.email, primaryLogins: record._count.accounts })) {
      throw notLinkable();
    }
    return clientId;
  }

  /**
   * For each email, the one client record approve would link to. Two or more such records: none
   * is offered, so staff pick one deliberately. The database keeps both emails lower-case, so an
   * exact match finds the candidates; `linkable` decides.
   */
  private async existingClients(firm: ScopedClient, emails: string[]) {
    const found = new Map<string, NonNullable<ClientSignUp['existingClient']>>();
    if (emails.length === 0) return found;
    const candidates = await firm.client.findMany({
      where: { email: { in: emails } },
      select: { id: true, displayName: true, email: true, ...PRIMARY_LOGINS },
    });
    for (const email of emails) {
      const matches = candidates.filter((c) =>
        linkable(email, { email: c.email, primaryLogins: c._count.accounts }),
      );
      const [only] = matches;
      if (matches.length === 1 && only) {
        found.set(email, { clientId: only.id, displayName: only.displayName });
      }
    }
    return found;
  }

  private firm(businessId: string) {
    return this.db.forBusiness(businessId).business.findUniqueOrThrow({
      where: { id: businessId },
      select: { name: true, slug: true },
    });
  }
}
