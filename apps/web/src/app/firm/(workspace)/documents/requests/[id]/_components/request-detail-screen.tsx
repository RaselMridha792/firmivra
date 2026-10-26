'use client';

import { ApiRequestError, DOCUMENT_ERRORS, type RequestItem } from '@firmivra/types';
import {
  Button,
  Input,
  KpiCard,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  Timeline,
  type TimelineItem,
  Toast,
} from '@firmivra/ui';
import {
  ArrowLeft,
  BellRinging,
  CalendarBlank,
  CaretRight,
  CheckCircle,
  ClipboardText,
  Clock,
  FilePlus,
  Files,
  PaperPlaneTilt,
  ShieldCheck,
  UploadSimple,
  XCircle,
  type Icon,
} from '@phosphor-icons/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { useFirm } from '../../../../../../../components/firm-context';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { RowMenu } from '../../../../team/_components/row-menu';
import { VIEW_LOOKS } from '../../_components/requests-parts';
import { formatDue, todayIso } from '../../new/_components/request-draft';
import { Section } from '../../new/_components/request-sections';
import {
  type ActivityLook,
  activityLook,
  dueText,
  formatTime,
  packetActions,
} from './detail-parts';
import { RequestChecklist } from './request-checklist';

const KEY = ['document-requests'];
const ERRORS: Record<string, string> = {
  ...DOCUMENT_ERRORS,
  REQUEST_INCOMPLETE:
    'Add a due date, a subject, a message and at least one document before sending.',
  REQUEST_SENT: 'This request was sent: only its due date and assignee change now.',
  INVALID_STATUS: 'This request is no longer open for that.',
  REQUEST_CLOSED: 'This request is closed.',
  NOTHING_SUBMITTED: 'Nothing was uploaded for this document yet.',
  SCAN_PENDING: 'The file is still being checked for viruses. Try again in a moment.',
  NOT_A_MEMBER: 'That team member is no longer active. Choose another.',
};
const ICONS: Record<ActivityLook, { icon: Icon; tone: TimelineItem['tone'] }> = {
  created: { icon: FilePlus, tone: 'blue' },
  sent: { icon: PaperPlaneTilt, tone: 'blue' },
  reminded: { icon: BellRinging, tone: 'amber' },
  received: { icon: UploadSimple, tone: 'purple' },
  review: { icon: ClipboardText, tone: 'purple' },
  done: { icon: CheckCircle, tone: 'green' },
  cancelled: { icon: XCircle, tone: 'red' },
  other: { icon: Clock, tone: 'grey' },
};

type Ask =
  | { kind: 'cancel' }
  | { kind: 'replace'; item: RequestItem }
  | { kind: 'due' }
  | { kind: 'assign' }
  | { kind: 'edit' };

function Row({
  label,
  children,
  action,
}: {
  label: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2 py-2">
      <dt className="text-sm font-semibold text-heading">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-baseline justify-between gap-2 text-sm text-text">
        <span className="min-w-0">{children}</span>
        {action}
      </dd>
    </div>
  );
}

const linkButton = 'text-sm font-medium text-action underline';

/**
 * One document request, for staff (the Documents guide's "staff detail state" of Frame 3; no
 * image draws it): its checklist with what came in, its details and message, its history, and
 * the actions its status allows (the library API's send, remind, resend, complete, cancel and
 * update; the documents API's accept and reject for one item).
 */
export function RequestDetailScreen({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { role } = useFirm();
  const manager = role === 'OWNER' || role === 'ADMIN';
  const query = useQuery({
    queryKey: [...KEY, id],
    queryFn: () => api.documentLibrary.request(id),
    // A missing request (or a malformed id) stays missing: no retries.
    retry: (count, error) => !(error instanceof ApiRequestError && error.status < 500) && count < 2,
  });
  const team = useQuery({ queryKey: ['team'], queryFn: () => api.team.list(), enabled: manager });
  const [note, setNote] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);

  async function act(done: string, run: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    try {
      await run();
      setNote({ text: done, tone: 'success' });
      await queryClient.invalidateQueries({ queryKey: KEY });
      return true;
    } catch (error) {
      setNote({ text: errorMessage(error, ERRORS), tone: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const header = (title: string, actions?: ReactNode, subtitle?: string) => (
    <PageHeader
      above={
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-2 text-sm">
            <li>
              <Link href="/documents" className="text-text hover:text-action hover:underline">
                Documents
              </Link>
            </li>
            <li aria-hidden>
              <CaretRight weight="bold" className="size-3 text-muted" />
            </li>
            <li>
              <Link
                href="/documents/requests"
                className="text-text hover:text-action hover:underline"
              >
                Document Requests
              </Link>
            </li>
            <li aria-hidden>
              <CaretRight weight="bold" className="size-3 text-muted" />
            </li>
            <li aria-current="page" className="font-medium text-heading">
              {title}
            </li>
          </ol>
        </nav>
      }
      title={title}
      subtitle={subtitle}
      actions={actions}
    />
  );

  if (query.isPending)
    return (
      <div className="flex flex-col gap-5" data-testid="request-detail">
        {header('Document Request')}
        <Skeleton className="h-28" />
        <Skeleton className="h-96" />
      </div>
    );
  if (query.isError) {
    const missing =
      query.error instanceof ApiRequestError && [400, 404].includes(query.error.status);
    return (
      <div className="flex flex-col gap-5" data-testid="request-detail">
        {header('Document Request')}
        <p role="alert" className="rounded-card bg-surface p-6 text-center text-text shadow-card">
          {missing
            ? 'This request was not found, or it is not one you can see.'
            : 'This request could not be loaded right now. Try again in a moment.'}{' '}
          <Link href="/documents/requests" className="font-medium text-action underline">
            Back to Document Requests
          </Link>
        </p>
      </div>
    );
  }

  const p = query.data;
  const can = packetActions(p.status);
  const look = VIEW_LOOKS[p.view];
  const members = team.data?.filter((m) => m.status === 'ACTIVE') ?? [];
  const today = todayIso();
  const more = [
    ...(can.resend
      ? [
          {
            label: 'Resend Request',
            onSelect: () =>
              void act('The request was sent again.', () =>
                api.documentLibrary.resendRequest(p.id),
              ),
          },
        ]
      : []),
    ...(can.complete
      ? [
          {
            label: 'Mark Complete',
            onSelect: () =>
              void act('The request is complete.', () => api.documentLibrary.completeRequest(p.id)),
          },
        ]
      : []),
    ...(can.editDraft
      ? [
          {
            label: 'Edit Draft',
            onSelect: () => router.push(`/documents/requests/new?draft=${p.id}`),
          },
          { label: 'Edit Details', onSelect: () => setAsk({ kind: 'edit' }) },
        ]
      : []),
    ...(can.changeDates
      ? [{ label: 'Change Due Date', onSelect: () => setAsk({ kind: 'due' }) }]
      : []),
    ...(can.changeDates && manager
      ? [{ label: 'Assign', onSelect: () => setAsk({ kind: 'assign' }) }]
      : []),
    ...(can.cancel
      ? [{ label: 'Cancel Request', danger: true, onSelect: () => setAsk({ kind: 'cancel' }) }]
      : []),
  ];
  const actions = (
    <>
      <Link
        href="/documents/requests"
        className="inline-flex min-h-11 items-center gap-2 rounded-control border border-action bg-surface px-4 text-sm font-medium text-action hover:bg-accent-soft"
      >
        <ArrowLeft aria-hidden weight="bold" className="size-5" />
        Back to Document Requests
      </Link>
      {can.send ? (
        <Button
          disabled={busy}
          onClick={() =>
            void act(`${p.reference} was sent to ${p.recipient.name}.`, () =>
              api.documentLibrary.sendRequest(p.id),
            )
          }
        >
          <PaperPlaneTilt aria-hidden weight="fill" className="size-5" />
          Send Request
        </Button>
      ) : can.remind ? (
        <Button
          disabled={busy}
          onClick={() =>
            void act(`A reminder was sent to ${p.recipient.name}.`, () =>
              api.documentLibrary.remindRequest(p.id),
            )
          }
        >
          <BellRinging aria-hidden weight="fill" className="size-5" />
          Send Reminder
        </Button>
      ) : null}
      {more.length ? <RowMenu label="More actions" items={more} /> : null}
    </>
  );
  const notify = [
    p.notifyEmail && 'Email',
    p.notifyPortal && 'Portal',
    p.notifySms && 'SMS',
  ].filter(Boolean);
  const timeline: TimelineItem[] = p.activity.map((a) => ({
    id: a.id,
    ...ICONS[activityLook(a.kind)],
    title: a.label,
    time: formatTime(a.at),
    dateTime: a.at,
    ...(a.by ? { actor: a.by } : {}),
  }));

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="request-detail">
      {header(p.title, actions, `${p.reference} · ${p.service.title}`)}
      {note ? <Toast tone={note.tone} message={note.text} onDismiss={() => setNote(null)} /> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="request-cards">
        <KpiCard
          icon={Files}
          tone="blue"
          value={`${p.items.received} of ${p.items.total}`}
          label="Documents Received"
        />
        <KpiCard
          icon={ShieldCheck}
          tone="purple"
          value={p.items.required}
          label="Required Documents"
        />
        <KpiCard
          icon={CalendarBlank}
          tone={p.view === 'OVERDUE' ? 'red' : 'amber'}
          value={p.dueOn ? formatDue(p.dueOn) : '—'}
          label="Due Date"
          {...(can.remind ? { note: dueText(p.dueOn, today) } : {})}
        />
        <KpiCard
          icon={p.view === 'COMPLETED' ? CheckCircle : ClipboardText}
          tone={p.view === 'COMPLETED' ? 'green' : 'grey'}
          value={
            <span className={`rounded-pill px-3 py-1 text-base ${look.tone}`}>{look.label}</span>
          }
          label="Status"
        />
      </div>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <RequestChecklist
            packet={p}
            can={can}
            busy={busy}
            on={{
              download: (documentId) =>
                void act('The download started.', async () => {
                  const link = await api.documents.download(documentId);
                  window.open(link.url, '_blank', 'noopener');
                }),
              accept: (item) =>
                void act(`${item.title} was accepted.`, () => api.documents.acceptRequest(item.id)),
              replace: (item) => setAsk({ kind: 'replace', item }),
              setRequired: (item, required) =>
                void act(`${item.title} is ${required ? 'required' : 'optional'} now.`, () =>
                  api.documentLibrary.updateItem(p.id, item.id, { required }),
                ),
              remove: (item) =>
                void act(`${item.title} was taken off the request.`, () =>
                  api.documentLibrary.removeItem(p.id, item.id),
                ),
              add: (item) =>
                act(`${item.title} was added.`, () =>
                  api.documentLibrary.addItem(p.id, {
                    title: item.title,
                    instructions: item.description || null,
                    required: item.required,
                  }),
                ),
            }}
          />
          <Section title="Message to Recipient" testId="request-message">
            {p.messageSubject || p.messageBody ? (
              <div className="flex flex-col gap-2 text-sm">
                <p className="font-semibold text-heading">{p.messageSubject ?? 'No subject'}</p>
                <p className="whitespace-pre-wrap text-text">{p.messageBody ?? 'No message.'}</p>
              </div>
            ) : (
              <p className="text-sm text-muted">No message yet.</p>
            )}
          </Section>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <Section title="Request Details" testId="request-info">
            <dl className="flex flex-col divide-y divide-divider">
              <Row label="Recipient">
                {p.recipient.kind === 'MEMBER' ? `${p.recipient.name} (team)` : p.recipient.name}
              </Row>
              <Row label="Client">
                <Link
                  href={`/clients/${p.client.id}`}
                  className="font-medium text-action hover:underline"
                >
                  {p.client.name}
                </Link>
              </Row>
              <Row label="Service">{p.service.title}</Row>
              <Row label="Requested By">{p.requestedBy?.name ?? '—'}</Row>
              <Row
                label="Assigned To"
                action={
                  can.changeDates && manager ? (
                    <button
                      type="button"
                      className={linkButton}
                      onClick={() => setAsk({ kind: 'assign' })}
                    >
                      Change
                    </button>
                  ) : undefined
                }
              >
                {p.assignedTo?.name ?? 'Unassigned'}
              </Row>
              <Row
                label="Due Date"
                action={
                  can.changeDates ? (
                    <button
                      type="button"
                      className={linkButton}
                      onClick={() => setAsk({ kind: 'due' })}
                    >
                      Change
                    </button>
                  ) : undefined
                }
              >
                {p.dueOn ? formatDue(p.dueOn) : 'Not set'}
              </Row>
              <Row label="Sent">{p.sentAt ? formatTime(p.sentAt) : 'Not sent yet'}</Row>
              {p.expiresAt ? <Row label="Expires">{formatTime(p.expiresAt)}</Row> : null}
              <Row label="Reminder">
                {p.reminderDaysBefore
                  ? `${p.reminderDaysBefore} ${p.reminderDaysBefore === 1 ? 'day' : 'days'} before the due date`
                  : 'None'}
              </Row>
              <Row label="Notifications">{notify.length ? notify.join(', ') : 'None'}</Row>
              <Row label="Uploads">
                {p.allowMultipleFiles ? 'Several files per document' : 'One file per document'}
              </Row>
              <Row label="Client Comments">{p.allowClientComments ? 'Allowed' : 'Off'}</Row>
            </dl>
          </Section>
          <Section title="Activity" testId="request-activity">
            {timeline.length ? (
              <Timeline items={timeline} />
            ) : (
              <p className="text-sm text-muted">No activity yet.</p>
            )}
          </Section>
        </div>
      </div>

      <AskDialog
        ask={ask}
        busy={busy}
        onClose={() => setAsk(null)}
        dueOn={p.dueOn ?? ''}
        today={today}
        assigned={p.assignedTo?.userId ?? ''}
        members={members.map((m) => ({ value: m.user.id, label: m.user.name }))}
        draft={{ title: p.title, subject: p.messageSubject ?? '', message: p.messageBody ?? '' }}
        onSubmit={async (value) => {
          if (!ask) return;
          const ok =
            ask.kind === 'cancel'
              ? await act(`${p.reference} was cancelled.`, () =>
                  api.documentLibrary.cancelRequest(p.id, value.text ? { reason: value.text } : {}),
                )
              : ask.kind === 'replace'
                ? await act(`${p.client.name} was asked again for ${ask.item.title}.`, () =>
                    api.documents.rejectRequest(ask.item.id, { reason: value.text }),
                  )
                : ask.kind === 'due'
                  ? await act('The due date was changed.', () =>
                      api.documentLibrary.updateRequest(p.id, { dueOn: value.text }),
                    )
                  : ask.kind === 'assign'
                    ? await act('The request was reassigned.', () =>
                        api.documentLibrary.updateRequest(p.id, {
                          assignedUserId: value.text || null,
                        }),
                      )
                    : await act('The draft was saved.', () =>
                        api.documentLibrary.updateRequest(p.id, {
                          title: value.title,
                          messageSubject: value.subject || null,
                          messageBody: value.message || null,
                        }),
                      );
          if (ok) setAsk(null);
        }}
      />
    </div>
  );
}

interface AskValue {
  text: string;
  title: string;
  subject: string;
  message: string;
}

const COPY: Record<Ask['kind'], { title: string; confirm: string; danger?: boolean }> = {
  cancel: { title: 'Cancel this request?', confirm: 'Cancel Request', danger: true },
  replace: { title: 'Request a replacement', confirm: 'Ask Again' },
  due: { title: 'Change Due Date', confirm: 'Save' },
  assign: { title: 'Assign', confirm: 'Save' },
  edit: { title: 'Edit Details', confirm: 'Save' },
};

function AskDialog({
  ask,
  busy,
  onClose,
  onSubmit,
  dueOn,
  today,
  assigned,
  members,
  draft,
}: {
  ask: Ask | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (value: AskValue) => Promise<void>;
  dueOn: string;
  today: string;
  assigned: string;
  members: { value: string; label: string }[];
  draft: { title: string; subject: string; message: string };
}) {
  const copy = ask ? COPY[ask.kind] : null;
  return (
    <Modal
      open={ask !== null}
      title={copy?.title ?? ''}
      subtitle={ask?.kind === 'replace' ? ask.item.title : undefined}
      onClose={onClose}
    >
      {ask && copy ? (
        <AskForm
          key={ask.kind}
          ask={ask}
          confirm={copy.confirm}
          busy={busy}
          onClose={onClose}
          onSubmit={onSubmit}
          initial={{
            text: ask.kind === 'due' ? dueOn : ask.kind === 'assign' ? assigned : '',
            ...draft,
          }}
          today={today}
          members={members}
        />
      ) : null}
    </Modal>
  );
}

function AskForm({
  ask,
  confirm,
  busy,
  onClose,
  onSubmit,
  initial,
  today,
  members,
}: {
  ask: Ask;
  confirm: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (value: AskValue) => Promise<void>;
  initial: AskValue;
  today: string;
  members: { value: string; label: string }[];
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState('');
  const put = (next: Partial<AskValue>) => setValue((v) => ({ ...v, ...next }));
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (ask.kind === 'replace' && !value.text.trim())
          return setError('Tell the client what is missing.');
        if (ask.kind === 'due' && (!value.text || value.text < today))
          return setError('Choose today or a later date.');
        if (ask.kind === 'edit' && !value.title.trim()) return setError('Enter a request title.');
        setError('');
        void onSubmit({
          ...value,
          text: value.text.trim(),
          title: value.title.trim(),
          subject: value.subject.trim(),
          message: value.message.trim(),
        });
      }}
    >
      {ask.kind === 'cancel' ? (
        <>
          <p className="text-sm text-text">
            The client can no longer upload to it, and its reminders stop. The request and its
            history are kept.
          </p>
          <Textarea
            label="Reason (optional)"
            rows={3}
            maxLength={500}
            value={value.text}
            onChange={(e) => put({ text: e.target.value })}
          />
        </>
      ) : ask.kind === 'replace' ? (
        <Textarea
          label="What is missing or wrong *"
          rows={3}
          maxLength={500}
          autoFocus
          value={value.text}
          error={error || undefined}
          onChange={(e) => put({ text: e.target.value })}
        />
      ) : ask.kind === 'due' ? (
        <Input
          label="Due Date *"
          type="date"
          min={today}
          value={value.text}
          error={error || undefined}
          onChange={(e) => put({ text: e.target.value })}
        />
      ) : ask.kind === 'assign' ? (
        <Select
          label="Assigned To"
          value={value.text}
          onChange={(e) => put({ text: e.target.value })}
          options={[{ value: '', label: 'Unassigned' }, ...members]}
        />
      ) : (
        <>
          <Input
            label="Request Title *"
            maxLength={200}
            value={value.title}
            error={error || undefined}
            onChange={(e) => put({ title: e.target.value })}
          />
          <Input
            label="Subject Line"
            maxLength={200}
            value={value.subject}
            onChange={(e) => put({ subject: e.target.value })}
          />
          <Textarea
            label="Message"
            rows={8}
            maxLength={1000}
            value={value.message}
            onChange={(e) => put({ message: e.target.value })}
          />
        </>
      )}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={onClose}>
          {ask.kind === 'cancel' ? 'Keep Request' : 'Cancel'}
        </Button>
        <Button type="submit" disabled={busy}>
          {confirm}
        </Button>
      </div>
    </form>
  );
}
