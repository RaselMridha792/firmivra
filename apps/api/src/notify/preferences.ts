import type { Database } from '@firmivra/db';
import { LOCKED_NOTIFICATION_CATEGORIES, type NotificationCategory } from '@firmivra/types';
import type { NotifyChannel } from './notify.types.js';

/** A category with nothing saved: email on, SMS off (the table's defaults). */
export const DEFAULT_CHOICE = { email: true, sms: false } as const;

export type Choice = { email: boolean; sms: boolean };

/** Who a message is for, as NotifyMessage.recipient names them. */
export type Recipient = { userId: string } | { clientAccountId: string };

export const isLockedCategory = (category: NotificationCategory) =>
  (LOCKED_NOTIFICATION_CATEGORIES as readonly NotificationCategory[]).includes(category);

/** SMS standings that stop every text: a STOP reply, an unsubscribe, a complaint, a dead number. */
const TEXTS_STOPPED: readonly string[] = ['OPTED_OUT', 'COMPLAINED', 'BOUNCED', 'INVALID'];

/**
 * Whether the client's texts are stopped at this firm (`communication_consents`, SMS). Client
 * Portal guide 7.5 and 9.2: a text needs the person's opt-in (their SMS switch) and respects an
 * opt-out; after one, only the firm records a new opt-in (Communications). No client record, or
 * no row: not stopped.
 */
export async function textsStopped(
  scope: ReturnType<Database['forBusiness']>,
  businessId: string,
  clientId: string | null | undefined,
): Promise<boolean> {
  if (!clientId) return false;
  const row = await scope.communicationConsent.findFirst({
    where: { businessId, clientId, channel: 'SMS' },
    select: { status: true },
  });
  return row !== null && TEXTS_STOPPED.includes(row.status);
}

/**
 * A person's email and SMS choices in one firm (R6 step 5), read in that firm's own scope (row-level
 * security shows nothing of another firm). NotifyService asks it before sending a message that is
 * not ALWAYS_SENT; the notification preferences routes show the same choices.
 */
/** An active member of the firm (Owner, Admin or Staff), as opposed to a client login. */
async function isStaff(
  scope: ReturnType<Database['forBusiness']>,
  businessId: string,
  userId: string,
): Promise<boolean> {
  const member = await scope.membership.findFirst({
    where: { businessId, userId, status: 'ACTIVE' },
    select: { userId: true },
  });
  return member !== null;
}

export class PreferenceSource {
  constructor(private readonly db: Pick<Database, 'forBusiness'>) {}

  /** Every saved choice of the person, by category (missing ones are DEFAULT_CHOICE). */
  async choices(businessId: string, userId: string): Promise<Map<NotificationCategory, Choice>> {
    const rows = await this.db.forBusiness(businessId).notificationPreference.findMany({
      where: { businessId, userId },
      select: { category: true, email: true, sms: true },
    });
    return new Map(rows.map((r) => [r.category, { email: r.email, sms: r.sms }]));
  }

  /**
   * Whether the person wants this category on this channel. A locked category (ACCOUNT) always
   * goes out. Every notice here is about the person's own account or services, so its email
   * always goes, whatever a stored row says (Octavia's Notifications review of Oct 18 for staff;
   * Client Portal guide 9.2 for clients; older rows switched off count as on). The firm's staff
   * get no text until a verified mobile number exists for staff logins (Rasel, Oct 24; none is
   * recorded yet). A client gets a text only with their SMS switch on and their texts not
   * stopped (`textsStopped`). A client login that is not this firm's has no choices here: the
   * defaults apply.
   */
  async allows(
    businessId: string,
    recipient: Recipient,
    category: NotificationCategory,
    channel: NotifyChannel,
  ): Promise<boolean> {
    if (isLockedCategory(category) || channel === 'email') return true;
    const scope = this.db.forBusiness(businessId);
    if ('userId' in recipient && (await isStaff(scope, businessId, recipient.userId))) return false;
    const account = await scope.clientAccount.findFirst({
      where:
        'userId' in recipient
          ? { businessId, userId: recipient.userId }
          : { businessId, id: recipient.clientAccountId },
      select: { userId: true, clientId: true },
    });
    if (!account) return DEFAULT_CHOICE.sms;
    const row = await scope.notificationPreference.findUnique({
      where: { businessId_userId_category: { businessId, userId: account.userId, category } },
      select: { sms: true },
    });
    if (!(row ?? DEFAULT_CHOICE).sms) return false;
    return !(await textsStopped(scope, businessId, account.clientId));
  }
}
