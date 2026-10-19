'use client';

import { ApiRequestError, type AdminSettingsCategory } from '@firmivra/types';
import { Badge, Card, PageHeader } from '@firmivra/ui';
import {
  Buildings,
  CaretRight,
  Cloud,
  Database,
  EnvelopeSimple,
  Gear,
  Info,
  ShieldCheck,
  SlidersHorizontal,
  UsersThree,
  Wrench,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { SettingsOverview } from './settings-overview';

interface SettingsCategory {
  key: AdminSettingsCategory;
  title: string;
  description: string;
  icon: Icon;
  href: string;
}

const categories: readonly SettingsCategory[] = [
  {
    key: 'GENERAL',
    title: 'General Settings',
    description: 'Platform name, timezone, language, date format, and other global preferences.',
    icon: Gear,
    href: '/system-settings/general',
  },
  {
    key: 'BRANDING',
    title: 'Branding & Appearance',
    description: 'Manage platform branding, logo, colors, and default theme settings.',
    icon: Buildings,
    href: '/system-settings/branding',
  },
  {
    key: 'EMAIL',
    title: 'Email & Notifications',
    description: 'Configure system email settings, notification templates, and defaults.',
    icon: EnvelopeSimple,
    href: '/system-settings/email-notifications',
  },
  {
    key: 'FEATURES',
    title: 'Feature Management',
    description: 'Enable or disable platform features and control feature access.',
    icon: SlidersHorizontal,
    href: '/system-settings/features',
  },
  {
    key: 'RETENTION',
    title: 'Data & Retention',
    description: 'Configure data retention policies, archiving, and deletion settings.',
    icon: Database,
    href: '/system-settings/data-retention',
  },
  {
    key: 'SECURITY',
    title: 'Security Settings',
    description: 'Manage password policies, session settings, and additional security options.',
    icon: ShieldCheck,
    href: '/audit-security',
  },
  {
    key: 'SYSTEM',
    title: 'System Configuration',
    description: 'Environment settings, API keys, third-party services, and system defaults.',
    icon: Cloud,
    href: '/system-settings/configuration',
  },
  {
    key: 'MAINTENANCE',
    title: 'Maintenance & Tools',
    description: 'System maintenance, background jobs, logs, and troubleshooting tools.',
    icon: Wrench,
    href: '/system-settings/configuration',
  },
  {
    key: 'DEFAULTS',
    title: 'Default User & Firm Settings',
    description:
      'Set default roles, permissions, and initial configurations for new firms and users.',
    icon: UsersThree,
    href: '/system-settings/defaults',
  },
];

const tabs = [
  { label: 'Overview', href: '/system-settings' },
  { label: 'General', href: '/system-settings/general' },
  { label: 'Branding', href: '/system-settings/branding' },
  { label: 'Email & Notifications', href: '/system-settings/email-notifications' },
  { label: 'Features', href: '/system-settings/features' },
  { label: 'Data & Retention', href: '/system-settings/data-retention' },
  { label: 'Security', href: '/audit-security' },
  { label: 'Integrations', href: '/integrations' },
  { label: 'Maintenance', href: '/system-settings/configuration' },
] as const;

/** The kit's LinkCard has square tiles and a round arrow; this page uses discs and chevrons. */
function SettingsCard({ category, disabled }: { category: SettingsCategory; disabled: boolean }) {
  const Glyph = category.icon;

  return (
    <Card
      data-testid="settings-category"
      className="relative flex min-h-28.5 items-start gap-4 p-4! sm:gap-5"
    >
      <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-info-soft text-action">
        <Glyph aria-hidden weight="fill" className="size-7" />
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <h2 className="flex items-start justify-between gap-2 text-base font-bold text-heading">
          {disabled ? (
            <span role="link" aria-disabled="true">
              {category.title}
            </span>
          ) : (
            <Link
              href={category.href}
              className="after:absolute after:inset-0 after:rounded-card hover:text-link focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-focus"
            >
              {category.title}
            </Link>
          )}
          <CaretRight aria-hidden weight="bold" className="mt-1 size-4 shrink-0 text-muted" />
        </h2>
        <p className="mt-1 text-sm text-muted">{category.description}</p>
      </div>
    </Card>
  );
}

async function loadOverview() {
  try {
    return { settings: await api.adminSettings.overview(), preview: false };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) {
      // The contract is published before its backend route. Keep the local design usable
      // until that route lands, without disguising permission/network errors or production data.
      if (process.env.NODE_ENV !== 'production') {
        const { createAdminSystemSettingsOverviewPreview } =
          await import('../../../../../mocks/admin-system-settings-overview');
        return { settings: createAdminSystemSettingsOverviewPreview(), preview: true };
      }
      throw new ApiRequestError(
        503,
        'SETTINGS_UNAVAILABLE',
        'System settings are unavailable. Please try again.',
      );
    }
    throw error;
  }
}

export function SystemSettingsScreen() {
  const overview = useApiQuery(['admin-settings', 'overview', 'screen'], loadOverview);
  const denied =
    overview.error instanceof ApiRequestError &&
    (overview.error.status === 401 || overview.error.status === 403);
  // Never show previously cached platform data after access has been revoked.
  const data = overview.isError ? undefined : overview.data?.settings;
  const preview = !overview.isError && overview.data?.preview;

  return (
    <div data-testid="system-settings" className="min-w-0 md:-mt-3 md:-ml-3 md:mr-3">
      <div
        data-testid="page-title"
        className="border-b border-divider pb-3 [&_h1]:font-sans [&_p]:mt-0.5 [&_p]:text-base sm:[&_p]:text-lg"
      >
        <PageHeader
          title="System Settings"
          subtitle="Manage platform-wide configuration, defaults, and preferences for Firmivra."
          actions={
            preview ? (
              <span
                data-testid="settings-preview"
                title="System Information and Recent Changes show sample data for local design preview."
              >
                <Badge tone="neutral">Preview data</Badge>
              </span>
            ) : undefined
          }
        />
      </div>

      <nav
        aria-label="System settings"
        className="flex min-w-0 overflow-x-auto border-b border-divider"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.label}
            href={tab.href}
            aria-current={tab.label === 'Overview' ? 'page' : undefined}
            className={`inline-flex min-h-13 shrink-0 items-center whitespace-nowrap border-b-2 px-5 py-3 text-sm ${
              tab.label === 'Overview'
                ? 'border-action font-semibold text-action'
                : 'border-transparent text-muted hover:border-border hover:text-heading'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="mt-4 flex flex-col gap-3.5">
        <div
          role="note"
          className="flex items-start gap-3 rounded-card border border-folder-border bg-info-soft px-4 py-3 text-sm text-info sm:items-center sm:text-base"
        >
          <Info aria-hidden weight="fill" className="mt-0.5 size-5 shrink-0 sm:mt-0" />
          <p>
            These settings apply to the entire Firmivra platform and all firms. Changes may impact
            all users.
          </p>
        </div>

        {denied ? (
          <Card data-testid="page-forbidden" role="alert">
            <p className="text-sm text-muted">
              You don&apos;t have permission to view system settings.
            </p>
          </Card>
        ) : overview.isError ? (
          <PageState query={overview}>{() => null}</PageState>
        ) : null}

        {data?.maintenance?.status === 'ACTIVE' ? (
          <div
            role="status"
            className="rounded-card bg-warning-soft px-4 py-3 text-sm text-warning"
          >
            Maintenance in progress: {data.maintenance.title}
          </div>
        ) : null}

        <div
          aria-label="Settings categories"
          className="grid min-w-0 grid-cols-1 gap-3.5 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3"
        >
          {categories.map((category) => (
            <SettingsCard
              key={category.key}
              category={category}
              disabled={!data?.categories.some((available) => available.key === category.key)}
            />
          ))}
        </div>

        <SettingsOverview data={data} loading={overview.isPending} unavailable={overview.isError} />
      </div>
    </div>
  );
}
