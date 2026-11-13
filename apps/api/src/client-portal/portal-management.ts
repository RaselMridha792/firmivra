import {
  Controller,
  Get,
  Inject,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { Prisma, type Database, type TxClient } from '@firmivra/db';
import {
  ClientId,
  type ClientPortalActivityItem,
  type ClientPortalActivityPage,
  ClientPortalActivityQuery,
  type ClientPortalHeader,
  type ClientPortalLoginItem,
  type ClientPortalLogins,
  ClientPortalLoginsQuery,
  type ClientPortalStatus,
  type ClientPortalSummary,
  type PendingClientAction,
  type PendingClientActions,
  type PermissionModule,
  PortalSummaryQuery,
  RECENT_PORTAL_CLIENTS,
  type RecentPortalClients,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import { IDENTITY_PROVIDER, type IdentityProvider } from '../auth/identity/identity-provider.js';
import { SignInModule } from '../auth/sign-in.controller.js';
import { portalEmailKey } from '../auth/sign-in.service.js';
import { PortalInvitationsModule } from '../client-invitations/portal-invitations.controller.js';
import {
  type InvitationActor,
  PortalInvitationsService,
} from '../client-invitations/portal-invitations.service.js';
import { type AuthContext, legacyFirmRole, type TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { PermissionGrantsService } from '../roles/permission-grants.service.js';

// The firm workspace's Client Portal module, part 1 (Client Portal developer instructions 1 to 5,
// 13 to 15, 17, 24 and 26): the client's header and status strip, the member's Recent Clients,
// the Portal Summary, Pending Client Actions, the portal Activity and Login History. Every read is
// of the canonical records in the firm's scope, for one client the member may see (Staff: the
// clients assigned to them); nothing is copied. Opening the header is the page view, audited;
// the activity and login history, which show IPs to Owner and Admin, are audited each.

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const DAY_MS = 24 * 60 * 60 * 1000;
/** The member's Recent Clients rows kept (the list shows RECENT_PORTAL_CLIENTS). */
const RECENT_KEPT = 20;
const IN_PROGRESS_DONE = ['ACCEPTED', 'CLOSED'] as const;
const INTAKE_WAITING = ['SENT', 'IN_PROGRESS', 'NEEDS_CORRECTION'] as const;
const ESIGN_OPEN = ['SENT', 'DELIVERED', 'VIEWED', 'PARTIALLY_SIGNED'] as const;
const SIGNER_WAITING = ['SENT', 'DELIVERED', 'VIEWED'] as const;
const LOGIN_ACTIONS = {
  signedIn: 'auth.signed_in',
  signedOut: 'auth.signed_out',
  failed: 'auth.sign_in_failed',
  locked: 'auth.locked',
} as const;

const number = (n: number) => `CL-${n}`;
const dateOnly = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** A keyset cursor: the row's time and id, base64url. */
const encodeCursor = (at: Date, id: string) =>
  Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
function decodeCursor(cursor: string | undefined): { at: Date; id: string } | undefined {
  if (!cursor) return undefined;
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const when = new Date(at ?? '');
  if (!id || Number.isNaN(when.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  return { at: when, id };
}

@Injectable()
export class PortalManagementService {
  private readonly logger = new Logger(PortalManagementService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    private readonly audit: AuditService,
    private readonly invitations: PortalInvitationsService,
    private readonly grants: PermissionGrantsService,
  ) {}

  /** The header and status strip; puts the client first in the member's Recent Clients. */
  async header(
    tenant: TenantContext,
    userId: string,
    clientId: string,
  ): Promise<ClientPortalHeader> {
    const businessId = tenant.businessId;
    const actor = this.actor(tenant, userId);
    const read = await this.inFirm(businessId, async (tx) => {
      const client = await tx.client.findFirst({
        where: this.visible(tenant, userId, clientId),
        select: {
          id: true,
          clientNumber: true,
          displayName: true,
          accountType: true,
          status: true,
          email: true,
          phone: true,
          clientSince: true,
          archivedAt: true,
        },
      });
      if (!client) throw notFound();
      const [access, accounts, lock, lastActivity, firm] = await Promise.all([
        this.invitations.readIn(tx, actor, clientId),
        tx.clientAccount.findMany({
          where: { clientId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            userId: true,
            portalRole: true,
            status: true,
            approvedAt: true,
            createdAt: true,
            user: { select: { cognitoSub: true } },
          },
        }),
        tx.clientPortalLock.findUnique({
          where: { businessId_clientId: { businessId, clientId } },
          select: {
            lockedAt: true,
            reason: true,
            lockedBy: { select: { user: { select: { name: true } } } },
          },
        }),
        tx.clientPortalActivity.findFirst({
          where: { clientId },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          select: { occurredAt: true, type: true },
        }),
        tx.business.findUniqueOrThrow({ where: { id: businessId }, select: { slug: true } }),
      ]);
      const lastLogin = accounts.length
        ? await tx.auditLog.findFirst({
            where: {
              businessId,
              action: LOGIN_ACTIONS.signedIn,
              actorUserId: { in: accounts.map((a) => a.userId) },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { createdAt: true },
          })
        : null;
      await this.remember(tx, businessId, userId, clientId);
      await this.audit.logIn(
        tx,
        'client_portal.viewed',
        { type: 'client', id: clientId },
        {},
        {
          businessId,
        },
      );
      return { client, access, accounts, lock, lastActivity, lastLogin, firm };
    });
    const { client, access, accounts, lock, lastActivity, lastLogin, firm } = read;
    const status: ClientPortalStatus = lock
      ? 'LOCKED'
      : accounts.some((a) => a.status === 'ACTIVE')
        ? 'ACTIVE'
        : accounts.some((a) => a.status === 'PENDING_APPROVAL')
          ? 'PENDING_APPROVAL'
          : accounts.some((a) => a.status === 'DISABLED')
            ? 'DEACTIVATED'
            : access.invitation?.state === 'OPEN'
              ? 'INVITATION_PENDING'
              : 'NOT_ACTIVATED';
    const approved = accounts
      .map((a) => a.approvedAt ?? (a.status === 'ACTIVE' ? a.createdAt : null))
      .filter((d): d is Date => !!d)
      .sort((a, b) => a.getTime() - b.getTime());
    const primary =
      accounts.find((a) => a.status === 'ACTIVE' && a.portalRole === 'PRIMARY') ??
      accounts.find((a) => a.status === 'ACTIVE');
    return {
      client: {
        id: client.id,
        number: number(client.clientNumber),
        name: client.displayName,
        accountType: client.accountType,
        status: client.status,
        email: client.email,
        phone: client.phone,
        clientSince: dateOnly(client.clientSince),
        archived: !!client.archivedAt,
      },
      portal: {
        status,
        lock: {
          clientId,
          locked: !!lock,
          lockedAt: lock?.lockedAt.toISOString() ?? null,
          lockedBy: lock?.lockedBy.user.name ?? null,
          reason: lock?.reason ?? null,
        },
        logins: access.logins,
        portalSince: approved[0]?.toISOString() ?? null,
        lastLogin: lastLogin?.createdAt.toISOString() ?? null,
        lastActivity: lastActivity
          ? { at: lastActivity.occurredAt.toISOString(), type: lastActivity.type }
          : null,
        mfa: primary ? await this.mfa(primary.user.cognitoSub) : null,
        invitation: access.invitation,
        invitationBlocked: access.blocked,
        link: `${this.env.PORTAL_BASE_URL.replace(/\/+$/, '')}/${firm.slug}`,
      },
      can: {
        manageAccess: this.manager(tenant),
        // As the invitation routes: Owner, Admin and Staff; another role by its grid.
        invite: this.customRole(tenant)
          ? await this.grants.canTenant(tenant, 'CLIENTS', 'CREATE')
          : true,
      },
    };
  }

  /** The member's recently opened clients they may still see, newest first. */
  async recent(tenant: TenantContext, userId: string): Promise<RecentPortalClients> {
    const rows = await this.inFirm(tenant.businessId, (tx) =>
      tx.portalRecentClient.findMany({
        where: {
          userId,
          client: {
            archivedAt: null,
            ...(this.staffScoped(tenant) ? { assignedUserId: userId } : {}),
          },
        },
        orderBy: [{ lastViewedAt: 'desc' }, { id: 'desc' }],
        take: RECENT_PORTAL_CLIENTS,
        select: {
          lastViewedAt: true,
          client: { select: { id: true, clientNumber: true, displayName: true, email: true } },
        },
      }),
    );
    return {
      items: rows.map((r) => ({
        id: r.client.id,
        number: number(r.client.clientNumber),
        name: r.client.displayName,
        email: r.client.email,
        viewedAt: r.lastViewedAt.toISOString(),
      })),
    };
  }

  /** The six cards; a card is null when the member may not view its module. */
  async summary(
    tenant: TenantContext,
    userId: string,
    clientId: string,
    days: number,
  ): Promise<ClientPortalSummary> {
    const businessId = tenant.businessId;
    const can = await this.modules(tenant);
    const from = new Date(Date.now() - days * DAY_MS);
    const now = new Date();
    return this.inFirm(businessId, async (tx) => {
      await this.client(tx, tenant, userId, clientId);
      const live = { clientId, trashedAt: null, archivedAt: null, supersededAt: null };
      const intakeOf = { engagement: { clientId } };
      const [documents, messages, appointments, taxReturns, invoices, intakeForms] =
        await Promise.all([
          can.DOCUMENTS
            ? Promise.all([
                tx.document.count({ where: { ...live, createdAt: { gte: from } } }),
                tx.document.count({
                  where: { ...live, reviewStatus: { in: ['NEEDS_REVIEW', 'IN_REVIEW'] } },
                }),
              ]).then(([added, pendingReview]) => ({ added, pendingReview }))
            : null,
          can.MESSAGES
            ? Promise.all([
                tx.message.count({ where: { thread: { clientId }, createdAt: { gte: from } } }),
                tx.message.count({
                  where: {
                    thread: { clientId, archivedAt: null },
                    direction: 'CLIENT_TO_FIRM',
                    readAt: null,
                  },
                }),
              ]).then(([inRange, unread]) => ({ inRange, unread }))
            : null,
          can.APPOINTMENTS
            ? tx.appointment
                .aggregate({
                  where: { clientId, status: 'SCHEDULED', startsAt: { gt: now } },
                  _count: { _all: true },
                  _min: { startsAt: true },
                })
                .then((a) => ({
                  upcoming: a._count._all,
                  next: a._min.startsAt?.toISOString() ?? null,
                }))
            : null,
          can.TAX_RETURNS
            ? Promise.all([
                tx.taxReturn.count({ where: { clientId, archivedAt: null } }),
                tx.taxReturn.count({
                  where: {
                    clientId,
                    archivedAt: null,
                    workflowStatus: { notIn: [...IN_PROGRESS_DONE] },
                  },
                }),
              ]).then(([total, inProgress]) => ({ total, inProgress }))
            : null,
          can.INVOICES_PAYMENTS
            ? Promise.all([
                tx.invoice.count({ where: { clientId, issuedAt: { gte: from } } }),
                this.owed(tx, businessId, clientId),
              ]).then(([issued, owed]) => ({
                issued,
                outstandingCents: owed.reduce((sum, i) => sum + i.cents, 0),
              }))
            : null,
          can.INTAKE_FORMS
            ? Promise.all([
                tx.intake.count({ where: { ...intakeOf, sentAt: { gte: from } } }),
                tx.intake.count({ where: { ...intakeOf, status: { in: [...INTAKE_WAITING] } } }),
                tx.intake.count({ where: { ...intakeOf, status: 'SUBMITTED' } }),
              ]).then(([sent, pending, needsReview]) => ({ sent, pending, needsReview }))
            : null,
        ]);
      return { days, documents, messages, appointments, taxReturns, invoices, intakeForms };
    });
  }

  /** What waits on the client (and a submitted form, on the firm), one row per kind with items. */
  async pendingActions(
    tenant: TenantContext,
    userId: string,
    clientId: string,
  ): Promise<PendingClientActions> {
    const businessId = tenant.businessId;
    const can = await this.modules(tenant);
    const today = new Date().toISOString().slice(0, 10);
    const overdue = (dues: (Date | null)[]) => dues.some((d) => !!d && dateOnly(d)! < today);
    const earliest = (dues: (Date | null)[]) =>
      dateOnly(dues.filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime())[0]);
    return this.inFirm(businessId, async (tx) => {
      await this.client(tx, tenant, userId, clientId);
      const items: PendingClientAction[] = [];
      const add = (
        kind: PendingClientAction['kind'],
        rows: { id: string; title: string; due: Date | null }[],
        extra: Partial<PendingClientAction> = {},
      ) => {
        const first = rows[0];
        if (!first) return;
        const dues = rows.map((r) => r.due);
        items.push({
          kind,
          count: rows.length,
          title: first.title,
          recordId: first.id,
          amountCents: null,
          dueOn: earliest(dues),
          at: null,
          overdue: overdue(dues),
          ...extra,
        });
      };
      const byDue = [{ dueOn: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }] as const;
      if (can.DOCUMENTS) {
        const requests = await tx.documentRequest.findMany({
          where: { clientId, status: { in: ['REQUESTED', 'REJECTED'] } },
          orderBy: [...byDue],
          take: 200,
          select: { id: true, title: true, dueOn: true },
        });
        add(
          'DOCUMENTS_REQUESTED',
          requests.map((r) => ({ id: r.id, title: r.title, due: r.dueOn })),
        );
      }
      if (can.INTAKE_FORMS) {
        const intakes = await tx.intake.findMany({
          where: {
            engagement: { clientId },
            status: { in: [...INTAKE_WAITING, 'SUBMITTED'] },
          },
          orderBy: [...byDue],
          take: 200,
          select: { id: true, status: true, dueOn: true, form: { select: { title: true } } },
        });
        const row = (i: (typeof intakes)[number]) => ({
          id: i.id,
          title: i.form.title,
          due: i.dueOn,
        });
        add('INTAKE_INCOMPLETE', intakes.filter((i) => i.status !== 'SUBMITTED').map(row));
        // Waiting on the firm: never overdue for the client.
        add('INTAKE_SUBMITTED', intakes.filter((i) => i.status === 'SUBMITTED').map(row), {
          dueOn: null,
          overdue: false,
        });
      }
      if (can.DOCUMENTS) {
        const envelopes = await tx.esignRequest.findMany({
          where: {
            clientId,
            status: { in: [...ESIGN_OPEN] },
            recipients: {
              some: { clientAccountId: { not: null }, status: { in: [...SIGNER_WAITING] } },
            },
          },
          orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
          take: 200,
          select: { id: true, title: true, expiresAt: true },
        });
        add(
          'SIGNATURE_REQUIRED',
          envelopes.map((e) => ({ id: e.id, title: e.title, due: e.expiresAt })),
        );
      }
      if (can.INVOICES_PAYMENTS) {
        const owed = (await this.owed(tx, businessId, clientId)).filter((i) => i.cents > 0);
        add(
          'INVOICE_OUTSTANDING',
          owed.map((i) => ({ id: i.id, title: i.number, due: i.dueOn })),
          { amountCents: owed.reduce((sum, i) => sum + i.cents, 0) },
        );
      }
      if (can.APPOINTMENTS) {
        const next = await tx.appointment.findMany({
          where: { clientId, status: 'SCHEDULED', startsAt: { gt: new Date() } },
          orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
          take: 200,
          select: { id: true, startsAt: true, type: { select: { name: true } } },
        });
        add(
          'APPOINTMENT_UPCOMING',
          next.map((a) => ({ id: a.id, title: a.type?.name ?? 'Appointment', due: null })),
          { at: next[0]?.startsAt.toISOString() ?? null, overdue: false },
        );
      }
      if (can.TASKS) {
        const tasks = await tx.task.findMany({
          where: { clientId, clientVisible: true, status: 'OPEN', archivedAt: null },
          orderBy: [...byDue],
          take: 200,
          select: { id: true, title: true, dueOn: true },
        });
        add(
          'TASK_OPEN',
          tasks.map((t) => ({ id: t.id, title: t.title, due: t.dueOn })),
        );
      }
      return { items };
    });
  }

  /** The client's portal activity, newest first; the IP for Owner and Admin only. */
  async activity(
    tenant: TenantContext,
    userId: string,
    clientId: string,
    query: z.output<typeof ClientPortalActivityQuery>,
  ): Promise<ClientPortalActivityPage> {
    const businessId = tenant.businessId;
    const after = decodeCursor(query.cursor);
    const showIp = this.manager(tenant);
    const page = await this.inFirm(businessId, async (tx) => {
      await this.client(tx, tenant, userId, clientId);
      const days = await this.days(tx, businessId, query.from, query.to);
      const rows = await tx.clientPortalActivity.findMany({
        where: {
          clientId,
          ...(query.type
            ? query.type.includes('.')
              ? { type: query.type }
              : { type: { startsWith: `${query.type}.` } }
            : {}),
          ...(query.actor ? { actorKind: query.actor } : {}),
          ...(days.start || days.end
            ? {
                occurredAt: {
                  ...(days.start ? { gte: days.start } : {}),
                  ...(days.end ? { lt: days.end } : {}),
                },
              }
            : {}),
          ...(after
            ? {
                OR: [
                  { occurredAt: { lt: after.at } },
                  { occurredAt: after.at, id: { lt: after.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        select: {
          id: true,
          occurredAt: true,
          type: true,
          actorKind: true,
          entityType: true,
          entityId: true,
          ip: true,
          actor: { select: { user: { select: { name: true } } } },
          clientAccount: { select: { user: { select: { name: true } } } },
        },
      });
      await this.audit.logIn(
        tx,
        'client_portal.activity_viewed',
        { type: 'client', id: clientId },
        { count: Math.min(rows.length, query.limit) },
        { businessId },
      );
      return rows;
    });
    const items: ClientPortalActivityItem[] = page.slice(0, query.limit).map((r) => ({
      id: r.id,
      at: r.occurredAt.toISOString(),
      type: r.type,
      actor: {
        kind: r.actorKind,
        name:
          r.actorKind === 'STAFF'
            ? (r.actor?.user.name ?? null)
            : r.actorKind === 'CLIENT'
              ? (r.clientAccount?.user.name ?? null)
              : null,
      },
      entity: r.entityType && r.entityId ? { type: r.entityType, id: r.entityId } : null,
      ip: showIp ? r.ip : null,
    }));
    const last = page[query.limit - 1];
    return {
      items,
      nextCursor: page.length > query.limit && last ? encodeCursor(last.occurredAt, last.id) : null,
    };
  }

  /**
   * Login History and Security Events: the sign-ins and sign-outs of the client's logins, and
   * the failed attempts and locks on their emails (found by the sign-in's keyed email, never the
   * email itself). From the audit log, newest first; the IP for Owner and Admin only.
   */
  async logins(
    tenant: TenantContext,
    userId: string,
    clientId: string,
    query: z.output<typeof ClientPortalLoginsQuery>,
  ): Promise<ClientPortalLogins> {
    const businessId = tenant.businessId;
    const after = decodeCursor(query.cursor);
    const showIp = this.manager(tenant);
    const { rows, emailOf, keyOf } = await this.inFirm(businessId, async (tx) => {
      await this.client(tx, tenant, userId, clientId);
      const accounts = await tx.clientAccount.findMany({
        where: { clientId },
        select: { userId: true, email: true },
      });
      const emailOf = new Map(accounts.map((a) => [a.userId, a.email]));
      const keyOf = new Map<string, string>();
      for (const a of accounts) {
        const key = portalEmailKey(this.env, businessId, a.email);
        if (key) keyOf.set(key, a.email);
      }
      const keyed = [...keyOf.keys()].map((key) => ({
        metadata: { path: ['emailKey'], equals: key },
      }));
      const rows = accounts.length
        ? await tx.auditLog.findMany({
            where: {
              businessId,
              OR: [
                {
                  action: { in: [LOGIN_ACTIONS.signedIn, LOGIN_ACTIONS.signedOut] },
                  actorUserId: { in: accounts.map((a) => a.userId) },
                },
                ...(keyed.length
                  ? [
                      {
                        action: { in: [LOGIN_ACTIONS.failed, LOGIN_ACTIONS.locked] },
                        OR: keyed,
                      },
                    ]
                  : []),
              ],
              ...(after
                ? {
                    AND: [
                      {
                        OR: [
                          { createdAt: { lt: after.at } },
                          { createdAt: after.at, id: { lt: after.id } },
                        ],
                      },
                    ],
                  }
                : {}),
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: query.limit + 1,
            select: {
              id: true,
              action: true,
              actorUserId: true,
              metadata: true,
              ip: true,
              createdAt: true,
            },
          })
        : [];
      await this.audit.logIn(
        tx,
        'client_portal.logins_viewed',
        { type: 'client', id: clientId },
        { count: Math.min(rows.length, query.limit) },
        { businessId },
      );
      return { rows, emailOf, keyOf };
    });
    const items = rows.slice(0, query.limit).map((r): ClientPortalLoginItem => {
      const meta = (r.metadata ?? {}) as {
        emailKey?: unknown;
        step?: unknown;
        lockedUntil?: unknown;
      };
      const keyedEmail = typeof meta.emailKey === 'string' ? keyOf.get(meta.emailKey) : undefined;
      return {
        id: r.id,
        at: r.createdAt.toISOString(),
        event:
          r.action === LOGIN_ACTIONS.signedIn
            ? 'SIGNED_IN'
            : r.action === LOGIN_ACTIONS.signedOut
              ? 'SIGNED_OUT'
              : r.action === LOGIN_ACTIONS.locked
                ? 'LOCKED_OUT'
                : meta.step === 'mfa'
                  ? 'MFA_FAILED'
                  : 'SIGN_IN_FAILED',
        email: (r.actorUserId ? emailOf.get(r.actorUserId) : undefined) ?? keyedEmail ?? null,
        ip: showIp ? r.ip : null,
        until:
          typeof meta.lockedUntil === 'string' && !Number.isNaN(Date.parse(meta.lockedUntil))
            ? new Date(meta.lockedUntil).toISOString()
            : null,
      };
    });
    const last = rows[query.limit - 1];
    return {
      items,
      nextCursor: rows.length > query.limit && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  private actor(tenant: TenantContext, userId: string): InvitationActor {
    return { userId, role: legacyFirmRole(tenant.role) };
  }

  private manager(tenant: TenantContext): boolean {
    const role = legacyFirmRole(tenant.role);
    return role === 'OWNER' || role === 'ADMIN';
  }

  /** A custom role or one of the five newer roles, whose grid decides. */
  private customRole(tenant: TenantContext): boolean {
    return (
      tenant.kind === 'staff' &&
      (!!tenant.customRoleId || !['OWNER', 'ADMIN', 'STAFF'].includes(tenant.role))
    );
  }

  /** Staff and the five newer roles see only the clients assigned to them. */
  private staffScoped(tenant: TenantContext): boolean {
    return legacyFirmRole(tenant.role) === 'STAFF';
  }

  private visible(tenant: TenantContext, userId: string, clientId: string) {
    return {
      id: clientId,
      ...(this.staffScoped(tenant) ? { assignedUserId: userId } : {}),
    } satisfies Prisma.ClientWhereInput;
  }

  /** The client as the member may see it, or 404. */
  private async client(
    tx: TxClient,
    tenant: TenantContext,
    userId: string,
    clientId: string,
  ): Promise<void> {
    const found = await tx.client.findFirst({
      where: this.visible(tenant, userId, clientId),
      select: { id: true },
    });
    if (!found) throw notFound();
  }

  /** Which of the summary's modules the member may view (Owner and Admin: all). */
  private async modules(tenant: TenantContext): Promise<Record<SummaryModule, boolean>> {
    const entries = await Promise.all(
      SUMMARY_MODULES.map(
        async (m) =>
          [m, this.manager(tenant) || (await this.grants.canTenant(tenant, m, 'VIEW'))] as const,
      ),
    );
    return Object.fromEntries(entries) as Record<SummaryModule, boolean>;
  }

  /** The client's OPEN invoices and what each still owes, oldest due first. */
  private owed(tx: TxClient, businessId: string, clientId: string) {
    return tx.$queryRaw<{ id: string; number: string; dueOn: Date | null; cents: number }[]>`
      SELECT i.id::text AS id, i.number, i.due_on AS "dueOn",
        GREATEST(0, i.total_cents - app_invoice_paid_cents(i.id))::float8 AS cents
      FROM invoices i
      WHERE i.business_id = ${businessId}::uuid AND i.client_id = ${clientId}::uuid
        AND i.status = 'OPEN'
      ORDER BY i.due_on ASC NULLS LAST, i.created_at ASC
      LIMIT 200`.then((rows) => rows.map((r) => ({ ...r, cents: Math.round(r.cents) })));
  }

  /** From and to as the firm's own days (both included). */
  private async days(
    tx: TxClient,
    businessId: string,
    from: string | undefined,
    to: string | undefined,
  ): Promise<{ start: Date | undefined; end: Date | undefined }> {
    if (!from && !to) return { start: undefined, end: undefined };
    const [row] = await tx.$queryRaw<{ start: Date | null; end: Date | null }[]>`
      WITH s AS (
        SELECT COALESCE(
          (SELECT timezone FROM business_settings WHERE business_id = ${businessId}::uuid),
          'America/New_York') AS tz)
      SELECT (${from ?? null}::date::timestamp AT TIME ZONE s.tz) AS start,
        ((${to ?? null}::date + 1)::timestamp AT TIME ZONE s.tz) AS "end"
      FROM s`;
    return { start: row?.start ?? undefined, end: row?.end ?? undefined };
  }

  /** Keeps the member's Recent Clients: this client now, and only the newest RECENT_KEPT. */
  private async remember(
    tx: TxClient,
    businessId: string,
    userId: string,
    clientId: string,
  ): Promise<void> {
    await tx.portalRecentClient.upsert({
      where: { businessId_userId_clientId: { businessId, userId, clientId } },
      create: { businessId, userId, clientId },
      update: { lastViewedAt: new Date() },
    });
    const stale = await tx.portalRecentClient.findMany({
      where: { userId },
      orderBy: [{ lastViewedAt: 'desc' }, { id: 'desc' }],
      skip: RECENT_KEPT,
      select: { id: true },
    });
    if (stale.length) {
      await tx.portalRecentClient.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
    }
  }

  /** The login's authenticator app; null when the identity service can't say. */
  private async mfa(sub: string): Promise<'ENABLED' | 'NOT_ENROLLED' | null> {
    try {
      return (await this.identity.mfaEnabled('CLIENT', sub)) ? 'ENABLED' : 'NOT_ENROLLED';
    } catch {
      this.logger.warn('Could not read a client login’s MFA status');
      return null;
    }
  }
}

const SUMMARY_MODULES = [
  'DOCUMENTS',
  'MESSAGES',
  'APPOINTMENTS',
  'TAX_RETURNS',
  'INVOICES_PAYMENTS',
  'INTAKE_FORMS',
  'TASKS',
] as const satisfies readonly PermissionModule[];
type SummaryModule = (typeof SUMMARY_MODULES)[number];

/** GET /business/client-portal/... (contract: packages/types/src/client-portal/management.ts). */
@Controller('business/client-portal')
@Access('CLIENT_PORTAL')
@Roles(...FIRM_STAFF)
export class PortalManagementController {
  constructor(private readonly portal: PortalManagementService) {}

  @Get('recent')
  recent(@CurrentAuth() auth: AuthContext, @CurrentTenant() tenant: TenantContext) {
    return this.portal.recent(tenant, auth.userId);
  }

  @Get('clients/:id')
  header(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(ClientId)) id: string,
  ) {
    return this.portal.header(tenant, auth.userId, id);
  }

  @Get('clients/:id/summary')
  summary(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(ClientId)) id: string,
    @Query(new ZodValidationPipe(PortalSummaryQuery)) query: z.output<typeof PortalSummaryQuery>,
  ) {
    return this.portal.summary(tenant, auth.userId, id, Number(query.days));
  }

  @Get('clients/:id/pending-actions')
  pendingActions(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(ClientId)) id: string,
  ) {
    return this.portal.pendingActions(tenant, auth.userId, id);
  }

  @Get('clients/:id/activity')
  activity(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(ClientId)) id: string,
    @Query(new ZodValidationPipe(ClientPortalActivityQuery))
    query: z.output<typeof ClientPortalActivityQuery>,
  ) {
    return this.portal.activity(tenant, auth.userId, id, query);
  }

  @Get('clients/:id/logins')
  logins(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(ClientId)) id: string,
    @Query(new ZodValidationPipe(ClientPortalLoginsQuery))
    query: z.output<typeof ClientPortalLoginsQuery>,
  ) {
    return this.portal.logins(tenant, auth.userId, id, query);
  }
}

@Module({
  imports: [SignInModule, PortalInvitationsModule],
  controllers: [PortalManagementController],
  providers: [PortalManagementService],
})
export class PortalManagementModule {}
