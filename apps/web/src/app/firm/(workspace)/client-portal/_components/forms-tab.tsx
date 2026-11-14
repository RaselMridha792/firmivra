'use client';

import {
  type AssignedFormRow,
  type AssignedFormTab,
  INTAKE_STATUS_LABELS,
  type IntakeStatus,
} from '@firmivra/types';
import {
  ActionMenu,
  Badge,
  Button,
  Card,
  IconTile,
  type KpiTone,
  Pagination,
  SearchField,
  Select,
} from '@firmivra/ui';
import type { Icon } from '@phosphor-icons/react';
import {
  Archive,
  ArrowsClockwise,
  CaretDown,
  ChatCircleText,
  CheckCircle,
  ClipboardText,
  ClockCounterClockwise,
  DotsThree,
  Eye,
  FileText,
  FilePlus,
  GearSix,
  HourglassMedium,
  LinkSimple,
  PaperPlaneTilt,
  WarningCircle,
} from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { dayText } from './activity-labels';

const STATUS_TONE: Record<
  IntakeStatus,
  'success' | 'info' | 'warning' | 'danger' | 'purple' | 'neutral'
> = {
  DRAFT: 'neutral',
  SENT: 'danger',
  IN_PROGRESS: 'warning',
  SUBMITTED: 'purple',
  NEEDS_CORRECTION: 'warning',
  UNDER_REVIEW: 'info',
  COMPLETED: 'success',
  EXPIRED: 'neutral',
  ARCHIVED: 'neutral',
};
/** "Submitted - Needs Review" for the firm's side of a new submission (instructions 21). */
const statusLabel = (s: IntakeStatus) =>
  s === 'SUBMITTED' ? 'Submitted - Needs Review' : INTAKE_STATUS_LABELS[s];
const OUTSTANDING: IntakeStatus[] = ['SENT', 'IN_PROGRESS', 'NEEDS_CORRECTION'];
const date = (iso: string | null) =>
  iso ? dayText(iso.length === 10 ? `${iso}T12:00:00Z` : iso) : '—';

/**
 * The Client Portal module's Intake Forms (intake-form-client-portal.jpg; developer instructions
 * 20 to 23): the client's forms from the canonical Intake Forms records, with every state kept
 * (a submitted form never disappears), its KPIs and actions. Request Form opens Send Intake Form
 * with the client chosen; Form Settings (Client Permissions) is the client's Intake Forms switch
 * and each form's Archive, as decided (Review 2 default: no per-form portal flag).
 */
export function PortalForms({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<AssignedFormTab>('all');
  const [term, setTerm] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [notice, setNotice] = useState('');
  const summary = useApiQuery(['client-portal', 'forms-summary', clientId], () =>
    api.clientPortal.formsSummary(clientId),
  );
  const query = {
    clientId,
    tab,
    search: term.trim() || undefined,
    from: from || undefined,
    to: to || undefined,
    page,
    pageSize,
  };
  const forms = useApiQuery(['client-portal', 'forms', query], () => api.intakeForms.list(query));
  // The canonical intakes also give each one's submission date.
  const intakes = useApiQuery(['client-portal', 'intakes', clientId], () =>
    api.intakes.listForClient(clientId),
  );
  const submitted = new Map((intakes.data ?? []).map((i) => [i.id, i.submittedAt]));
  const outstanding = (forms.data?.items ?? []).filter((f) => OUTSTANDING.includes(f.status));
  const remind = useApiMutation(
    async (ids: string[]) => {
      for (const id of ids) await api.intakeForms.remind(id);
      return ids.length;
    },
    { invalidate: ['client-portal'] },
  );
  const sendReminders = () =>
    remind.mutate(
      outstanding.map((f) => f.id),
      {
        onSuccess: (n) =>
          setNotice(
            n
              ? `Reminder sent for ${n} form${n === 1 ? '' : 's'}.`
              : 'No form is waiting on the client.',
          ),
      },
    );
  const s = summary.data;
  const filtered = !!(term || from || to || tab !== 'all');
  return (
    <div
      className="grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_20rem]"
      data-testid="portal-forms"
    >
      <Card className="min-w-0">
        <div className="mb-4 flex flex-wrap items-start gap-4">
          <IconTile icon={ClipboardText} tone="purple" />
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-bold text-heading">Intake Forms</h2>
            <p className="text-sm text-muted">
              View, manage, and track all intake forms for this client. Forms are linked to the main
              Intake Forms module.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                router.push(`/intake-forms/send?clientId=${encodeURIComponent(clientId)}`)
              }
            >
              <FilePlus aria-hidden className="size-4" /> Request Form
            </Button>
            <Button variant="outline" disabled={remind.isPending} onClick={sendReminders}>
              <PaperPlaneTilt aria-hidden className="size-4" /> Send Reminder
            </Button>
            <ActionMenu
              label="More form actions"
              align="right"
              trigger={
                <span className="flex items-center gap-1 text-sm font-medium">
                  More Actions <CaretDown aria-hidden className="size-4" />
                </span>
              }
              sections={[
                {
                  items: [
                    {
                      label: 'View in Intake Forms',
                      icon: ClockCounterClockwise,
                      onSelect: () => router.push(`/clients/${clientId}/intake-forms`),
                    },
                    {
                      label: 'Manage Templates',
                      icon: FileText,
                      onSelect: () => router.push('/intake-forms/templates'),
                    },
                    {
                      label: 'Form Settings (Client Permissions)',
                      icon: GearSix,
                      onSelect: () => router.push(`/client-portal/${clientId}/content`),
                    },
                  ],
                },
              ]}
            />
          </div>
        </div>
        <div className="mb-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-6" data-testid="form-kpis">
          <Kpi icon={FileText} tone="blue" value={s?.total} label="Total Forms" />
          <Kpi icon={CheckCircle} tone="green" value={s?.completed} label="Completed" />
          <Kpi
            icon={ClipboardText}
            tone="purple"
            value={s?.needsReview}
            label="Submitted Needs Review"
          />
          <Kpi icon={HourglassMedium} tone="amber" value={s?.inProgress} label="In Progress" />
          <Kpi icon={WarningCircle} tone="red" value={s?.notStarted} label="Not Started" />
          <Kpi icon={Archive} tone="grey" value={s?.archived} label="Archived" />
        </div>
        <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(12rem,2fr)_repeat(3,minmax(9rem,1fr))_auto] lg:items-end">
          <SearchField
            label="Search forms"
            placeholder="Search forms by name or keyword..."
            value={term}
            minWidth="10rem"
            onChange={(e) => {
              setTerm(e.target.value);
              setPage(1);
            }}
          />
          <Select
            label="Status"
            hideLabel
            value={tab}
            onChange={(e) => {
              setTab(e.target.value as AssignedFormTab);
              setPage(1);
            }}
            options={[
              { value: 'all', label: 'All Statuses' },
              { value: 'sent', label: 'Not Started' },
              { value: 'in_progress', label: 'In Progress' },
              { value: 'submitted', label: 'Submitted / Needs Review' },
              { value: 'completed', label: 'Completed' },
              { value: 'expired', label: 'Expired' },
            ]}
          />
          <label className="flex flex-col gap-1 text-sm text-muted">
            <span className="sr-only">Requested from</span>
            <input
              type="date"
              aria-label="Requested from"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
              className="h-10 rounded-control border border-divider bg-canvas px-3 text-text"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-muted">
            <span className="sr-only">Requested to</span>
            <input
              type="date"
              aria-label="Requested to"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
              className="h-10 rounded-control border border-divider bg-canvas px-3 text-text"
            />
          </label>
          {filtered ? (
            <button
              type="button"
              className="text-sm font-medium text-danger"
              onClick={() => {
                setTerm('');
                setFrom('');
                setTo('');
                setTab('all');
                setPage(1);
              }}
            >
              Clear
            </button>
          ) : null}
        </div>
        {notice ? (
          <p role="status" className="mb-3 text-sm text-success">
            {notice}
          </p>
        ) : null}
        {remind.error ? (
          <p role="alert" className="mb-3 text-sm text-danger">
            {errorMessage(remind.error)}
          </p>
        ) : null}
        <PageState
          query={forms}
          empty={
            filtered ? 'No forms match these filters.' : 'No intake forms sent to this client yet.'
          }
          isEmpty={(d) => d.items.length === 0}
        >
          {(d) => (
            <>
              <FormsTable rows={d.items} submitted={submitted} clientId={clientId} />
              <div className="mt-4">
                <Pagination
                  page={page}
                  onPage={setPage}
                  pageCount={Math.max(1, Math.ceil(d.total / pageSize))}
                  summary={`Showing ${(page - 1) * pageSize + 1} - ${Math.min(page * pageSize, d.total)} of ${d.total} forms`}
                  pageSize={pageSize}
                  pageSizes={[10, 25, 50]}
                  onPageSize={(n) => {
                    setPageSize(n);
                    setPage(1);
                  }}
                />
              </div>
            </>
          )}
        </PageState>
      </Card>
      <div className="flex min-w-0 flex-col gap-6">
        <Card className="min-w-0" data-testid="form-pending-actions">
          <div className="mb-3 flex items-center gap-2">
            <WarningCircle aria-hidden weight="fill" className="size-6 text-danger" />
            <div>
              <h3 className="text-lg font-semibold text-heading">Pending Client Actions</h3>
              <p className="text-sm text-danger">
                {(s?.needsReview ?? 0) + (s?.inProgress ?? 0) + (s?.notStarted ?? 0)} items
              </p>
            </div>
          </div>
          <ul className="flex flex-col gap-3 text-sm">
            <Pending n={s?.needsReview} text="intake form submitted" sub="Needs review" />
            <Pending n={s?.inProgress} text="forms in progress" sub="Client has not completed" />
            <Pending n={s?.notStarted} text="forms not started" sub="Waiting on the client" />
          </ul>
        </Card>
        <Card className="min-w-0" title="Quick Actions">
          <ul className="flex flex-col gap-2 text-sm">
            <QuickLink
              icon={FilePlus}
              label="Request a New Form"
              onClick={() =>
                router.push(`/intake-forms/send?clientId=${encodeURIComponent(clientId)}`)
              }
            />
            <QuickLink
              icon={PaperPlaneTilt}
              label="Send Reminder to Client"
              onClick={sendReminders}
            />
            <QuickLink
              icon={ClockCounterClockwise}
              label="View Form History"
              onClick={() => router.push(`/client-portal/${clientId}/activity`)}
            />
            <QuickLink
              icon={LinkSimple}
              label="Link to Related Record"
              onClick={() => router.push(`/clients/${clientId}/services`)}
            />
          </ul>
        </Card>
        <Card className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-lg font-semibold text-heading">Form Templates</h3>
            <button
              type="button"
              className="text-xs font-medium text-action underline"
              onClick={() => router.push('/intake-forms/templates')}
            >
              Manage Templates
            </button>
          </div>
          <p className="mt-1 text-sm text-muted">Use templates from the Intake Forms module.</p>
        </Card>
        <Card className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-lg font-semibold text-heading">
              Form Settings (Client Permissions)
            </h3>
            <button
              type="button"
              className="text-sm font-medium text-action underline"
              onClick={() => router.push(`/client-portal/${clientId}/content`)}
            >
              Edit
            </button>
          </div>
          <p className="mt-1 text-sm text-muted">
            Control whether this client can access intake forms in their portal; archive a form to
            take it out of their list.
          </p>
        </Card>
      </div>
    </div>
  );
}

function Kpi({
  icon,
  tone,
  value,
  label,
}: {
  icon: Icon;
  tone: KpiTone;
  value: number | undefined;
  label: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-card border border-divider p-3">
      <IconTile icon={icon} tone={tone} />
      <div className="min-w-0">
        <p className="text-2xl font-bold text-heading">{value ?? '—'}</p>
        <p className="text-sm text-muted">{label}</p>
      </div>
    </div>
  );
}

function Pending({ n, text, sub }: { n: number | undefined; text: string; sub: string }) {
  if (!n) return null;
  return (
    <li className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-danger-soft font-bold text-danger">
        {n}
      </span>
      <span>
        <span className="block font-medium text-heading">
          {n} {text}
        </span>
        <span className="block text-muted">{sub}</span>
      </span>
    </li>
  );
}

function QuickLink({
  icon: Glyph,
  label,
  onClick,
}: {
  icon: Icon;
  label: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex items-center gap-2 text-action hover:underline"
      >
        <Glyph aria-hidden className="size-4" /> {label}
      </button>
    </li>
  );
}

function FormsTable({
  rows,
  submitted,
  clientId,
}: {
  rows: AssignedFormRow[];
  submitted: Map<string, string | null>;
  clientId: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[56rem] text-left text-sm" data-testid="portal-forms-table">
        <thead className="text-muted">
          <tr>
            <th className="py-2 pr-3 font-medium">Form Name</th>
            <th className="py-2 pr-3 font-medium">Form Type</th>
            <th className="py-2 pr-3 font-medium">Date Requested</th>
            <th className="py-2 pr-3 font-medium">Due Date</th>
            <th className="py-2 pr-3 font-medium">Date Submitted</th>
            <th className="py-2 pr-3 font-medium">Status</th>
            <th className="py-2 pr-3 font-medium">Assigned To</th>
            <th className="py-2 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr key={f.id} className="border-t border-divider">
              <td className="py-2 pr-3 text-action">{f.form.name}</td>
              <td className="py-2 pr-3 text-text">{f.service?.name ?? '—'}</td>
              <td className="py-2 pr-3 whitespace-nowrap text-text">{date(f.sentAt)}</td>
              <td className="py-2 pr-3 whitespace-nowrap text-text">{date(f.dueOn)}</td>
              <td className="py-2 pr-3 whitespace-nowrap text-text">
                {date(submitted.get(f.id) ?? null)}
              </td>
              <td className="py-2 pr-3">
                <Badge tone={STATUS_TONE[f.status]} dot>
                  {statusLabel(f.status)}
                </Badge>
              </td>
              <td className="py-2 pr-3 text-text">{f.assignedTo?.name ?? 'Unassigned'}</td>
              <td className="py-2">
                <FormActions form={f} clientId={clientId} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Intake form actions (instructions 22), each on the canonical Intake Forms record. */
function FormActions({ form, clientId }: { form: AssignedFormRow; clientId: string }) {
  const router = useRouter();
  const act = useApiMutation(
    async (kind: 'remind' | 'reviewed' | 'archive') => {
      if (kind === 'remind') await api.intakeForms.remind(form.id);
      else if (kind === 'reviewed') await api.intakeForms.markReviewed(form.id);
      else await api.intakeForms.archive(form.id);
    },
    { invalidate: ['client-portal'] },
  );
  const open = (path = '') => router.push(`/intake-forms/${form.id}${path}`);
  const waiting = OUTSTANDING.includes(form.status);
  const review = form.status === 'SUBMITTED' || form.status === 'UNDER_REVIEW';
  return (
    <div className="flex items-center gap-2">
      <ActionMenu
        label={`Actions for ${form.form.name}`}
        align="right"
        trigger={<DotsThree aria-hidden weight="bold" className="size-5" />}
        sections={[
          {
            items: [
              { label: 'View Submission', icon: Eye, onSelect: () => open('/responses') },
              ...(review
                ? [
                    { label: 'Review Form', icon: ClipboardText, onSelect: () => open() },
                    { label: 'Request Correction', icon: ArrowsClockwise, onSelect: () => open() },
                    {
                      label: 'Mark Reviewed',
                      icon: CheckCircle,
                      onSelect: () => act.mutate('reviewed'),
                    },
                  ]
                : []),
              ...(waiting
                ? [
                    {
                      label: 'Send Reminder',
                      icon: PaperPlaneTilt,
                      onSelect: () => act.mutate('remind'),
                    },
                  ]
                : []),
              {
                label: 'Send Message',
                icon: ChatCircleText,
                onSelect: () =>
                  router.push(`/messages/new?clientId=${encodeURIComponent(clientId)}`),
              },
              {
                label: 'View Form History',
                icon: ClockCounterClockwise,
                onSelect: () => open('/history'),
              },
              ...(form.status !== 'ARCHIVED'
                ? [{ label: 'Archive', icon: Archive, onSelect: () => act.mutate('archive') }]
                : []),
            ],
          },
        ]}
      />
      {act.error ? (
        <span role="alert" className="text-xs text-danger">
          {errorMessage(act.error)}
        </span>
      ) : null}
    </div>
  );
}
