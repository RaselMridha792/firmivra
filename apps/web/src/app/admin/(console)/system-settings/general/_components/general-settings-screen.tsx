'use client';

import { ApiRequestError } from '@firmivra/types';
import { Badge, Button, Card, PageHeader } from '@firmivra/ui';
import { ArrowLeft, CaretRight, Gear } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { useApiQuery } from '../../../../../../lib/query';
import { GENERAL_SETTINGS, loadGeneralSettings } from './general-settings-data';
import { GeneralSettingsForm } from './general-settings-form';

const tabs = [
  ['Platform Information', '#platform-information'],
  ['Localization', '#localization'],
  ['Date & Time', '#date-time'],
  ['Defaults', '/system-settings/defaults'],
  ['System Preferences', '#system-preferences'],
] as const;

export function GeneralSettingsScreen({ platformUrl }: { platformUrl: string }) {
  const query = useApiQuery(GENERAL_SETTINGS, loadGeneralSettings);
  const [active, setActive] = useState('Platform Information');
  const [message, setMessage] = useState('');
  const [reload, setReload] = useState(0);
  // A failed refresh must not leave stale settings editable or reveal revoked data.
  const data = query.isError ? undefined : query.data;
  const status = query.error instanceof ApiRequestError ? query.error.status : undefined;
  const denied = status === 401 || status === 403;

  return (
    <div data-testid="general-settings" className="min-w-0 md:-mt-6 md:-ml-3 md:mr-2">
      <div className="[&_h1]:font-sans [&_h1]:text-2xl sm:[&_h1]:text-3xl [&_header>div>div:first-child]:min-w-0 [&_header>div>div:first-child>span]:size-15 [&_header>div>div:first-child>span]:rounded-full [&_header>div>div:first-child>span]:bg-info-soft [&_header>div>div:first-child>span]:text-action">
        <PageHeader
          title="General Settings"
          subtitle="Manage platform-wide basic settings and preferences for Firmivra."
          icon={Gear}
          above={
            <nav
              aria-label="Breadcrumb"
              className="mb-2 flex min-h-5 flex-wrap items-center gap-2 text-xs text-muted"
            >
              <Link
                href="/system-settings"
                className="inline-flex items-center gap-2 hover:text-link"
              >
                <ArrowLeft aria-hidden weight="bold" className="size-3.5" />
                System Settings
              </Link>
              <CaretRight aria-hidden weight="bold" className="size-3 text-border" />
              <span aria-current="page" className="font-semibold text-heading">
                General Settings
              </span>
            </nav>
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {data?.preview ? (
                <span
                  data-testid="settings-preview"
                  title="Synthetic local preview; changes are kept only for this browser session."
                >
                  <Badge tone="neutral">Preview data</Badge>
                </span>
              ) : null}
              <Link
                href="/system-settings"
                className="inline-flex min-h-10 items-center justify-center gap-3 rounded-control border border-border px-4 py-2 text-xs font-semibold text-text hover:bg-surface focus-visible:outline-2 focus-visible:outline-focus"
              >
                <ArrowLeft aria-hidden weight="bold" className="size-4" />
                Back to System Settings
              </Link>
            </div>
          }
        />
      </div>
      <nav
        aria-label="General settings sections"
        className="mt-4 flex min-w-0 overflow-x-auto border-b border-divider"
      >
        {tabs.map(([label, href]) => (
          <Link
            key={label}
            href={href}
            onClick={() => setActive(label)}
            aria-current={active === label ? 'location' : undefined}
            className={`flex min-h-10 shrink-0 items-center whitespace-nowrap border-b-2 px-3 py-2 text-xs sm:px-4 ${active === label ? 'border-action font-bold text-action' : 'border-transparent text-muted hover:text-heading'}`}
          >
            {label}
          </Link>
        ))}
        <button
          type="button"
          disabled
          title="Legal and compliance settings are not available from the configuration service"
          className="min-h-10 shrink-0 whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-xs text-muted disabled:cursor-not-allowed sm:px-4"
        >
          Legal &amp; Compliance
        </button>
      </nav>

      <div className="mt-3.5">
        {message ? (
          <p
            role="status"
            className="mb-3 rounded-card bg-success-soft px-4 py-2 text-sm text-success"
          >
            {message}
          </p>
        ) : null}
        {denied ? (
          <Card data-testid="page-forbidden" role="alert" className="mb-3 p-4!">
            <p className="text-sm text-muted">
              You don't have permission to view general settings.
            </p>
          </Card>
        ) : status === 404 ? (
          <Card data-testid="page-error" role="alert" className="mb-3 p-4!">
            <p className="mb-2 text-sm text-muted">
              General settings are unavailable. Please try again.
            </p>
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </Card>
        ) : query.isError ? (
          <div className="mb-3">
            <PageState query={{ ...query, data: undefined }}>{() => null}</PageState>
          </div>
        ) : null}
        {!query.isPending && !query.isError && !data?.general ? (
          <p role="status" className="mb-3 text-sm text-muted">
            No general settings are available.
          </p>
        ) : null}
        {query.isPending ? (
          <span role="status" className="sr-only">
            Loading general settings
          </span>
        ) : null}
        <GeneralSettingsForm
          key={`${data?.general?.version ?? 'empty'}-${reload}`}
          data={data}
          loading={query.isPending}
          platformUrl={platformUrl}
          onSaved={setMessage}
          onReload={() => {
            setMessage('');
            void query.refetch().then(() => setReload((value) => value + 1));
          }}
        />
      </div>
    </div>
  );
}
