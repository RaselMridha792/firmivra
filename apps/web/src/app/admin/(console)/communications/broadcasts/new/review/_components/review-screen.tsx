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
import { PageState } from '../../../../../../../../components/page-state';
import { useApiQuery } from '../../../../../../../../lib/query';
import {
  getBroadcastReview,
  type BroadcastReviewFixture,
} from '../../../../../../../../mocks/admin-communications-review';
import { MessagePreview } from './message-preview';

const basePath = '/communications/broadcasts/new';
const steps = [
  { label: 'Basic Information', description: 'Set up your broadcast', href: basePath },
  { label: 'Audience', description: 'Choose recipients', href: `${basePath}/audience` },
  { label: 'Message', description: 'Create your content', href: `${basePath}/message` },
  { label: 'Review & Send', description: 'Confirm and send', href: `${basePath}/review` },
];
const channels: { id: BroadcastReviewFixture['channels'][number]; label: string; icon: Icon }[] = [
  { id: 'EMAIL', label: 'Email', icon: EnvelopeSimple },
  { id: 'SMS', label: 'SMS', icon: ChatCircleDots },
  { id: 'IN_APP', label: 'In-App', icon: Bell },
];
const softButton = 'border-transparent! bg-info-soft! text-link! hover:bg-folder-hover!';

// The shared Stepper does not support the reference's descriptions and connecting lines.
function ReviewProgress() {
  return (
    <nav aria-label="Broadcast creation progress" className="py-1 lg:px-8">
      <ol className="grid grid-cols-2 gap-x-4 gap-y-5 lg:flex lg:gap-3">
        {steps.map((step, index) => (
          <li key={step.label} className="flex min-w-0 flex-1 items-center gap-3">
            <Link
              href={step.href}
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

export function ReviewScreen() {
  const router = useRouter();
  const query = useApiQuery(['admin-communications', 'broadcast-review'], getBroadcastReview);
  const review = query.isError ? null : (query.data ?? null);
  const [previewChannel, setPreviewChannel] = useState('EMAIL');
  const [dialog, setDialog] = useState<'send' | 'schedule' | null>(null);
  const [scheduleInput, setScheduleInput] = useState('');
  const [scheduleError, setScheduleError] = useState('');
  const [scheduleLabel, setScheduleLabel] = useState('');
  const [notice, setNotice] = useState('');
  const canSend = Boolean(review?.name && review.recipients > 0 && review.channels.length);
  const recipientCount = review?.recipients.toLocaleString('en-US') ?? '0';
  const selectedChannels = channels.filter((channel) => review?.channels.includes(channel.id));
  const channelLabel = selectedChannels.map((channel) => channel.label).join(', ');

  function openSchedule() {
    setScheduleError('');
    setDialog('schedule');
  }

  function confirmPreview() {
    if (dialog === 'schedule') {
      const date = new Date(scheduleInput);
      if (!scheduleInput || !Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
        setScheduleError('Choose a future date and time.');
        return;
      }
      setScheduleLabel(
        new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date),
      );
      setNotice('Schedule preview updated. No broadcast has been scheduled.');
    } else {
      setNotice('Send preview complete. No messages were sent.');
    }
    setDialog(null);
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

      <ReviewProgress />

      <PageState
        query={query}
        empty="No broadcast to review yet. Complete the previous steps to get started."
        isEmpty={(data) => data === null}
      >
        {() => null}
      </PageState>

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
              onClick={() => router.push(basePath)}
            >
              <ArrowLeft aria-hidden weight="bold" className="size-4" />
              Edit Details
            </Button>
          </div>

          <ReviewSection
            title="Basic Information"
            icon={FileText}
            onEdit={() => router.push(basePath)}
          >
            <dl className="grid gap-x-6 gap-y-3 pb-1 sm:grid-cols-2">
              <Detail label="Broadcast Name" value={review?.name} />
              <Detail label="Category" value={review?.category} />
              <Detail label="Description" value={review?.description} muted />
              <Detail label="Created By" value={review?.createdBy} muted />
            </dl>
          </ReviewSection>

          <ReviewSection
            title="Audience"
            icon={UsersThree}
            onEdit={() => router.push(`${basePath}/audience`)}
          >
            <dl className="grid gap-x-6 gap-y-3 pb-1 sm:grid-cols-2">
              <Detail label="Selected Audience" value={review?.audience} />
              <Detail label="Additional Filters" value={review?.filters} />
              <Detail
                label="Recipients"
                value={review ? `${recipientCount} clients` : undefined}
                muted
              />
              <Detail label="Uploaded List" value={review?.uploadedList} muted />
            </dl>
          </ReviewSection>

          <ReviewSection
            title="Message Content"
            icon={ChatCircleDots}
            onEdit={() => router.push(`${basePath}/message`)}
          >
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
                    <MessagePreview review={review} compact />
                  </div>
                </div>
              )}
            </div>
          </ReviewSection>

          <ReviewSection title="Schedule" icon={CalendarBlank} onEdit={openSchedule}>
            <dl className="grid gap-x-6 gap-y-3 pb-1 sm:grid-cols-2">
              <Detail
                label="Send"
                value={review ? (scheduleLabel ? 'Scheduled' : 'Immediately') : undefined}
              />
              <Detail
                label="Date & Time"
                value={review ? scheduleLabel || review.scheduledLabel : undefined}
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
                onChange={setPreviewChannel}
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
            <Button className="w-full" disabled={!canSend} onClick={() => setDialog('send')}>
              <PaperPlaneTilt aria-hidden weight="fill" className="size-5" />
              Send Now
            </Button>
            <Button
              variant="secondary"
              className={`${softButton} w-full`}
              disabled={!canSend}
              onClick={openSchedule}
            >
              <CalendarBlank aria-hidden weight="fill" className="size-5" />
              Schedule for Later
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
        subtitle="This is a mock preview. Sending and scheduling are not connected yet."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button disabled={!canSend} onClick={confirmPreview}>
              Confirm preview
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
            Review sending “{review?.name}” to {recipientCount} recipients via {channelLabel}.
          </p>
        )}
      </Modal>
    </div>
  );
}
