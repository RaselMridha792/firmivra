'use client';

import {
  ESIGN_COUNTERS,
  ESIGN_STATUS_LABELS,
  type EsignAccessRole,
  type EsignCounter,
} from '@firmivra/types';
import { EmptyState } from '@firmivra/ui';
import {
  Ban,
  CircleCheck,
  CircleMinus,
  Clock,
  CloudUpload,
  Eye,
  File,
  FileText,
  Hourglass,
  type LucideIcon,
  PenLine,
  Plus,
  Send,
  Upload,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { canCreate } from '../../../../../components/esign/esign-role';
import { STATUS_TONE } from '../../../../../components/esign/status-badge';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { HowItWorks, QuickActions } from './dashboard-side';
import { RecentDocuments } from './recent-documents';

/** The Firm Sign dashboard (/firm-sign), from Octavia's mockup. */
export function FirmSignDashboard() {
  const status = useApiQuery(['esign', 'status'], () => api.esign.status());
  return (
    <PageState query={status} isEmpty={() => false}>
      {(s) =>
        s.enabled ? (
          <Dashboard role={s.myEsignRole} />
        ) : (
          <EmptyState
            title="Firm Sign is off"
            description="Firm Sign isn't turned on for your firm. Ask Firmivra support to turn it on."
          />
        )
      }
    </PageState>
  );
}

function Dashboard({ role }: { role: EsignAccessRole | null }) {
  return (
    <div className="flex flex-col gap-6" data-testid="firm-sign-dashboard">
      <Hero />
      <StartTiles role={role} />
      <Counters />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <RecentDocuments />
        <QuickActions role={role} />
      </div>
      <HowItWorks />
    </div>
  );
}

function Hero() {
  return (
    <section className="flex flex-wrap items-center justify-between gap-6 rounded-card border border-border bg-surface p-6 shadow-card sm:p-8">
      <div className="flex max-w-2xl flex-col gap-3">
        <h1 data-testid="page-title" className="font-display text-4xl text-heading">
          Firm Sign
        </h1>
        <span aria-hidden="true" className="h-1 w-24 rounded-pill bg-firm-accent" />
        <p className="font-display text-2xl text-heading">Send. Sign. Secure. All in One Place.</p>
        <p className="text-muted">
          Create, send, and track documents for e-signature with a simple, secure, and professional
          experience.
        </p>
      </div>
      <p
        aria-hidden="true"
        className="hidden text-sm font-semibold tracking-widest text-heading uppercase sm:block"
      >
        Documents
        <br />
        People
        <br />
        Progress
      </p>
    </section>
  );
}

interface Tile {
  title: string;
  text: string;
  icon: LucideIcon;
  href: string;
  primary?: true;
  /** Its screen isn't built yet: shown with "Soon", not a link. */
  soon?: true;
}

/** The mockup's five ways to start. Each opens the step it names. */
const TILES: Tile[] = [
  {
    title: 'New Signature Request',
    text: 'Start from scratch',
    icon: Plus,
    href: '/firm-sign/new',
    primary: true,
    soon: true,
  },
  {
    title: 'Upload Document',
    text: 'PDF, Word, and more',
    icon: Upload,
    href: '/firm-sign/new?start=upload',
    soon: true,
  },
  {
    title: 'Use Template',
    text: 'Saved templates',
    icon: FileText,
    href: '/firm-sign/templates',
    soon: true,
  },
  {
    title: 'Upload a Template',
    text: 'Create and save for future use',
    icon: CloudUpload,
    href: '/firm-sign/templates?new=1',
    soon: true,
  },
  { title: 'Send from Client Record', text: 'Quick send', icon: Users, href: '/clients' },
];

function StartTiles({ role }: { role: EsignAccessRole | null }) {
  if (!canCreate(role)) {
    return (
      <p data-testid="view-only" className="text-sm text-muted">
        You can view signature requests. Ask your firm&apos;s owner if you need to send them.
      </p>
    );
  }
  return (
    <div
      role="group"
      aria-label="Start a request"
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
    >
      {TILES.map(({ title, text, icon: Icon, href, primary, soon }) => {
        const body = (
          <>
            <span
              className={`rounded-pill p-2 ${primary ? 'bg-white text-platform-navy' : 'bg-surface text-brand-700'}`}
            >
              <Icon aria-hidden className="size-6" />
            </span>
            <span className="font-semibold">{title}</span>
            <span className={`text-sm ${primary ? 'text-white' : 'text-muted'}`}>
              {soon ? 'Soon' : text}
            </span>
          </>
        );
        const look = `flex flex-col items-center gap-2 rounded-card border p-5 text-center shadow-card ${
          primary
            ? 'border-platform-navy bg-platform-navy text-white'
            : 'border-border bg-brand-50 text-heading'
        }`;
        return soon ? (
          <div
            key={title}
            aria-disabled="true"
            data-testid="tile-soon"
            className={`${look} opacity-70`}
          >
            {body}
          </div>
        ) : (
          <Link
            key={title}
            href={href}
            className={`${look} focus-visible:outline-2 focus-visible:outline-focus ${primary ? 'hover:bg-platform-navy-raised' : 'hover:bg-brand-100'}`}
          >
            {body}
          </Link>
        );
      })}
    </div>
  );
}

const COUNTER_ICON: Record<EsignCounter, LucideIcon> = {
  DRAFT: File,
  NEEDS_APPROVAL: Clock,
  SENT: Send,
  VIEWED: Eye,
  PARTIALLY_SIGNED: PenLine,
  COMPLETED: CircleCheck,
  DECLINED: CircleMinus,
  EXPIRED: Hourglass,
  VOIDED: Ban,
};

/** Each counter's colours: the status's tone (the mockup's tinted tiles). */
const TONE_CLASS = {
  neutral: 'border-border bg-surface text-muted',
  info: 'border-info-soft bg-info-soft text-info',
  accent: 'border-accent-soft bg-accent-soft text-accent',
  success: 'border-success-soft bg-success-soft text-success',
  warning: 'border-warning-soft bg-warning-soft text-warning',
  danger: 'border-danger-soft bg-danger-soft text-danger',
};

/** The 9 counters (Delivered counts as Sent). Each opens All requests with that status. */
function Counters() {
  const summary = useApiQuery(['esign', 'summary'], () => api.esign.summary());
  return (
    <PageState query={summary} isEmpty={() => false}>
      {(s) => (
        <nav aria-label="Requests by status">
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9">
            {ESIGN_COUNTERS.map((key) => {
              const Icon = COUNTER_ICON[key];
              const label = ESIGN_STATUS_LABELS[key];
              return (
                <li key={key}>
                  <Link
                    href={`/firm-sign/requests?status=${key}`}
                    data-testid={`counter-${key}`}
                    aria-label={`${s.counts[key]} ${label}`}
                    className={`flex h-full flex-col items-center gap-1 rounded-card border p-3 text-center focus-visible:outline-2 focus-visible:outline-focus ${TONE_CLASS[STATUS_TONE[key]]}`}
                  >
                    <Icon aria-hidden className="size-6" />
                    <span className="text-lg font-semibold">{s.counts[key]}</span>
                    <span className="text-sm">{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </PageState>
  );
}
