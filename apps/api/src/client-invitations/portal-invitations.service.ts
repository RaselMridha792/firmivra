import {
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Database, TxClient } from '@firmivra/db';
import {
  type ClientPortalAccess,
  type OpenedPortalInvitation,
  PORTAL_INVITATION_DAYS,
  PORTAL_INVITATIONS_PER_DAY,
  type PortalInvitation,
  type PortalInvitationBlock,
} from '@firmivra/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { type PoolSecrets, Sealer } from '../auth/sealed.js';
import { PortalInfoService } from '../client-auth/portal-info.controller.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { NotifyDeliveryError } from '../notify/notify.service.js';
import { NOTIFY_SERVICE, type NotifyService } from '../notify/notify.types.js';

/** The audit actions that are an invitation's record: sent, not delivered, revoked, opened. */
export const INVITATION_ACTIONS = {
  sent: 'client.portal_invitation_sent',
  failed: 'client.portal_invitation_failed',
  revoked: 'client.portal_invitation_revoked',
  opened: 'client.portal_invitation_opened',
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const TTL_SECONDS = PORTAL_INVITATION_DAYS * 24 * 60 * 60;

/** What the link carries, sealed (A256GCM): the recipient cannot read or change it. */
const InvitationSeal = z.object({
  pool: z.literal('CLIENT'),
  businessId: z.uuid(),
  clientId: z.uuid(),
  invitationId: z.uuid(),
  email: z.string(),
});
type InvitationSeal = z.infer<typeof InvitationSeal>;

export class PortalInvitationSeals extends Sealer<InvitationSeal> {
  constructor(secrets: PoolSecrets) {
    super('fv-portal-invitation-v1', InvitationSeal, secrets);
  }
}
export const INVITATION_SEALS = Symbol('INVITATION_SEALS');

/** The member as this service needs them; Staff reach only the clients assigned to them. */
export interface InvitationActor {
  userId: string;
  role: 'OWNER' | 'ADMIN' | 'STAFF';
}

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const invalid = () =>
  new GoneException({
    code: 'INVITATION_INVALID',
    message: 'This invitation link has expired or was replaced. Ask the firm for a new one.',
  });
const BLOCK_MESSAGE: Record<PortalInvitationBlock, string> = {
  NO_EMAIL: 'Add an email address to the client before inviting them.',
  HAS_LOGIN: 'The client already has a portal login.',
  SIGN_UP_WAITING: 'A sign-up with this email is waiting for approval in Sign-ups.',
  ARCHIVED: 'Restore the client before inviting them.',
  DAILY_LIMIT: `At most ${PORTAL_INVITATIONS_PER_DAY} invitations a day can be sent to one client.`,
};

type AuditRow = { action: string; metadata: unknown; actorUserId: string | null; createdAt: Date };
const idOf = (row: AuditRow): string | undefined => {
  const m = row.metadata as { invitationId?: unknown } | null;
  return typeof m?.invitationId === 'string' ? m.invitationId : undefined;
};
const expiryOf = (row: AuditRow): Date => {
  const m = row.metadata as { expiresAt?: unknown } | null;
  return typeof m?.expiresAt === 'string'
    ? new Date(m.expiresAt)
    : new Date(row.createdAt.getTime() + TTL_SECONDS * 1000);
};

/** `r•••@example.com`: enough for the recipient to know which address to use. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '•••';
  return `${email[0]}•••${email.slice(at)}`;
}

/**
 * A client's portal access and the firm's invitation to it (Business Advisory B3). The link is
 * `{PORTAL_BASE_URL}/{slug}/invitation#token=...`: a sealed value (invitation id, client, email)
 * that expires after 7 days. Nothing secret is stored; the invitation's state is its audit trail
 * (sent, not delivered, revoked), so a newer invitation, a revocation, a changed email or a login
 * makes the older link stop working. The link opens the firm's sign-up, and the firm approves the
 * sign-up in Sign-ups as for any other: the invitation never opens the portal by itself.
 */
@Injectable()
export class PortalInvitationsService {
  private readonly logger = new Logger(PortalInvitationsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    @Inject(INVITATION_SEALS) private readonly seals: PortalInvitationSeals,
    private readonly portal: PortalInfoService,
    private readonly audit: AuditService,
  ) {}

  async access(
    businessId: string,
    actor: InvitationActor,
    clientId: string,
  ): Promise<ClientPortalAccess> {
    const view = await this.inFirm(businessId, (tx) => this.read(tx, actor, clientId));
    await this.audit.log('client.portal_access_viewed', { type: 'client', id: clientId });
    return view;
  }

  async send(
    businessId: string,
    actor: InvitationActor,
    clientId: string,
  ): Promise<ClientPortalAccess> {
    const invitationId = randomUUID();
    const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000);
    const ready = await this.inFirm(businessId, async (tx) => {
      // One send at a time per client, so the daily count and "the latest link" hold.
      await tx.$queryRaw`SELECT id FROM clients WHERE id = ${clientId}::uuid FOR UPDATE`;
      const view = await this.read(tx, actor, clientId);
      if (view.blocked) {
        throw new ConflictException({ code: view.blocked, message: BLOCK_MESSAGE[view.blocked] });
      }
      const firm = await tx.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { slug: true },
      });
      await this.audit.logIn(
        tx,
        INVITATION_ACTIONS.sent,
        { type: 'client', id: clientId },
        { invitationId, expiresAt: expiresAt.toISOString() },
      );
      return { view, slug: firm.slug };
    });
    const recipient = ready.view.recipient!;
    const token = await this.seals.sealUntil(
      {
        pool: 'CLIENT',
        businessId,
        clientId,
        invitationId,
        email: recipient.email.toLowerCase(),
      },
      Math.floor(expiresAt.getTime() / 1000),
    );
    const portal = this.env.PORTAL_BASE_URL.replace(/\/+$/, '');
    try {
      await this.notify.send({
        template: 'client.portal-invitation',
        to: recipient.email,
        businessId,
        data: {
          name: recipient.name,
          link: `${portal}/${ready.slug}/invitation#token=${token}`,
          expiresAt,
        },
      });
    } catch (error) {
      if (!(error instanceof NotifyDeliveryError)) throw error;
      // Ids only (hard rule 4). The record says it was not delivered, so the link never opens.
      this.logger.warn(`The portal invitation for client ${clientId} was not sent`);
      await this.audit.log(
        INVITATION_ACTIONS.failed,
        { type: 'client', id: clientId },
        { invitationId },
      );
    }
    return this.inFirm(businessId, (tx) => this.read(tx, actor, clientId));
  }

  async revoke(
    businessId: string,
    actor: InvitationActor,
    clientId: string,
  ): Promise<ClientPortalAccess> {
    return this.inFirm(businessId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM clients WHERE id = ${clientId}::uuid FOR UPDATE`;
      const view = await this.read(tx, actor, clientId);
      if (view.invitation?.state !== 'OPEN') {
        throw new ConflictException({ code: 'NOT_OPEN', message: 'No open invitation to revoke.' });
      }
      await this.audit.logIn(
        tx,
        INVITATION_ACTIONS.revoked,
        { type: 'client', id: clientId },
        { invitationId: view.invitation.id },
      );
      return this.read(tx, actor, clientId);
    });
  }

  /**
   * The signed-out invitation page. 410 INVITATION_INVALID unless the link is this firm's, unexpired,
   * the client's latest delivered invitation, not revoked, and the client's email is still the one
   * it was sent to; 409 ALREADY_SIGNED_UP once a login or a sign-up exists for that email.
   */
  async open(slug: string, token: string): Promise<OpenedPortalInvitation> {
    const firm = await this.portal.activeFirm(slug);
    const opened = await this.seals.open(token, 'CLIENT');
    if (!opened || opened.value.businessId !== firm.id) throw invalid();
    const seal = opened.value;
    const client = await this.inFirm(firm.id, async (tx) => {
      const client = await tx.client.findUnique({
        where: { id: seal.clientId },
        select: { id: true, displayName: true, email: true, archivedAt: true },
      });
      if (!client || client.archivedAt || client.email?.toLowerCase() !== seal.email) {
        throw invalid();
      }
      const invitation = this.latest(await this.trail(tx, client.id));
      if (
        !invitation ||
        invitation.id !== seal.invitationId ||
        !invitation.delivered ||
        invitation.revokedAt
      ) {
        throw invalid();
      }
      const login = await tx.clientAccount.count({
        where: {
          OR: [{ clientId: client.id }, { email: seal.email }],
          status: { in: ['INVITED', 'PENDING_APPROVAL', 'ACTIVE'] },
        },
      });
      if (login > 0) {
        throw new ConflictException({
          code: 'ALREADY_SIGNED_UP',
          message: 'An account with this email exists. Sign in instead.',
        });
      }
      return client;
    });
    await this.audit.log(
      INVITATION_ACTIONS.opened,
      { type: 'client', id: client.id },
      { invitationId: seal.invitationId },
      { businessId: firm.id },
    );
    return {
      firmName: firm.name,
      name: client.displayName,
      maskedEmail: maskEmail(seal.email),
      expiresAt: new Date(opened.expiresAt * 1000).toISOString(),
    };
  }

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  private async read(
    tx: TxClient,
    actor: InvitationActor,
    clientId: string,
  ): Promise<ClientPortalAccess> {
    const client = await tx.client.findFirst({
      where: {
        id: clientId,
        ...(actor.role === 'STAFF' ? { assignedUserId: actor.userId } : {}),
      },
      select: {
        id: true,
        displayName: true,
        email: true,
        archivedAt: true,
        accounts: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, email: true, portalRole: true, status: true },
        },
      },
    });
    if (!client) throw notFound();
    const email = client.email?.toLowerCase() ?? null;
    const waiting = email
      ? await tx.clientAccount.count({
          where: {
            email,
            clientId: null,
            status: 'PENDING_APPROVAL',
            emailVerifiedAt: { not: null },
          },
        })
      : 0;
    const trail = await this.trail(tx, client.id);
    const linked = client.accounts.some((a) =>
      ['INVITED', 'PENDING_APPROVAL', 'ACTIVE'].includes(a.status),
    );
    const latest = this.latest(trail);
    const sentToday = trail.filter(
      (r) => r.action === INVITATION_ACTIONS.sent && r.createdAt.getTime() > Date.now() - DAY_MS,
    ).length;
    const blocked: PortalInvitationBlock | null = client.archivedAt
      ? 'ARCHIVED'
      : !email
        ? 'NO_EMAIL'
        : linked
          ? 'HAS_LOGIN'
          : waiting
            ? 'SIGN_UP_WAITING'
            : sentToday >= PORTAL_INVITATIONS_PER_DAY
              ? 'DAILY_LIMIT'
              : null;
    let invitation: PortalInvitation | null = null;
    if (latest) {
      const sentBy = latest.actorUserId
        ? await tx.membership.findFirst({
            where: { userId: latest.actorUserId },
            select: { user: { select: { name: true } } },
          })
        : null;
      invitation = {
        id: latest.id,
        sentAt: latest.sentAt.toISOString(),
        sentBy: sentBy?.user.name ?? null,
        expiresAt: latest.expiresAt.toISOString(),
        delivered: latest.delivered,
        revokedAt: latest.revokedAt?.toISOString() ?? null,
        state:
          linked || waiting
            ? 'ACCEPTED'
            : !latest.delivered
              ? 'NOT_SENT'
              : latest.revokedAt
                ? 'REVOKED'
                : latest.expiresAt.getTime() <= Date.now()
                  ? 'EXPIRED'
                  : 'OPEN',
      };
    }
    return {
      clientId: client.id,
      clientName: client.displayName,
      recipient: client.email ? { name: client.displayName, email: client.email } : null,
      logins: client.accounts.map((a) => ({
        clientAccountId: a.id,
        email: a.email,
        portalRole: a.portalRole,
        status: a.status,
      })),
      invitation,
      blocked,
    };
  }

  /** The client's invitation records of the last eight days (a link lasts seven), newest first. */
  private trail(tx: TxClient, clientId: string): Promise<AuditRow[]> {
    return tx.auditLog.findMany({
      where: {
        entityType: 'client',
        entityId: clientId,
        action: {
          in: [INVITATION_ACTIONS.sent, INVITATION_ACTIONS.failed, INVITATION_ACTIONS.revoked],
        },
        createdAt: { gt: new Date(Date.now() - (PORTAL_INVITATION_DAYS + 1) * DAY_MS) },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: { action: true, metadata: true, actorUserId: true, createdAt: true },
    });
  }

  /** The newest invitation sent, with whether it was delivered and when it was revoked. */
  private latest(trail: AuditRow[]) {
    const sent = trail.find((r) => r.action === INVITATION_ACTIONS.sent);
    const id = sent && idOf(sent);
    if (!sent || !id) return undefined;
    const of = (action: string) => trail.find((r) => r.action === action && idOf(r) === id);
    return {
      id,
      sentAt: sent.createdAt,
      actorUserId: sent.actorUserId,
      expiresAt: expiryOf(sent),
      delivered: !of(INVITATION_ACTIONS.failed),
      revokedAt: of(INVITATION_ACTIONS.revoked)?.createdAt ?? null,
    };
  }
}
