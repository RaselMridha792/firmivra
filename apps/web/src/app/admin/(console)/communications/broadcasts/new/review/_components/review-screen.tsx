'use client';

import { Button, Card, Input, Modal, PageHeader, Tabs } from '@firmivra/ui';
import {
  ArrowLeft,
  Bell,
  CalendarBlank,
  ChatCircleDots,
  Check,
  EnvelopeSimple,
  FileText,
  PaperPlaneTilt,
  PencilSimple,
  UsersThree,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { ADMIN_COMM_BROADCAST_ERRORS } from '@firmivra/types';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../../../lib/query';
import { readBroadcastDraft, stepHref } from '../../_components/broadcast-draft';
import { MessagePreview, type ReviewChannel, type ReviewView } from './message-preview';

const basePath = '/communications/broadcasts/new';
const steps = [
  { label: 'Basic Information', description: 'Set up your broadcast', step: '' as const },
  { label: 'Audience', description: 'Choose recipients', step: 'audience' as const },
  { label: 'Message', description: 'Create your content', step: 'message' as const },
  { label: 'Review & Send', description: 'Confirm and send', step: 'review' as const },
];
const channels: { id: ReviewChannel; label: string; icon: Icon }[] = [
  { id: 'EMAIL', label: 'Email', icon: EnvelopeSimple },
  { id: 'SMS', label: 'SMS', icon: ChatCircleDots },
  { id: 'IN_APP', label: 'In-App', icon: Bell },
];
const softButton = 'border-transparent! bg-info-soft! text-link! hover:bg-folder-hover!';

// The shared Stepper does not support the reference's descriptions and connecting lines.
function ReviewProgress({ broadcastId }: { broadcastId?: string }) {
  return (
    <nav aria-label="Broadcast creation progress" className="py-1 lg:px-8">
      <ol className="grid grid-cols-2 gap-x-4 gap-y-5 lg:flex lg:gap-3">
        {steps.map((step, index) => (
          <li key={step.label} className="flex min-w-0 flex-1 items-center gap-3">
            <Link
              href={
                broadcastId
                  ? stepHref(step.step, broadcastId)
                  : `${basePath}${step.step ? `/${step.step}` : ''}`
              }
              aria-current={index === 3 ? 'step' : undefined}
              className="flex min-w-0 items-center gap-3 rounded-control focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
            >
              <span
                className={`flex size-10 shrink-0 items-center justify-center rounded-full lg:size-11 ${index === 3 ? 'bg-action text-on-action' : 'bg-info-soft text-action'}`}
              >
                {index === 3 ? (
                  <span className="text-lg font-bold">4</span>
                ) : (
                  <>
                    <Check aria-hidden weight="bold" className="size-5" />
                    <span className="sr-only">Completed: </span>
                  </>
                )}
              </span>
              <span className="min-w-0 text-sm">
                <span className={`block font-bold ${index === 3 ? 'text-link' : 'text-heading'}`}>
                  {step.label}
                </span>
                <span
                  className={`mt-0.5 block text-xs lg:text-sm ${index === 3 ? 'text-link' : 'text-muted'}`}
                >
                  {step.description}
                </span>
              </span>
            </Link>
            {index < 3 && (
              <span aria-hidden className="hidden h-px min-w-2 flex-1 bg-border lg:block" />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Detail({
  label,
  value,
  muted = false,
}: {
  label: string;
  value?: string;
  muted?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-sm font-semibold text-heading">{label}</dt>
      <dd className={`mt-0.5 break-words text-sm ${muted ? 'text-muted' : 'text-heading'}`}>
        {value || '—'}
      </dd>
    </div>
  );
}

function ReviewSection({
  title,
  icon: SectionIcon,
  onEdit,
  children,
}: {
  title: string;
  icon: Icon;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="@container relative rounded-control border border-border p-3 sm:pl-4"
    >
      <div className="flex items-start gap-3 sm:gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-info-soft text-action">
          <SectionIcon aria-hidden weight="fill" className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex min-h-9 items-center justify-between gap-2">
            <h3 className="font-display text-lg font-bold text-heading">{title}</h3>
            <Button
              variant="secondary"
              className={`${softButton} shrink-0 px-3! sm:min-h-9! sm:px-4!`}
              aria-label={`Edit ${title.toLowerCase()}`}
              onClick={onEdit}
            >
              <PencilSimple aria-hidden weight="fill" className="size-4" />
              <span className="hidden sm:inline">Edit</span>
            </Button>
          </div>
          {children}
        </div>
      </div>
    </section>
  );
}

const when = (iso: string, zone: string | null) =>
  new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(zone ? { timeZone: zone } : {}),
  }).format(new Date(iso)) + (zone ? ` (${zone})` : '');

/** Step 4 of the broadcast `?id=`: test, send now or schedule (B6's lifecycle). */
export function ReviewScreen({ broadcastId }: { broadcastId?: string }) {
  const router = useRouter();
  const client = useQueryClient();
  const query = useApiQuery(
    ['admin-communications', 'broadcasts', 'one', broadcastId ?? 'new'],
    () => (broadcastId ? api.adminBroadcasts.broadcasts.get(broadcastId) : Promise.resolve(null)),
  );
  const broadcast = query.data ?? null;
  const segmentId = broadcast?.segment?.id ?? '';
  const count = useApiQuery(['admin-communications', 'segment-count', segmentId || 'none'], () =>
    segmentId ? api.adminBroadcasts.segments.count(segmentId) : Promise.resolve(null),
  );
  const categories = useApiQuery(['admin-communications', 'categories'], () =>
    api.adminCommunications.categories.list(),
  );
  const draft = broadcastId ? readBroadcastDraft(broadcastId) : null;
  const review: ReviewView | null = broadcast
    ? {
        name: broadcast.name,
        category: categories.data?.items.find((c) => c.id === draft?.category)?.name ?? '',
        description: draft?.description ?? '',
        createdBy: broadcast.createdBy?.name ?? 'Firmivra',
        audience: broadcast.segment?.name ?? '',
        recipients: count.data?.total ?? null,
        filters: '',
        uploadedList: '',
        channels: broadcast.channels.map((c) => c.channel),
        messageSummary: broadcast.channels[0]
          ? (broadcast.channels[0].subject ?? broadcast.channels[0].body).slice(0, 160)
          : '',
        scheduledLabel: broadcast.scheduledAt
          ? when(broadcast.scheduledAt, broadcast.scheduledTimeZone)
          : 'Send immediately',
        contents: Object.fromEntries(
          broadcast.channels.map((c) => [c.channel, { subject: c.subject, body: c.body }]),
        ),
      }
    : null;
  const editable = broadcast?.status === 'DRAFT' || broadcast?.status === 'SCHEDULED';
  // The preview opens on the broadcast's first channel until a tab is chosen.
  const [pickedChannel, setPickedChannel] = useState<string | null>(null);
  const previewChannel = pickedChannel ?? review?.channels[0] ?? 'EMAIL';
  const [dialog, setDialog] = useState<'send' | 'schedule' | null>(null);
  const [scheduleInput, setScheduleInput] = useState('');
  const [scheduleError, setScheduleError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const canSend = Boolean(
    editable && review?.name && review.audience && review.channels.length && review.recipients,
  );
  const recipientCount = review?.recipients?.toLocaleString('en-US') ?? '—';
  const selectedChannels = channels.filter((channel) => review?.channels.includes(channel.id));
  const channelLabel = selectedChannels.map((channel) => channel.label).join(', ');
  const go = (step: '' | 'audience' | 'message') =>
    router.push(broadcastId ? stepHref(step, broadcastId) : basePath);

  function openSchedule() {
    setScheduleError('');
    setDialog('schedule');
  }

  async function run(work: () => Promise<unknown>, done: string, leave = true) {
    setBusy(true);
    try {
      await work();
      await client.invalidateQueries({ queryKey: ['admin-communications', 'broadcasts'] });
      setNotice(done);
      setDialog(null);
      if (leave) router.push('/communications/broadcasts');
    } catch (error) {
      setNotice(errorMessage(error, ADMIN_COMM_BROADCAST_ERRORS));
      setDialog(null);
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    if (!broadcastId) return;
    if (dialog === 'schedule') {
      const date = new Date(scheduleInput);
      if (!scheduleInput || !Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
        setScheduleError('Choose a future date and time.');
        return;
      }
      void run(
        () =>
          api.adminBroadcasts.broadcasts.schedule(broadcastId, {
            scheduledAt: date.toISOString(),
            scheduledTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        'Broadcast scheduled.',
      );
    } else
      void run(
        () =>
          api.adminBroadcasts.broadcasts.send(broadcastId, {
            idempotencyKey: crypto.randomUUID(),
          }),
        'Broadcast is going out now.',
      );
  }

  function sendTest() {
    if (!broadcastId || !review?.channels.length) return;
    void run(
      async () => {
        const sent = await api.adminBroadcasts.broadcasts.test(broadcastId, {
          channels: review.channels,
        });
        setNotice(`Test sent to ${sent.sentTo.join(', ')}.`);
      },
      'Test sent.',
      false,
    );
  }

  return (
    <div className="space-y-5 xl:-mt-4">
      <header>
        <Link
          href="/communications/broadcasts"
          className="mb-4 inline-flex min-h-6 items-center gap-2 text-sm text-link hover:underline"
        >
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
          Back to Broadcasts
        </Link>
        <PageHeader
          title="Create Broadcast"
          subtitle="Send a message to multiple recipients using email, SMS, or in-app notifications."
        />
      </header>

      <ReviewProgress broadcastId={broadcastId} />

      {query.isError || !broadcastId || (broadcast && !editable) ? (
        <p
          role={query.isError ? 'alert' : 'status'}
          className={`rounded-control px-3 py-2 text-sm ${query.isError ? 'bg-danger-soft text-danger' : 'bg-info-soft text-heading'}`}
        >
          {query.isError
            ? errorMessage(query.error, ADMIN_COMM_BROADCAST_ERRORS)
            : !broadcastId
              ? 'No broadcast to review yet. Complete the previous steps to get started.'
              : 'This broadcast can no longer change: its details are shown as they were sent.'}
        </p>
      ) : null}

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-10">
        <Card className="min-w-0 space-y-4 p-3! shadow-none! sm:p-5! xl:col-span-7">
          <div className="flex flex-wrap items-start justify-between gap-3 px-1 pb-2">
            <div className="min-w-0 flex-1 basis-64">
              <h2 className="font-display text-2xl font-bold text-heading">
                Review Your Broadcast
              </h2>
              <p className="mt-1 text-sm text-muted">
                Please review all details below before sending. You can go back to make changes if
                needed.
              </p>
            </div>
            <Button
              variant="secondary"
              className={softButton}
              disabled={!editable}
              onClick={() => go('')}
            >
              <ArrowLeft aria-hidden weight="bold" className="size-4" />
              Edit Details
            </Button>
          </div>

          <ReviewSection title="Basic Information" icon={FileText} onEdit={() => go('')}>
            <dl className="grid gap-x-6 gap-y-3 pb-1 sm:grid-cols-2">
              <Detail label="Broadcast Name" value={review?.name} />
              <Detail label="Category" value={review?.category} />
              <Detail label="Description" value={review?.description} muted />
              <Detail label="Created By" value={review?.createdBy} muted />
            </dl>
          </ReviewSection>

          <ReviewSection title="Audience" icon={UsersThree} onEdit={() => go('audience')}>
            <dl className="grid gap-x-6 gap-y-3 pb-1 sm:grid-cols-2">
              <Detail label="Selected Audience" value={review?.audience} />
              <Detail label="Additional Filters" value={review?.filters} />
              <Detail
                label="Recipients"
                value={review ? `${recipientCount} recipients` : undefined}
                muted
              />
              <Detail label="Uploaded List" value={review?.uploadedList} muted />
            </dl>
          </ReviewSection>

          <ReviewSection title="Message Content" icon={ChatCircleDots} onEdit={() => go('message')}>
            <div className="flex flex-wrap items-start gap-4 pb-1 @xl:pr-64">
              <dl className="min-w-0 flex-1 basis-64 space-y-3">
                <div>
                  <dt className="text-sm font-semibold text-heading">Channels</dt>
                  <dd className="mt-1 flex flex-wrap gap-x-5 gap-y-2">
                    {selectedChannels.map(({ id, label, icon: ChannelIcon }) => (
                      <span key={id} className="inline-flex items-center gap-2 text-sm text-muted">
                        <span className="rounded-lg bg-info-soft p-1.5 text-action">
                          <ChannelIcon aria-hidden weight="fill" className="size-5" />
                        </span>
                        {label}
                      </span>
                    ))}
                    {!review && <span className="text-sm text-muted">—</span>}
                  </dd>
                </div>
                <Detail label="Message Summary" value={review?.messageSummary} muted />
              </dl>
              {review && (
                <div
                  aria-hidden
                  className="h-36 w-40 shrink-0 overflow-hidden rounded-control border border-border @xl:absolute @xl:top-4 @xl:right-28"
                >
                  <div className="w-80 origin-top-left scale-50">
                    <MessagePreview review={review} channel={review?.channels[0]} compact />
                  </div>
                </div>
              )}
            </div>
          </ReviewSection>

          <ReviewSection title="Schedule" icon={CalendarBlank} onEdit={openSchedule}>
            <dl className="grid gap-x-6 gap-y-3 pb-1 sm:grid-cols-2">
              <Detail
                label="Send"
                value={review ? (broadcast?.scheduledAt ? 'Scheduled' : 'Immediately') : undefined}
              />
              <Detail
                label="Date & Time"
                value={review ? review.scheduledLabel : undefined}
                muted
              />
            </dl>
          </ReviewSection>
        </Card>

        <aside
          aria-label="Broadcast preview and sending"
          className="grid min-w-0 items-start gap-4 lg:grid-cols-2 xl:col-span-3 xl:grid-cols-1"
        >
          <Card className="min-w-0 p-4! shadow-none!">
            <h2 className="mb-2 font-display text-xl font-bold text-heading">Message Preview</h2>
            <div className="[&_[role=tab]]:min-h-11 [&_[role=tab]]:flex-1 [&_[role=tab]]:justify-center [&_[role=tab]]:rounded-t-control [&_[role=tab]]:bg-canvas [&_[role=tablist]]:gap-2 [&_[role=tabpanel]]:pb-0 [&_[role=tabpanel]]:pt-3">
              <Tabs
                label="Message preview channel"
                variant="underline"
                value={previewChannel}
                onChange={setPickedChannel}
                items={channels.map(({ id, label }) => ({
                  id,
                  label,
                  content: <MessagePreview review={review} channel={id} />,
                }))}
              />
            </div>
          </Card>

          <Card className="min-w-0 space-y-3 p-4! shadow-none!">
            <div className="flex items-start gap-3">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-canvas text-action">
                <PaperPlaneTilt aria-hidden weight="fill" className="size-7" />
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-lg font-bold text-heading">Send This Broadcast</h2>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">
                  {review
                    ? `Your message will be sent to ${recipientCount} recipients via ${channelLabel}.`
                    : 'Complete your broadcast details before sending.'}
                </p>
              </div>
            </div>
            <Button
              className="w-full"
              disabled={!canSend || busy}
              onClick={() => setDialog('send')}
            >
              <PaperPlaneTilt aria-hidden weight="fill" className="size-5" />
              Send Now
            </Button>
            <Button
              variant="secondary"
              className={`${softButton} w-full`}
              disabled={!canSend || busy}
              onClick={openSchedule}
            >
              <CalendarBlank aria-hidden weight="fill" className="size-5" />
              {broadcast?.status === 'SCHEDULED' ? 'Reschedule' : 'Schedule for Later'}
            </Button>
            <Button
              variant="ghost"
              className="w-full"
              disabled={!editable || !review?.channels.length || busy}
              onClick={sendTest}
            >
              <PaperPlaneTilt aria-hidden weight="bold" className="size-5" />
              Send a Test to Me
            </Button>
            <p role="status" className="empty:hidden text-sm text-muted">
              {notice}
            </p>
          </Card>
        </aside>
      </div>

      <Modal
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={dialog === 'schedule' ? 'Schedule for Later' : 'Send This Broadcast'}
        subtitle={review?.name}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button disabled={!canSend || busy} onClick={confirm}>
              {dialog === 'schedule' ? 'Schedule' : 'Send Now'}
            </Button>
          </>
        }
      >
        {dialog === 'schedule' ? (
          <div className="space-y-3">
            <Input
              label="Date & time"
              type="datetime-local"
              value={scheduleInput}
              onChange={(event) => {
                setScheduleInput(event.target.value);
                setScheduleError('');
              }}
              error={scheduleError}
              required
            />
            <p className="text-sm text-muted">
              Time zone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">
            Send “{review?.name}” to {recipientCount} recipients via {channelLabel} now? It cannot
            be stopped once it starts.
          </p>
        )}
      </Modal>
    </div>
  );
}
