'use client';

import type { AdvisoryClientDetail } from '@firmivra/types';
import { ActionMenu, Avatar, Badge, Button, Input, Modal, Select } from '@firmivra/ui';
import {
  ArrowLeft,
  CalendarCheck,
  CalendarDots,
  ChartBar,
  CheckCircle,
  Envelope,
  FileText,
  Handshake,
  MapPin,
  PencilSimple,
  Phone,
  Plus,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { ErrorLine, useMembers } from './ba-dialogs';
import {
  BASE,
  BA_KEY,
  BUSINESS_STAGES,
  CLIENT_STATUS,
  PlanStatusPill,
  card,
  dayText,
  errorText,
  outlined,
  quiet,
} from './ba-shared';

const TABS = [
  ['', 'Overview'],
  ['/plan', 'Business Plan'],
  ['/financials', 'Financials'],
  ['/goals', 'Goals & Milestones'],
  ['/recommendations', 'Recommendations'],
  ['/tasks', 'Tasks'],
  ['/meetings', 'Meetings'],
  ['/documents', 'Documents'],
  ['/notes', 'Notes'],
  ['/portal', 'Client Portal'],
  ['/activity', 'Activity Log'],
] as const;

/** The client's detail, shared by every tab (one cached query). */
export function useAdvisoryClient(advisoryClientId: string) {
  return useApiQuery([...BA_KEY, 'client', advisoryClientId], () =>
    api.advisory.client(advisoryClientId),
  );
}

const statusText = (c: AdvisoryClientDetail) =>
  c.archived
    ? 'Archived'
    : ['IN_PROGRESS', 'SCHEDULED', 'NEEDS_REVIEW'].includes(c.status)
      ? 'Active Advisory Client'
      : `${CLIENT_STATUS[c.status] ?? c.status} · Advisory Client`;

/** Client Advisory Detail (design 3): header, client card, plan status and the eleven tabs. */
export function ClientShell({
  advisoryClientId,
  children,
}: {
  advisoryClientId: string;
  children: ReactNode;
}) {
  const path = usePathname();
  const router = useRouter();
  const q = useAdvisoryClient(advisoryClientId);
  const c = q.data;
  const [editing, setEditing] = useState(false);
  const base = `${BASE}/clients/${advisoryClientId}`;
  const p = c?.businessProfile;
  const meta = c
    ? [
        c.industry,
        p?.entityType,
        p?.yearsInBusiness == null ? null : `${p.yearsInBusiness} Years in Business`,
      ]
        .filter(Boolean)
        .join(' | ')
    : '';
  const place = [p?.address?.city, p?.address?.state].filter(Boolean).join(', ');

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="client-detail">
      <Link
        href={BASE}
        className="flex items-center gap-2 self-start text-sm font-medium text-link hover:underline"
      >
        <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Business Advisory &amp;
        Development
      </Link>
      <header className="flex flex-wrap items-center justify-between gap-4 xl:flex-nowrap">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-action text-on-action sm:size-20"
          >
            <Handshake weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold text-heading sm:text-4xl">
              Client Advisory Detail
            </h1>
            <p className="text-base text-link sm:text-lg">
              View and manage all advisory details, goals, recommendations, and progress for this
              client.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            className={outlined}
            disabled={!c?.canEdit}
            onClick={() => setEditing(true)}
          >
            Edit Client
          </button>
          <Link href="/calendar/new" className={outlined}>
            <CalendarDots aria-hidden weight="fill" className="size-5 text-action" /> Schedule
            Meeting
          </Link>
          <ActionMenu
            label="Generate Report"
            className="[&>button]:min-h-11 [&>button]:border-action [&>button]:bg-action [&>button]:px-5 [&>button]:text-on-action"
            trigger={<span className="text-on-action">Generate Report</span>}
            sections={[
              {
                items: [
                  ...(c?.currentPlan
                    ? [
                        {
                          label: 'Business Plan Summary',
                          icon: FileText,
                          onSelect: () =>
                            router.push(`${BASE}/plans/${c.currentPlan!.id}/edit/review`),
                        },
                      ]
                    : []),
                  {
                    label: 'Advisory Reports',
                    icon: ChartBar,
                    onSelect: () => router.push(`${BASE}/reports`),
                  },
                  { label: 'Build a Report', icon: Plus, onSelect: () => router.push('/reports') },
                ],
              },
            ]}
          />
        </div>
      </header>

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,19rem)]">
        <section
          className={`${card} flex flex-wrap items-center gap-5`}
          aria-label="Client"
          data-testid="client-card"
        >
          {c ? (
            <>
              <Avatar name={c.client.name} size="xl" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="font-display text-2xl font-bold text-heading">{c.client.name}</h2>
                  <Badge tone={c.archived ? 'neutral' : 'success'} icon={CheckCircle}>
                    {statusText(c)}
                  </Badge>
                </div>
                <p className="flex flex-wrap items-center gap-x-3 text-base text-heading">
                  {c.businessName ?? 'No business name'}
                  {meta ? <span className="text-xs text-link">{meta}</span> : null}
                </p>
                <p className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-text">
                  {c.client.phone ? (
                    <span className="flex items-center gap-1.5">
                      <Phone aria-hidden weight="fill" className="size-4 text-action" />{' '}
                      {c.client.phone}
                    </span>
                  ) : null}
                  {c.client.email ? (
                    <span className="flex items-center gap-1.5">
                      <Envelope aria-hidden weight="fill" className="size-4 text-action" />{' '}
                      {c.client.email}
                    </span>
                  ) : null}
                  {place ? (
                    <span className="flex items-center gap-1.5">
                      <MapPin aria-hidden weight="fill" className="size-4 text-action" /> {place}
                    </span>
                  ) : null}
                </p>
              </div>
              <p className="hidden max-w-56 text-center font-display text-lg text-heading italic 2xl:block">
                &ldquo;Building today for a stronger tomorrow.&rdquo;
              </p>
            </>
          ) : (
            <p
              className={`${quiet} flex-1`}
              role={q.isError ? 'alert' : undefined}
              data-testid={q.isError ? 'ba-error' : undefined}
            >
              {q.isError
                ? 'This advisory client is not available right now. We could not load it. Try again in a moment.'
                : 'Loading the client…'}
            </p>
          )}
        </section>
        <section
          className={`${card} flex items-center gap-4`}
          aria-label="Plan status"
          data-testid="plan-status"
        >
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-info-soft text-action"
          >
            <CalendarCheck weight="fill" className="size-8" />
          </span>
          <div className="flex min-w-0 flex-col gap-1 text-sm">
            <span className="font-medium text-heading">Plan Status</span>
            {c?.currentPlan ? (
              <>
                <span>
                  <PlanStatusPill status={c.currentPlan.status} />
                </span>
                <Link
                  href={`${BASE}/plans/${c.currentPlan.id}/edit`}
                  className="font-medium text-link hover:underline"
                >
                  {c.currentPlan.name}
                </Link>
                <span className="text-xs text-muted">
                  Last Updated: {dayText(c.currentPlan.updatedAt)}
                </span>
              </>
            ) : c ? (
              <>
                <span className="text-muted">No business plan yet.</span>
                <Link
                  href={`${BASE}/plans/new?advisoryClientId=${c.id}`}
                  className="font-medium text-link hover:underline"
                >
                  Create Business Plan
                </Link>
              </>
            ) : (
              <span className="text-muted">—</span>
            )}
          </div>
        </section>
      </div>

      <nav
        aria-label="Client advisory views"
        role="tablist"
        className="relative flex overflow-x-auto border-b border-divider"
      >
        {TABS.map(([suffix, label]) => {
          const href = `${base}${suffix}`;
          const on = suffix ? path.startsWith(href) : path === base;
          return (
            <Link
              key={label}
              href={href}
              role="tab"
              aria-selected={on}
              className={`-mb-px flex min-h-11 shrink-0 items-center border-b-2 px-4 text-sm whitespace-nowrap ${on ? 'border-action font-semibold text-action' : 'border-transparent font-medium text-heading hover:text-action'}`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
      {children}
      {editing && c ? <EditClientDialog client={c} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}

const WORKSTREAM_STATUS: Record<string, string> = {
  INTERESTED: 'Interested',
  PROPOSED: 'Proposed',
  ACCEPTED: 'Accepted',
  IN_PROGRESS: 'In Progress',
  AWAITING_CLIENT: 'Awaiting Client',
  COMPLETED: 'Completed',
  DECLINED: 'Declined',
  ON_HOLD: 'On Hold',
};

/** Edit Client: the advisory record (status, advisor, industry, stage, since) and its services. */
export function EditClientDialog({
  client: c,
  onClose,
}: {
  client: AdvisoryClientDetail;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const members = useMembers();
  const services = useApiQuery([...BA_KEY, 'services'], () => api.advisory.serviceOptions());
  const [status, setStatus] = useState<string>(c.status);
  const [advisor, setAdvisor] = useState(c.advisor?.userId ?? '');
  const [industry, setIndustry] = useState(c.industry ?? '');
  const [stage, setStage] = useState(c.businessStage ?? '');
  const [since, setSince] = useState(c.since ?? '');
  const [newService, setNewService] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: [...BA_KEY] });
  const run = async (work: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await work();
      await refresh();
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  };
  const save = async () => {
    setSaving(true);
    const ok = await run(() =>
      api.advisory.updateClient(c.id, {
        etag: c.etag,
        status: status as never,
        industry: industry.trim() || null,
        businessStage: stage || null,
        since: since || null,
        ...(advisor && advisor !== c.advisor?.userId ? { advisorUserId: advisor } : {}),
      }),
    );
    setSaving(false);
    if (ok) onClose();
  };
  const taken = new Set(c.workstreams.map((w) => w.serviceId));
  return (
    <Modal
      open
      title="Edit Advisory Client"
      subtitle={`${c.client.name}${c.businessName ? ` · ${c.businessName}` : ''}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void save()}>
            Save Client
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="edit-client">
        <ErrorLine text={error} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={Object.entries(CLIENT_STATUS)
              .filter(([v]) => v !== 'ARCHIVED')
              .map(([value, label]) => ({ value, label }))}
          />
          {members.length ? (
            <Select
              label="Advisor"
              value={advisor}
              onChange={(e) => setAdvisor(e.target.value)}
              options={[
                { value: '', label: c.advisor?.name ?? 'No advisor' },
                ...members.filter((m) => m.value !== c.advisor?.userId),
              ]}
            />
          ) : null}
          <Input
            label="Industry"
            maxLength={100}
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
          />
          <Select
            label="Business stage"
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            options={[
              { value: '', label: 'Not set' },
              ...[
                ...BUSINESS_STAGES,
                ...(stage && !BUSINESS_STAGES.includes(stage) ? [stage] : []),
              ].map((s) => ({ value: s, label: s })),
            ]}
          />
          <Input
            label="Advisory client since"
            type="date"
            value={since}
            onChange={(e) => setSince(e.target.value)}
          />
        </div>
        <fieldset className="flex flex-col gap-2" data-testid="client-services">
          <legend className="text-sm font-medium text-text">Services</legend>
          <ul className="divide-y divide-divider">
            {c.workstreams.map((w) => (
              <li key={w.id} className="grid grid-cols-[1fr_11rem] items-center gap-2 py-2 text-sm">
                <span className="flex flex-col">
                  <span className="font-semibold text-heading">{w.serviceName}</span>
                  <span className="text-xs text-muted">
                    {w.role === 'PRIMARY' ? 'Primary focus' : 'Additional'}
                  </span>
                </span>
                <Select
                  label={`Status of ${w.serviceName}`}
                  hideLabel
                  value={w.status}
                  onChange={(e) =>
                    void run(() =>
                      api.advisory.updateWorkstream(c.id, w.id, {
                        status: e.target.value as never,
                      }),
                    )
                  }
                  options={Object.entries(WORKSTREAM_STATUS).map(([value, label]) => ({
                    value,
                    label,
                  }))}
                />
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <Select
              label="Add a service"
              value={newService}
              onChange={(e) => setNewService(e.target.value)}
              options={[
                { value: '', label: 'Choose a service…' },
                ...(services.data ?? [])
                  .filter((s) => !taken.has(s.serviceId))
                  .map((s) => ({ value: s.serviceId, label: s.name })),
              ]}
            />
            <Button
              variant="secondary"
              disabled={!newService}
              onClick={() =>
                void run(() => api.advisory.addWorkstream(c.id, { serviceId: newService })).then(
                  (ok) => ok && setNewService(''),
                )
              }
            >
              <Plus aria-hidden weight="bold" className="size-4" /> Add
            </Button>
          </div>
        </fieldset>
        <p className="flex items-center gap-1 text-xs text-muted">
          <PencilSimple aria-hidden weight="fill" className="size-3.5" /> Service changes save at
          once; the rest saves with Save Client.
        </p>
      </div>
    </Modal>
  );
}
