import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import type { ClientActivity, ClientActivityItem, PermissionModule } from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import type { ClientsActor } from '../clients/clients.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { PermissionGrantsService } from '../roles/permission-grants.service.js';

// MSG-F18 (Octavia's Oct 27 Messages review, MSG-033): Recent Activity in the contact panel. The
// thread's client's latest records across the modules the member may view, each with its own
// page. Reads only; nothing here changes a record. Firm Sign keeps its own roles (esign roles),
// so its requests are not listed here.

const LIMIT = 10;
const EXCERPT = 80;
const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const excerpt = (text: string) => {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > EXCERPT ? `${one.slice(0, EXCERPT - 1)}…` : one;
};

type Item = ClientActivityItem;

@Injectable()
export class MessagesActivityService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly grants: PermissionGrantsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Whether the member may view `module`, in the order the role guard decides it: an Owner always;
   * then the member's own change (Staff Management), their custom role's grid, and their role's
   * grid with the firm's changes over the default.
   */
  private async mayView(
    tenant: TenantContext,
    userId: string,
    module: PermissionModule,
  ): Promise<boolean> {
    if (tenant.kind !== 'staff') return false;
    if (tenant.role === 'OWNER') return true;
    const own = await this.grants.memberCell(tenant.businessId, userId, module, 'VIEW');
    if (own !== undefined) return own;
    if (tenant.customRoleId) {
      const custom = await this.grants.customCell(
        tenant.businessId,
        tenant.customRoleId,
        module,
        'VIEW',
      );
      if (custom !== undefined) return custom;
    }
    return this.grants.can(tenant.businessId, tenant.role, module, 'VIEW');
  }

  async forThread(
    tenant: TenantContext,
    actor: ClientsActor,
    threadId: string,
  ): Promise<ClientActivity> {
    const { businessId } = tenant;
    const modules = [
      'APPOINTMENTS',
      'INTAKE_FORMS',
      'INVOICES_PAYMENTS',
      'DOCUMENTS',
      'TASKS',
    ] as const satisfies readonly PermissionModule[];
    const allowed = new Set<PermissionModule>(['MESSAGES']);
    for (const m of modules) if (await this.mayView(tenant, actor.userId, m)) allowed.add(m);

    const { clientId, items } = await this.database.withScope(
      { kind: 'business', businessId },
      async (tx) => {
        const thread = await tx.messageThread.findFirst({
          where: {
            businessId,
            id: threadId,
            clientId: { not: null },
            client: actor.role === 'STAFF' ? { assignedUserId: actor.userId } : {},
          },
          select: { clientId: true },
        });
        if (!thread?.clientId) throw notFound();
        const found = await Promise.all([
          this.messages(tx, businessId, thread.clientId),
          allowed.has('APPOINTMENTS') ? this.appointments(tx, businessId, thread.clientId) : [],
          allowed.has('INTAKE_FORMS') ? this.intakes(tx, businessId, thread.clientId) : [],
          allowed.has('INVOICES_PAYMENTS') ? this.invoices(tx, businessId, thread.clientId) : [],
          allowed.has('DOCUMENTS') ? this.documents(tx, businessId, thread.clientId) : [],
          allowed.has('TASKS') ? this.tasks(tx, businessId, thread.clientId) : [],
        ]);
        const all = found
          .flat()
          .sort((a, b) => b.at.localeCompare(a.at))
          .slice(0, LIMIT);
        return { clientId: thread.clientId, items: all };
      },
    );
    await this.audit.log(
      'client_activity.viewed',
      { type: 'message_thread', id: threadId },
      { clientId, count: items.length },
    );
    return { items };
  }

  private async messages(tx: TxClient, businessId: string, clientId: string): Promise<Item[]> {
    const rows = await tx.message.findMany({
      where: { businessId, thread: { clientId } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LIMIT,
      select: { threadId: true, direction: true, body: true, createdAt: true },
    });
    return rows.map((m) => ({
      kind: m.direction === 'CLIENT_TO_FIRM' ? 'MESSAGE_RECEIVED' : 'MESSAGE_SENT',
      title: m.direction === 'CLIENT_TO_FIRM' ? 'Message Received' : 'Message Sent',
      detail: excerpt(m.body) || null,
      at: m.createdAt.toISOString(),
      eventAt: null,
      href: `/messages?thread=${m.threadId}`,
    }));
  }

  private async appointments(tx: TxClient, businessId: string, clientId: string): Promise<Item[]> {
    const rows = await tx.appointment.findMany({
      where: { businessId, clientId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: LIMIT,
      select: {
        id: true,
        status: true,
        startsAt: true,
        endsAt: true,
        createdAt: true,
        cancelledAt: true,
        type: { select: { name: true } },
      },
    });
    return rows.map((a): Item => {
      const base = {
        detail: a.type?.name ?? null,
        eventAt: a.startsAt.toISOString(),
        href: `/calendar/${a.id}`,
      };
      if (a.status === 'CANCELLED')
        return {
          ...base,
          kind: 'APPOINTMENT_CANCELLED',
          title: 'Appointment Cancelled',
          at: (a.cancelledAt ?? a.createdAt).toISOString(),
        };
      if (a.status === 'COMPLETED')
        return {
          ...base,
          kind: 'APPOINTMENT_HELD',
          title: 'Appointment Held',
          at: a.endsAt.toISOString(),
        };
      return {
        ...base,
        kind: 'APPOINTMENT_BOOKED',
        title: 'Appointment Booked',
        at: a.createdAt.toISOString(),
      };
    });
  }

  private async intakes(tx: TxClient, businessId: string, clientId: string): Promise<Item[]> {
    const rows = await tx.intake.findMany({
      where: { businessId, engagement: { clientId }, status: { not: 'DRAFT' } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: LIMIT,
      select: {
        id: true,
        status: true,
        sentAt: true,
        createdAt: true,
        form: { select: { title: true } },
        submissions: {
          where: { submittedAt: { not: null } },
          orderBy: { submittedAt: 'desc' },
          take: 1,
          select: { submittedAt: true },
        },
      },
    });
    return rows.map((i): Item => {
      const submitted = i.submissions[0]?.submittedAt;
      return submitted
        ? {
            kind: 'FORM_SUBMITTED',
            title: 'Form Submitted',
            detail: i.form.title,
            at: submitted.toISOString(),
            eventAt: null,
            href: `/intake-forms/${i.id}`,
          }
        : {
            kind: 'FORM_SENT',
            title: 'Form Sent',
            detail: i.form.title,
            at: (i.sentAt ?? i.createdAt).toISOString(),
            eventAt: null,
            href: `/intake-forms/${i.id}`,
          };
    });
  }

  private async invoices(tx: TxClient, businessId: string, clientId: string): Promise<Item[]> {
    const rows = await tx.invoice.findMany({
      where: { businessId, clientId, status: { notIn: ['DRAFT', 'CANCELED'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LIMIT,
      select: {
        id: true,
        number: true,
        status: true,
        totalCents: true,
        paidAt: true,
        createdAt: true,
      },
    });
    return rows.map((v): Item => {
      const detail = `${v.number} · ${money.format(v.totalCents / 100)}`;
      return v.status === 'PAID' && v.paidAt
        ? {
            kind: 'INVOICE_PAID',
            title: 'Invoice Paid',
            detail,
            at: v.paidAt.toISOString(),
            eventAt: null,
            href: `/invoices/${v.id}`,
          }
        : {
            kind: 'INVOICE_CREATED',
            title: 'Invoice Created',
            detail,
            at: v.createdAt.toISOString(),
            eventAt: null,
            href: `/invoices/${v.id}`,
          };
    });
  }

  private async documents(tx: TxClient, businessId: string, clientId: string): Promise<Item[]> {
    const [files, requests] = await Promise.all([
      tx.document.findMany({
        where: { businessId, clientId, trashedAt: null, archivedAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: LIMIT,
        select: { id: true, fileName: true, direction: true, createdAt: true },
      }),
      tx.documentRequest.findMany({
        where: { businessId, clientId, status: { not: 'CANCELLED' } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: LIMIT,
        select: { id: true, title: true, createdAt: true },
      }),
    ]);
    return [
      ...files.map((d): Item => ({
        kind:
          d.direction === 'CLIENT_TO_FIRM'
            ? 'DOCUMENT_UPLOADED'
            : d.direction === 'FIRM_TO_CLIENT'
              ? 'DOCUMENT_SHARED'
              : 'DOCUMENT_ADDED',
        title:
          d.direction === 'CLIENT_TO_FIRM'
            ? 'Document Uploaded'
            : d.direction === 'FIRM_TO_CLIENT'
              ? 'Document Shared'
              : 'Document Added',
        detail: d.fileName,
        at: d.createdAt.toISOString(),
        eventAt: null,
        href: `/documents/${d.id}`,
      })),
      ...requests.map((r): Item => ({
        kind: 'DOCUMENTS_REQUESTED',
        title: 'Documents Requested',
        detail: r.title,
        at: r.createdAt.toISOString(),
        eventAt: null,
        href: `/documents/requests/${r.id}`,
      })),
    ];
  }

  private async tasks(tx: TxClient, businessId: string, clientId: string): Promise<Item[]> {
    const rows = await tx.task.findMany({
      where: { businessId, clientId, status: 'DONE', completedAt: { not: null }, archivedAt: null },
      orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
      take: LIMIT,
      select: { id: true, title: true, completedAt: true },
    });
    return rows.map((t) => ({
      kind: 'TASK_COMPLETED',
      title: 'Task Completed',
      detail: t.title,
      at: (t.completedAt as Date).toISOString(),
      eventAt: null,
      href: `/tasks/${t.id}`,
    }));
  }
}
