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

/**
 * A person's email and SMS choices in one firm (R6 step 5), read in that firm's own scope (row-level
 * security shows nothing of another firm). NotifyService asks it before sending a message that is
 * not ALWAYS_SENT; the notification preferences routes show the same choices.
 */
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
   * goes out. A client login that is not this firm's has no choices here: the defaults apply.
   */
  async allows(
    businessId: string,
    recipient: Recipient,
    category: NotificationCategory,
    channel: NotifyChannel,
  ): Promise<boolean> {
    if (isLockedCategory(category)) return true;
    const scope = this.db.forBusiness(businessId);
    const userId =
      'userId' in recipient
        ? recipient.userId
        : (
            await scope.clientAccount.findFirst({
              where: { businessId, id: recipient.clientAccountId },
              select: { userId: true },
            })
          )?.userId;
    const row = userId
      ? await scope.notificationPreference.findUnique({
          where: { businessId_userId_category: { businessId, userId, category } },
          select: { email: true, sms: true },
        })
      : null;
    const choice = row ?? DEFAULT_CHOICE;
    return channel === 'sms' ? choice.sms : choice.email;
  }
}
