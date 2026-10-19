import type { AdminSettingsOverview } from '@firmivra/types';
import { Badge, Card } from '@firmivra/ui';
import { Clock, Info } from '@phosphor-icons/react';
import Link from 'next/link';
import type { ReactNode } from 'react';

function SettingsTime({ value }: { value: string }) {
  const date = new Date(value);
  return (
    <time dateTime={value} className="inline-flex flex-wrap justify-end gap-x-2">
      <span>
        {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </span>
      <span>{date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
    </time>
  );
}

function InformationRow({
  label,
  children,
  loading,
}: {
  label: string;
  children?: ReactNode;
  loading: boolean;
}) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-4 py-2.5">
      <dt className="shrink-0">{label}</dt>
      <dd className="min-w-0 text-right">
        {loading ? (
          <span className="block h-4 w-20 animate-pulse rounded-control bg-disabled motion-reduce:animate-none" />
        ) : (
          (children ?? <span className="text-muted">—</span>)
        )}
      </dd>
    </div>
  );
}

export function SettingsOverview({
  data,
  loading,
  unavailable,
}: {
  data?: AdminSettingsOverview;
  loading: boolean;
  unavailable: boolean;
}) {
  const system = data?.system;
  const changes = data?.recentChanges.slice(0, 4) ?? [];

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3.5 xl:grid-cols-19">
      <Card
        data-testid="system-information"
        aria-labelledby="system-information-title"
        aria-busy={loading}
        className="min-w-0 p-5! shadow-none! xl:col-span-9"
      >
        <div className="flex items-center gap-4 border-b border-divider pb-2">
          <Info aria-hidden weight="fill" className="size-6 shrink-0 text-action" />
          <h2 id="system-information-title" className="text-base font-bold text-heading">
            System Information
          </h2>
        </div>
        {loading ? (
          <span role="status" className="sr-only">
            Loading system information
          </span>
        ) : null}
        <dl className="divide-y divide-divider text-sm text-text">
          <InformationRow label="Platform Version" loading={loading}>
            {system?.version || undefined}
          </InformationRow>
          <InformationRow label="Environment" loading={loading}>
            {system?.environment ? (
              <Badge tone={system.environment.toLowerCase() === 'production' ? 'success' : 'info'}>
                {system.environment}
              </Badge>
            ) : undefined}
          </InformationRow>
          <InformationRow label="Last Updated" loading={loading}>
            {system?.lastUpdatedAt ? <SettingsTime value={system.lastUpdatedAt} /> : undefined}
          </InformationRow>
          <InformationRow label="Total Firms" loading={loading}>
            {system?.totalFirms.toLocaleString('en-US')}
          </InformationRow>
          <InformationRow label="Total Users" loading={loading}>
            {system?.totalUsers.toLocaleString('en-US')}
          </InformationRow>
        </dl>
      </Card>

      <Card
        data-testid="recent-settings-changes"
        aria-labelledby="recent-settings-changes-title"
        aria-busy={loading}
        className="min-w-0 p-5! shadow-none! xl:col-span-10"
      >
        <div className="flex items-center gap-4 border-b border-divider pb-2">
          <Clock aria-hidden weight="fill" className="size-6 shrink-0 text-action" />
          <h2 id="recent-settings-changes-title" className="text-base font-bold text-heading">
            Recent Changes
          </h2>
          <Link
            href="/audit-security"
            className="ml-auto shrink-0 text-sm text-link hover:underline"
          >
            View All
          </Link>
        </div>

        {loading ? (
          <div role="status" className="space-y-5 py-4">
            <span className="sr-only">Loading recent changes</span>
            {[0, 1, 2, 3].map((row) => (
              <div key={row} className="flex items-center gap-5">
                <span className="size-3 shrink-0 rounded-full bg-disabled" />
                <span className="h-8 w-full animate-pulse rounded-control bg-disabled motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        ) : changes.length === 0 ? (
          <p className="py-6 text-sm text-muted">
            {unavailable ? 'Recent changes are unavailable.' : 'No recent changes yet.'}
          </p>
        ) : (
          <ol aria-label="Recent settings changes" className="divide-y divide-divider">
            {changes.map((change, index) => (
              <li key={change.eventId} className="flex items-center gap-5 py-2">
                <span aria-hidden className="flex size-6 shrink-0 items-center justify-center">
                  <span
                    className={`size-3 rounded-full ${index % 2 === 0 ? 'bg-action' : 'bg-success'}`}
                  />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/audit-security/events/${change.eventId}`}
                      className="block text-sm text-heading hover:text-link hover:underline"
                    >
                      {change.label}
                    </Link>
                    {change.by ? <p className="text-xs text-muted">by {change.by}</p> : null}
                  </div>
                  <div className="shrink-0 text-xs text-muted sm:text-sm">
                    <SettingsTime value={change.at} />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}
