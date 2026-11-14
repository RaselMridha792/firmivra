import type { TxClient } from '@firmivra/db';

const NOTE_TYPE: Record<string, string> = {
  GENERAL: 'General',
  CALL: 'Call',
  MEETING: 'Meeting',
  FOLLOW_UP: 'Follow-up',
  DOCUMENT: 'Document',
  BILLING: 'Billing',
};

/**
 * Review 2 (Bookkeeping A01): a note written on a client's Bookkeeping engagement, or a file
 * uploaded to it, shows in that client's Bookkeeping Activity with who and when. Any other service
 * is left alone. The entry names the event only, never the note's text or the file's content.
 */
export async function addServiceEvent(
  tx: TxClient,
  businessId: string,
  engagementId: string | null,
  event:
    | { kind: 'note'; noteId: string; noteType: string | null; actorUserId: string }
    | { kind: 'document'; documentId: string; fileName: string; actorUserId: string | null },
): Promise<void> {
  if (!engagementId) return;
  const profile = await tx.bookkeepingProfile.findFirst({
    where: { businessId, engagementId },
    select: { id: true },
  });
  if (!profile) return;
  await tx.bookkeepingActivity.create({
    data:
      event.kind === 'note'
        ? {
            businessId,
            engagementId,
            kind: 'NOTE',
            summary: event.noteType ? `${NOTE_TYPE[event.noteType]} note added` : 'Note added',
            details: { noteId: event.noteId },
            actorUserId: event.actorUserId,
          }
        : {
            businessId,
            engagementId,
            kind: 'OTHER',
            // A client's upload has no staff author: it says the client sent it.
            summary: event.actorUserId
              ? `Document uploaded: ${event.fileName}`
              : `The client uploaded ${event.fileName}`,
            details: { documentId: event.documentId },
            actorUserId: event.actorUserId,
          },
  });
}
