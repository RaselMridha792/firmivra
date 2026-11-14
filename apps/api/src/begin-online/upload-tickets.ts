import type { TxClient } from '@firmivra/db';
import { z } from 'zod';
import { LONGEST_UPLOAD_SECONDS, UPLOAD_TOKEN_SECONDS } from '../storage/upload-token.js';

/** The audit actions of a draft's upload tickets: a ticket, then a confirm or a refusal. */
export const UPLOAD_ACTIONS = {
  started: 'begin_online.upload_started',
  confirmed: 'begin_online.upload_confirmed',
  refused: 'begin_online.upload_refused',
} as const;
/** The same three for a lead's files through the secure intake link (audited on the intake). */
export const LINK_UPLOAD_ACTIONS = {
  started: 'intake_link.upload_started',
  confirmed: 'intake_link.upload_confirmed',
  refused: 'intake_link.upload_refused',
} as const;
export type UploadActions = typeof UPLOAD_ACTIONS | typeof LINK_UPLOAD_ACTIONS;

/** The last part of a lead upload's key (tenant/{businessId}/leads/{leadId}/{uploadId}). */
export const uploadIdOf = (key: string) => key.slice(key.lastIndexOf('/') + 1);

export const leadUploadKey = (businessId: string, leadId: string, uploadId: string) =>
  `tenant/${businessId}/leads/${leadId}/${uploadId}`;

/** `seconds`: the ticket's lifetime (a multipart upload's is longer); older tickets have none. */
const Started = z.object({
  slot: z.string(),
  uploadId: z.uuid(),
  seconds: z.number().int().positive().optional(),
});

async function ticketsOf(
  tx: TxClient,
  entityId: string,
  since: Date,
  actions: UploadActions = UPLOAD_ACTIONS,
) {
  const rows = await tx.auditLog.findMany({
    where: { action: actions.started, entityId, createdAt: { gte: since } },
    select: { metadata: true, createdAt: true },
  });
  return rows.flatMap((r) => {
    const parsed = Started.safeParse(r.metadata);
    return parsed.success ? [{ ...parsed.data, createdAt: r.createdAt }] : [];
  });
}

/**
 * The lead's open tickets: those still alive (each lives its own `seconds`: a PUT's 15 minutes, a
 * multipart upload's 70) that were neither confirmed nor refused. They count toward the slot's
 * and the draft's file caps, so a visitor who never confirms can't take more tickets (and leave
 * more objects) than the caps allow. Run it holding the lead (holdDraft), as confirm counts its
 * files, and the counts are exact. A link's tickets are the intake's (`entityId`, LINK actions).
 */
export async function openTickets(
  tx: TxClient,
  entityId: string,
  actions: UploadActions = UPLOAD_ACTIONS,
): Promise<{ slot: string; uploadId: string }[]> {
  const now = Date.now();
  const since = new Date(now - LONGEST_UPLOAD_SECONDS * 1000);
  const started = (await ticketsOf(tx, entityId, since, actions)).filter(
    (t) => t.createdAt.getTime() + (t.seconds ?? UPLOAD_TOKEN_SECONDS) * 1000 > now,
  );
  if (started.length === 0) return [];
  const ended = await tx.auditLog.findMany({
    where: {
      action: { in: [actions.confirmed, actions.refused] },
      entityId,
      createdAt: { gte: since },
    },
    select: { metadata: true },
  });
  const done = new Set(ended.map((r) => (r.metadata as { uploadId?: unknown } | null)?.uploadId));
  return started
    .filter((t) => !done.has(t.uploadId))
    .map(({ slot, uploadId }) => ({ slot, uploadId }));
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
  /** A link's tickets: the intake's, under LINK_UPLOAD_ACTIONS (keys stay under the lead). */
  link?: { intakeId: string },
): Promise<string[]> {
  const tickets = link
    ? await ticketsOf(tx, link.intakeId, since, LINK_UPLOAD_ACTIONS)
    : await ticketsOf(tx, leadId, since);
  return [...new Set(tickets.map((t) => leadUploadKey(businessId, leadId, t.uploadId)))];
}
