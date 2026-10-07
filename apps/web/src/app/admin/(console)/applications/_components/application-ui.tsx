import { CheckCircle2, FileText, Users, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Card } from '@firmivra/ui';
import type { Application, Status } from './application-data';

export const dateText = (value: string) =>
  new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
export const dateParts = (value: string) => {
  const d = new Date(value);
  return [d.toLocaleDateString(), d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })];
};

export function StatusPill({ status }: { status: Status }) {
  const tone: Record<Status, string> = {
    'Pending Review': 'bg-brand-50 text-brand-700',
    'Information Requested': 'bg-accent-500/10 text-brand-700',
    Approved: 'bg-success/10 text-success',
    Declined: 'bg-danger/10 text-danger',
  };
  return (
    <span className={`inline-flex rounded-control px-3 py-1 text-xs font-medium ${tone[status]}`}>
      {status}
    </span>
  );
}

export function MetricCards({ apps }: { apps: Application[] }) {
  const [month] = useState(() => new Date().getMonth());
  const thisMonth = apps.filter((a) => new Date(a.submittedAt).getMonth() === month);
  const pending = apps.filter(
    (a) => a.status === 'Pending Review' || a.status === 'Information Requested',
  ).length;
  const metrics = [
    ['Pending Review', pending, FileText, 'text-brand-700 bg-brand-50'],
    [
      'Approved This Month',
      thisMonth.filter((a) => a.status === 'Approved').length,
      CheckCircle2,
      'text-success bg-success/10',
    ],
    [
      'Declined This Month',
      thisMonth.filter((a) => a.status === 'Declined').length,
      XCircle,
      'text-danger bg-danger/10',
    ],
    ['Total Applications', apps.length, Users, 'text-accent-600 bg-accent-500/10'],
  ] as const;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map(([label, count, Icon, tone]) => (
        <Card key={label} className="flex items-center gap-4">
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
