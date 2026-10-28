import type { MessageThread } from '@firmivra/types';
import { ORIGIN_PARAM, safeOrigin } from '../../../../../lib/origin';

// The Messages page's view (MSG-F03, F05, F08): the tab, the search, the open thread and the
// filters live in the address, so a link out of Messages (Open Client, Templates, Bulk) comes
// Back to the same thread, list, filters and search (SH1).

export const TABS = [
  { id: 'all', label: 'All Messages' },
  { id: 'unread', label: 'Unread' },
  { id: 'clients', label: 'Clients' },
  { id: 'leads', label: 'Leads' },
  { id: 'appointment', label: 'Appointments' },
  { id: 'invoice', label: 'Invoices' },
  // Kept as an extra view (D6).
  { id: 'document_request', label: 'Documents' },
  { id: 'automations', label: 'Automations' },
  { id: 'archived', label: 'Archived' },
] as const;
export type TabId = (typeof TABS)[number]['id'];

export const SINCE = [
  { id: '', label: 'Any time' },
  { id: 'today', label: 'Today' },
  { id: '7d', label: 'Last 7 days' },
  { id: '30d', label: 'Last 30 days' },
] as const;
export const REPLIES = [
  { id: '', label: 'Open or closed' },
  { id: 'open', label: 'Replies open' },
  { id: 'closed', label: 'Replies closed' },
] as const;
export const STARTED = [
  { id: '', label: 'Anyone' },
  { id: 'firm', label: 'Your firm' },
  { id: 'client', label: 'The client' },
] as const;
type Since = (typeof SINCE)[number]['id'];
type Replies = (typeof REPLIES)[number]['id'];
type Started = (typeof STARTED)[number]['id'];

export interface MessagesView {
  tab: TabId;
  /** The search box's text. */
  q: string;
  /** The open conversation ('' : the list's first). */
  thread: string;
  /** SH5: one client's conversations. */
  clientId: string;
  /** SH5: the subject New Message starts with. */
  service: string;
  since: Since;
  replies: Replies;
  started: Started;
  /** The place a service workspace opened Messages from: kept so its Back stays. */
  from: string;
}

type Params = Record<string, string | undefined>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const oneOf = <T extends string>(list: readonly { id: T }[], v: string | undefined): T =>
  list.find((x) => x.id === v)?.id ?? list[0]!.id;
const short = (v: string | undefined, max: number) =>
  typeof v === 'string' && v.length <= max ? v : '';

/** The view an address asks for; anything unknown is the default. */
export function readView(params: Params): MessagesView {
  return {
    tab: oneOf(TABS, params['tab']),
    q: short(params['q'], 100),
    thread: UUID.test(params['thread'] ?? '') ? params['thread']! : '',
    clientId: UUID.test(params['clientId'] ?? '') ? params['clientId']! : '',
    service: short(params['service'], 200),
    since: oneOf(SINCE, params['since']),
    replies: oneOf(REPLIES, params['replies']),
    started: oneOf(STARTED, params['started']),
    from: safeOrigin(params[ORIGIN_PARAM]) ?? '',
  };
}

/** `/messages?…` for a view, defaults left out. */
export function addressOf(view: MessagesView): string {
  const params = new URLSearchParams();
  if (view.tab !== 'all') params.set('tab', view.tab);
  if (view.q.trim()) params.set('q', view.q);
  if (view.thread) params.set('thread', view.thread);
  if (view.clientId) params.set('clientId', view.clientId);
  if (view.service) params.set('service', view.service);
  if (view.since) params.set('since', view.since);
  if (view.replies) params.set('replies', view.replies);
  if (view.started) params.set('started', view.started);
  if (view.from) params.set(ORIGIN_PARAM, view.from);
  const query = params.toString();
  return query ? `/messages?${query}` : '/messages';
}

/** The filters the Filter panel set, for the chips under the bar and the button's count. */
export function activeFilters(
  view: MessagesView,
): { key: 'since' | 'replies' | 'started'; label: string }[] {
  return [
    ...(view.since
      ? [{ key: 'since' as const, label: SINCE.find((s) => s.id === view.since)!.label }]
      : []),
    ...(view.replies
      ? [{ key: 'replies' as const, label: REPLIES.find((s) => s.id === view.replies)!.label }]
      : []),
    ...(view.started
      ? [
          {
            key: 'started' as const,
            label: `Started by ${STARTED.find((s) => s.id === view.started)!.label.toLowerCase()}`,
          },
        ]
      : []),
  ];
}

const DAY = 86_400_000;

/**
 * Whether a thread belongs in the tab and passes the filters (the search is the API's). Every
 * conversation today is with a client: Leads stays empty until there are conversations with
 * leads, never filled with anything else.
 */
export function inView(t: MessageThread, view: MessagesView, now = new Date()): boolean {
  const tab = view.tab;
  const inTab =
    tab === 'all' || tab === 'clients' || tab === 'archived'
      ? true
      : tab === 'unread'
        ? t.unreadCount > 0
        : tab === 'leads'
          ? false
          : tab === 'automations'
            ? t.automated
            : t.related?.type === tab;
  if (!inTab) return false;
  if (view.clientId && t.client.id !== view.clientId) return false;
  if (view.replies && t.repliesEnabled !== (view.replies === 'open')) return false;
  if (view.started === 'firm' && t.startedBy?.kind !== 'STAFF') return false;
  if (view.started === 'client' && t.startedBy?.kind !== 'CLIENT') return false;
  if (view.since) {
    const at = new Date(t.lastMessage?.createdAt ?? t.createdAt);
    if (view.since === 'today') return at.toDateString() === now.toDateString();
    const days = view.since === '7d' ? 7 : 30;
    return now.getTime() - at.getTime() <= days * DAY;
  }
  return true;
}
