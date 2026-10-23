'use client';

import type { ContactChannel, LeadProfile } from '@firmivra/types';
import { Avatar, Badge, Button, Modal, tileTones } from '@firmivra/ui';
import {
  Cake,
  CalendarBlank,
  ChatCircleText,
  ClockCountdown,
  Envelope,
  FileArrowUp,
  FileText,
  Fire,
  type Icon,
  IdentificationCard,
  Lightning,
  ListChecks,
  MapPin,
  Megaphone,
  NotePencil,
  PaperPlaneTilt,
  Phone,
  Plus,
  Tag,
  Target,
  TreeStructure,
  UserCircle,
  UserPlus,
  UserSwitch,
  XCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import {
  LEAD_PIPELINE_KEY,
  PRIORITY_LABELS,
  SOURCE_LABELS,
  STAGE_LABELS,
  priorityTone,
  stageTone,
} from '../../_components/lead-shared';
import { BeginOnlineRequest } from './lead-screen';
import { ActivityTimeline } from './profile-activity';
import { CardFrame, linkClass, outlineButton } from './profile-cards';
import { useProfile } from './profile-frame';
import { dayText, shortName, stamp } from './profile-shared';
import { UpcomingAppointmentsCard } from './tab-appointments';
import { ACTIONS, FollowUpCard, OpenTasksCard } from './tab-tasks';

const CONTACT: Record<ContactChannel, string> = { PHONE: 'Phone', EMAIL: 'Email', SMS: 'SMS' };

/** One labelled line of a card: icon, label, value (a quiet dash when there is none). */
function Line({
  icon: Glyph,
  label,
  children,
}: {
  icon: Icon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1.25rem_7.5rem_minmax(0,1fr)] items-center gap-2 border-b border-divider py-2 last:border-b-0">
      <Glyph aria-hidden weight="fill" className="size-4 text-heading" />
      <dt className="text-sm text-text">{label}</dt>
      <dd className="min-w-0 text-sm [overflow-wrap:anywhere] text-heading">{children ?? '—'}</dd>
    </div>
  );
}

const dash = (value: string | null | undefined) => (value ? value : '—');
/** Quick Actions: two to a row; a long label wraps under 1600 px (the design's canvas is wider). */
const quickButton = 'justify-start gap-1.5 !px-2.5 py-1.5 text-left';

/** "Call – Sep 30, 2026 at 10:00 AM", red with "Overdue" once it has passed. */
function NextActionText({ lead }: { lead: LeadProfile }) {
  const next = lead.nextAction;
  if (!next) return <span className="text-muted">No follow-up scheduled</span>;
  const when = new Date(next.dueAt);
  const text = `${ACTIONS.find((a) => a.value === next.type)?.label ?? next.type} – ${dayText(next.dueAt)} at ${when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  return (
    <span className={next.overdue ? 'font-medium text-danger' : 'text-link'}>
      {next.overdue ? `Overdue: ${text}` : text}
    </span>
  );
}

/** A small figure card of the middle column: tile, label, value and a line under it. */
function Figure({
  icon: Glyph,
  tone,
  label,
  value,
  note,
  testId,
}: {
  icon: Icon;
  tone: keyof typeof tileTones;
  label: string;
  value: ReactNode;
  note: ReactNode;
  testId: string;
}) {
  return (
    <section
      // The icon beside the text from 1600 px, as in the design; above it on narrower screens.
      className="flex min-w-0 flex-col items-start gap-2 rounded-xl bg-surface p-3 shadow-md min-[1600px]:flex-row min-[1600px]:gap-2.5"
      data-testid={testId}
    >
      <span
        aria-hidden
        className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${tileTones[tone]}`}
      >
        <Glyph weight="fill" className="size-5" />
      </span>
      <div className="flex min-w-0 flex-col">
        <h2 className="text-sm text-text">{label}</h2>
        <p className="text-base font-bold whitespace-nowrap text-heading">{value}</p>
        <div className="text-sm text-text">{note}</div>
      </div>
    </section>
  );
}

/**
 * Lead Profile > Overview (individual-lead-profile-lead-workspace.jpg; Octavia's Leads review of
 * Oct 20, item 4): Contact Information and Lead Details, the three figures, Recent Activity and
 * Upcoming Appointments, Next Action / Follow-Up, Open Tasks and Quick Actions, all from
 * `api.leadPipeline.profile` (the frame's query). A lead from Begin Online also shows its request
 * with the review actions. Every card keeps its frame with a quiet line while the lead loads or
 * cannot be read.
 */
export function OverviewTab() {
  const { id, profile: lead, open } = useProfile();
  const [declining, setDeclining] = useState(false);
  const decline = useApiMutation(
    () => api.leadPipeline.update(id, { version: lead?.version, stage: 'DECLINED' }),
    { invalidate: LEAD_PIPELINE_KEY },
  );
  const base = `/leads/${id}`;
  const closed = lead?.stage === 'CONVERTED' || lead?.stage === 'DECLINED';
  const edit = (
    <button
      type="button"
      disabled={!lead}
      onClick={() => open('edit')}
      className={`${linkClass} disabled:opacity-50`}
    >
      Edit
    </button>
  );
  const quick: { label: string; icon: Icon; href?: string; run?: () => void; off?: boolean }[] = [
    { label: 'Send Intake Form', icon: FileText, href: '/intake-forms/send' },
    { label: 'Upload Document', icon: FileArrowUp, href: `${base}/documents` },
    { label: 'Add to Campaign', icon: PaperPlaneTilt, href: `${base}/campaigns` },
    { label: 'Change Status', icon: Tag, run: () => open('edit'), off: !lead },
    lead?.client
      ? { label: 'Open Client', icon: UserSwitch, href: `/clients/${lead.client.id}` }
      : { label: 'Convert to Client', icon: UserPlus, href: `${base}/convert` },
    {
      label: 'Mark Not Qualified',
      icon: XCircle,
      run: () => setDeclining(true),
      off: !lead || closed,
    },
  ];

  return (
    <div className="flex flex-col gap-4" data-testid="lead-overview">
      <div className="grid items-start gap-4 lg:grid-cols-2 min-[1440px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <CardFrame
            icon={IdentificationCard}
            title="Contact Information"
            action={edit}
            testId="card-contact"
          >
            <dl>
              <Line icon={UserCircle} label="Full Name">
                {lead ? `${lead.firstName} ${lead.lastName}`.trim() : null}
              </Line>
              <Line icon={Envelope} label="Email">
                {lead?.email}
              </Line>
              <Line icon={Phone} label="Phone">
                {dash(lead?.phone)}
              </Line>
              <Line icon={MapPin} label="Address">
                {dash(lead?.address)}
              </Line>
              <Line icon={ChatCircleText} label="Preferred Contact">
                {lead?.preferredContact.length
                  ? lead.preferredContact.map((c) => CONTACT[c]).join(', ')
                  : '—'}
              </Line>
              <Line icon={ClockCountdown} label="Best Time to Contact">
                {dash(lead?.bestTimeToContact)}
              </Line>
              <Line icon={Cake} label="Date of Birth">
                {lead?.dateOfBirth ? dayText(`${lead.dateOfBirth}T12:00:00Z`) : '—'}
              </Line>
              <Line icon={NotePencil} label="Notes">
                <Link href={`${base}/notes`} className="text-link">
                  Open Notes
                </Link>
              </Line>
            </dl>
          </CardFrame>

          <div id="lead-details" className="scroll-mt-4">
            <CardFrame
              icon={FileText}
              title="Lead Details"
              action={edit}
              testId="card-lead-details"
            >
              <dl>
                <Line icon={TreeStructure} label="Lead Source">
                  {lead ? SOURCE_LABELS[lead.source] : null}
                  {lead?.sourceDetail ? (
                    <span className="text-muted"> · {lead.sourceDetail}</span>
                  ) : null}
                </Line>
                <Line icon={Megaphone} label="Campaign">
                  {dash(lead?.campaign?.name)}
                </Line>
                <Line icon={Lightning} label="Lead Status">
                  {lead ? (
                    <Badge tone={stageTone(lead.stage)}>{STAGE_LABELS[lead.stage]}</Badge>
                  ) : null}
                </Line>
                <Line icon={Fire} label="Priority">
                  {lead ? (
                    <Badge tone={priorityTone(lead.priority)} icon={Fire}>
                      {PRIORITY_LABELS[lead.priority]}
                    </Badge>
                  ) : null}
                </Line>
                <Line icon={ListChecks} label="Services Interested In">
                  {lead?.services.length ? (
                    <span className="flex flex-wrap gap-1.5">
                      {lead.services.map((s) => (
                        <span
                          key={s.id}
                          className="rounded-md bg-info-soft px-2 py-0.5 text-action"
                        >
                          {s.name}
                        </span>
                      ))}
                    </span>
                  ) : (
                    '—'
                  )}
                </Line>
                <Line icon={UserCircle} label="Assigned To">
                  <span className="flex flex-wrap items-center gap-2">
                    {lead?.assignedTo ? (
                      <>
                        <Avatar name={lead.assignedTo.name} size="sm" />
                        {shortName(lead.assignedTo.name)}
                      </>
                    ) : (
                      <span className="text-muted">{lead ? 'Unassigned' : '—'}</span>
                    )}
                    <button
                      type="button"
                      disabled={!lead}
                      onClick={() => open('edit')}
                      className={`${linkClass} disabled:opacity-50`}
                    >
                      Change
                    </button>
                  </span>
                </Line>
                <Line icon={CalendarBlank} label="Date Added">
                  {lead ? dayText(lead.createdAt) : null}
                </Line>
                <Line icon={Phone} label="Last Contact">
                  {lead?.lastContact ? stamp(lead.lastContact.at) : lead ? 'No contact yet' : '—'}
                </Line>
                <Line icon={PaperPlaneTilt} label="Next Action">
                  {lead ? <NextActionText lead={lead} /> : null}
                </Line>
                <Line icon={Tag} label="Tags">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {lead?.tags.map((t) => (
                      <Badge key={t} tone="neutral">
                        {t}
                      </Badge>
                    ))}
                    <button
                      type="button"
                      disabled={!lead}
                      onClick={() => open('edit')}
                      className="inline-flex items-center gap-1 rounded-md border border-action px-2 py-0.5 text-action disabled:opacity-50"
                    >
                      <Plus aria-hidden weight="bold" className="size-3" /> Add Tag
                    </button>
                  </span>
                </Line>
              </dl>
            </CardFrame>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Figure
              icon={CalendarBlank}
              tone="blue"
              label="Next Follow-Up"
              testId="figure-next-follow-up"
              value={lead?.nextAction ? dayText(lead.nextAction.dueAt) : '—'}
              note={
                lead?.nextAction ? (
                  <span className={lead.nextAction.overdue ? 'text-danger' : undefined}>
                    {new Date(lead.nextAction.dueAt).toLocaleTimeString('en-US', {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}{' '}
                    · {ACTIONS.find((a) => a.value === lead.nextAction?.type)?.label}
                    {lead.nextAction.overdue ? ' · Overdue' : ''}
                  </span>
                ) : (
                  'None scheduled'
                )
              }
            />
            <Figure
              icon={Target}
              tone="red"
              label="Lead Score"
              testId="figure-lead-score"
              value={lead?.score ? lead.score.value : '—'}
              note={lead?.score ? lead.score.label : 'Not scored yet'}
            />
            <Figure
              icon={FileText}
              tone="amber"
              label="Interested In"
              testId="figure-interested-in"
              value={
                lead
                  ? `${lead.services.length} ${lead.services.length === 1 ? 'Service' : 'Services'}`
                  : '—'
              }
              note={
                <a href="#lead-details" className="text-link">
                  View Details
                </a>
              }
            />
          </div>
          <CardFrame
            icon={Lightning}
            title="Recent Activity"
            testId="card-recent-activity"
            action={
              <Link href={`${base}/activity`} className={linkClass}>
                View All
              </Link>
            }
          >
            <ActivityTimeline
              kind="all"
              limit={5}
              label="Recent activity"
              emptyText="No activity yet."
            />
          </CardFrame>
          <UpcomingAppointmentsCard />
        </div>

        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2 min-[1440px]:col-span-1">
          <FollowUpCard key={lead ? lead.version : 'none'} lead={lead} />
          <OpenTasksCard />
          <CardFrame icon={Lightning} title="Quick Actions" testId="card-quick-actions">
            <div className="grid grid-cols-2 gap-2">
              {quick.map(({ label, icon: Glyph, href, run, off }) =>
                href ? (
                  <Link key={label} href={href} className={`${outlineButton} ${quickButton}`}>
                    <Glyph aria-hidden weight="fill" className="size-4 shrink-0" /> {label}
                  </Link>
                ) : (
                  <button
                    key={label}
                    type="button"
                    disabled={off}
                    onClick={run}
                    className={`${outlineButton} ${quickButton} disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    <Glyph aria-hidden weight="fill" className="size-4 shrink-0" /> {label}
                  </button>
                ),
              )}
            </div>
          </CardFrame>
        </div>
      </div>

      {lead?.beginOnline ? <BeginOnlineRequest id={id} /> : null}

      {declining && lead ? (
        <Modal open title="Mark Not Qualified?" onClose={() => setDeclining(false)}>
          <div className="flex flex-col gap-4" data-testid="mark-not-qualified">
            <p className="text-sm text-text">
              {lead.firstName} {lead.lastName} moves to Not Qualified. The lead and its history
              stay, and you can change the status again later.
            </p>
            {decline.error ? (
              <p role="alert" className="text-sm text-danger">
                {errorMessage(decline.error, {
                  SAVE_CONFLICT: 'Someone changed this lead meanwhile. Close this and try again.',
                })}
              </p>
            ) : null}
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setDeclining(false)}>
                Cancel
              </Button>
              <Button
                disabled={decline.isPending}
                onClick={() => decline.mutate(undefined, { onSuccess: () => setDeclining(false) })}
              >
                Mark Not Qualified
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
