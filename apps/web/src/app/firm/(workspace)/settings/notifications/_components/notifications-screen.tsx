'use client';

import {
  NOTIFICATION_CATEGORY_LABELS,
  type NotificationPreference,
  type NotificationPreferences,
} from '@firmivra/types';
import { Badge, Button, Callout, Checkbox, Skeleton, Table } from '@firmivra/ui';
import { Bell, Info, LockSimple } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { NOT_LOADED, Quiet, SettingsCard, SettingsHeader } from '../../_components/settings-parts';

const PREFERENCES = ['notifications', 'preferences'];

const NOTICE_ERRORS: Record<string, string> = {
  VALIDATION_FAILED: 'Text messages are not available for your account yet.',
  EMAIL_ALWAYS_ON: 'Email notices are always on for staff.',
};

/**
 * Settings > Notifications (guide §11; Octavia's review of Oct 18): which notices reach you by text
 * message, per category (`api.notifications` preferences, R6). In-app notices (the bell) always
 * arrive, and staff email is always on (each row `emailLocked`, enforced by the API). Text
 * messages wait for a verified mobile number. Each person sets their own.
 */
export function NotificationsScreen() {
  const prefs = useApiQuery(PREFERENCES, () => api.notifications.preferences());
  const [saved, setSaved] = useState('');
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <SettingsHeader
        icon={Bell}
        title="Notifications"
        subtitle="Choose which notices also reach you by text message. Email and in-app notices always arrive."
      />
      <SettingsCard
        title="My Notification Preferences"
        subtitle="Email and in-app notices in the bell always arrive. These choices are yours alone."
        icon={Bell}
        testId="notification-preferences"
      >
        {prefs.data ? (
          <PreferencesTable
            key={JSON.stringify(prefs.data.items)}
            prefs={prefs.data}
            saved={saved}
            onSaved={setSaved}
          />
        ) : prefs.isPending ? (
          <Skeleton className="h-64" />
        ) : (
          <Quiet>{NOT_LOADED}</Quiet>
        )}
      </SettingsCard>
      <Callout icon={Info} tone="navy" surface="plain" size="compact">
        Email notices are always on for staff, so work that needs you is never missed. Text messages
        only say that something is waiting; they never carry a link, a code or client details.
      </Callout>
    </div>
  );
}

function PreferencesTable({
  prefs,
  saved,
  onSaved,
}: {
  prefs: NotificationPreferences;
  saved: string;
  onSaved: (text: string) => void;
}) {
  const [items, setItems] = useState<NotificationPreference[]>(prefs.items);
  const sms = prefs.channels.includes('SMS');
  const changed = items.filter((item) => {
    const before = prefs.items.find((p) => p.category === item.category);
    return (
      !item.locked &&
      ((!item.emailLocked && before?.email !== item.email) || before?.sms !== item.sms)
    );
  });
  const save = useApiMutation(
    async () => {
      await api.notifications.updatePreferences({
        // Account and security notices are locked: never sent as a change. Email is sent only
        // where it can change (never for staff, whose email is always on).
        items: changed.flatMap(({ category, email, emailLocked, sms: text }) =>
          category === 'ACCOUNT'
            ? []
            : [{ category, ...(emailLocked ? {} : { email }), sms: text }],
        ),
      });
      onSaved('Notification preferences saved.');
    },
    { invalidate: PREFERENCES },
  );
  const set = (
    category: NotificationPreference['category'],
    channel: 'email' | 'sms',
    on: boolean,
  ) => {
    setItems((list) => list.map((i) => (i.category === category ? { ...i, [channel]: on } : i)));
    onSaved('');
  };
  // Only the words are hidden: the box itself stays visible and clickable.
  const box = 'flex justify-center [&_label>span]:sr-only';
  return (
    <div className="flex flex-col gap-3">
      <Table
        rows={items}
        rowKey={(i) => i.category}
        caption="Notification preferences"
        dense
        showPagination={false}
        columns={[
          {
            id: 'notice',
            label: 'Notice',
            cell: (item) => (
              <span className="flex items-center gap-2 font-medium text-heading">
                {NOTIFICATION_CATEGORY_LABELS[item.category]}
                {item.locked ? (
                  <Badge tone="neutral" icon={LockSimple}>
                    Always sent
                  </Badge>
                ) : null}
              </span>
            ),
          },
          {
            id: 'app',
            label: 'In-app',
            cell: () => <span className="text-xs text-muted">Always</span>,
          },
          {
            id: 'email',
            label: 'Email',
            cell: (item) => (
              <span className={box}>
                <Checkbox
                  label={`${NOTIFICATION_CATEGORY_LABELS[item.category]} by email${item.emailLocked ? ' (always on)' : ''}`}
                  checked={item.emailLocked || item.locked || item.email}
                  disabled={item.emailLocked || item.locked || save.isPending}
                  onChange={(e) => set(item.category, 'email', e.target.checked)}
                />
              </span>
            ),
          },
          {
            id: 'sms',
            label: 'Text message',
            cell: (item) => (
              <span className={box}>
                <Checkbox
                  label={`${NOTIFICATION_CATEGORY_LABELS[item.category]} by text message`}
                  checked={item.sms}
                  disabled={item.locked || !sms || save.isPending}
                  onChange={(e) => set(item.category, 'sms', e.target.checked)}
                />
              </span>
            ),
          },
        ]}
      />
      {sms ? null : (
        <p data-testid="sms-unavailable" className="text-xs text-muted">
          Text messages need a verified mobile number, and staff numbers cannot be verified yet, so
          their boxes stay off. You can add your number on{' '}
          <Link href="/profile" className="font-semibold text-action underline">
            My Profile
          </Link>
          .
        </p>
      )}
      {save.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(save.error, NOTICE_ERRORS)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        {saved ? (
          <span role="status" data-testid="notifications-saved" className="text-sm text-success">
            {saved}
          </span>
        ) : null}
        <div className="ml-auto flex gap-3">
          <Button
            variant="secondary"
            disabled={!changed.length || save.isPending}
            onClick={() => setItems(prefs.items)}
          >
            Cancel
          </Button>
          <Button
            disabled={!changed.length || save.isPending}
            onClick={() => save.mutate(undefined)}
          >
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}
