'use client';

import {
  NOTIFICATION_CATEGORY_LABELS,
  type NotificationPreference,
  type UpdateNotificationPreferencesRequest,
} from '@firmivra/types';
import { Card, Checkbox } from '@firmivra/ui';
import { Bell, ChevronRight, Settings2 } from 'lucide-react';
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
    <Card className="grid min-w-0 content-start gap-3">
      <div className="flex items-center gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-folder-surface text-firm-primary">
          <Settings2 aria-hidden className="size-7" />
        </span>
        <div>
          <h2 className="font-display text-xl font-bold text-heading">Profile Settings</h2>
          <p className="text-sm text-muted">Update your preferences and communication settings.</p>
        </div>
      </div>
      <details className="group grid gap-3">
        <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-control border border-border bg-surface p-3 focus-visible:outline-2 focus-visible:outline-focus">
          <Bell aria-hidden className="size-6 shrink-0 text-firm-primary" />
          <span className="flex-1">
            <span className="block font-display font-bold text-heading">
              Notification Preferences
            </span>
            <span className="block text-sm text-muted">Choose how you want to be notified.</span>
          </span>
          <ChevronRight
            aria-hidden
            className="size-5 shrink-0 text-firm-primary transition-transform group-open:rotate-90"
          />
        </summary>
        <PageState query={prefs} isEmpty={(p) => p.items.length === 0}>
          {(p) => (
            <ul className="grid gap-2">
              {p.items.map((item) => (
                <PreferenceRow
                  key={item.category}
                  item={item}
                  hasSms={p.channels.includes('SMS')}
                  pending={update.isPending}
                  onChange={set}
                />
              ))}
            </ul>
          )}
        </PageState>
        {update.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(update.error)}
          </p>
        ) : null}
      </details>
    </Card>
  );
}

function PreferenceRow({
  item,
  hasSms,
  pending,
  onChange,
}: {
  item: NotificationPreference;
  hasSms: boolean;
  pending: boolean;
  onChange: (item: NotificationPreference, channel: 'email' | 'sms', on: boolean) => void;
}) {
  const label = NOTIFICATION_CATEGORY_LABELS[item.category];
  return (
    <li className="flex flex-wrap items-center gap-4 border-b border-border pb-2">
      <span className="flex-1 text-sm font-medium text-heading">
        {label}
        {item.locked && <span className="block text-xs font-normal text-muted">Always sent</span>}
      </span>
      <Checkbox
        className="[&>input]:accent-firm-primary"
        label="Email"
        aria-label={`${label} by email`}
        checked={item.email}
        disabled={item.locked || pending}
        onChange={(e) => onChange(item, 'email', e.target.checked)}
      />
      {hasSms && (
        <Checkbox
          className="[&>input]:accent-firm-primary"
          label="Text"
          aria-label={`${label} by text`}
          checked={item.sms}
          disabled={item.locked || pending}
          onChange={(e) => onChange(item, 'sms', e.target.checked)}
        />
      )}
    </li>
  );
}
