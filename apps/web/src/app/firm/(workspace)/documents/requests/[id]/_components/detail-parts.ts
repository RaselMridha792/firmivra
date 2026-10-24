import type {
  DocumentActivity,
  DocumentRequestPacketStatus,
  DocumentRequestStatus,
  RequestPacketDetail,
} from '@firmivra/types';

/** Each checklist item's words and badge colours. */
export const ITEM_LOOKS: Record<DocumentRequestStatus, { label: string; tone: string }> = {
  REQUESTED: { label: 'Waiting', tone: 'bg-warning-soft text-warning' },
  SUBMITTED: { label: 'Received', tone: 'bg-info-soft text-info' },
  ACCEPTED: { label: 'Accepted', tone: 'bg-success-soft text-success' },
  REJECTED: { label: 'Replacement Requested', tone: 'bg-danger-soft text-danger' },
  NOT_AVAILABLE: { label: 'Not Available', tone: 'bg-purple-soft text-purple' },
  CANCELLED: { label: 'Removed', tone: 'bg-disabled text-muted' },
};

export interface PacketActions {
  send: boolean;
  remind: boolean;
  resend: boolean;
  complete: boolean;
  cancel: boolean;
  /** Add, remove and change items, and the title, message and options: a draft only. */
  editDraft: boolean;
  /** The due date, assignee, reminder and expiry: also after sending (the API's AFTER_SEND). */
  changeDates: boolean;
  /** Accept or ask again for a received file. */
  review: boolean;
}

/** What the API lets staff do in each status (409 INVALID_STATUS or REQUEST_SENT otherwise). */
export function packetActions(status: DocumentRequestPacketStatus): PacketActions {
  const draft = status === 'DRAFT';
  const open = status === 'OPEN' || status === 'SUBMITTED';
  return {
    send: draft,
    remind: open,
    resend: open,
    complete: open,
    cancel: draft || open,
    editDraft: draft,
    changeDates: draft || open,
    review: open,
  };
}

/** The checklist's live items (a removed one stays in the history only). */
export const liveItems = (p: RequestPacketDetail) =>
  p.checklist.filter((i) => i.status !== 'CANCELLED');

export type ActivityLook =
  'created' | 'sent' | 'reminded' | 'received' | 'review' | 'done' | 'cancelled' | 'other';

export function activityLook(kind: DocumentActivity['kind']): ActivityLook {
  switch (kind) {
    case 'REQUEST_CREATED':
      return 'created';
    case 'REQUEST_SENT':
      return 'sent';
    case 'REQUEST_REMINDED':
      return 'reminded';
    case 'REQUEST_RECEIVED':
    case 'UPLOADED':
    case 'REPLACED':
      return 'received';
    case 'REVIEW':
      return 'review';
    case 'REQUEST_COMPLETED':
      return 'done';
    case 'REQUEST_CANCELLED':
      return 'cancelled';
    default:
      return 'other';
  }
}

/** "Nov 6, 2026, 2:05 PM". */
export const formatTime = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/** Days from today to a due date: "Due in 3 days", "Due today", "2 days overdue". */
export function dueText(dueOn: string | null, today: string): string {
  if (!dueOn) return 'No due date';
  const days = Math.round(
    (Date.parse(`${dueOn}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000,
  );
  if (days === 0) return 'Due today';
  if (days > 0) return `Due in ${days} ${days === 1 ? 'day' : 'days'}`;
  return `${-days} ${days === -1 ? 'day' : 'days'} overdue`;
}
