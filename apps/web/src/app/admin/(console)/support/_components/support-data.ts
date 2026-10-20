import type {
  PriorityColor,
  SlaState,
  TicketQuery,
  TicketSla,
  TicketStatus,
} from '../../../../../mocks/admin-support';
import { errorMessage } from '../../../../../lib/errors';

/** Every Support query starts with this key, so one invalidate refreshes all of them. */
export const SUPPORT = ['admin-support'] as const;
export const supportKeys = {
  me: [...SUPPORT, 'me'],
  summary: [...SUPPORT, 'summary'],
  directory: [...SUPPORT, 'directory'],
  settings: [...SUPPORT, 'settings'],
  tickets: (query: TicketQuery) => [...SUPPORT, 'tickets', query],
  ticket: (id: string) => [...SUPPORT, 'ticket', id],
};

export type BadgeTone = 'info' | 'success' | 'warning' | 'danger' | 'neutral' | 'purple';

export const STATUS_TONES: Record<TicketStatus, BadgeTone> = {
  OPEN: 'info',
  IN_PROGRESS: 'info',
  WAITING_ON_CUSTOMER: 'purple',
  ESCALATED: 'danger',
  RESOLVED: 'success',
  CLOSED: 'neutral',
};
/** The dot before a status in the selects. */
export const STATUS_DOTS: Record<TicketStatus, string> = {
  OPEN: 'bg-action',
  IN_PROGRESS: 'bg-sky',
  WAITING_ON_CUSTOMER: 'bg-purple',
  ESCALATED: 'bg-danger',
  RESOLVED: 'bg-success',
  CLOSED: 'bg-chart-grey',
};

/** A priority's badge, from the colour set in Support Settings. */
export const PRIORITY_TONES: Record<PriorityColor, BadgeTone> = {
  red: 'danger',
  orange: 'danger',
  yellow: 'warning',
  green: 'success',
  blue: 'info',
  purple: 'purple',
  grey: 'neutral',
};
export const PRIORITY_DOTS: Record<PriorityColor, string> = {
  red: 'bg-danger',
  orange: 'bg-orange',
  yellow: 'bg-chart-yellow',
  green: 'bg-chart-green',
  blue: 'bg-action',
  purple: 'bg-purple',
  grey: 'bg-chart-grey',
};

export const SLA_TEXT: Record<SlaState, string> = {
  WITHIN: 'text-success',
  WARNING: 'text-warning',
  BREACHED: 'text-danger',
  PAUSED: 'text-muted',
  MET: 'text-success',
};
export const SLA_DOTS: Record<SlaState, string> = {
  WITHIN: 'bg-chart-green',
  WARNING: 'bg-gold',
  BREACHED: 'bg-danger',
  PAUSED: 'bg-chart-grey',
  MET: 'bg-chart-green',
};

/** "#1001", "#0998". */
export const ticketNo = (n: number) => `#${String(n).padStart(4, '0')}`;

export const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(iso),
  );
export const formatTime = (iso: string) =>
  new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
export const formatDateTime = (iso: string) => `${formatDate(iso)} ${formatTime(iso)}`;

/** "3h 45m", "2d 4h", "25m". */
export function formatMinutes(total: number) {
  const minutes = Math.abs(Math.round(total));
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const rest = minutes % 60;
  if (days) return hours ? `${days}d ${hours}h` : `${days}d`;
  if (hours) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  return `${rest}m`;
}

/** The line under the SLA state. */
export function slaNote(sla: TicketSla) {
  switch (sla.state) {
    case 'PAUSED':
      return 'Paused while waiting on the customer';
    case 'MET':
      return 'Response targets met';
    case 'BREACHED':
      return sla.minutesLeft === null
        ? 'A response target was missed'
        : `Response overdue by ${formatMinutes(sla.minutesLeft)}`;
    default:
      return sla.minutesLeft === null
        ? 'No response due'
        : `Response due in ${formatMinutes(sla.minutesLeft)}`;
  }
}

/** The quiet line a frame shows when its data could not load. */
export function loadError(error: unknown) {
  return error instanceof TypeError
    ? 'Could not load this right now. Try again in a moment.'
    : errorMessage(error);
}

/** Error texts for Support's own codes. */
export const SUPPORT_ERRORS: Record<string, string> = {
  CONFLICT: 'This ticket was changed by someone else. Reload it and try again.',
  DUPLICATE_NAME: 'That name is already used. Choose another.',
  FORBIDDEN: "You don't have the support permission for this.",
};

/** File size for people: "182 KB", "1.4 MB". */
export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
