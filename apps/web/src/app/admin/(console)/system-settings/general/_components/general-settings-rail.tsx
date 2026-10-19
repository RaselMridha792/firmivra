import { Badge, Card } from '@firmivra/ui';
import {
  ArrowRight,
  CaretRight,
  Database,
  EnvelopeSimple,
  FileText,
  Gear,
  Info,
  Link as LinkIcon,
  MagnifyingGlass,
  SlidersHorizontal,
} from '@phosphor-icons/react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { GeneralSettingsData } from './general-settings-data';
import { SettingsSection } from './settings-section';

const quickLinks = [
  {
    title: 'Branding & Appearance',
    description: 'Manage logo, colors, and theme settings',
    href: '/system-settings/branding',
    icon: Gear,
  },
  {
    title: 'Email & Notifications',
    description: 'Configure system emails and notifications',
    href: '/system-settings/email-notifications',
    icon: EnvelopeSimple,
  },
  {
    title: 'Feature Management',
    description: 'Enable or disable platform features',
    href: '/system-settings/features',
    icon: SlidersHorizontal,
  },
  {
    title: 'Data & Retention',
    description: 'Manage data retention and archiving',
    href: '/system-settings/data-retention',
    icon: Database,
  },
  {
    title: 'View Audit Logs',
    description: 'See recent changes to system settings',
    href: '/audit-security',
    icon: MagnifyingGlass,
  },
] as const;

export function GeneralSettingsRail({
  data,
  loading,
  onLearnMore,
}: {
  data?: GeneralSettingsData;
  loading: boolean;
  onLearnMore: () => void;
}) {
  const system = data?.overview?.system;
  const general = data?.general;
  const updatedAt = general?.updatedAt;
  const rows: { label: string; value: ReactNode }[] = [
    { label: 'Platform Version', value: system?.version || null },
    {
      label: 'Environment',
      value: system?.environment ? (
        <Badge tone={system.environment.toLowerCase() === 'production' ? 'success' : 'info'}>
          {system.environment}
        </Badge>
      ) : null,
    },
    {
      label: 'Last Updated',
      value: updatedAt ? (
        <time dateTime={updatedAt}>
          {new Date(updatedAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
          <span className="ml-2">
            {new Date(updatedAt).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
            })}
          </span>
        </time>
      ) : null,
    },
    { label: 'Updated By', value: general?.updatedBy ?? null },
    { label: 'Total Firms', value: system?.totalFirms.toLocaleString('en-US') ?? null },
    { label: 'Total Users', value: system?.totalUsers.toLocaleString('en-US') ?? null },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      <Card
        data-testid="settings-important"
        className="flex gap-3.5 border-folder-border! bg-info-soft! p-4! shadow-none!"
      >
        <Info aria-hidden weight="fill" className="size-8 shrink-0 text-action" />
        <div className="min-w-0">
          <h2 className="mb-1 text-sm font-bold text-heading">Important</h2>
          <p className="text-xs text-muted">
            These settings apply to the entire Firmivra platform and all firms. Changes may impact
            all users.
          </p>
          <button
            type="button"
            onClick={onLearnMore}
            className="mt-1 inline-flex items-center gap-2 text-xs font-semibold text-link hover:underline focus-visible:outline-2 focus-visible:outline-focus"
          >
            Learn more <ArrowRight aria-hidden weight="bold" className="size-3.5" />
          </button>
        </div>
      </Card>

      <SettingsSection
        id="current-configuration"
        title="Current Configuration"
        icon={FileText}
        className="pb-1.5! [&>div:first-child]:mb-0 [&>div:first-child]:gap-3 [&>div:first-child]:border-b [&>div:first-child]:border-divider [&>div:first-child]:pb-2 [&_h2]:text-sm [&_span:has(>svg)]:size-8"
      >
        <dl aria-busy={loading} className="divide-y divide-divider text-xs">
          {rows.map(({ label, value }) => (
            <div key={label} className="flex min-h-7.5 items-center justify-between gap-3 py-1.5">
              <dt className="shrink-0 text-heading">{label}</dt>
              <dd className="min-w-0 text-right text-muted">
                {loading ? (
                  <span className="block h-3 w-16 animate-pulse rounded bg-disabled motion-reduce:animate-none" />
                ) : (
                  (value ?? '—')
                )}
              </dd>
            </div>
          ))}
        </dl>
        {data?.configurationUnavailable ? (
          <p className="pb-2 text-xs text-muted">Platform information is unavailable.</p>
        ) : null}
      </SettingsSection>

      <SettingsSection
        id="quick-links"
        title="Quick Links"
        icon={LinkIcon}
        className="pb-2! [&>div:first-child]:mb-0 [&>div:first-child]:gap-3 [&>div:first-child]:border-b [&>div:first-child]:border-divider [&>div:first-child]:pb-3 [&_h2]:text-sm [&_span:has(>svg)]:size-8"
      >
        <ul className="divide-y divide-divider">
          {quickLinks.map(({ title, description, href, icon: Glyph }) => (
            <li key={href}>
              <Link
                href={href}
                className="flex min-h-12 items-center gap-3 py-1.5 hover:bg-subtle focus-visible:outline-2 focus-visible:outline-focus"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-info-soft text-action">
                  <Glyph aria-hidden weight="fill" className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-heading">{title}</p>
                  <p className="text-xs text-muted">{description}</p>
                </div>
                <CaretRight aria-hidden weight="bold" className="size-3.5 shrink-0 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      </SettingsSection>
    </div>
  );
}
