'use client';

import {
  NOTIFICATION_CATEGORY_LABELS,
  type NotificationPreference,
  type UpdateNotificationPreferencesRequest,
} from '@firmivra/types';
import { Card, Checkbox } from '@firmivra/ui';
import { Bell } from 'lucide-react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';

/**
 * Notification Preferences: email and (when the client has a phone) SMS per category. The SMS
 * switch only stores the choice until SMS sending is on. Account notices are always sent.
 */
export function NotificationPreferencesCard({ slug }: { slug: string }) {
  const prefs = useApiQuery(['my-notification-preferences', slug], () =>
    api.myNotifications(slug).preferences(),
  );
  const update = useApiMutation(
    (body: UpdateNotificationPreferencesRequest) =>
      api.myNotifications(slug).updatePreferences(body),
    { invalidate: ['my-notification-preferences', slug] },
  );
  // Locked rows have their switches disabled, so a change never names a locked category.
  const set = (item: NotificationPreference, channel: 'email' | 'sms', on: boolean) =>
    update.mutate({
      items: [{ category: item.category, [channel]: on }],
    } as UpdateNotificationPreferencesRequest);
  return (
    <Card className="grid min-w-0 gap-3">
      <h2 className="flex items-center gap-2 font-display text-2xl font-bold text-heading">
        <Bell aria-hidden className="size-6 text-firm-primary" /> Notification Preferences
      </h2>
      <p className="text-sm text-muted">Choose how you want to be notified.</p>
      <PageState query={prefs} isEmpty={(p) => p.items.length === 0}>
        {(p) => (
          <ul className="grid gap-2">
            {p.items.map((item) => (
              <li
                key={item.category}
                className="flex flex-wrap items-center gap-4 border-b border-border pb-2"
              >
                <span className="flex-1 text-sm font-medium text-heading">
                  {NOTIFICATION_CATEGORY_LABELS[item.category]}
                  {item.locked ? (
                    <span className="block text-xs font-normal text-muted">Always sent</span>
                  ) : null}
                </span>
                <Checkbox
                  label="Email"
                  aria-label={`${NOTIFICATION_CATEGORY_LABELS[item.category]} by email`}
                  checked={item.email}
                  disabled={item.locked || update.isPending}
                  onChange={(e) => set(item, 'email', e.target.checked)}
                />
                {p.channels.includes('SMS') ? (
                  <Checkbox
                    label="Text"
                    aria-label={`${NOTIFICATION_CATEGORY_LABELS[item.category]} by text`}
                    checked={item.sms}
                    disabled={item.locked || update.isPending}
                    onChange={(e) => set(item, 'sms', e.target.checked)}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </PageState>
      {update.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(update.error)}
        </p>
      ) : null}
    </Card>
  );
}
