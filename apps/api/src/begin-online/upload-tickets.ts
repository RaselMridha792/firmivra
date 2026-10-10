import type { TxClient } from '@firmivra/db';
import { z } from 'zod';
import { UPLOAD_TOKEN_SECONDS } from '../storage/upload-token.js';

/** The audit actions of a draft's upload tickets: a ticket, then a confirm or a refusal. */
export const UPLOAD_ACTIONS = {
  started: 'begin_online.upload_started',
  confirmed: 'begin_online.upload_confirmed',
  refused: 'begin_online.upload_refused',
} as const;

/** The last part of a lead upload's key (tenant/{businessId}/leads/{leadId}/{uploadId}). */
export const uploadIdOf = (key: string) => key.slice(key.lastIndexOf('/') + 1);

export const leadUploadKey = (businessId: string, leadId: string, uploadId: string) =>
  `tenant/${businessId}/leads/${leadId}/${uploadId}`;

const Started = z.object({ slot: z.string(), uploadId: z.uuid() });

async function ticketsOf(tx: TxClient, leadId: string, since: Date) {
  const rows = await tx.auditLog.findMany({
    where: { action: UPLOAD_ACTIONS.started, entityId: leadId, createdAt: { gte: since } },
    select: { metadata: true },
  });
  return rows.flatMap((r) => {
    const parsed = Started.safeParse(r.metadata);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * The lead's open tickets: those of the last UPLOAD_TOKEN_SECONDS (a ticket's lifetime) that were
 * neither confirmed nor refused. They count toward the slot's and the draft's file caps, so a
 * visitor who never confirms can't take more tickets (and leave more objects) than the caps allow.
 * Run it holding the lead (holdDraft), as confirm counts its files, and the counts are exact.
 */
export async function openTickets(
  tx: TxClient,
  leadId: string,
): Promise<{ slot: string; uploadId: string }[]> {
  const since = new Date(Date.now() - UPLOAD_TOKEN_SECONDS * 1000);
  const started = await ticketsOf(tx, leadId, since);
  if (started.length === 0) return [];
  const ended = await tx.auditLog.findMany({
    where: {
      action: { in: [UPLOAD_ACTIONS.confirmed, UPLOAD_ACTIONS.refused] },
      entityId: leadId,
      createdAt: { gte: since },
    },
    select: { metadata: true },
  });
  const done = new Set(ended.map((r) => (r.metadata as { uploadId?: unknown } | null)?.uploadId));
  return started.filter((t) => !done.has(t.uploadId));
}

/**
 * The key of every ticket the lead was given since `since` (its start): a draft that ends
 * (expires or is sent) deletes those no lead_uploads row holds, so a ticket that was never
 * confirmed leaves no object behind.
 */
export async function ticketKeys(
  tx: TxClient,
  businessId: string,
  leadId: string,
  since: Date,
): Promise<string[]> {
  const tickets = await ticketsOf(tx, leadId, since);
  return [...new Set(tickets.map((t) => leadUploadKey(businessId, leadId, t.uploadId)))];
}
