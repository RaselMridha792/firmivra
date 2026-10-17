'use client';

import type { LeadProfile, LeadSource } from '@firmivra/types';
import { ActionMenu, Avatar, Badge } from '@firmivra/ui';
import {
  ArrowLeft,
  CalendarPlus,
  ChatCircleText,
  DoorOpen,
  Envelope,
  FacebookLogo,
  Fire,
  GlobeSimple,
  GoogleLogo,
  Handshake,
  InstagramLogo,
  NotePencil,
  PencilSimple,
  PhoneCall,
  Plus,
  Ticket,
  UserSwitch,
  Lightning,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { createContext, type ReactNode, use, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { LeadAppointmentDialog } from '../../_components/lead-appointment-dialog';
import { LeadEditDialog } from '../../_components/lead-edit-dialog';
import { LeadMessageDialog } from '../../_components/lead-message-dialog';
import {
  LEAD_PIPELINE_KEY,
  PRIORITY_LABELS,
  SOURCE_LABELS,
  STAGE_LABELS,
  fullName,
  priorityTone,
  stageTone,
} from '../../_components/lead-shared';
import { type LeadTab, TABS, dayText, profileKey, shortName, stamp } from './profile-shared';

export type ProfileDialog = 'email' | 'sms' | 'appointment' | 'edit';

interface ProfileValue {
  id: string;
  /** The lead's profile; undefined while loading, missing or when the API is unreachable. */
  profile: LeadProfile | undefined;
  open: (dialog: ProfileDialog) => void;
}
const ProfileContext = createContext<ProfileValue | null>(null);

/** The lead of the open page and the dialogs the header opens (Email, SMS, Appointment, Edit). */
export function useProfile(): ProfileValue {
  const value = use(ProfileContext);
  if (!value) throw new Error('useProfile() works only inside <ProfileFrame>');
  return value;
}

const SOURCE_ICON: Record<LeadSource, Icon> = {
  BEGIN_ONLINE: GlobeSimple,
  WEBSITE_FORM: GlobeSimple,
  FACEBOOK_AD: FacebookLogo,
  INSTAGRAM: InstagramLogo,
  GOOGLE_AD: GoogleLogo,
  REFERRAL: Handshake,
  PHONE_CALL: PhoneCall,
  WALK_IN: DoorOpen,
  EMAIL: Envelope,
  EVENT: Ticket,
  OTHER: Lightning,
};

const outline =
  'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-control border border-action bg-surface px-2.5 text-sm font-medium text-action hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50';

/**
 * The top of every Lead Profile tab: breadcrumb, name and facts, the five actions, Interested In,
 * and the tab bar. Each tab fills the body below it. A lead that is missing or not reachable keeps
 * the same frame with quiet placeholders.
 */
export function ProfileFrame({ tab, children }: { tab: LeadTab; children: ReactNode }) {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [dialog, setDialog] = useState<ProfileDialog | null>(null);
  const query = useApiQuery(profileKey(id), () => api.leadPipeline.profile(id));
  const lead = query.data;
  const logCall = useApiMutation(
    () => api.leadPipeline.logActivity(id, { kind: 'CALL', summary: 'Called the lead' }),
    { invalidate: LEAD_PIPELINE_KEY },
  );
  const name = lead ? fullName(lead.firstName, lead.lastName, 'Lead') : 'Lead';
  const base = `/leads/${id}`;
  const sourceIcon = lead ? SOURCE_ICON[lead.source] : GlobeSimple;
  const SourceGlyph = sourceIcon;

  return (
    <ProfileContext.Provider value={{ id, profile: lead, open: setDialog }}>
      <div className="flex flex-col gap-4" data-testid={`lead-tab-${tab}`}>
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
          <Link href="/leads" className="text-link">
            Leads
          </Link>
          <span aria-hidden className="text-muted">
            ›
          </span>
          <span className="font-semibold text-heading">{name}</span>
        </nav>
        <div className="flex flex-wrap items-start justify-between gap-4 xl:flex-nowrap">
          <div className="flex min-w-0 flex-col gap-3 xl:flex-1">
            <Link
              href="/leads"
              className="inline-flex min-h-9 w-fit items-center gap-2 rounded-control border border-action bg-surface px-3 text-sm font-medium text-action hover:bg-accent-soft"
            >
              <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Leads
            </Link>
            <div className="flex items-center gap-4">
              <Avatar name={name} size="xl" />
              <div className="flex min-w-0 flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <h1
                    data-testid="lead-name"
                    className="font-display text-3xl font-bold text-heading"
                  >
                    {name}
                  </h1>
                  <button
                    type="button"
                    aria-label="Edit lead"
                    disabled={!lead}
                    onClick={() => setDialog('edit')}
                    className="flex size-8 items-center justify-center rounded-md bg-info-soft text-action disabled:opacity-50"
                  >
                    <PencilSimple aria-hidden weight="fill" className="size-4" />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text">
                  <span>Lead ID: {lead?.number ?? '—'}</span>
                  {lead ? (
                    <>
                      <Badge tone={priorityTone(lead.priority)} icon={Fire}>
                        {PRIORITY_LABELS[lead.priority]}
                      </Badge>
                      <Badge tone={stageTone(lead.stage)}>{STAGE_LABELS[lead.stage]}</Badge>
                    </>
                  ) : null}
                  <span className="flex items-center gap-2">
                    Source:{' '}
                    <span className="font-medium text-link">
                      {lead ? SOURCE_LABELS[lead.source] : '—'}
                    </span>
                    <SourceGlyph aria-hidden weight="fill" className="size-5 text-action" />
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                  <span>Added: {lead ? dayText(lead.createdAt) : '—'}</span>
                  <span aria-hidden>|</span>
                  <span>Last Contact: {lead?.lastContact ? stamp(lead.lastContact.at) : '—'}</span>
                  <span aria-hidden>|</span>
                  <span className="flex items-center gap-2">
                    Assigned To:
                    {lead?.assignedTo ? (
                      <span className="flex items-center gap-2 text-heading">
                        <Avatar name={lead.assignedTo.name} size="sm" />
                        {shortName(lead.assignedTo.name)}
                      </span>
                    ) : (
                      <span>—</span>
                    )}
                    <button
                      type="button"
                      aria-label="Change assigned staff"
                      disabled={!lead}
                      onClick={() => setDialog('edit')}
                      className="flex size-7 items-center justify-center rounded-md bg-info-soft text-action disabled:opacity-50"
                    >
                      <UserSwitch aria-hidden weight="fill" className="size-4" />
                    </button>
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex min-w-0 flex-col items-end gap-3 xl:shrink-0">
            <div
              className="flex flex-wrap items-center justify-end gap-1.5"
              role="group"
              aria-label="Lead actions"
            >
              {lead?.phone ? (
                <a
                  href={`tel:${lead.phone}`}
                  onClick={() => logCall.mutate(undefined)}
                  className={outline}
                >
                  <PhoneCall aria-hidden weight="fill" className="size-4" /> Call
                </a>
              ) : (
                <button type="button" disabled className={outline}>
                  <PhoneCall aria-hidden weight="fill" className="size-4" /> Call
                </button>
              )}
              <button
                type="button"
                disabled={!lead}
                onClick={() => setDialog('email')}
                className={outline}
              >
                <Envelope aria-hidden weight="fill" className="size-4" /> Email
              </button>
              <button
                type="button"
                disabled={!lead?.phone}
                onClick={() => setDialog('sms')}
                className={outline}
              >
                <ChatCircleText aria-hidden weight="fill" className="size-4" /> SMS
              </button>
              <button
                type="button"
                disabled={!lead}
                onClick={() => setDialog('appointment')}
                className={outline}
              >
                <CalendarPlus aria-hidden weight="fill" className="size-4" /> Schedule Appointment
              </button>
              <ActionMenu
                label="More Actions"
                trigger={<span>More Actions</span>}
                sections={[
                  {
                    items: [
                      { label: 'Edit Lead', icon: PencilSimple, onSelect: () => setDialog('edit') },
                      {
                        label: 'Add / View Notes',
                        icon: NotePencil,
                        onSelect: () => router.push(`${base}/notes`),
                      },
                      {
                        label: 'Log Activity',
                        icon: Lightning,
                        onSelect: () => router.push(`${base}/activity`),
                      },
                      {
                        label: 'Convert to Client',
                        icon: UserSwitch,
                        onSelect: () => router.push(`${base}/convert`),
                      },
                    ],
                  },
                ]}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-info-soft px-4 py-3">
              <span className="text-sm font-bold text-heading">Interested In:</span>
              {lead?.services.length ? (
                lead.services.map((s) => (
                  <span key={s.id} className="rounded-md bg-surface px-3 py-1 text-sm text-action">
                    {s.name}
                  </span>
                ))
              ) : (
                <span className="text-sm text-muted">No service chosen yet</span>
              )}
              <button
                type="button"
                disabled={!lead}
                onClick={() => setDialog('edit')}
                className="inline-flex items-center gap-1 rounded-md bg-surface px-3 py-1 text-sm text-action disabled:opacity-50"
              >
                <Plus aria-hidden weight="bold" className="size-3" /> Add Service
              </button>
            </div>
          </div>
        </div>
        {query.isError ? (
          <p
            role="status"
            data-testid="lead-state"
            className="rounded-xl bg-surface px-4 py-3 text-sm text-muted shadow-md"
          >
            {errorMessage(query.error)}
          </p>
        ) : null}
        <nav
          aria-label="Lead profile"
          className="flex overflow-x-auto border-b border-divider bg-surface px-2"
        >
          {TABS.map((item) => (
            <Link
              key={item.id}
              href={`${base}${item.path}`}
              aria-current={item.id === tab ? 'page' : undefined}
              className={`-mb-px shrink-0 border-b-2 px-4 py-3 text-sm font-medium whitespace-nowrap ${item.id === tab ? 'border-action text-action' : 'border-transparent text-heading hover:text-action'}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {children}
      </div>
      <LeadMessageDialog
        open={dialog === 'email'}
        ids={[id]}
        channel="EMAIL"
        onClose={() => setDialog(null)}
      />
      <LeadMessageDialog
        open={dialog === 'sms'}
        ids={[id]}
        channel="SMS"
        onClose={() => setDialog(null)}
      />
      {dialog === 'appointment' && lead ? (
        <LeadAppointmentDialog lead={lead} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'edit' && lead ? (
        <LeadEditDialog lead={lead} onClose={() => setDialog(null)} />
      ) : null}
    </ProfileContext.Provider>
  );
}
