import type { RequestPacketRow, RequestPacketTab, RequestPacketView } from '@firmivra/types';

/** Each status's words and badge colours on the dashboard. */
export const VIEW_LOOKS: Record<RequestPacketView, { label: string; tone: string }> = {
  DRAFT: { label: 'Draft', tone: 'bg-disabled text-muted' },
  OUTSTANDING: { label: 'Outstanding', tone: 'bg-warning-soft text-warning' },
  PARTIALLY_RECEIVED: { label: 'Partially Received', tone: 'bg-purple-soft text-purple' },
  READY_FOR_REVIEW: { label: 'Ready for Review', tone: 'bg-info-soft text-info' },
  OVERDUE: { label: 'Overdue', tone: 'bg-danger-soft text-danger' },
  EXPIRED: { label: 'Expired', tone: 'bg-danger-soft text-danger' },
  COMPLETED: { label: 'Completed', tone: 'bg-success-soft text-success' },
  CANCELLED: { label: 'Cancelled', tone: 'bg-disabled text-muted' },
};

/** The design's six tabs, in its order. */
export const TABS: { id: RequestPacketTab; label: string }[] = [
  { id: 'all', label: 'All Requests' },
  { id: 'outstanding', label: 'Outstanding' },
  { id: 'partially_received', label: 'Partially Received' },
  { id: 'ready_for_review', label: 'Ready for Review' },
  { id: 'completed', label: 'Completed' },
  { id: 'overdue', label: 'Overdue' },
];

/** All Statuses: the tabs plus the API's other lists. */
export const STATUS_FILTER: { id: RequestPacketTab; label: string }[] = [
  ...TABS.map((t) => ({ id: t.id, label: t.id === 'all' ? 'All Statuses' : t.label })),
  { id: 'due_soon', label: 'Due Soon' },
  { id: 'draft', label: 'Drafts' },
  { id: 'cancelled', label: 'Cancelled' },
];

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((w) => /^[A-Za-z]/.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

/** "2 hours ago", "1 day ago", "just now". */
export function timeAgo(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export interface RequestEvent {
  key: string;
  kind: 'sent' | 'uploaded' | 'completed' | 'overdue';
  text: string;
  at: string;
}

/**
 * Recent Activity, from the latest requests' own dates (there is no firm-wide request feed): a
 * request sent, documents in (partly or all), completed, gone past its due date. Newest first.
 */
export function requestActivity(rows: readonly RequestPacketRow[], limit = 4): RequestEvent[] {
  const events: RequestEvent[] = [];
  for (const r of rows) {
    if (r.view === 'COMPLETED')
      events.push({
        key: `${r.id}-done`,
        kind: 'completed',
        text: `Request completed by ${r.client.name}`,
        at: r.updatedAt,
      });
    else if (r.view === 'OVERDUE' && r.dueOn)
      events.push({
        key: `${r.id}-late`,
        kind: 'overdue',
        text: `Request overdue (${r.client.name})`,
        at: `${r.dueOn}T23:59:59.000Z`,
      });
    else if (r.view === 'PARTIALLY_RECEIVED' || r.view === 'READY_FOR_REVIEW')
      events.push({
        key: `${r.id}-in`,
        kind: 'uploaded',
        text: `${r.client.name} uploaded ${r.view === 'READY_FOR_REVIEW' ? 'every document' : 'a document'}`,
        at: r.updatedAt,
      });
    if (r.sentAt)
      events.push({
        key: `${r.id}-sent`,
        kind: 'sent',
        text: `Document request sent to ${r.recipient.name}`,
        at: r.sentAt,
      });
  }
  return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
