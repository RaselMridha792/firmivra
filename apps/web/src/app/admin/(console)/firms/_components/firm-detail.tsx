'use client';

import { FIRM_PLANS, FirmId, type FirmRecord } from '@firmivra/types';
import { Card } from '@firmivra/ui';
import { ArrowLeft, Building2, ExternalLink, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useMe } from '../../../../../components/signed-in';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { FieldCard, formatPhone } from '../../applications/_components/application-cards';
import { ApplicationRecord } from '../../applications/_components/application-detail';
import {
  ApplicationPageState,
  dateText,
  NoApplicationPermission,
} from '../../applications/_components/application-ui';

const BACK = { href: '/firms', label: 'Back to Firms' };
const STATUS: Record<string, { label: string; tone: string }> = {
  ACTIVE: { label: 'Active', tone: 'bg-success-soft text-success' },
  PENDING_SETUP: { label: 'Pending Setup', tone: 'bg-warning-soft text-warning' },
};

/** A firm that never had an application (created by hand): what the firm record holds. */
function FirmOnly({ firm, appBaseUrl }: { firm: FirmRecord; appBaseUrl: string }) {
  const status = STATUS[firm.status] ?? { label: 'Inactive', tone: 'bg-danger-soft text-danger' };
  return (
    <section className="flex w-full flex-col gap-5 rounded-card bg-surface p-4 shadow-md md:p-5">
      <Link
        href={BACK.href}
        className="inline-flex w-fit items-center gap-3 text-base font-medium text-link"
      >
        <ArrowLeft aria-hidden className="size-5" />
        {BACK.label}
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-4">
            <h1
              data-testid="page-title"
              className="font-display text-3xl font-bold tracking-tight text-heading md:text-4xl"
            >
              {firm.name}
            </h1>
            <span className={`rounded-pill px-3 py-1 text-base font-semibold ${status.tone}`}>
              {status.label}
            </span>
          </div>
          <p className="mt-1 text-base text-muted">Created on {dateText(firm.createdAt)}</p>
        </div>
        <a
          href={appBaseUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-control bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action-hover"
        >
          <ExternalLink aria-hidden className="size-4" />
          Open Firm Workspace
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </header>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <FieldCard
          icon={Building2}
          title="Business Information"
          fields={[
            ['Business Name', firm.name],
            ['Portal Address', `/${firm.slug}`],
            ['Plan', firm.plan ? FIRM_PLANS[firm.plan] : null],
            ['Date Approved', firm.approvedAt ? dateText(firm.approvedAt) : null],
          ]}
        />
        <FieldCard
          icon={UserRound}
          title="Primary Administrator"
          fields={[
            ['Full Name', firm.owner?.name],
            ['Email', firm.owner?.email],
            ['Phone', firm.owner?.phone ? formatPhone(firm.owner.phone) : null],
          ]}
        />
      </div>
    </section>
  );
}

function FirmContent({ id, appBaseUrl }: { id: string; appBaseUrl: string }) {
  const { me } = useMe();
  const firm = useApiQuery(['firms', 'detail', id], () => api.firmApplications.getFirm(id));
  if (!me.platformAdmin) return <NoApplicationPermission />;
  return (
    <ApplicationPageState query={firm}>
      {(record) =>
        record.application ? (
          <ApplicationRecord
            key={record.application.id}
            application={record.application}
            appBaseUrl={appBaseUrl}
            back={BACK}
            onStale={() => void firm.refetch()}
          />
        ) : (
          <FirmOnly firm={record} appBaseUrl={appBaseUrl} />
        )
      }
    </ApplicationPageState>
  );
}

/**
 * One firm, from the firms list's "Open Firm": a firm that came from an application shows the
 * approved application's page (the "Firm approved" mockup); one without shows its own record.
 */
export function FirmDetail({ id, appBaseUrl }: { id: string; appBaseUrl: string }) {
  if (!FirmId.safeParse(id).success) {
    return (
      <Card data-testid="page-not-found">
        <p className="font-medium text-text">We couldn&apos;t find this.</p>
        <p className="mt-1 text-sm text-muted">It may have been removed, or the link is wrong.</p>
      </Card>
    );
  }
  return <FirmContent id={id} appBaseUrl={appBaseUrl} />;
}
