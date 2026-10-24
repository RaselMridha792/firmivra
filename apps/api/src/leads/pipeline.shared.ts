import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Prisma, TxClient } from '@firmivra/db';
import {
  LEAD_STATUS_LABELS,
  type LeadActivity,
  type LeadPipelineStatus,
  type LeadProfile,
  type LeadRow,
  type LeadSource,
  roleCan,
  type PermissionCapability,
} from '@firmivra/types';
import { legacyFirmRole, type TenantRole } from '../common/request-context.js';
import { notFound } from './leads.service.js';

/** The member acting: Staff reach only the leads assigned to them (Owner and Admin: all). */
export interface PipelineActor {
  userId: string;
  role: Exclude<TenantRole, 'CLIENT'>;
}

/** The pipeline's statuses: everything but a Begin Online draft and an expired one. */
export const PIPELINE_STATUSES: LeadPipelineStatus[] = [
  'SUBMITTED',
  'IN_REVIEW',
  'CONTACTED',
  'IN_FOLLOW_UP',
  'APPOINTMENT_SCHEDULED',
  'QUALIFIED',
  'CONVERTED',
  'DECLINED',
  'LOST',
];

/** A closed lead has no follow-up (leads_r37_rules). */
export const CLOSED_STATUSES: LeadPipelineStatus[] = ['CONVERTED', 'DECLINED', 'LOST'];

export const SOURCE_LABELS: Record<LeadSource, string> = {
  BEGIN_ONLINE: 'Begin Online',
  WEBSITE_FORM: 'Website Form',
  FACEBOOK_AD: 'Facebook Ad',
  INSTAGRAM: 'Instagram',
  GOOGLE_AD: 'Google Ad',
  REFERRAL: 'Referral',
  PHONE_CALL: 'Phone Call',
  WALK_IN: 'Walk-In',
  EMAIL: 'Email',
  EVENT: 'Event',
  OTHER: 'Other',
};

/** Last contact is the newest of these activity rows. */
export const CONTACT_KINDS = [
  'EMAIL_SENT',
  'SMS_SENT',
  'CALL',
  'MEETING',
  'APPOINTMENT_SCHEDULED',
] as const;

const CONTACT_CHANNEL = {
  EMAIL_SENT: 'EMAIL',
  SMS_SENT: 'SMS',
  CALL: 'CALL',
  MEETING: 'APPOINTMENT',
  APPOINTMENT_SCHEDULED: 'APPOINTMENT',
} as const;

const CONTACT_FROM_DB = { EMAIL: 'EMAIL', PHONE: 'PHONE', TEXT: 'SMS' } as const;
export const CONTACT_TO_DB = { EMAIL: 'EMAIL', PHONE: 'PHONE', SMS: 'TEXT' } as const;

export const visibleLead = (businessId: string): Prisma.LeadWhereInput => ({
  businessId,
  status: { in: PIPELINE_STATUSES },
});

/** Staff reach their own leads; every other role the whole firm's (the grid decides the actions). */
export function reach(actor: PipelineActor): Prisma.LeadWhereInput {
  return legacyFirmRole(actor.role) === 'STAFF' ? { assignedUserId: actor.userId } : {};
}

/** 403 unless the member's grid gives the capability (bulk assign/stage, campaigns, archive). */
export function requireCapability(actor: PipelineActor, capability: PermissionCapability): void {
  if (!roleCan(actor.role, 'LEADS', capability)) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You do not have access to this action',
    });
  }
}

/**
 * Delete (the archive) and Restore: Firm Admin only, the Owner and the Admin, over and above the
 * grid (L11 of Octavia's Leads review; Rasel, Oct 24). 403 for everyone else.
 */
export function requireFirmAdmin(actor: PipelineActor): void {
  if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'Only an Owner or Admin can delete or restore leads',
    });
  }
}

export const invalid = (message: string, code = 'VALIDATION_FAILED') =>
  new BadRequestException({ code, message });

export const rowSelect = {
  id: true,
  number: true,
  firstName: true,
  lastName: true,
  businessName: true,
  email: true,
  phone: true,
  source: true,
  sourceDetail: true,
  priority: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
  nextActionType: true,
  nextActionAt: true,
  nextActionNote: true,
  preferredContactMethods: true,
  service: { select: { id: true, name: true } },
  services: {
    orderBy: { createdAt: 'asc' },
    select: { service: { select: { id: true, name: true } } },
  },
  tags: { orderBy: { tag: { name: 'asc' } }, select: { tag: { select: { name: true } } } },
  assignedMember: { select: { userId: true, user: { select: { name: true } } } },
  activities: {
    where: { kind: { in: [...CONTACT_KINDS] } },
    orderBy: { occurredAt: 'desc' },
    take: 1,
    select: { kind: true, occurredAt: true },
  },
} satisfies Prisma.LeadSelect;
export type RowData = Prisma.LeadGetPayload<{ select: typeof rowSelect }>;

export function toRow(r: RowData, now = new Date()): LeadRow {
  const last = r.activities[0];
  const due = r.nextActionAt;
  return {
    id: r.id,
    number: `LD-${r.number}`,
    firstName: r.firstName,
    lastName: r.lastName,
    businessName: r.businessName,
    email: r.email,
    phone: r.phone,
    source: r.source,
    sourceDetail: r.sourceDetail,
    // No campaign link on leads yet (see the PR's gaps).
    campaign: null,
    // The services chosen for the lead; a Begin Online lead has only its own service.
    services: r.services.length ? r.services.map((s) => s.service) : [r.service],
    // Begin Online leads have no priority; the pipeline shows them as Warm, the default for a new lead.
    priority: r.priority ?? 'WARM',
    stage: r.status as LeadPipelineStatus,
    lastContact: last
      ? {
          at: last.occurredAt.toISOString(),
          channel: CONTACT_CHANNEL[last.kind as (typeof CONTACT_KINDS)[number]],
        }
      : null,
    nextAction:
      r.nextActionType && due
        ? {
            type: r.nextActionType,
            dueAt: due.toISOString(),
            notes: r.nextActionNote,
            overdue: r.nextActionType !== 'CLOSE_LEAD' && due.getTime() < now.getTime(),
          }
        : null,
    assignedTo: r.assignedMember
      ? { userId: r.assignedMember.userId, name: r.assignedMember.user.name }
      : null,
    preferredContact: r.preferredContactMethods.map((m) => CONTACT_FROM_DB[m]),
    tags: r.tags.map((t) => t.tag.name),
    createdAt: r.createdAt.toISOString(),
  };
}

export const activitySelect = {
  id: true,
  kind: true,
  occurredAt: true,
  summary: true,
  status: true,
  metadata: true,
  actor: { select: { userId: true, user: { select: { name: true } } } },
} satisfies Prisma.LeadActivitySelect;
type ActivityData = Prisma.LeadActivityGetPayload<{ select: typeof activitySelect }>;

const ACTIVITY_LABELS: Partial<Record<ActivityData['kind'], string>> = {
  EMAIL_SENT: 'Email sent',
  SMS_SENT: 'Text message sent',
  CALL: 'Call',
  MEETING: 'Meeting',
  NOTE: 'Note added',
  FOLLOW_UP: 'Follow-up set',
  FOLLOW_UP_COMPLETED: 'Follow-up completed',
  APPOINTMENT_SCHEDULED: 'Appointment scheduled',
  TAG_ADDED: 'Tag added',
  FORM_SUBMITTED: 'Intake form submitted',
  CONVERTED: 'Converted to client',
  DOCUMENT: 'Document uploaded',
  CAMPAIGN: 'Added to a campaign',
};

/** "Lead created from Facebook Ad", "Email sent: Welcome". A note's text is never in the label. */
export function activityLabel(a: ActivityData, source: LeadSource): string {
  if (a.kind === 'CREATED') return `Lead created from ${SOURCE_LABELS[source]}`;
  if (a.kind === 'STATUS_CHANGED') {
    return `Status changed to ${a.status ? LEAD_STATUS_LABELS[a.status as LeadPipelineStatus] : 'a new status'}`;
  }
  if (a.kind === 'ASSIGNED') {
    return (a.metadata as { assigned?: boolean }).assigned ? 'Lead assigned' : 'Lead unassigned';
  }
  const base = ACTIVITY_LABELS[a.kind] ?? 'Activity';
  return a.summary && a.kind !== 'NOTE' ? `${base}: ${a.summary}` : base;
}

export function toActivity(a: ActivityData, source: LeadSource): LeadActivity {
  return {
    id: a.id,
    at: a.occurredAt.toISOString(),
    kind: a.kind,
    label: activityLabel(a, source),
    by: a.actor ? { userId: a.actor.userId, name: a.actor.user.name } : null,
  };
}

const profileSelect = {
  ...rowSelect,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  bestTimeToContact: true,
  engagement: { select: { client: { select: { id: true, displayName: true } } } },
  _count: { select: { intakes: true } },
} satisfies Prisma.LeadSelect;

/** One lead the member reaches, as the Lead Profile; 404 for anyone else's, a draft or an archived lead. */
export async function loadProfile(
  tx: TxClient,
  businessId: string,
  actor: PipelineActor,
  id: string,
  { archived = false, unrestricted = false } = {},
): Promise<LeadProfile> {
  const r = await tx.lead.findFirst({
    where: {
      AND: [
        visibleLead(businessId),
        unrestricted ? {} : reach(actor),
        { id },
        archived ? {} : { archivedAt: null },
      ],
    },
    select: profileSelect,
  });
  if (!r) throw notFound();
  const recent = await tx.leadActivity.findMany({
    where: { businessId, leadId: id },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: 10,
    select: activitySelect,
  });
  const address = [
    r.addressLine1,
    r.addressLine2,
    [r.city, r.state, r.postalCode].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ');
  return {
    ...toRow(r),
    address: address || null,
    // No date of birth column on leads (see the PR's gaps).
    dateOfBirth: null,
    bestTimeToContact: r.bestTimeToContact,
    recentActivity: recent.map((a) => toActivity(a, r.source)),
    // Tasks and appointments have no lead link yet (see the PR's gaps).
    upcomingAppointments: [],
    openTasks: [],
    client: r.engagement
      ? { id: r.engagement.client.id, name: r.engagement.client.displayName }
      : null,
    beginOnline: r._count.intakes > 0,
    archivedAt: r.archivedAt?.toISOString() ?? null,
    version: r.updatedAt.toISOString(),
  };
}

/** The lead held for this transaction, if the member reaches it: 404 otherwise. */
export async function lockLead(tx: TxClient, businessId: string, actor: PipelineActor, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM leads WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid
      AND status::text NOT IN ('DRAFT', 'EXPIRED') FOR UPDATE`;
  if (!rows[0]) throw notFound();
  const lead = await tx.lead.findFirst({
    where: { AND: [visibleLead(businessId), reach(actor), { id }] },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      serviceId: true,
      taxYear: true,
      sourceDetail: true,
      status: true,
      source: true,
      updatedAt: true,
      archivedAt: true,
      assignedUserId: true,
      declineReason: true,
      nextActionType: true,
    },
  });
  if (!lead) throw notFound();
  return lead;
}

/** An active member of the firm (404 for anyone else: another firm's, invited or deactivated). */
export async function requireActiveMember(tx: TxClient, businessId: string, userId: string) {
  const m = await tx.membership.findFirst({
    where: { businessId, userId, status: 'ACTIVE' },
    select: { userId: true },
  });
  if (!m) throw notFound();
}

/** A phone number in E.164 for a text, or null when it cannot be one (US numbers may omit +1). */
export function toE164(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (phone.trim().startsWith('+'))
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}
