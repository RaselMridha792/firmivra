'use client';

import { FIRM_ROLE_LABELS } from '@firmivra/types';
import { Avatar, Card, PageHeader } from '@firmivra/ui';
import { UserCircle } from '@phosphor-icons/react';
import Link from 'next/link';
import { useFirm } from '../../../../../components/firm-context';
import { useMe } from '../../../../../components/signed-in';

/**
 * My Profile (Settings review, Overview items 9 and 20): the signed-in person's own details at this
 * firm, read-only from /me. Name, work email and role are managed by the firm's administrators;
 * self-edit of photo, phone and password waits for its API (R1). Never the company profile.
 */
export function MyProfileScreen() {
  const { me } = useMe();
  const { firm, role } = useFirm();
  const rows: [string, string][] = [
    ['Name', me.user.name],
    ['Work email', me.user.email],
    ['Role', role ? FIRM_ROLE_LABELS[role] : 'Staff'],
    ['Firm', firm.name],
  ];
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader icon={UserCircle} title="My Profile" subtitle="Your own details at this firm." />
      <Card variant="elevated" className="flex flex-col gap-5">
        <div className="flex items-center gap-4">
          <Avatar name={me.user.name} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-heading">{me.user.name}</p>
            <p className="truncate text-sm text-muted">{me.user.email}</p>
          </div>
        </div>
        <dl
          data-testid="my-profile"
          className="grid gap-x-6 gap-y-3 border-t border-divider pt-5 sm:grid-cols-[10rem_minmax(0,1fr)]"
        >
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-sm font-semibold text-heading">{label}</dt>
              <dd className="mb-2 break-words text-sm text-text sm:mb-0">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-muted">
          Your name, work email and role are managed by your firm&apos;s administrators. Choose
          which notices reach you in{' '}
          <Link href="/settings/notifications" className="font-medium text-link hover:underline">
            My Settings
          </Link>
          .
        </p>
      </Card>
    </div>
  );
}
