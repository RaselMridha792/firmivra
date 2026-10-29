import type { TxClient } from '@firmivra/db';
import { INVOICE_ERRORS } from '@firmivra/types';
import { conflict, notFound } from './invoice-view.js';

// IP-F03: a draft's tax rate, Assigned Staff, template and attachments, each checked against the
// firm's own records in its scope. A draft keeps a tax rate or template the firm archived since;
// a new choice must be live. Attachments are the client's documents the client can see (shared,
// clean, not trashed or archived), as the database's own rule on invoice_attachments requires.
// IP-F04: the tip and payment-before-due options only while Settings > Payments turned them on.

export interface DraftExtras {
  taxRateId?: string | null;
  assignedUserId?: string | null;
  templateId?: string | null;
  documentIds?: string[];
  allowTip?: boolean;
  requirePaymentBeforeDue?: boolean;
}

interface Current {
  clientId: string;
  taxRateId: string | null;
  templateId: string | null;
  allowTip: boolean;
  requirePaymentBeforeDue: boolean;
}

/**
 * 404 for a rate, member, template or file that isn't the firm's (or this client's) to use; 409
 * OPTION_NOT_ENABLED for a tip or payment-before-due option the firm hasn't turned on (a draft
 * keeps one it already has).
 */
export async function checkDraftExtras(
  tx: TxClient,
  businessId: string,
  current: Current,
  body: DraftExtras,
): Promise<void> {
  const tip = body.allowTip === true && !current.allowTip;
  const beforeDue = body.requirePaymentBeforeDue === true && !current.requirePaymentBeforeDue;
  if (tip || beforeDue) {
    const settings = await tx.paymentSettings.findUnique({
      where: { businessId },
      select: { tippingEnabled: true, requirePaymentBeforeDue: true },
    });
    if ((tip && !settings?.tippingEnabled) || (beforeDue && !settings?.requirePaymentBeforeDue)) {
      throw conflict('OPTION_NOT_ENABLED', INVOICE_ERRORS.OPTION_NOT_ENABLED);
    }
  }
  if (body.taxRateId && body.taxRateId !== current.taxRateId) {
    const rate = await tx.invoiceTaxRate.findFirst({
      where: { businessId, id: body.taxRateId, archivedAt: null },
      select: { id: true },
    });
    if (!rate) throw notFound();
  }
  if (body.assignedUserId) {
    const member = await tx.membership.findFirst({
      where: { businessId, userId: body.assignedUserId, status: 'ACTIVE' },
      select: { userId: true },
    });
    if (!member) throw notFound();
  }
  if (body.templateId && body.templateId !== current.templateId) {
    const template = await tx.invoiceTemplate.findFirst({
      where: { businessId, id: body.templateId, archivedAt: null },
      select: { id: true },
    });
    if (!template) throw notFound();
  }
  const ids = body.documentIds ?? [];
  if (ids.length > 0) {
    const docs = await tx.document.findMany({
      where: {
        businessId,
        clientId: current.clientId,
        id: { in: ids },
        trashedAt: null,
        archivedAt: null,
      },
      select: { id: true, direction: true, scanStatus: true },
    });
    if (docs.length !== ids.length) throw notFound();
    if (docs.some((d) => d.direction === 'INTERNAL' || d.scanStatus !== 'CLEAN')) {
      throw conflict('ATTACHMENT_NOT_SHAREABLE', INVOICE_ERRORS.ATTACHMENT_NOT_SHAREABLE);
    }
  }
}

/** The draft's attachments become `documentIds` (left out: kept as they are). */
export async function writeAttachments(
  tx: TxClient,
  businessId: string,
  invoiceId: string,
  documentIds: string[] | undefined,
  actorUserId: string,
): Promise<void> {
  if (documentIds === undefined) return;
  await tx.invoiceAttachment.deleteMany({
    where: { businessId, invoiceId, documentId: { notIn: documentIds } },
  });
  await tx.invoiceAttachment.createMany({
    data: documentIds.map((documentId) => ({
      businessId,
      invoiceId,
      documentId,
      addedByUserId: actorUserId,
    })),
    skipDuplicates: true,
  });
}
