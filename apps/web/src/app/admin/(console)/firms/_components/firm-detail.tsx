'use client';

import { FIRM_PLANS, FirmId, type FirmRecord } from '@firmivra/types';
import { Card } from '@firmivra/ui';
import { ArrowLeft, Building2, UserRound } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
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
import { FirmAccountActions, FirmAccountHistory, firmDetailKey } from './firm-account';
import { ProfileChanges } from './profile-changes';

type Back = { href: string; label: string };
const STATUS: Record<string, { label: string; tone: string }> = {
  ACTIVE: { label: 'Active', tone: 'bg-success-soft text-success' },
  PENDING_SETUP: { label: 'Pending Setup', tone: 'bg-warning-soft text-warning' },
  // SA-FRM-Y06: the exact status, never just "Inactive".
  SUSPENDED: { label: 'Suspended', tone: 'bg-danger-soft text-danger' },
  CLOSED: { label: 'Closed', tone: 'bg-danger-soft text-danger' },
};

/** A firm that never had an application (created by hand): what the firm record holds. */
function FirmOnly({ firm, back, actions }: { firm: FirmRecord; back: Back; actions: ReactNode }) {
  const status = STATUS[firm.status] ?? { label: 'Inactive', tone: 'bg-danger-soft text-danger' };
  return (
    <section className="flex w-full flex-col gap-5 rounded-card bg-surface p-4 shadow-md md:p-5">
      <Link
        href={back.href}
        className="inline-flex w-fit items-center gap-3 text-base font-medium text-link"
      >
        <ArrowLeft aria-hidden className="size-5" />
        {back.label}
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
            <span
              data-testid="firm-status"
              className={`rounded-pill px-3 py-1 text-base font-semibold ${status.tone}`}
            >
              {status.label}
            </span>
          </div>
          <p className="mt-1 text-base text-muted">Created on {dateText(firm.createdAt)}</p>
        </div>
        {actions}
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

function FirmContent({ id, back }: { id: string; back: Back }) {
  const { me } = useMe();
  const firm = useApiQuery(firmDetailKey(id), () => api.firmApplications.getFirm(id));
  if (!me.platformAdmin) return <NoApplicationPermission />;
  return (
    <ApplicationPageState query={firm}>
      {(record) => {
        // SA-FRM-F02: the Actions menu, top right; an older API build sends no `can`.
        const actions = <FirmAccountActions firm={record} />;
        return (
          <div className="flex flex-col gap-5">
            {record.application ? (
              <ApplicationRecord
                key={record.application.id}
                application={record.application}
                back={back}
                actions={actions}
                onStale={() => void firm.refetch()}
              />
            ) : (
              <FirmOnly firm={record} back={back} actions={actions} />
            )}
            {record.accountHistory ? <FirmAccountHistory events={record.accountHistory} /> : null}
            {/* After activation the firm asks Firmivra to change its legal name, EIN or licensing. */}
            <ProfileChanges firmId={record.id} />
          </div>
        );
      }}
    </ApplicationPageState>
  );
}

/**
 * One firm, from the firms list's "Open Firm": a firm that came from an application shows the
 * approved application's page (the "Firm approved" mockup); one without shows its own record.
 * SA-FRM-Y05: Back returns to the firms list exactly as it was left (`backTo`, a /firms path).
 */
export function FirmDetail({ id, backTo = null }: { id: string; backTo?: string | null }) {
  if (!FirmId.safeParse(id).success) {
    return (
      <Card data-testid="page-not-found">
        <p className="font-medium text-text">We couldn&apos;t find this.</p>
        <p className="mt-1 text-sm text-muted">It may have been removed, or the link is wrong.</p>
      </Card>
    );
  }
  const href = backTo && /^\/firms(?:[?#]|$)/.test(backTo) ? backTo : '/firms';
  return <FirmContent id={id} back={{ href, label: 'Back to Firms' }} />;
}
