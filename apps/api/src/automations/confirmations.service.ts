import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, TxClient } from '@firmivra/db';
import {
  type AutomationConfirmationList,
  type AutomationEventConfirmation,
  type ConfirmAutomationEventRequest,
  isGridFirmRole,
  type PermissionModule,
  roleCan,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../common/request-context.js';
import { autoErrors } from './automations.common.js';
import { AutomationsReadService } from './automations-read.service.js';
import { eventOf } from './catalog.js';

// Manual Event Confirmation (Octavia's Oct 28 review, AU-F31 to F33; R1's
// automation_event_confirmations). A member reports one known external outcome for one record and
// occurrence: one row each (no bulk), only while Automation Settings has it on, by an Owner or
// Admin or a member with that module's manage right. It records the fact and nothing else: no
// return is filed, no payment made, no record's status changed. Rules on the event pick it up as
// an occurrence keyed as the engine keys runs, so provider evidence added later (AU-F32) never
// starts a second run.

type Body = z.output<typeof ConfirmAutomationEventRequest>;

/** The permission module a confirmable event's module answers to. */
const PERMISSION_MODULE: Record<string, PermissionModule> = {
  TAX_RETURNS: 'TAX_RETURNS',
  PAYROLL: 'PAYROLL',
  COMPLIANCE_DEADLINES: 'COMPLIANCE',
};

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });

const confirmationSelect = {
  id: true,
  eventCode: true,
  recordKind: true,
  recordId: true,
  occurrenceKey: true,
  confirmedAt: true,
  reference: true,
  note: true,
  evidenceDocumentId: true,
  providerVerifiedAt: true,
  providerCode: true,
  providerReference: true,
  client: { select: { id: true, displayName: true } },
  confirmedBy: { select: { userId: true, user: { select: { name: true } } } },
} satisfies Prisma.AutomationEventConfirmationSelect;
type Row = Prisma.AutomationEventConfirmationGetPayload<{ select: typeof confirmationSelect }>;

const viewOf = (r: Row): AutomationEventConfirmation => ({
  id: r.id,
  event: r.eventCode,
  eventLabel: eventOf(r.eventCode)?.label ?? r.eventCode,
  recordKind: r.recordKind,
  recordId: r.recordId,
  occurrence: r.occurrenceKey.slice(`${r.eventCode}:${r.recordId}:`.length),
  client: r.client,
  confirmedBy: { userId: r.confirmedBy.userId, name: r.confirmedBy.user.name },
  confirmedAt: r.confirmedAt.toISOString(),
  reference: r.reference,
  note: r.note,
  evidenceDocumentId: r.evidenceDocumentId,
  providerEvidence:
    r.providerVerifiedAt && r.providerCode && r.providerReference
      ? {
          verifiedAt: r.providerVerifiedAt.toISOString(),
          provider: r.providerCode,
          reference: r.providerReference,
        }
      : null,
});

/** The record a confirmable event is about, in this firm: its client, or 404. */
async function clientOfRecord(
  tx: TxClient,
  businessId: string,
  recordKind: string,
  recordId: string,
): Promise<string> {
  if (recordKind === 'tax_return') {
    const r = await tx.taxReturn.findFirst({
      where: { businessId, id: recordId },
      select: { clientId: true },
    });
    if (r) return r.clientId;
  } else if (recordKind === 'payroll_run') {
    const r = await tx.payrollRun.findFirst({
      where: { businessId, id: recordId },
      select: { payrollClient: { select: { clientId: true } } },
    });
    if (r) return r.payrollClient.clientId;
  } else if (recordKind === 'deadline') {
    const r = await tx.complianceDeadline.findFirst({
      where: { businessId, id: recordId, archivedAt: null },
      select: { clientId: true },
    });
    if (r) return r.clientId;
  }
  throw notFound();
}

@Injectable()
export class ConfirmationsService {
  constructor(
    private readonly read: AutomationsReadService,
    private readonly audit: AuditService,
  ) {}

  confirm(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    body: Body,
  ): Promise<AutomationEventConfirmation> {
    return this.read.inFirm(businessId, async (tx) => {
      const ctx = await this.read.ctx(tx, businessId, tenant, userId);
      const event = eventOf(body.event);
      if (!event?.confirmation)
        throw autoErrors.invalid('event', 'This is not an outcome a member confirms');
      // Who may: an Owner or Admin, or a member with the source module's manage right.
      const role = ctx.actor.role === 'STAFF' ? tenantRole(tenant) : ctx.actor.role;
      const module = PERMISSION_MODULE[event.module];
      const allowed =
        ctx.perms.admin ||
        (module !== undefined &&
          isGridFirmRole(role as never) &&
          roleCan(role as never, module, 'MANAGE'));
      if (!allowed) throw autoErrors.forbidden();
      // The record first (another firm's is 404), then the switch.
      const clientId = await clientOfRecord(tx, businessId, event.recordKind, body.recordId);
      if (!ctx.settings.manualConfirmationEnabled) throw autoErrors.manualConfirmationOff();
      if (body.evidenceDocumentId) {
        const doc = await tx.document.findFirst({
          where: {
            businessId,
            id: body.evidenceDocumentId,
            clientId,
            trashedAt: null,
            archivedAt: null,
          },
          select: { id: true },
        });
        if (!doc) throw notFound();
      }
      const occurrenceKey = `${event.code}:${body.recordId}:${body.occurrence}`;
      const known = await tx.automationEventConfirmation.findFirst({
        where: { businessId, occurrenceKey },
        select: { id: true },
      });
      if (known) throw autoErrors.alreadyConfirmed();
      const row = await tx.automationEventConfirmation.create({
        data: {
          businessId,
          sourceModule: event.module,
          eventCode: event.code,
          recordKind: event.recordKind,
          recordId: body.recordId,
          occurrenceKey,
          clientId,
          confirmedByUserId: userId,
          reference: body.reference ?? null,
          note: body.note ?? null,
          evidenceDocumentId: body.evidenceDocumentId ?? null,
        },
        select: confirmationSelect,
      });
      // The reference and note may name the outcome; the audit keeps ids and facts only.
      await this.audit.logIn(
        tx,
        'automation_event.confirmed',
        { type: 'automation_event_confirmation', id: row.id },
        {
          event: event.code,
          recordKind: event.recordKind,
          recordId: body.recordId,
          clientId,
          occurrence: body.occurrence,
          hasReference: body.reference !== undefined,
          hasEvidence: body.evidenceDocumentId !== undefined,
        },
      );
      return viewOf(row);
    });
  }

  list(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    query: { recordId?: string | undefined },
  ): Promise<AutomationConfirmationList> {
    return this.read.inFirm(businessId, async (tx) => {
      await this.read.ctx(tx, businessId, tenant, userId);
      const rows = await tx.automationEventConfirmation.findMany({
        where: { businessId, ...(query.recordId ? { recordId: query.recordId } : {}) },
        select: confirmationSelect,
        orderBy: [{ confirmedAt: 'desc' }, { id: 'desc' }],
        take: 100,
      });
      return { items: rows.map(viewOf) };
    });
  }
}

/**
 * AU-F32: a vetted integration's evidence for an occurrence a member confirmed, added once beside
 * the manual confirmation (never replacing it). The occurrence key does not change, so the runs
 * keyed by it never repeat; a rule waiting for Integration verified starts now. False when the
 * occurrence was not confirmed or already has evidence.
 */
export async function attachProviderEvidence(
  tx: TxClient,
  businessId: string,
  occurrenceKey: string,
  evidence: { provider: string; reference: string; verifiedAt: Date },
): Promise<boolean> {
  const { count } = await tx.automationEventConfirmation.updateMany({
    where: { businessId, occurrenceKey, providerVerifiedAt: null },
    data: {
      providerVerifiedAt: evidence.verifiedAt,
      providerCode: evidence.provider,
      providerReference: evidence.reference,
    },
  });
  return count === 1;
}

/** The member's own role in the firm (the grid roles have a module manage right). */
const tenantRole = (tenant: TenantContext) => (tenant.kind === 'staff' ? tenant.role : 'STAFF');
