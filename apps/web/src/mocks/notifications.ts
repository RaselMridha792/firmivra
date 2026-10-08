import {
  ApiRequestError,
  type DeliveryChannel,
  FirmSlug,
  ListNotificationsQuery,
  LOCKED_NOTIFICATION_CATEGORIES,
  type MyNotificationsClient,
  NOTIFICATION_EVENTS,
  NotificationCategory,
  type NotificationEvent,
  NotificationId,
  NotificationItem,
  type NotificationPreferences,
  type NotificationsClient,
  parseInput,
  UpdateNotificationPreferencesRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { firstClientId } from './clients';
import { documentFixtures } from './documents';
import { engagementFixtures } from './engagements';

/**
 * Mock data for `api.notifications` (the signed-in member's bell, firm site) and
 * `api.myNotifications(slug)` (the signed-in client's bell, Notification Center and preferences,
 * portal), R6. Synthetic data only. Same input checks, paging and error codes as the API, and texts
 * that follow its rules: no amounts, file names or message text. Records come from the documents
 * and engagements mocks, so most links open a page with mock data. Each mock keeps its own read
 * state and preferences; callers get copies. Nothing is built until the first call.
 */
const at = (day: number, hour: number) =>
  `2026-10-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`;
const firmId = (n: number) => `0199b6e0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const myId = (n: number) => `0199b6e1-0000-7000-8000-${String(n).padStart(12, '0')}`;
/** Records that have no mock yet (message threads, appointments, intake forms, invoices...). */
const recordId = (n: number) => `0199b6e2-0000-7000-8000-${String(n).padStart(12, '0')}`;

/** One fixture: the event gives the category and the record's kind (NOTIFICATION_EVENTS). */
interface Fixture {
  event: NotificationEvent;
  title: string;
  body: string;
  /** The record's id. */
  record: string;
  createdAt: string;
  readAt?: string;
}

/**
 * Numbered in order and parsed, so a fixture that breaks the contract (or sends an event to the
 * wrong side) fails on first use. On the firm site a record names its client (client 1), except
 * a sign-up, a team member or the member's own account; in the portal never.
 */
const numbered = (side: 'staff' | 'client', fixtures: Fixture[]): NotificationItem[] =>
  fixtures.map((f, i) => {
    const { category, kind, to } = NOTIFICATION_EVENTS[f.event];
    if (to !== side && to !== 'both') throw new Error(`${f.event} is not for ${side}`);
    const ofClient =
      side === 'staff' && kind !== 'client_account' && kind !== 'membership' && kind !== 'user';
    return NotificationItem.parse({
      id: (side === 'staff' ? firmId : myId)(i + 1),
      category,
      title: f.title,
      body: f.body,
      target: { kind, id: f.record, clientId: ofClient ? firstClientId : null },
      readAt: f.readAt ?? null,
      createdAt: f.createdAt,
    });
  });

let firmFixtures: readonly NotificationItem[] | undefined;

/**
 * The signed-in member's notifications at the firm, newest first: three unread. All are about
 * client 1 (assigned to Sam Staff), so they fit every role.
 */
export function notificationFixtures(): readonly NotificationItem[] {
  if (firmFixtures) return firmFixtures;
  const { requests } = documentFixtures();
  const payroll = engagementFixtures()[3]!;
  firmFixtures = numbered('staff', [
    {
      event: 'document-request.submitted',
      title: 'Document request answered',
      body: 'Jamie Sample uploaded W-2 from your employer.',
      record: requests[0]!.id,
      createdAt: at(8, 13),
    },
    {
      event: 'message.received',
      title: 'New message from Jamie Sample',
      body: 'Open the conversation to read it.',
      record: recordId(1),
      createdAt: at(8, 11),
    },
    {
      event: 'document-request.not-available',
      title: 'Document not available',
      body: "Jamie Sample doesn't have Childcare receipts.",
      record: requests[3]!.id,
      createdAt: at(7, 16),
    },
    {
      event: 'appointment.booked',
      title: 'Appointment booked',
      body: 'Jamie Sample booked Tax review for Oct 14 at 10:00 AM.',
      record: recordId(2),
      createdAt: at(6, 14),
      readAt: at(6, 15),
    },
    {
      event: 'intake.submitted',
      title: 'Intake form submitted',
      body: 'Jamie Sample sent the 2025 Personal Tax intake form.',
      record: recordId(3),
      createdAt: at(5, 10),
      readAt: at(5, 12),
    },
    {
      event: 'payment.received',
      title: 'Payment received',
      body: 'Jamie Sample paid invoice INV-1001.',
      record: recordId(4),
      createdAt: at(3, 17),
      readAt: at(4, 9),
    },
    {
      event: 'engagement.status-changed',
      title: 'Service cancelled',
      body: `${payroll.title} for Jamie Sample was cancelled.`,
      record: payroll.id,
      createdAt: at(2, 10),
      readAt: at(2, 11),
    },
    {
      // The firm site has no page for the member's own account yet: no link.
      event: 'account.password-changed',
      title: 'Your password was changed',
      body: "If this wasn't you, reset your password now.",
      record: recordId(5),
      createdAt: at(1, 9),
      readAt: at(1, 9),
    },
  ]);
  return firmFixtures;
}

let portalFixtures: readonly NotificationItem[] | undefined;

/**
 * The signed-in portal client's notifications (Jamie Sample, client 1), newest first: four
 * unread. The same at every firm; the site adds the firm's address to the links.
 */
export function myNotificationFixtures(): readonly NotificationItem[] {
  if (portalFixtures) return portalFixtures;
  const { documents, requests } = documentFixtures();
  const taxReturn = engagementFixtures()[0]!;
  const lastYear = engagementFixtures()[2]!;
  portalFixtures = numbered('client', [
    {
      event: 'document.requested',
      title: 'New document request',
      body: '1099-INT from your bank, due Oct 31.',
      record: requests[1]!.id,
      createdAt: at(8, 14),
    },
    {
      event: 'document-request.rejected',
      title: 'Please upload this again',
      body: 'Your firm needs Bank statements for September again.',
      record: requests[2]!.id,
      createdAt: at(8, 10),
    },
    {
      event: 'message.received',
      title: 'New message',
      body: 'Your firm sent you a message. Open Messages to read it.',
      record: recordId(1),
      createdAt: at(7, 18),
    },
    {
      event: 'appointment.reminder',
      title: 'Appointment reminder',
      body: 'Tax review on Oct 9 at 2:00 PM.',
      record: recordId(2),
      createdAt: at(7, 14),
    },
    {
      event: 'document.shared',
      title: 'Your firm shared a document',
      body: 'It is in Firm Uploaded Documents.',
      record: documents[4]!.id,
      createdAt: at(6, 15),
      readAt: at(6, 16),
    },
    {
      event: 'invoice.sent',
      title: 'New invoice',
      body: 'Invoice INV-1007 is ready to pay.',
      record: recordId(4),
      createdAt: at(5, 16),
      readAt: at(5, 18),
    },
    {
      event: 'intake.sent',
      title: 'Intake form to fill in',
      body: `Please complete the ${taxReturn.title} intake form.`,
      record: recordId(3),
      createdAt: at(4, 11),
      readAt: at(4, 12),
    },
    {
      event: 'client-note.reminder',
      title: 'Note reminder',
      body: 'You asked to be reminded about one of your notes today.',
      record: recordId(6),
      createdAt: at(3, 13),
      readAt: at(3, 15),
    },
    {
      event: 'engagement.status-changed',
      title: 'Service update',
      body: `${taxReturn.title} is now in ${taxReturn.stage}.`,
      record: taxReturn.id,
      createdAt: at(2, 9),
      readAt: at(2, 10),
    },
    {
      event: 'account.password-changed',
      title: 'Your password was changed',
      body: "If this wasn't you, reset your password and contact your firm.",
      record: recordId(7),
      createdAt: at(1, 9),
      readAt: at(1, 9),
    },
    {
      event: 'engagement.status-changed',
      title: 'Service completed',
      body: `${lastYear.title} is complete.`,
      record: lastYear.id,
      createdAt: lastYear.completedAt!,
      readAt: lastYear.completedAt!,
    },
    {
      event: 'tax-return.status-changed',
      title: 'Tax return filed',
      body: `Your return for ${lastYear.title} is Filed / Completed.`,
      record: recordId(8),
      createdAt: lastYear.completedAt!,
      readAt: lastYear.completedAt!,
    },
  ]);
  return portalFixtures;
}

/** Every category in order: email on and SMS off unless `choices` says otherwise; ACCOUNT locked. */
const preferences = (
  channels: DeliveryChannel[],
  choices: Partial<Record<NotificationCategory, { email?: boolean; sms?: boolean }>> = {},
): NotificationPreferences => ({
  channels,
  items: NotificationCategory.options.map((category) => {
    const locked = (LOCKED_NOTIFICATION_CATEGORIES as readonly string[]).includes(category);
    return { category, email: true, sms: false, ...(locked ? {} : choices[category]), locked };
  }),
});

const copy = <T>(value: T): T => structuredClone(value);
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const now = () => new Date().toISOString();
type Position = Pick<NotificationItem, 'createdAt' | 'id'>;
const newestFirst = (a: Position, b: Position) =>
  a.createdAt === b.createdAt
    ? Number(a.id < b.id) - Number(a.id > b.id)
    : Number(a.createdAt < b.createdAt) - Number(a.createdAt > b.createdAt);
/** The mock's cursor: the last item's createdAt and id. Anything else is refused, as by the API. */
const toCursor = (n: Position) => `${n.createdAt}_${n.id}`;
const fromCursor = (cursor: string): Position => {
  const [createdAt = '', id = '', ...rest] = cursor.split('_');
  if (rest.length || Number.isNaN(Date.parse(createdAt)) || !NotificationId.safeParse(id).success) {
    throw fail(400, 'VALIDATION_FAILED', 'Invalid cursor');
  }
  return { createdAt, id };
};

interface State {
  items: NotificationItem[];
  preferences: NotificationPreferences;
}

/**
 * An in-memory client on `build()`'s fixtures, built on the first call. `check()` runs first on
 * every call (the portal's firm address check, a 400 like the real client's).
 */
function createMock(
  build: () => State,
  check: () => unknown = () => undefined,
): NotificationsClient {
  let state: State | undefined;
  const open = async () => {
    await mockDelay();
    check();
    return (state ??= copy(build()));
  };
  const unread = (s: State) => s.items.filter((n) => n.readAt === null);

  return {
    list: async (query = {}) => {
      const s = await open();
      const q = parseInput(ListNotificationsQuery, query);
      const after = q.cursor === undefined ? undefined : fromCursor(q.cursor);
      const found = [...s.items]
        .sort(newestFirst)
        .filter((n) => !q.unreadOnly || n.readAt === null)
        .filter((n) => !after || newestFirst(n, after) > 0);
      const page = found.slice(0, q.limit);
      return {
        items: copy(page),
        nextCursor: found.length > page.length ? toCursor(page.at(-1)!) : null,
        unreadCount: unread(s).length,
      };
    },
    unreadCount: async () => unread(await open()).length,
    markRead: async (id) => {
      const s = await open();
      const key = parseInput(NotificationId, id);
      const n = s.items.find((x) => x.id === key);
      if (!n) throw fail(404, 'NOT_FOUND', 'Not found');
      n.readAt ??= now();
      return copy(n);
    },
    markAllRead: async () => {
      const marked = unread(await open());
      const readAt = now();
      for (const n of marked) n.readAt = readAt;
      return { marked: marked.length };
    },
    preferences: async () => copy((await open()).preferences),
    updatePreferences: async (body) => {
      const s = await open();
      const { items } = parseInput(UpdateNotificationPreferencesRequest, body);
      // As the API: no SMS opt-in while texts cannot reach the person (turning it off is fine).
      if (!s.preferences.channels.includes('SMS') && items.some((i) => i.sms === true)) {
        throw fail(400, 'VALIDATION_FAILED', 'Text messages are not available for you');
      }
      for (const change of items) {
        const row = s.preferences.items.find((p) => p.category === change.category)!;
        if (change.email !== undefined) row.email = change.email;
        if (change.sms !== undefined) row.sms = change.sms;
      }
      return copy(s.preferences);
    },
  };
}

/**
 * An in-memory `api.notifications`: the signed-in member's bell. No phone number on file, so the
 * preferences offer email only.
 */
export function createNotificationsMock(): NotificationsClient {
  return createMock(() => ({
    items: [...notificationFixtures()],
    preferences: preferences(['EMAIL']),
  }));
}

/**
 * An in-memory `api.myNotifications(slug)` for the signed-in portal client (Jamie Sample, who has
 * a verified phone, so SMS is offered). A bad firm address rejects every call with 400.
 */
export function createMyNotificationsMock(firmSlug: string): MyNotificationsClient {
  return createMock(
    () => ({
      items: [...myNotificationFixtures()],
      preferences: preferences(['EMAIL', 'SMS'], {
        DOCUMENTS: { sms: true },
        APPOINTMENTS: { sms: true },
      }),
    }),
    () => parseInput(FirmSlug, firmSlug),
  );
}

let myMocks: Map<string, MyNotificationsClient> | undefined;

/**
 * `api.myNotifications(slug)` in mock mode: one mock per firm (by lower-cased slug), so an item
 * marked read in the bell is read in the Notification Center too, however often the page calls
 * `api.myNotifications(slug)`.
 */
export function myNotificationsMock(firmSlug: string): MyNotificationsClient {
  myMocks ??= new Map();
  const key = firmSlug.trim().toLowerCase();
  let mock = myMocks.get(key);
  if (!mock) {
    mock = createMyNotificationsMock(firmSlug);
    myMocks.set(key, mock);
  }
  return mock;
}
