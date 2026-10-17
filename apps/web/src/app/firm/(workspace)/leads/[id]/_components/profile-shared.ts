import type { LeadActivity, LeadActivityKind } from '@firmivra/types';
import type { TileTone } from '@firmivra/ui';
import {
  CalendarCheck,
  CheckCircle,
  Envelope,
  ChatCircleText,
  FacebookLogo,
  FileText,
  Flag,
  type Icon,
  NotePencil,
  PhoneCall,
  Repeat,
  Tag,
  UserCircle,
  UsersThree,
  Lightning,
  ArrowsClockwise,
} from '@phosphor-icons/react';
import { LEAD_PIPELINE_KEY } from '../../_components/lead-shared';

/** Every query of the Lead Profile tabs: under the leads page's root, so its changes refresh them. */
export const PROFILE_KEY = [...LEAD_PIPELINE_KEY, 'profile-ws'] as const;
export const profileKey = (id: string) => [...PROFILE_KEY, id, 'profile'];
export const wsKey = (id: string, part: string, ...rest: unknown[]) => [
  ...PROFILE_KEY,
  id,
  part,
  ...rest,
];

/** The icon and tile colour of one activity row (Recent Activity / Activity / Communications). */
export const KIND: Record<LeadActivityKind, { icon: Icon; tone: TileTone; label: string }> = {
  CREATED: { icon: FacebookLogo, tone: 'blue', label: 'Lead created' },
  STATUS_CHANGED: { icon: ArrowsClockwise, tone: 'blue', label: 'Status changed' },
  FORM_SUBMITTED: { icon: FileText, tone: 'amber', label: 'Form submitted' },
  EMAIL_SENT: { icon: Envelope, tone: 'blue', label: 'Email' },
  SMS_SENT: { icon: ChatCircleText, tone: 'green', label: 'SMS' },
  CALL: { icon: PhoneCall, tone: 'green', label: 'Call' },
  MEETING: { icon: UsersThree, tone: 'purple', label: 'Meeting' },
  NOTE: { icon: NotePencil, tone: 'amber', label: 'Note' },
  FOLLOW_UP: { icon: Repeat, tone: 'blue', label: 'Follow-up' },
  FOLLOW_UP_COMPLETED: { icon: CheckCircle, tone: 'green', label: 'Follow-up done' },
  APPOINTMENT_SCHEDULED: { icon: CalendarCheck, tone: 'purple', label: 'Appointment' },
  TAG_ADDED: { icon: Tag, tone: 'amber', label: 'Tag added' },
  ASSIGNED: { icon: UserCircle, tone: 'blue', label: 'Assigned' },
  CONVERTED: { icon: Flag, tone: 'green', label: 'Converted' },
  // The database has more kinds than the screens name; any other reads as a generic event.
} as Record<LeadActivityKind, { icon: Icon; tone: TileTone; label: string }>;

export const kindOf = (kind: LeadActivity['kind']) =>
  KIND[kind] ?? { icon: Lightning, tone: 'grey' as TileTone, label: 'Activity' };

/** "Sep 18, 2026, 10:24 AM". */
export const stamp = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export const dayText = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** "K. Allen" from "Kim Allen". */
export const shortName = (name: string) => {
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.length < 2 ? name : `${parts[0]?.[0]}. ${parts.slice(1).join(' ')}`;
};

export const TABS = [
  { id: 'overview', label: 'Overview', path: '' },
  { id: 'communications', label: 'Communications', path: '/communications' },
  { id: 'appointments', label: 'Appointments', path: '/appointments' },
  { id: 'tasks', label: 'Tasks', path: '/tasks' },
  { id: 'documents', label: 'Documents & Forms', path: '/documents' },
  { id: 'campaigns', label: 'Campaigns', path: '/campaigns' },
  { id: 'notes', label: 'Notes', path: '/notes' },
  { id: 'activity', label: 'Activity', path: '/activity' },
  { id: 'convert', label: 'Convert to Client', path: '/convert' },
] as const;
export type LeadTab = (typeof TABS)[number]['id'];
