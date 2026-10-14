import { Card } from '@firmivra/ui';
import { CheckCircle, Clock, File, FileX, WarningCircle } from '@phosphor-icons/react/ssr';
import type { Icon } from '@phosphor-icons/react';

interface Stat {
  icon: Icon;
  iconBg: string;
  iconColor: string;
  label: string;
  caption?: string;
}

/**
 * The design's five counts (All Documents, Recently Uploaded, Needs Review, Signed / Completed,
 * Missing Documents) all need a firm-wide count across every client; the API only lists one
 * client's documents at a time (apps/api/src/storage/documents.controller.ts has no firm-wide
 * route). R34 PR: shown with a quiet "—" rather than a made-up or single-client number.
 */
const STATS: Stat[] = [
  { icon: File, iconBg: 'bg-disabled', iconColor: 'text-heading', label: 'All Documents' },
  {
    icon: Clock,
    iconBg: 'bg-info-soft',
    iconColor: 'text-info',
    label: 'Recently Uploaded',
    caption: 'in last 7 days',
  },
  {
    icon: WarningCircle,
    iconBg: 'bg-warning-soft',
    iconColor: 'text-warning',
    label: 'Needs Review',
  },
  {
    icon: CheckCircle,
    iconBg: 'bg-success-soft',
    iconColor: 'text-success',
    label: 'Signed / Completed',
  },
  { icon: FileX, iconBg: 'bg-danger-soft', iconColor: 'text-danger', label: 'Missing Documents' },
];

export function DocumentsStatCards() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5" data-testid="stat-cards">
      {STATS.map((stat) => (
        <Card key={stat.label} className="flex items-start gap-4 p-4">
          <span
            className={`inline-flex size-14 shrink-0 items-center justify-center rounded-full ${stat.iconBg}`}
          >
            <stat.icon weight="regular" className={`size-7 ${stat.iconColor}`} aria-hidden="true" />
          </span>
          <span>
            <span
              className="block text-3xl font-bold text-heading"
              aria-label={`${stat.label}: not available yet`}
            >
              &mdash;
            </span>
            <span className="block text-base font-medium text-text">{stat.label}</span>
            {stat.caption ? <span className="block text-xs text-muted">{stat.caption}</span> : null}
          </span>
        </Card>
      ))}
    </div>
  );
}
