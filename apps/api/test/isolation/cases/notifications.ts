// The bell: a staff member's and a client's own notifications.
import type { CaseModule, SeedContext } from '../world.js';

const notification = async (ctx: SeedContext, recipientUserId: string) => {
  const row = await ctx.tx.notification.create({
    data: {
      businessId: ctx.businessId,
      recipientUserId,
      category: 'SERVICES',
      type: 'engagement.updated',
      entityType: 'engagement',
      entityId: await ctx.get('engagement'),
    },
  });
  return row.id;
};

export const records: CaseModule['records'] = {
  /** Firm P's Owner's notification. */
  notification: { create: (ctx) => notification(ctx, ctx.owner.id) },
  /** Client X's notification. */
  clientNotification: {
    clientPrivate: true,
    async create(ctx) {
      await ctx.get('client');
      return notification(ctx, await ctx.get('clientUser'));
    },
  },
};

export const cases: CaseModule['cases'] = {
  'POST /api/v1/business/me/notifications/:id/read': {
    params: { id: 'notification' },
    body: {},
  },
  'POST /api/v1/portal/:firmSlug/me/notifications/:id/read': {
    params: { id: 'clientNotification' },
    body: {},
  },
};
