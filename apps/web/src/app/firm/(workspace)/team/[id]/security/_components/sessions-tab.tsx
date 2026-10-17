'use client';

import { Callout, Skeleton } from '@firmivra/ui';
import { Info, SlidersHorizontal } from '@phosphor-icons/react';
import Link from 'next/link';
import { NOT_LOADED } from '../../../_components/quiet-card';
import { useMember } from '../../_components/use-member';
import { Panel } from './panel';
import { SessionsCard, useSecurity } from './security-cards';
import { SecurityShell, tabHref } from './security-shell';

const yesNo = (on: boolean) => (on ? 'On' : 'Off');

/**
 * Active Sessions tab (guide §14): every browser and device the member is signed in on, with
 * Sign out for one or all, and the session rules from Login & Security.
 */
export function SessionsTab({ id }: { id: string }) {
  const { member, manages } = useMember(id);
  const security = useSecurity(id);
  const s = security.data;
  const rules: [string, string][] = s
    ? [
        ['Maximum sessions at once', String(s.maxConcurrentSessions)],
        [
          'Automatic logout',
          s.autoLogoutMinutes ? `${s.autoLogoutMinutes} minutes` : 'Firm default',
        ],
        ['Sign out other sessions at sign-in', yesNo(s.signOutOtherSessions)],
        ['Remember trusted devices', yesNo(s.allowTrustedDevices)],
        ['Known devices only', yesNo(s.restrictDevices)],
      ]
    : [];
  return (
    <SecurityShell id={id} tab="sessions">
      <div className="grid grid-cols-1 items-start gap-4 min-[1440px]:grid-cols-3">
        <div className="min-w-0 min-[1440px]:col-span-2">
          <SessionsCard id={id} name={member?.name} enabled={manages} />
        </div>
        <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2 min-[1440px]:grid-cols-1">
          <Panel
            title="Session Rules"
            icon={SlidersHorizontal}
            testId="session-rules"
            action={
              <Link
                href={tabHref(id, 'login')}
                className="inline-flex min-h-9 w-20 items-center justify-center rounded-lg border border-action bg-surface text-xs font-semibold text-action hover:bg-canvas"
              >
                Edit
              </Link>
            }
          >
            {!s ? (
              security.isPending ? (
                <Skeleton className="h-32" />
              ) : (
                <p className="rounded-lg bg-subtle p-4 text-sm text-muted">{NOT_LOADED}</p>
              )
            ) : (
              <dl className="flex flex-col divide-y divide-divider">
                {rules.map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-3 py-2">
                    <dt className="text-sm text-heading">{label}</dt>
                    <dd className="text-sm font-semibold text-link">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </Panel>
          <Callout icon={Info} tone="navy" surface="plain" size="compact">
            Signing out a session ends it on that browser or device; they sign in again with their
            password and two-factor sign-in. Location and IP address are approximate.
          </Callout>
        </div>
      </div>
    </SecurityShell>
  );
}
