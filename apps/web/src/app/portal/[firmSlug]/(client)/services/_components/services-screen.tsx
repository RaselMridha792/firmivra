'use client';

import type { MyService } from '@firmivra/types';
import { Badge, Card, Tabs } from '@firmivra/ui';
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  CloudUpload,
  FileText,
  Headphones,
  Mail,
  Plus,
  Receipt,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { usePortal } from '../../../layout';
import {
  PayButton,
  PayError,
  money,
  usePay,
} from '../../(tabs)/invoices/_components/invoice-parts';
import { ServiceCard } from './service-card';

type Group = 'active' | 'recurring' | 'completed' | 'cancelled';
const GROUPS: [Group, string, string][] = [
  ['active', 'Active Services', 'No active services right now.'],
  ['recurring', 'Recurring', 'No recurring services.'],
  ['completed', 'Completed', 'No completed services yet.'],
  ['cancelled', 'Cancelled', 'No cancelled services.'],
];
const QUICK_LINKS = [
  { label: 'Upload Documents', path: 'documents', icon: FileText },
  { label: 'Schedule an Appointment', path: 'appointments', icon: CalendarDays },
  { label: 'View Invoices & Payments', path: 'invoices', icon: Receipt },
];
const groupOf = (s: MyService): Group =>
  s.status === 'COMPLETED'
    ? 'completed'
    : s.status === 'CANCELLED'
      ? 'cancelled'
      : s.recurring
        ? 'recurring'
        : 'active';
const serviceActivityDate = (s: MyService) => s.cancelledAt ?? s.cancelRequestedAt ?? '';
const dateLabel = (value: string) => {
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  return new Date(value.length === 10 ? value + 'T12:00:00' : value).toLocaleDateString(
    'en-US',
    options,
  );
};
const timeLabel = (value: string) =>
  new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
type ActivityItem = {
  id: string;
  kind: 'upload' | 'shared' | 'message' | 'appointment' | 'service';
  title: string;
  detail: string;
  at: string;
};
const ACTIVITY_ICON: Record<ActivityItem['kind'], LucideIcon> = {
  upload: FileText,
  shared: CloudUpload,
  message: Mail,
  appointment: CalendarDays,
  service: CheckCircle2,
};
const SERVICES_THEME = {
  '--color-action': 'var(--color-firm-primary)',
  '--color-action-hover': 'var(--color-navigation-hover)',
  '--color-action-pressed': 'var(--color-firm-primary)',
  '--color-link': 'var(--color-firm-primary)',
  '--color-focus': 'var(--color-firm-primary)',
  '--color-accent': 'var(--color-firm-primary)',
  '--color-accent-soft': 'var(--color-folder-surface)',
} as CSSProperties;
const loadInsights = async (slug: string) => {
  const [uploads, shared, messages, appointments, invoices] = await Promise.allSettled([
    api.myDocuments(slug).list({ source: 'MINE', limit: 100 }),
    api.myDocuments(slug).list({ source: 'FIRM', limit: 100 }),
    api.myMessages(slug).list({ filter: 'all', limit: 100 }),
    api.myAppointments(slug).list({ when: 'past' }),
    api.myInvoices(slug).list({ section: 'CURRENT', limit: 100 }),
  ]);
  return {
    documents: [
      ...(uploads.status === 'fulfilled' ? uploads.value.items : []),
      ...(shared.status === 'fulfilled' ? shared.value.items : []),
    ],
    messages: messages.status === 'fulfilled' ? messages.value.items : [],
    appointments: appointments.status === 'fulfilled' ? appointments.value : [],
    invoices: invoices.status === 'fulfilled' ? invoices.value.items : [],
  };
};

export function ServicesScreen() {
  const { firmSlug: slug } = useParams<{ firmSlug: string }>();
  const { business } = usePortal();
  const [tab, setTab] = useState<Group>('active');
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [showAllMilestones, setShowAllMilestones] = useState(false);
  const [showAllPayments, setShowAllPayments] = useState(false);
  const [viewingMilestone, setViewingMilestone] = useState<string | null>(null);
  const services = useApiQuery(['my-services', slug], () => api.myServices(slug).list());
  const insights = useApiQuery(['my-services-insights', slug], () => loadInsights(slug));
  const pay = usePay(slug);

  return (
    <div className="grid min-w-0 gap-4" style={SERVICES_THEME}>
      <header className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <h1 className="font-display text-4xl leading-tight font-bold text-firm-primary md:text-5xl">
            My <span className="text-firm-accent">Services</span>
          </h1>
          <p className="mt-1 text-base text-text">
            View and manage the services you&apos;ve purchased with {business.name}.
          </p>
        </div>
        <p
          aria-hidden
          className="hidden shrink-0 -rotate-6 text-right font-display text-xl text-heading italic md:block"
        >
          More Than Taxes.
          <span className="block">We Build Futures.</span>
        </p>
      </header>
      <PageState query={services}>
        {(items) => {
          const milestones = items.filter(
            (s) => s.stage && s.status !== 'COMPLETED' && s.status !== 'CANCELLED',
          );

          return (
            <div className="grid gap-5">
              <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
                <section
                  aria-label="Your services"
                  className="min-w-0 [&_[role=tablist]]:gap-2 [&_[role=tablist]]:border-0 [&_[role=tab]]:cursor-pointer [&_[role=tab]]:rounded-control [&_[role=tab]]:border-0 [&_[role=tab]]:shadow-card [&_[role=tab][aria-selected=true]]:bg-action [&_[role=tab][aria-selected=true]]:text-on-action [&_[role=tab][aria-selected=false]]:bg-folder-surface [&_[role=tab][aria-selected=false]]:text-text"
                >
                  <Tabs
                    label="Services"
                    value={tab}
                    onChange={(id) => setTab(id as Group)}
                    items={GROUPS.map(([id, label, empty]) => {
                      const rows = items.filter((service) => groupOf(service) === id);
                      return {
                        id,
                        label: label + ' (' + rows.length + ')',
                        content:
                          rows.length === 0 ? (
                            <Card className="border-dashed bg-canvas text-center">
                              <p className="font-semibold text-heading">{empty}</p>
                            </Card>
                          ) : (
                            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                              {rows.map((service) => (
                                <li key={service.id} className="min-w-0">
                                  <ServiceCard slug={slug} service={service} />
                                </li>
                              ))}
                            </ul>
                          ),
                      };
                    })}
                  />
                </section>

                <aside className="grid content-start gap-4">
                  <Link
                    href={'/' + slug + '/begin'}
                    className="inline-flex min-h-11 items-center justify-center gap-2 justify-self-end rounded-control bg-action px-4 py-2 text-sm font-semibold text-on-action shadow-sm transition-colors hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    <Plus aria-hidden className="size-4" />
                    Request a New Service
                  </Link>
                  <Card variant="elevated" className="border border-folder-border p-4!">
                    <div className="flex items-center gap-3">
                      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft text-firm-primary">
                        <Headphones aria-hidden className="size-6" />
                      </span>
                      <div>
                        <h2 className="font-display text-lg font-bold text-heading">Need Help?</h2>
                        <p className="text-sm text-muted">Our team is here for you.</p>
                      </div>
                    </div>
                    <Link
                      href={'/' + slug + '/messages'}
                      className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control bg-action px-4 py-2 text-sm font-semibold text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                    >
                      Send a Message
                      <ArrowRight aria-hidden className="size-4" />
                    </Link>
                  </Card>
                  <Card
                    variant="elevated"
                    title="Quick Links"
                    className="border border-folder-border p-4!"
                  >
                    {QUICK_LINKS.map(({ label, path, icon: Icon }) => (
                      <Link
                        key={path}
                        href={'/' + slug + '/' + path}
                        className="flex min-h-11 items-center gap-3 border-t border-folder-border py-2 text-sm text-heading hover:text-link"
                      >
                        <Icon aria-hidden className="size-4 shrink-0 text-firm-primary" />
                        <span className="flex-1">{label}</span>
                        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
                      </Link>
                    ))}
                  </Card>
                </aside>
              </div>

              <PageState query={insights}>
                {(feed) => {
                  const activity: ActivityItem[] = [
                    ...feed.documents.map((d) => ({
                      id: d.id,
                      kind: d.source === 'MINE' ? ('upload' as const) : ('shared' as const),
                      title: d.source === 'MINE' ? 'Document uploaded' : 'Document received',
                      detail: d.fileName,
                      at: d.uploadedAt,
                    })),
                    ...feed.messages.map((m) => ({
                      id: m.id,
                      kind: 'message' as const,
                      title: 'Conversation updated',
                      detail: m.subject,
                      at: m.lastMessageAt ?? m.createdAt,
                    })),
                    ...feed.appointments.map((a) => ({
                      id: a.id,
                      kind: 'appointment' as const,
                      title:
                        a.status === 'COMPLETED'
                          ? 'Appointment completed'
                          : a.status === 'NO_SHOW'
                            ? 'Appointment missed'
                            : a.status === 'CANCELLED'
                              ? 'Appointment cancelled'
                              : 'Appointment scheduled',
                      detail: a.type?.name ?? 'Appointment',
                      at: a.startsAt,
                    })),
                    ...items
                      .filter((s) => s.cancelRequestedAt || s.cancelledAt)
                      .map((s) => ({
                        id: s.id,
                        kind: 'service' as const,
                        title: s.cancelledAt ? 'Service cancelled' : 'Cancellation requested',
                        detail: s.service.name,
                        at: serviceActivityDate(s),
                      })),
                  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
                  const payments = [...feed.invoices].sort((a, b) =>
                    (a.dueOn ?? a.issuedOn).localeCompare(b.dueOn ?? b.issuedOn),
                  );

                  return (
                    <div className="grid gap-4 xl:grid-cols-3">
                      <InsightPanel
                        title="Recent Activity"
                        expanded={showAllActivity}
                        onToggle={() => setShowAllActivity((shown) => !shown)}
                      >
                        {activity.length ? (
                          <ul className="grid gap-3">
                            {(showAllActivity ? activity : activity.slice(0, 3)).map((s) => (
                              <InsightRow
                                key={s.id}
                                icon={ACTIVITY_ICON[s.kind]}
                                tone={
                                  s.kind === 'upload' || s.kind === 'shared'
                                    ? 'success'
                                    : s.kind === 'appointment'
                                      ? 'accent'
                                      : 'info'
                                }
                                title={s.title}
                                detail={s.detail}
                                aside={
                                  <time className="grid text-right text-xs text-muted">
                                    {dateLabel(s.at)}
                                    <span>{timeLabel(s.at)}</span>
                                  </time>
                                }
                              />
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-muted">No recent activity to show.</p>
                        )}
                      </InsightPanel>
                      <InsightPanel
                        title="Upcoming Service Milestones"
                        expanded={showAllMilestones}
                        onToggle={() => setShowAllMilestones((shown) => !shown)}
                      >
                        {milestones.length ? (
                          <ul className="grid gap-3">
                            {(showAllMilestones ? milestones : milestones.slice(0, 3)).map((s) => (
                              <InsightRow
                                key={s.id}
                                icon={CalendarDays}
                                title={s.service.name}
                                detail={s.stage ?? ''}
                                aside={
                                  <button
                                    type="button"
                                    aria-expanded={viewingMilestone === s.id}
                                    onClick={() =>
                                      setViewingMilestone((id) => (id === s.id ? null : s.id))
                                    }
                                    className="min-h-9 cursor-pointer rounded-control border border-folder-border px-3 text-sm font-semibold text-link hover:bg-info-soft"
                                  >
                                    {viewingMilestone === s.id ? 'Hide' : 'View'}
                                  </button>
                                }
                                extra={
                                  viewingMilestone === s.id ? (
                                    <p className="ml-12 mt-2 rounded-control bg-canvas px-3 py-2 text-xs text-muted">
                                      {s.title}
                                      {s.package ? ' · ' + s.package : ''}
                                      {s.nextBillingOn
                                        ? ' · Next billing ' + dateLabel(s.nextBillingOn)
                                        : ''}
                                    </p>
                                  ) : null
                                }
                              />
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-muted">No upcoming service steps right now.</p>
                        )}
                      </InsightPanel>
                      <InsightPanel
                        title="Upcoming Payments"
                        subtitle="Pay company invoices only. Tax payments go through the tax agency."
                        expanded={showAllPayments}
                        onToggle={() => setShowAllPayments((shown) => !shown)}
                      >
                        {payments.length ? (
                          <ul className="grid gap-3">
                            {(showAllPayments ? payments : payments.slice(0, 3)).map((invoice) => (
                              <InsightRow
                                key={invoice.id}
                                prefix={
                                  <Badge
                                    tone={
                                      invoice.overdue
                                        ? 'danger'
                                        : invoice.status === 'UPCOMING'
                                          ? 'info'
                                          : invoice.status === 'DUE_SOON'
                                            ? 'warning'
                                            : 'neutral'
                                    }
                                  >
                                    {invoice.overdue
                                      ? 'Overdue'
                                      : invoice.status === 'UPCOMING'
                                        ? 'Upcoming'
                                        : invoice.status === 'DUE_SOON'
                                          ? 'Due Now'
                                          : 'Pending'}
                                  </Badge>
                                }
                                title={invoice.title}
                                detail={dateLabel(invoice.dueOn ?? invoice.issuedOn)}
                                aside={
                                  <div className="grid justify-items-end gap-1">
                                    <span className="font-semibold text-heading">
                                      {money(invoice.balanceDueCents, invoice.currency)}
                                    </span>
                                    {invoice.canPay ? (
                                      <PayButton invoice={invoice} pay={pay} />
                                    ) : (
                                      <Link
                                        href={'/' + slug + '/invoices/' + invoice.id}
                                        className="min-h-8 cursor-pointer rounded-control border border-folder-border px-2 py-1 text-xs font-semibold text-link hover:bg-info-soft"
                                      >
                                        View Invoice
                                      </Link>
                                    )}
                                  </div>
                                }
                              />
                            ))}
                          </ul>
                        ) : (
                          <p className="text-sm text-muted">No upcoming payments are listed.</p>
                        )}
                        <PayError pay={pay} />
                      </InsightPanel>
                    </div>
                  );
                }}
              </PageState>
            </div>
          );
        }}
      </PageState>
    </div>
  );
}

function InsightPanel({
  title,
  subtitle,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  subtitle?: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <Card variant="elevated" className="border border-folder-border p-4!">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold text-heading">{title}</h2>
          {subtitle ? <p className="mt-1 text-xs text-muted">{subtitle}</p> : null}
        </div>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={onToggle}
          className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-xs font-semibold text-link hover:underline"
        >
          {expanded ? 'Show Less' : 'View All'}
          <ArrowRight aria-hidden className="size-3.5" />
        </button>
      </div>
      {children}
    </Card>
  );
}

function InsightRow({
  icon: Icon,
  tone = 'info',
  prefix,
  title,
  detail,
  aside,
  extra,
}: {
  icon?: LucideIcon;
  tone?: 'accent' | 'info' | 'success';
  prefix?: ReactNode;
  title: string;
  detail: string;
  aside: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-folder-border pb-3 text-sm last:border-0 last:pb-0">
      {prefix ?? (
        <span
          className={`grid size-9 place-items-center rounded-xl ${tone === 'success' ? 'bg-success-soft text-success' : tone === 'accent' ? 'bg-accent-soft text-firm-primary' : 'bg-info-soft text-info'}`}
        >
          {Icon ? <Icon aria-hidden className="size-5" /> : null}
        </span>
      )}
      <span className="min-w-0">
        <span className="block font-semibold text-heading">{title}</span>
        <span className="text-muted">{detail}</span>
      </span>
      <div>{aside}</div>
      {extra ? <div className="col-span-full min-w-0">{extra}</div> : null}
    </li>
  );
}
