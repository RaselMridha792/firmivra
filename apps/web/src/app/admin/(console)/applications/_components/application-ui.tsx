import { CheckCircle2, FileText, Users, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Card } from '@firmivra/ui';
import type { FirmApplication } from './application-data';

export function StatusPill({ status }: { status: FirmApplication['status'] }) {
  const tone = {
    'Pending Review': 'bg-brand-50 text-brand-700',
    'Information Requested': 'bg-accent-500/10 text-brand-700',
    Approved: 'bg-success/10 text-success',
    Declined: 'bg-danger/10 text-danger',
  }[status];
  return (
    <span className={`inline-flex rounded-control px-3 py-1 text-xs font-medium ${tone}`}>
      {status}
    </span>
  );
}

export function MetricCards({ applications }: { applications: FirmApplication[] }) {
  const [month] = useState(() => new Date().getMonth());
  const thisMonth = applications.filter((item) => new Date(item.submittedAt).getMonth() === month);
  const metrics = [
    {
      label: 'Pending Review',
      count: applications.filter(
        (item) => item.status === 'Pending Review' || item.status === 'Information Requested',
      ).length,
      Icon: FileText,
      tone: 'text-brand-700 bg-brand-50',
    },
    {
      label: 'Approved This Month',
      count: thisMonth.filter((item) => item.status === 'Approved').length,
      Icon: CheckCircle2,
      tone: 'text-success bg-success/10',
    },
    {
      label: 'Declined This Month',
      count: thisMonth.filter((item) => item.status === 'Declined').length,
      Icon: XCircle,
      tone: 'text-danger bg-danger/10',
    },
    {
      label: 'Total Applications',
      count: applications.length,
      Icon: Users,
      tone: 'text-accent-600 bg-accent-500/10',
    },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map(({ label, count, Icon, tone }) => (
        <Card key={label} className="flex items-center gap-4 p-4">
          <span
            className={`flex size-14 shrink-0 items-center justify-center rounded-card ${tone}`}
          >
            <Icon aria-hidden className="size-7" />
          </span>
          <div>
            <p className="text-2xl font-semibold text-text">{count}</p>
            <p className="text-sm text-muted">{label}</p>
          </div>
        </Card>
      ))}
    </div>
  );
}

export function SectionTitle({
  icon: Icon,
  children,
}: {
  icon: typeof FileText;
  children: ReactNode;
}) {
  return (
    <h2 className="flex items-center gap-2 text-lg font-semibold text-text">
      <Icon aria-hidden className="size-5 text-brand-700" />
      {children}
    </h2>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(7rem,0.8fr)_minmax(0,1.2fr)] gap-3 border-b border-border px-2 py-2 text-sm last:border-b-0">
      <dt className="text-muted">{label}</dt>
      <dd className="break-words text-text">{children || '—'}</dd>
    </div>
  );
}

export function formatDate(value: string) {
  const date = new Date(value);
  return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

export function formatDateParts(value: string) {
  const date = new Date(value);
  return [
    date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
  ] as const;
}
