import {
  ApiRequestError,
  type AudienceCandidate,
  AudienceCandidatesQuery,
  type AudienceSummary,
  CommunicationActivityQuery,
  type CommunicationActivity,
  type CommunicationDetail,
  type CommunicationRecipient,
  CommunicationRecipientsQuery,
  type CommunicationResults,
  type CommunicationReview,
  type CommunicationRow,
  CommunicationsQuery,
  type CommunicationsClient,
  ConfirmUploadRequest,
  ConsentQuery,
  CreateCommunicationRequest,
  CreateSegmentRequest,
  ExportCommunicationRequest,
  FollowUpRequest,
  type MemberRef,
  parseInput,
  PreviewCommunicationRequest,
  PreviewSegmentRequest,
  RescheduleCommunicationRequest,
  SaveAsTemplateRequest,
  ScheduleCommunicationRequest,
  SegmentMembersQuery,
  SegmentsQuery,
  type SegmentDetail,
  type SendCheck,
  SelectAllAudienceRequest,
  SendCommunicationRequest,
  SetAudienceRequest,
  SetConsentRequest,
  SetSegmentMembersRequest,
  StartCommunicationAttachmentRequest,
  TestSendCommunicationRequest,
  UpdateCommunicationRequest,
  UpdateSegmentRequest,
  UseTemplateRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { mockMe } from './appointments';

/**
 * Mock data for `api.communications` (R55 contract, Communications). Synthetic contacts and
 * campaigns only, dated around today. It checks input with the contract's schemas and answers its
 * codes: CHANNEL_UNAVAILABLE, SAVE_CONFLICT, NOT_EDITABLE, LOCKED, NOT_READY, AUDIENCE_CHANGED,
 * CONTENT_WOULD_BE_LOST, TEMPLATE_NOT_ALLOWED, TEST_SEND_REFUSED, INVALID_CRITERIA, DUPLICATE_NAME,
 * SEGMENT_IN_USE, SCHEDULE_IN_PAST, NO_ELIGIBLE_RECIPIENTS, STILL_SENDING. Nothing is ever sent:
 * a "sent" campaign gets its recipients and results made up from the audience. `empty: true`
 * (NEXT_PUBLIC_API_MOCK_EMPTY=communications) starts with no campaigns or segments.
 */
type MockRole = 'OWNER' | 'ADMIN' | 'STAFF';
interface Options {
  role?: MockRole;
  empty?: boolean;
}
const DAY = 86_400_000;
const uuid = (block: string, n: number) =>
  `0199c0f0-${block}-7000-8000-${String(n).padStart(12, '0')}`;
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const copy = <T>(value: T): T => structuredClone(value);
const nowIso = () => new Date().toISOString();
const ago = (days: number, hour = 10) => {
  const d = new Date(Date.now() - days * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};
const ahead = (days: number, hour = 10) => ago(-days, hour);
const KEVIN: MemberRef = { userId: '0199c0f0-0b00-7000-8000-000000000001', name: 'Kevin Martin' };

const FIRST = [
  'Sarah',
  'James',
  'Tanya',
  'Michael',
  'Priya',
  'Luis',
  'Chen',
  'Hannah',
  'Omar',
  'Grace',
  'Noah',
  'Sofia',
  'Ethan',
  'Maya',
  'Liam',
  'Zoe',
  'Isaac',
  'Nina',
  'Owen',
  'Ruby',
];
const LAST = [
  'Mitchell',
  'Brown',
  'Keller',
  'Carter',
  'Patel',
  'Garcia',
  'Nguyen',
  'Brown',
  'Khan',
  'Moore',
  'Clark',
  'Lopez',
  'Young',
  'King',
  'Wright',
  'Scott',
  'Adams',
  'Baker',
  'Hill',
  'Reed',
];
interface Contact {
  kind: 'CLIENT' | 'LEAD';
  id: string;
  name: string;
  email: string;
  index: number;
  unsubscribed: boolean;
  invalid: boolean;
  noPhone: boolean;
}
const SEG_DEFS: [
  string,
  string,
  (c: Contact) => boolean,
  'DYNAMIC' | 'STATIC',
  'CLIENTS' | 'LEADS',
][] = [
  ['All Clients', 'Every active client', (c) => c.kind === 'CLIENT', 'DYNAMIC', 'CLIENTS'],
  [
    'Tax Preparation Clients',
    'Individual and business tax clients',
    (c) => c.kind === 'CLIENT' && c.index % 3 === 0,
    'DYNAMIC',
    'CLIENTS',
  ],
  [
    'Bookkeeping Clients',
    'Active bookkeeping engagements',
    (c) => c.kind === 'CLIENT' && c.index % 5 === 1,
    'DYNAMIC',
    'CLIENTS',
  ],
  [
    'Payroll Clients',
    'Active payroll clients',
    (c) => c.kind === 'CLIENT' && c.index % 9 === 2,
    'DYNAMIC',
    'CLIENTS',
  ],
  [
    'Clients with Open Returns',
    'Returns currently in progress',
    (c) => c.kind === 'CLIENT' && c.index % 4 === 3,
    'DYNAMIC',
    'CLIENTS',
  ],
  [
    'Appointment Clients',
    'Clients with upcoming appointments',
    (c) => c.kind === 'CLIENT' && c.index % 7 === 4,
    'DYNAMIC',
    'CLIENTS',
  ],
  [
    'Small Business Clients',
    'Business service clients',
    (c) => c.kind === 'CLIENT' && c.index % 3 === 1,
    'DYNAMIC',
    'CLIENTS',
  ],
  ['New Leads', 'Leads not yet converted', (c) => c.kind === 'LEAD', 'DYNAMIC', 'LEADS'],
  [
    'VIP Newsletter List',
    'A hand-picked list',
    (c) => c.kind === 'CLIENT' && c.index % 11 === 0,
    'STATIC',
    'CLIENTS',
  ],
];

const FIELDS = [
  {
    field: 'clientType',
    label: 'Client Type',
    type: 'STATUS' as const,
    audience: 'CLIENTS' as const,
    options: [
      { value: 'BUSINESS', label: 'Business' },
      { value: 'INDIVIDUAL', label: 'Individual' },
    ],
    operators: ['IS' as const, 'IS_NOT' as const, 'IS_ANY_OF' as const],
  },
  {
    field: 'service',
    label: 'Service',
    type: 'STATUS' as const,
    audience: 'CLIENTS' as const,
    options: [
      { value: 'TAX', label: 'Tax Preparation' },
      { value: 'BOOKKEEPING', label: 'Bookkeeping' },
      { value: 'PAYROLL', label: 'Payroll' },
    ],
    operators: ['IS' as const, 'IS_ANY_OF' as const, 'IS_NONE_OF' as const],
  },
  {
    field: 'state',
    label: 'State',
    type: 'STATUS' as const,
    audience: 'BOTH' as const,
    options: [
      { value: 'GA', label: 'Georgia' },
      { value: 'NC', label: 'North Carolina' },
      { value: 'FL', label: 'Florida' },
    ],
    operators: ['IS' as const, 'IS_ANY_OF' as const],
  },
  {
    field: 'leadSource',
    label: 'Lead Source',
    type: 'STATUS' as const,
    audience: 'LEADS' as const,
    options: [
      { value: 'WEB', label: 'Website' },
      { value: 'REFERRAL', label: 'Referral' },
    ],
    operators: ['IS' as const, 'IS_NOT' as const],
  },
  {
    field: 'createdAt',
    label: 'Added',
    type: 'DATE' as const,
    audience: 'BOTH' as const,
    options: [],
    operators: ['BEFORE' as const, 'AFTER' as const, 'BETWEEN' as const],
  },
];

type Cond = { field: string; op: string; value?: unknown };
const condText = (c: Cond) => {
  const f = FIELDS.find((x) => x.field === c.field);
  const v = Array.isArray(c.value)
    ? c.value.join(', ')
    : typeof c.value === 'object' && c.value
      ? 'a range'
      : String(c.value ?? '');
  const opt = f?.options.find((o) => o.value === v)?.label ?? v;
  return `${f?.label ?? c.field} ${c.op.toLowerCase().replace(/_/g, ' ')} ${opt}`.trim();
};

interface Rec {
  d: CommunicationDetail;
  recipients: CommunicationRecipient[];
  activity: CommunicationActivity[];
  audience: {
    segmentIds: string[];
    clientIds: string[];
    leadIds: string[];
    excludeClientIds: string[];
    excludeLeadIds: string[];
  };
}
interface Seg {
  d: SegmentDetail;
  members: { kind: 'CLIENT' | 'LEAD'; id: string }[];
}

export function createCommunicationsMock({
  role = 'OWNER',
  empty = false,
}: Options = {}): CommunicationsClient {
  let next = 5000;
  const pending = new Map<
    string,
    { communicationId: string; fileName: string; contentType: string; sizeBytes: number }
  >();
  const sentKeys = new Set<string>();
  const consentOf = new Map<
    string,
    Partial<
      Record<'EMAIL' | 'SMS', 'OPTED_IN' | 'OPTED_OUT' | 'BOUNCED' | 'INVALID' | 'COMPLAINED'>
    >
  >();
  const id = (block: string) => uuid(block, next++);
  const run = async <T>(work: () => T): Promise<T> => {
    await mockDelay();
    return copy(work());
  };
  const canSendNow = () => role !== 'STAFF';
  const manage = () => {
    if (role === 'STAFF') throw fail(403, 'FORBIDDEN', 'This action is not permitted');
  };

  const contacts: Contact[] = [];
  for (let i = 0; i < 120; i += 1) {
    contacts.push({
      kind: 'CLIENT',
      id: uuid('c100', i + 1),
      name: `${FIRST[i % 20]} ${LAST[(i * 7) % 20]}`,
      email: `client${i + 1}@example.test`,
      index: i,
      unsubscribed: i % 17 === 5,
      invalid: i % 23 === 7,
      noPhone: i % 29 === 3,
    });
  }
  for (let i = 0; i < 30; i += 1) {
    contacts.push({
      kind: 'LEAD',
      id: uuid('c200', i + 1),
      name: `${FIRST[(i + 3) % 20]} ${LAST[(i * 3) % 20]}`,
      email: `lead${i + 1}@example.test`,
      index: i,
      unsubscribed: i % 13 === 4,
      invalid: i % 19 === 2,
      noPhone: i % 11 === 6,
    });
  }
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const segs: Seg[] = [];
  const recs: Rec[] = [];

  const senders = [
    {
      id: uuid('c300', 1),
      channel: 'EMAIL' as const,
      label: 'LVP Accounting & Taxes <support@example.test>',
      verified: true,
      isDefault: true,
      provider: 'Postmark',
      providerHealthy: true,
    },
    {
      id: uuid('c300', 2),
      channel: 'SMS' as const,
      label: '(555) 010-0300',
      verified: true,
      isDefault: true,
      provider: 'Twilio',
      providerHealthy: true,
    },
  ];
  const readiness = () => [
    { channel: 'EMAIL' as const, ready: true, reason: null, route: null, senderCount: 1 },
    { channel: 'SMS' as const, ready: true, reason: null, route: null, senderCount: 1 },
    { channel: 'ANNOUNCEMENT' as const, ready: true, reason: null, route: null, senderCount: 0 },
  ];

  const members = (s: Seg) => s.members.map((m) => byId.get(m.id)).filter((c): c is Contact => !!c);
  const newSeg = (
    name: string,
    description: string,
    type: 'DYNAMIC' | 'STATIC',
    audience: 'CLIENTS' | 'LEADS' | 'BOTH',
    pick: (c: Contact) => boolean,
    criteria?: { conditions: Cond[] },
  ): Seg => {
    const m = contacts.filter(pick).map((c) => ({ kind: c.kind, id: c.id }));
    const at = nowIso();
    const d: SegmentDetail = {
      id: id('c400'),
      name,
      description,
      type,
      audience,
      criteriaSummary: criteria
        ? criteria.conditions.map(condText).join(' and ') || 'Everyone'
        : null,
      memberCount: m.length,
      lastRefreshedAt: type === 'DYNAMIC' ? at : null,
      usedBy: 0,
      owner: mockMe,
      archived: false,
      updatedAt: at,
      criteria: criteria
        ? ({ logic: 'AND', conditions: criteria.conditions, groups: [] } as never)
        : null,
      etag: `e${next++}`,
    };
    return { d, members: m };
  };
  const segCount = (s: Seg) => members(s).length;

  const summaryOf = (r: Rec, channel = r.d.channel): AudienceSummary => {
    const ids = new Set<string>();
    for (const sid of r.audience.segmentIds)
      for (const m of segs.find((s) => s.d.id === sid)?.members ?? []) ids.add(m.id);
    for (const cid of [...r.audience.clientIds, ...r.audience.leadIds]) ids.add(cid);
    const excluded = new Set([...r.audience.excludeClientIds, ...r.audience.excludeLeadIds]);
    const selected = [...ids].map((x) => byId.get(x)).filter((c): c is Contact => !!c);
    const manual = selected.filter((c) => excluded.has(c.id));
    const live = selected.filter((c) => !excluded.has(c.id));
    const unsub = live.filter((c) => c.unsubscribed).length;
    const invalid = live.filter((c) => !c.unsubscribed && c.invalid).length;
    const missing = live.filter(
      (c) => !c.unsubscribed && !c.invalid && channel === 'SMS' && c.noPhone,
    ).length;
    const chips = [
      ...r.audience.segmentIds.map((sid) => ({
        kind: 'SEGMENT' as const,
        id: sid,
        label: segs.find((s) => s.d.id === sid)?.d.name ?? 'Segment',
        count: segs.find((s) => s.d.id === sid)?.members.length ?? null,
      })),
      ...r.audience.clientIds.map((cid) => ({
        kind: 'CLIENT' as const,
        id: cid,
        label: byId.get(cid)?.name ?? 'Client',
        count: 1,
      })),
      ...r.audience.leadIds.map((cid) => ({
        kind: 'LEAD' as const,
        id: cid,
        label: byId.get(cid)?.name ?? 'Lead',
        count: 1,
      })),
      ...r.audience.excludeClientIds.map((cid) => ({
        kind: 'EXCLUDE_CLIENT' as const,
        id: cid,
        label: byId.get(cid)?.name ?? 'Client',
        count: null,
      })),
      ...r.audience.excludeLeadIds.map((cid) => ({
        kind: 'EXCLUDE_LEAD' as const,
        id: cid,
        label: byId.get(cid)?.name ?? 'Lead',
        count: null,
      })),
    ];
    return {
      selectedCount: selected.length,
      autoExcluded: {
        unsubscribed: unsub,
        invalid,
        missingChannel: missing,
        duplicate: 0,
        ineligible: 0,
      },
      manualExcludedCount: manual.length,
      finalCount: live.length - unsub - invalid - missing,
      chips,
      calculatedAt: nowIso(),
    };
  };
  const analyze = (text: string) => {
    const known = new Set([
      'first name',
      'client first name',
      'client full name',
      'business name',
      'staff name',
      'your name',
      'company phone',
      'document upload link',
      'appointment date',
    ]);
    const used: string[] = [];
    const unknown: string[] = [];
    for (const m of text.matchAll(/\[([^\]\n]{1,60})\]|\{\{([^}\n]{1,60})\}\}/g)) {
      const k = (m[1] ?? m[2] ?? '').trim();
      (known.has(k.toLowerCase()) ? used : unknown).push(k);
    }
    return { used: [...new Set(used)], unknown: [...new Set(unknown)] };
  };
  const smsOf = (channel: string, body: string) => {
    if (channel !== 'SMS') return null;
    const n = body.replace(/<[^>]+>/g, '').length;
    return { characters: n, parts: Math.max(1, Math.ceil(n / 160)) };
  };
  const rowOf = (r: Rec): CommunicationRow => {
    const d = r.d;
    const opens =
      d.status === 'DRAFT'
        ? 'COMPOSER'
        : d.status === 'SCHEDULED' || d.status === 'PAUSED'
          ? 'SCHEDULED_DETAIL'
          : 'RESULTS';
    const done = r.recipients.length > 0;
    return {
      id: d.id,
      channel: d.channel,
      name: d.name,
      subject: d.subject,
      status: d.status,
      opens: d.status === 'CANCELLED' && !done ? 'SCHEDULED_DETAIL' : opens,
      audienceSummary: d.audienceSummary,
      finalCount: d.audience?.finalCount ?? d.finalCount,
      scheduledFor: d.scheduledFor,
      sentAt: d.sentAt,
      createdBy: d.createdBy,
      deliveredCount: done
        ? r.recipients.filter((x) => ['DELIVERED', 'OPENED', 'CLICKED'].includes(x.status)).length
        : null,
      failedCount: done
        ? r.recipients.filter((x) => ['FAILED', 'BOUNCED'].includes(x.status)).length
        : null,
      openRatePercent: done
        ? rate(
            r.recipients.filter((x) => ['OPENED', 'CLICKED'].includes(x.status)).length,
            r.recipients.filter((x) => ['DELIVERED', 'OPENED', 'CLICKED'].includes(x.status))
              .length,
          )
        : null,
      publishStartsAt: d.publishStartsAt,
      publishEndsAt: d.publishEndsAt,
      sourceId: d.sourceId,
      sourceKind: d.sourceKind,
      archived: d.archived,
      updatedAt: d.updatedAt,
    };
  };
  const rate = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 1000) / 10 : null);
  const touch = (r: Rec) => {
    const d = r.d;
    d.etag = `e${next++}`;
    d.updatedAt = nowIso();
    d.savedAt = d.updatedAt;
    d.mergeFields = analyze(`${d.subject ?? ''} ${d.body}`);
    d.sms = smsOf(d.channel, d.body);
    d.audience =
      r.audience.segmentIds.length + r.audience.clientIds.length + r.audience.leadIds.length > 0
        ? summaryOf(r)
        : null;
    d.audienceSummary = d.audience
      ? d.audience.chips
          .filter((c) => !c.kind.startsWith('EXCLUDE'))
          .map((c) => c.label)
          .join(', ') || null
      : null;
    d.finalCount = d.audience?.finalCount ?? null;
    d.editable = d.status === 'DRAFT' || d.status === 'SCHEDULED';
    d.lockedAt =
      d.status === 'SCHEDULED' &&
      d.scheduledFor &&
      Date.parse(d.scheduledFor) - Date.now() < 15 * 60_000
        ? d.scheduledFor
        : null;
    d.canSend = canSendNow() && d.status === 'DRAFT';
    return d;
  };
  const make = (v: {
    channel: 'EMAIL' | 'SMS' | 'ANNOUNCEMENT';
    name: string;
    subject?: string | null;
    body?: string;
    status?: CommunicationDetail['status'];
    segmentNames?: string[];
    scheduledFor?: string | null;
    sentAt?: string | null;
    createdBy?: MemberRef;
    publish?: [string | null, string | null];
    sourceId?: string | null;
    sourceKind?: CommunicationDetail['sourceKind'];
  }): Rec => {
    const at = v.sentAt ?? nowIso();
    const d: CommunicationDetail = {
      id: id('c500'),
      channel: v.channel,
      name: v.name,
      subject: v.subject ?? null,
      status: v.status ?? 'DRAFT',
      opens: 'COMPOSER',
      audienceSummary: null,
      finalCount: null,
      scheduledFor: v.scheduledFor ?? null,
      sentAt: v.sentAt ?? null,
      createdBy: v.createdBy ?? mockMe,
      deliveredCount: null,
      failedCount: null,
      openRatePercent: null,
      publishStartsAt: v.publish?.[0] ?? null,
      publishEndsAt: v.publish?.[1] ?? null,
      sourceId: v.sourceId ?? null,
      sourceKind: v.sourceKind ?? null,
      archived: false,
      updatedAt: at,
      previewText:
        v.channel === 'EMAIL' ? 'Important dates and a checklist to help you prepare.' : null,
      body: v.body ?? '',
      sender:
        v.channel === 'ANNOUNCEMENT'
          ? null
          : (senders.find((s) => s.channel === v.channel) ?? null),
      replyTo: v.channel === 'EMAIL' ? 'support@example.test' : null,
      template: null,
      attachments: [],
      mergeFields: { used: [], unknown: [] },
      sms: null,
      audience: null,
      timezone: 'America/New_York',
      visibility: v.channel === 'ANNOUNCEMENT' ? 'DASHBOARD' : null,
      startedAt: v.sentAt ?? null,
      cancelledAt: null,
      editable: true,
      lockedAt: null,
      savedAt: at,
      canSend: true,
      createdAt: at,
      etag: 'e0',
    };
    const r: Rec = {
      d,
      recipients: [],
      activity: [
        {
          id: id('c900'),
          type: 'QUEUED',
          message: 'Draft created',
          detailCode: null,
          occurredAt: at,
          source: 'STAFF',
        },
      ],
      audience: {
        segmentIds: (v.segmentNames ?? [])
          .map((n) => segs.find((s) => s.d.name === n)?.d.id ?? '')
          .filter(Boolean),
        clientIds: [],
        leadIds: [],
        excludeClientIds: [],
        excludeLeadIds: [],
      },
    };
    touch(r);
    return r;
  };
  /** Made-up delivery results for a sent campaign: the same recipients every time. */
  const deliver = (r: Rec) => {
    const eligible: Contact[] = [];
    const ids = new Set<string>();
    for (const sid of r.audience.segmentIds)
      for (const m of segs.find((s) => s.d.id === sid)?.members ?? []) ids.add(m.id);
    for (const cid of [...r.audience.clientIds, ...r.audience.leadIds]) ids.add(cid);
    const excluded = new Set([...r.audience.excludeClientIds, ...r.audience.excludeLeadIds]);
    for (const x of ids) {
      const c = byId.get(x);
      if (
        c &&
        !excluded.has(c.id) &&
        !c.unsubscribed &&
        !c.invalid &&
        !(r.d.channel === 'SMS' && c.noPhone)
      )
        eligible.push(c);
    }
    const sentAt = r.d.sentAt ?? nowIso();
    r.recipients = eligible.map((c, i) => {
      const status = (
        [
          'DELIVERED',
          'OPENED',
          'CLICKED',
          'OPENED',
          'DELIVERED',
          'CLICKED',
          'OPENED',
          'DELIVERED',
          'BOUNCED',
          'DELIVERED',
        ] as const
      )[(i * 7) % 10]!;
      const opened = status === 'OPENED' || status === 'CLICKED';
      const at = new Date(Date.parse(sentAt) + (i % 90) * 60_000).toISOString();
      return {
        id: id('c600'),
        client: c.kind === 'CLIENT' ? { id: c.id, name: c.name } : null,
        leadId: c.kind === 'LEAD' ? c.id : null,
        leadName: c.kind === 'LEAD' ? c.name : null,
        addressMask:
          r.d.channel === 'SMS' ? '(***) ***-0142' : `${c.email.slice(0, 2)}***@example.test`,
        status,
        failureCode: status === 'BOUNCED' ? 'MAILBOX_FULL' : null,
        failureLabel: status === 'BOUNCED' ? 'The mailbox is full' : null,
        sentAt,
        deliveredAt: status === 'BOUNCED' ? null : at,
        openCount: opened ? 1 + (i % 3) : 0,
        clickCount: status === 'CLICKED' ? 1 : 0,
        unsubscribedAt: null,
      };
    });
    r.activity.unshift({
      id: id('c900'),
      type: 'SENT',
      message: `Sent to ${r.recipients.length} recipient(s)`,
      detailCode: null,
      occurredAt: sentAt,
      source: 'SYSTEM',
    });
    r.d.deliveredCount = r.recipients.filter((x) => x.status !== 'BOUNCED').length;
  };

  const find = (communicationId: string) => {
    const r = recs.find((x) => x.d.id === communicationId);
    if (!r) throw fail(404, 'NOT_FOUND', 'That communication was not found.');
    return r;
  };
  const conflict = (r: Rec, etag: string) => {
    if (etag !== r.d.etag)
      throw fail(409, 'SAVE_CONFLICT', 'Someone saved this communication after you opened it.');
  };
  const editable = (r: Rec) => {
    if (r.d.status === 'SCHEDULED' && r.d.lockedAt)
      throw fail(409, 'LOCKED', 'It is about to send and can no longer be changed.');
    if (!r.d.editable)
      throw fail(409, 'NOT_EDITABLE', 'This communication has been sent and cannot be edited.');
  };
  const channelOk = (channel: string) => {
    const c = readiness().find((x) => x.channel === channel);
    if (!c?.ready)
      throw fail(409, 'CHANNEL_UNAVAILABLE', c?.reason ?? 'That channel is not available.');
  };

  const seed = () => {
    for (const [name, desc, pick, type, aud] of SEG_DEFS) {
      const s = newSeg(
        name,
        desc,
        type,
        aud,
        pick,
        type === 'DYNAMIC'
          ? {
              conditions:
                name === 'All Clients' || name === 'New Leads'
                  ? []
                  : [
                      {
                        field: 'service',
                        op: 'IS',
                        value: name.startsWith('Tax')
                          ? 'TAX'
                          : name.startsWith('Book')
                            ? 'BOOKKEEPING'
                            : 'PAYROLL',
                      },
                    ],
            }
          : undefined,
      );
      segs.push(s);
    }
    const sentBody =
      '<p>Hello [Client First Name],</p><p>Tax season is approaching. Please review your checklist and upload any available documents through your secure client portal.</p><p>— [Business Name]</p>';
    const sent = (
      channel: 'EMAIL' | 'SMS' | 'ANNOUNCEMENT',
      name: string,
      subject: string | null,
      days: number,
      seg: string,
      createdBy = mockMe,
    ) => {
      const r = make({
        channel,
        name,
        subject,
        body:
          channel === 'SMS'
            ? 'Hello [Client First Name], a quick reminder from [Business Name].'
            : sentBody,
        status: 'SENT',
        sentAt: ago(days),
        segmentNames: [seg],
        createdBy,
      });
      deliver(r);
      touch(r);
      r.d.status = 'SENT';
      r.d.editable = false;
      r.d.canSend = false;
      r.d.sentAt = ago(days);
      r.d.startedAt = ago(days);
      recs.push(r);
      return r;
    };
    sent('EMAIL', '2026 Tax Season Reminder', 'Tax Season 2026 Is Coming', 30, 'All Clients');
    sent('SMS', 'Appointment Reminder', null, 31, 'Appointment Clients');
    sent(
      'ANNOUNCEMENT',
      'Office Closure Notice',
      'Our office will be closed on Monday',
      32,
      'All Clients',
      KEVIN,
    );
    sent(
      'EMAIL',
      'Document Request',
      'We are missing some information',
      34,
      'Clients with Open Returns',
      KEVIN,
    );
    sent(
      'EMAIL',
      'Monthly Newsletter',
      'Your monthly tax and business update',
      14,
      'Small Business Clients',
    );
    const s1 = make({
      channel: 'EMAIL',
      name: 'Tax Prep Reminder',
      subject: 'Tax prep checklist',
      body: sentBody,
      status: 'SCHEDULED',
      scheduledFor: ahead(2, 14),
      segmentNames: ['Tax Preparation Clients'],
    });
    const s2 = make({
      channel: 'EMAIL',
      name: 'Bookkeeping Promo',
      subject: 'Take control of your finances',
      body: sentBody,
      status: 'SCHEDULED',
      scheduledFor: ahead(5, 9),
      segmentNames: ['Small Business Clients'],
    });
    const s3 = make({
      channel: 'SMS',
      name: 'Office Closure Text',
      body: 'Our office closes early Monday. - [Business Name]',
      status: 'SCHEDULED',
      scheduledFor: ahead(4, 11),
      segmentNames: ['All Clients'],
      createdBy: KEVIN,
    });
    const sending = make({
      channel: 'EMAIL',
      name: 'Year-End Planning Invite',
      subject: 'Plan your year-end',
      body: sentBody,
      status: 'SENDING',
      sentAt: ago(0),
      segmentNames: ['Small Business Clients'],
    });
    const draft1 = make({
      channel: 'EMAIL',
      name: 'Referral Request',
      subject: 'Know someone who needs help?',
      body: '<p>Hi [Client First Name], thanks for being a client.</p>',
      segmentNames: [],
    });
    const draft2 = make({
      channel: 'SMS',
      name: 'Missing Docs Text',
      body: 'Hi [Client First Name], we still need a few documents.',
      segmentNames: ['Clients with Open Returns'],
    });
    const ann = make({
      channel: 'ANNOUNCEMENT',
      name: 'New Portal Features',
      subject: 'New in your portal',
      body: '<p>You can now message us from your dashboard.</p>',
      status: 'SENT',
      sentAt: ago(8),
      publish: [ago(8), ahead(22)],
      segmentNames: ['All Clients'],
    });
    deliver(ann);
    ann.d.editable = false;
    ann.d.canSend = false;
    const cancelled = make({
      channel: 'EMAIL',
      name: 'Cancelled Promo',
      subject: 'Cancelled',
      body: sentBody,
      status: 'CANCELLED',
      segmentNames: ['All Clients'],
    });
    cancelled.d.cancelledAt = ago(3);
    cancelled.d.editable = false;
    recs.push(s1, s2, s3, sending, draft1, draft2, ann, cancelled);
    for (const r of recs) {
      touch(r);
      if (r.d.status === 'SENT' || r.d.status === 'SENDING') {
        r.d.editable = false;
        r.d.canSend = false;
      }
      if (r.d.status === 'CANCELLED') {
        r.d.editable = false;
        r.d.canSend = false;
      }
    }
    for (const s of segs)
      s.d.usedBy = recs.filter(
        (r) => r.audience.segmentIds.includes(s.d.id) && r.d.status === 'SCHEDULED',
      ).length;
  };
  if (!empty) seed();

  const reviewOf = (r: Rec): CommunicationReview => {
    const d = r.d;
    const audience = summaryOf(r);
    const checks: SendCheck[] = [];
    const add = (code: SendCheck['code'], severity: SendCheck['severity'], message: string) =>
      checks.push({ code, severity, message });
    const c = readiness().find((x) => x.channel === d.channel);
    if (!c?.ready)
      add('CHANNEL_UNAVAILABLE', 'BLOCK', c?.reason ?? 'The channel is not available.');
    if (audience.finalCount === 0) add('NO_RECIPIENTS', 'BLOCK', 'Choose recipients first.');
    else
      add(
        'CONSENT_CHECKED',
        'OK',
        `${audience.finalCount} recipient(s) can receive this. Contacts without consent are excluded.`,
      );
    if (['EMAIL', 'ANNOUNCEMENT'].includes(d.channel) && !(d.subject ?? '').trim())
      add('MISSING_SUBJECT', 'BLOCK', 'Add a subject line.');
    if (!d.body.replace(/<[^>]+>/g, '').trim()) add('EMPTY_BODY', 'BLOCK', 'Write the message.');
    if (d.mergeFields.unknown.length)
      add(
        'UNKNOWN_FIELDS',
        'WARN',
        `Unknown fields: ${d.mergeFields.unknown.map((u) => `[${u}]`).join(', ')}.`,
      );
    if (d.scheduledFor && Date.parse(d.scheduledFor) < Date.now())
      add('SCHEDULE_IN_PAST', 'BLOCK', 'The scheduled time has passed.');
    if (
      d.channel === 'ANNOUNCEMENT' &&
      d.publishStartsAt &&
      d.publishEndsAt &&
      d.publishEndsAt <= d.publishStartsAt
    )
      add('ANNOUNCEMENT_WINDOW_INVALID', 'BLOCK', 'The end of the window is before its start.');
    const unresolved = d.mergeFields.unknown;
    return {
      channel: d.channel,
      audience,
      sender: d.sender,
      subject: d.subject,
      preview: {
        subject: d.subject,
        body: d.body.replace(/\[Client First Name\]|\{\{First Name\}\}/gi, 'Jamie'),
        unresolved,
      },
      timing: {
        mode: d.scheduledFor ? 'SCHEDULED' : 'NOW',
        scheduledFor: d.scheduledFor,
        timezone: d.timezone,
      },
      integration: { provider: d.sender?.provider ?? null, healthy: true, route: null },
      checks,
      canSend: canSendNow() && !checks.some((x) => x.severity === 'BLOCK'),
    };
  };

  const listTab = (r: Rec, tab: string) =>
    tab === 'campaigns'
      ? r.d.channel !== 'ANNOUNCEMENT'
      : tab === 'announcements'
        ? r.d.channel === 'ANNOUNCEMENT'
        : tab === 'scheduled'
          ? r.d.status === 'SCHEDULED'
          : tab === 'sent'
            ? ['SENT', 'FAILED', 'CANCELLED'].includes(r.d.status)
            : tab === 'drafts'
              ? r.d.status === 'DRAFT'
              : true;

  return {
    overview: () =>
      run(() => {
        const live = recs.filter((r) => !r.d.archived);
        const sent = live.filter((r) => r.d.status === 'SENT');
        const rows = sent.flatMap((r) => r.recipients);
        const delivered = rows.filter(
          (x) => x.status !== 'BOUNCED' && x.status !== 'FAILED',
        ).length;
        return {
          kpis: {
            drafts: live.filter((r) => r.d.status === 'DRAFT').length,
            scheduled: live.filter((r) => r.d.status === 'SCHEDULED').length,
            sending: live.filter((r) => r.d.status === 'SENDING').length,
            sent: sent.length,
            recipientsReached: rows.length,
            deliveryRatePercent: rate(delivered, rows.length),
            openRatePercent: rate(rows.filter((x) => x.openCount > 0).length, delivered),
            clickRatePercent: rate(rows.filter((x) => x.clickCount > 0).length, delivered),
            failed: rows.length - delivered,
          },
          channels: readiness(),
          recent: [...live]
            .sort((a, b) =>
              (b.d.sentAt ?? b.d.updatedAt).localeCompare(a.d.sentAt ?? a.d.updatedAt),
            )
            .slice(0, 5)
            .map(rowOf),
          scheduled: live
            .filter((r) => r.d.status === 'SCHEDULED')
            .sort((a, b) => (a.d.scheduledFor ?? '').localeCompare(b.d.scheduledFor ?? ''))
            .slice(0, 5)
            .map(rowOf),
          templates: [
            {
              id: uuid('7100', 1004),
              name: 'Tax Season Announcement',
              kind: 'EMAIL',
              category: 'Tax Season',
            },
            {
              id: uuid('7100', 1008),
              name: 'Appointment Reminder',
              kind: 'SMS',
              category: 'Reminders',
            },
          ].slice(0, empty ? 0 : 2),
          segments: {
            total: segs.filter((s) => !s.d.archived).length,
            totalMembers: segs.filter((s) => !s.d.archived).reduce((n, s) => n + segCount(s), 0),
          },
          canCreate: role !== 'STAFF',
          canSend: canSendNow(),
          canExport: role !== 'STAFF',
          canManageSegments: role !== 'STAFF',
        };
      }),
    list: (q = {}) =>
      run(() => {
        const query = parseInput(CommunicationsQuery, q);
        const term = query.search?.toLowerCase();
        const rows = recs
          .filter((r) => (query.archived === true ? r.d.archived : !r.d.archived))
          .filter(
            (r) =>
              listTab(r, query.tab) &&
              (!query.channel || r.d.channel === query.channel) &&
              (!query.status || r.d.status === query.status) &&
              (!query.createdByUserId || r.d.createdBy.userId === query.createdByUserId) &&
              (!query.from || (r.d.sentAt ?? r.d.updatedAt).slice(0, 10) >= query.from) &&
              (!query.to || (r.d.sentAt ?? r.d.updatedAt).slice(0, 10) <= query.to) &&
              (!term ||
                `${r.d.name} ${r.d.subject ?? ''} ${r.d.body}`.toLowerCase().includes(term)),
          )
          .sort((a, b) => {
            if (query.sort === 'name') return a.d.name.localeCompare(b.d.name);
            if (query.sort === 'scheduled')
              return (a.d.scheduledFor ?? '9').localeCompare(b.d.scheduledFor ?? '9');
            const x = a.d.sentAt ?? a.d.updatedAt;
            const y = b.d.sentAt ?? b.d.updatedAt;
            return query.sort === 'oldest' ? x.localeCompare(y) : y.localeCompare(x);
          })
          .map(rowOf);
        return {
          items: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
          total: rows.length,
          page: query.page,
          pageSize: query.pageSize,
        };
      }),
    senders: () => run(() => senders),
    announcementLocations: () =>
      run(() => [
        { key: 'DASHBOARD', label: 'Portal dashboard' },
        { key: 'MESSAGES', label: 'Portal messages page' },
      ]),
    create: (body) =>
      run(() => {
        manage();
        const input = parseInput(CreateCommunicationRequest, body);
        channelOk(input.channel);
        const r = make({ channel: input.channel, name: input.name ?? 'Untitled communication' });
        recs.unshift(r);
        return touch(r);
      }),
    get: (communicationId) => run(() => find(communicationId).d),
    update: (communicationId, body) =>
      run(() => {
        manage();
        const input = parseInput(UpdateCommunicationRequest, body);
        const r = find(communicationId);
        conflict(r, input.etag);
        editable(r);
        if (input.channel && input.channel !== r.d.channel) {
          channelOk(input.channel);
          if (
            input.channel === 'SMS' &&
            /<[a-z][^>]*>/i.test(r.d.body) &&
            !input.confirmStripContent
          ) {
            throw fail(409, 'CONTENT_WOULD_BE_LOST', 'Switching to text removes the formatting.');
          }
          r.d.channel = input.channel;
          if (input.channel === 'SMS')
            r.d.body = r.d.body
              .replace(/<br\s*\/?>/gi, '\n')
              .replace(/<\/p>\s*<p>/gi, '\n\n')
              .replace(/<[^>]+>/g, '');
          r.d.sender = senders.find((s) => s.channel === input.channel) ?? null;
          r.d.replyTo = input.channel === 'EMAIL' ? 'support@example.test' : null;
        }
        if (input.name !== undefined) r.d.name = input.name;
        if (input.senderId !== undefined)
          r.d.sender = senders.find((s) => s.id === input.senderId) ?? null;
        if (input.replyTo !== undefined) r.d.replyTo = input.replyTo;
        if (input.subject !== undefined) r.d.subject = input.subject;
        if (input.previewText !== undefined) r.d.previewText = input.previewText;
        if (input.body !== undefined) r.d.body = input.body;
        if (input.publishStartsAt !== undefined) r.d.publishStartsAt = input.publishStartsAt;
        if (input.publishEndsAt !== undefined) r.d.publishEndsAt = input.publishEndsAt;
        if (input.visibility !== undefined) r.d.visibility = input.visibility;
        return touch(r);
      }),
    useTemplate: (communicationId, body) =>
      run(async () => {
        manage();
        const input = parseInput(UseTemplateRequest, body);
        const r = find(communicationId);
        conflict(r, input.etag);
        editable(r);
        let found:
          { name: string; subject: string | null; body: string; version: number } | undefined;
        try {
          const { api } = await import('../lib/api');
          const t = await api.templates.get(input.templateId);
          if (t.status !== 'ACTIVE') throw new Error('inactive');
          found = { name: t.name, subject: t.subject, body: t.body, version: t.version };
        } catch {
          throw fail(409, 'TEMPLATE_NOT_ALLOWED', 'That template cannot be used here.');
        }
        r.d.subject = found.subject ?? r.d.subject;
        r.d.body = found.body;
        r.d.template = { id: input.templateId, name: found.name, version: found.version };
        return touch(r);
      }) as never,
    saveAsTemplate: (communicationId, body) =>
      run(() => {
        manage();
        const input = parseInput(SaveAsTemplateRequest, body);
        const r = find(communicationId);
        const at = nowIso();
        return {
          id: id('7100'),
          kind:
            r.d.channel === 'SMS'
              ? ('SMS' as const)
              : r.d.channel === 'ANNOUNCEMENT'
                ? ('ANNOUNCEMENT' as const)
                : ('EMAIL' as const),
          category: null,
          name: input.name,
          description: null,
          subject: r.d.subject,
          tags: [],
          status: 'DRAFT' as const,
          access: 'TEAM' as const,
          starter: false,
          includeInAutomations: false,
          owner: mockMe,
          updatedBy: mockMe,
          version: 1,
          favorite: false,
          useCount: 0,
          updatedAt: at,
          previewText: r.d.previewText,
          body: r.d.body,
          sharedWith: [],
          attachments: [],
          mergeFields: r.d.mergeFields,
          automationCount: 0,
          lastUsedAt: null,
          createdAt: at,
          etag: `e${next++}`,
        };
      }),
    preview: (communicationId, body = {}) =>
      run(() => {
        parseInput(PreviewCommunicationRequest, body);
        const r = find(communicationId);
        const fill = (t: string) =>
          t
            .replace(/\[Client First Name\]|\{\{First Name\}\}|\[First Name\]/gi, 'Jamie')
            .replace(/\[Business Name\]/gi, 'LVP Accounting & Taxes');
        const unknown = r.d.mergeFields.unknown;
        const plain = fill(r.d.body).replace(/<[^>]+>/g, '');
        return {
          subject: r.d.subject === null ? null : fill(r.d.subject),
          previewText: r.d.previewText,
          body: fill(r.d.body),
          unresolved: unknown,
          sample: true,
          sms:
            r.d.channel === 'SMS'
              ? { characters: plain.length, parts: Math.max(1, Math.ceil(plain.length / 160)) }
              : null,
        };
      }),
    testSend: (communicationId, body = {}) =>
      run(() => {
        const input = parseInput(TestSendCommunicationRequest, body);
        const r = find(communicationId);
        if (r.d.channel === 'ANNOUNCEMENT')
          throw fail(400, 'TEST_SEND_REFUSED', 'An announcement cannot be test-sent.');
        if (r.d.channel === 'SMS' && !input.toPhone)
          throw fail(400, 'TEST_SEND_REFUSED', 'Enter a phone number.');
        if (r.d.channel === 'EMAIL' && !input.toEmail)
          throw fail(400, 'TEST_SEND_REFUSED', 'Enter an email address.');
        r.activity.unshift({
          id: id('c900'),
          type: 'QUEUED',
          message: 'A test was sent to the sender',
          detailCode: null,
          occurredAt: nowIso(),
          source: 'STAFF',
        });
        return { ok: true as const };
      }),
    startAttachment: (communicationId, body) =>
      run(() => {
        const input = parseInput(StartCommunicationAttachmentRequest, body);
        find(communicationId);
        const token = `mock-comm-upload-${next++}`;
        pending.set(token, {
          communicationId,
          fileName: input.fileName,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
        });
        return {
          uploadToken: token,
          url: `mock:upload/${token}`,
          method: 'PUT' as const,
          headers: { 'content-type': input.contentType },
          expiresAt: new Date(Date.now() + 4 * 60_000).toISOString(),
        };
      }),
    confirmAttachment: (body) =>
      run(() => {
        const { uploadToken } = parseInput(ConfirmUploadRequest, body);
        const p = pending.get(uploadToken);
        if (!p) throw fail(410, 'UPLOAD_EXPIRED', 'This upload has expired.');
        pending.delete(uploadToken);
        const r = find(p.communicationId);
        const a = {
          id: id('c700'),
          fileName: p.fileName,
          contentType: p.contentType,
          sizeBytes: p.sizeBytes,
        };
        r.d.attachments.push(a);
        return a;
      }),
    removeAttachment: (communicationId, attachmentId) =>
      run(() => {
        const r = find(communicationId);
        editable(r);
        r.d.attachments = r.d.attachments.filter((a) => a.id !== attachmentId);
        return { ok: true as const };
      }),
    candidates: (q) =>
      run(() => {
        const query = parseInput(AudienceCandidatesQuery, q);
        const r = find(query.communicationId);
        const term = query.search?.toLowerCase();
        let items: AudienceCandidate[];
        if (
          query.view === 'SEGMENTS' ||
          query.view === 'SERVICES' ||
          query.view === 'STATUSES' ||
          query.view === 'LISTS' ||
          (query.view === 'LEADS' && false)
        ) {
          items = segs
            .filter((s) => !s.d.archived)
            .filter((s) =>
              query.view === 'LISTS'
                ? s.d.type === 'STATIC'
                : query.view === 'SERVICES'
                  ? /Clients$/.test(s.d.name) && /Tax|Book|Payroll/.test(s.d.name)
                  : query.view === 'STATUSES'
                    ? /Open|Appointment|Small/.test(s.d.name)
                    : true,
            )
            .filter((s) => !term || s.d.name.toLowerCase().includes(term))
            .map((s) => ({
              kind: 'SEGMENT' as const,
              id: s.d.id,
              label: s.d.name,
              secondary: s.d.description,
              count: segCount(s),
              eligible: true,
              ineligibleReason: null,
            }));
        } else {
          items = contacts
            .filter((c) => (query.view === 'LEADS' ? c.kind === 'LEAD' : true))
            .filter((c) => !term || `${c.name} ${c.email}`.toLowerCase().includes(term))
            .map((c) => ({
              kind: c.kind,
              id: c.id,
              label: c.name,
              secondary: c.email,
              count: null,
              eligible: !c.unsubscribed && !c.invalid && !(r.d.channel === 'SMS' && c.noPhone),
              ineligibleReason: c.unsubscribed
                ? ('UNSUBSCRIBED' as const)
                : c.invalid
                  ? ('INVALID' as const)
                  : r.d.channel === 'SMS' && c.noPhone
                    ? ('MISSING_CHANNEL' as const)
                    : null,
            }));
        }
        return {
          items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
          total: items.length,
          page: query.page,
          pageSize: query.pageSize,
        };
      }),
    selectAll: (body) =>
      run(() => {
        const query = parseInput(SelectAllAudienceRequest, body);
        const term = query.search?.toLowerCase();
        const pool = contacts.filter(
          (c) =>
            (!term || `${c.name} ${c.email}`.toLowerCase().includes(term)) &&
            (query.view === 'LEADS' ? c.kind === 'LEAD' : true),
        );
        const segsAll =
          query.view === 'SEGMENTS' || query.view === 'LISTS'
            ? segs
                .filter(
                  (s) => !s.d.archived && (query.view === 'LISTS' ? s.d.type === 'STATIC' : true),
                )
                .map((s) => s.d.id)
            : [];
        return {
          clientIds: segsAll.length ? [] : pool.filter((c) => c.kind === 'CLIENT').map((c) => c.id),
          leadIds: segsAll.length ? [] : pool.filter((c) => c.kind === 'LEAD').map((c) => c.id),
          segmentIds: segsAll,
          truncated: false,
        };
      }),
    setAudience: (communicationId, body) =>
      run(() => {
        manage();
        const input = parseInput(SetAudienceRequest, body);
        const r = find(communicationId);
        conflict(r, input.etag);
        editable(r);
        r.audience = {
          segmentIds: input.segmentIds,
          clientIds: input.clientIds,
          leadIds: input.leadIds,
          excludeClientIds: input.excludeClientIds,
          excludeLeadIds: input.excludeLeadIds,
        };
        touch(r);
        return summaryOf(r);
      }),
    audience: (communicationId) => run(() => summaryOf(find(communicationId))),
    review: (communicationId) => run(() => reviewOf(find(communicationId))),
    send: (communicationId, body) =>
      run(() => {
        manage();
        const input = parseInput(SendCommunicationRequest, body);
        const r = find(communicationId);
        if (sentKeys.has(input.idempotencyKey)) return r.d;
        conflict(r, input.etag);
        if (r.d.status !== 'DRAFT') throw fail(409, 'NOT_EDITABLE', 'Only a draft can be sent.');
        const review = reviewOf(r);
        if (review.audience.finalCount === 0)
          throw fail(409, 'NO_ELIGIBLE_RECIPIENTS', 'No one can receive this message.');
        if (!review.canSend)
          throw fail(
            409,
            'NOT_READY',
            review.checks.find((c) => c.severity === 'BLOCK')?.message ??
              'The message is not ready.',
          );
        if (
          input.expectedFinalCount !== undefined &&
          input.expectedFinalCount !== review.audience.finalCount
        )
          throw fail(409, 'AUDIENCE_CHANGED', 'The audience changed since you reviewed it.');
        sentKeys.add(input.idempotencyKey);
        r.d.status = 'SENT';
        r.d.sentAt = nowIso();
        r.d.startedAt = r.d.sentAt;
        r.d.scheduledFor = null;
        deliver(r);
        touch(r);
        r.d.editable = false;
        r.d.canSend = false;
        return r.d;
      }),
    schedule: (communicationId, body) =>
      run(() => {
        manage();
        const input = parseInput(ScheduleCommunicationRequest, body);
        const r = find(communicationId);
        if (sentKeys.has(input.idempotencyKey)) return r.d;
        conflict(r, input.etag);
        if (r.d.status !== 'DRAFT')
          throw fail(409, 'NOT_EDITABLE', 'Only a draft can be scheduled.');
        if (Date.parse(input.scheduledFor) <= Date.now())
          throw fail(409, 'SCHEDULE_IN_PAST', 'Choose a time in the future.');
        r.d.scheduledFor = input.scheduledFor;
        const review = reviewOf(r);
        if (review.audience.finalCount === 0)
          throw fail(409, 'NO_ELIGIBLE_RECIPIENTS', 'No one can receive this message.');
        if (!review.canSend)
          throw fail(
            409,
            'NOT_READY',
            review.checks.find((c) => c.severity === 'BLOCK')?.message ??
              'The message is not ready.',
          );
        if (
          input.expectedFinalCount !== undefined &&
          input.expectedFinalCount !== review.audience.finalCount
        )
          throw fail(409, 'AUDIENCE_CHANGED', 'The audience changed since you reviewed it.');
        sentKeys.add(input.idempotencyKey);
        r.d.status = 'SCHEDULED';
        return touch(r);
      }),
    reschedule: (communicationId, body) =>
      run(() => {
        manage();
        const input = parseInput(RescheduleCommunicationRequest, body);
        const r = find(communicationId);
        conflict(r, input.etag);
        if (r.d.status !== 'SCHEDULED')
          throw fail(409, 'NOT_EDITABLE', 'Only a scheduled communication can be moved.');
        if (r.d.lockedAt)
          throw fail(409, 'LOCKED', 'It is about to send and can no longer be changed.');
        if (Date.parse(input.scheduledFor) <= Date.now())
          throw fail(409, 'SCHEDULE_IN_PAST', 'Choose a time in the future.');
        r.d.scheduledFor = input.scheduledFor;
        return touch(r);
      }),
    cancel: (communicationId) =>
      run(() => {
        manage();
        const r = find(communicationId);
        if (r.d.status === 'SENDING')
          throw fail(409, 'STILL_SENDING', 'It is sending now. Pause it instead.');
        if (r.d.status !== 'SCHEDULED' && r.d.status !== 'PAUSED')
          throw fail(409, 'NOT_EDITABLE', 'Only a scheduled communication can be cancelled.');
        r.d.status = 'CANCELLED';
        r.d.cancelledAt = nowIso();
        touch(r);
        r.d.editable = false;
        r.d.canSend = false;
        return r.d;
      }),
    pause: (communicationId) =>
      run(() => {
        manage();
        const r = find(communicationId);
        if (r.d.status !== 'SENDING' && r.d.status !== 'SCHEDULED')
          throw fail(
            409,
            'NOT_EDITABLE',
            'Only a sending or scheduled communication can be paused.',
          );
        r.d.status = 'PAUSED';
        return touch(r);
      }),
    resume: (communicationId) =>
      run(() => {
        manage();
        const r = find(communicationId);
        if (r.d.status !== 'PAUSED')
          throw fail(409, 'NOT_EDITABLE', 'Only a paused communication can be resumed.');
        r.d.status = r.d.scheduledFor ? 'SCHEDULED' : 'SENDING';
        return touch(r);
      }),
    expire: (communicationId) =>
      run(() => {
        manage();
        const r = find(communicationId);
        if (r.d.channel !== 'ANNOUNCEMENT')
          throw fail(409, 'NOT_EDITABLE', 'Only an announcement can be expired.');
        r.d.publishEndsAt = nowIso();
        return touch(r);
      }),
    archive: (communicationId) =>
      run(() => {
        manage();
        const r = find(communicationId);
        if (r.d.status === 'SENDING') throw fail(409, 'STILL_SENDING', 'It is sending now.');
        r.d.archived = true;
        return touch(r);
      }),
    restore: (communicationId) =>
      run(() => {
        manage();
        const r = find(communicationId);
        r.d.archived = false;
        return touch(r);
      }),
    results: (communicationId) =>
      run((): CommunicationResults => {
        const r = find(communicationId);
        const rows = r.recipients;
        const m = (f: (x: CommunicationRecipient) => boolean) => {
          const n = rows.filter(f).length;
          return { count: n, ratePercent: rate(n, rows.length) };
        };
        const delivered = rows.filter(
          (x) => !['BOUNCED', 'FAILED', 'NOT_SENT'].includes(x.status),
        ).length;
        const opened = rows.filter((x) => x.openCount > 0).length;
        const clicked = rows.filter((x) => x.clickCount > 0).length;
        const days = [0, 1, 2, 3, 4].map((n) =>
          new Date(Date.parse(r.d.sentAt ?? nowIso()) + n * DAY).toISOString().slice(0, 10),
        );
        const share = [0.45, 0.25, 0.15, 0.1, 0.05];
        const failed = rows.filter((x) => ['BOUNCED', 'FAILED'].includes(x.status));
        return {
          communication: r.d,
          metrics: {
            totalRecipients: rows.length,
            delivered: { count: delivered, ratePercent: rate(delivered, rows.length) },
            opened: { count: opened, ratePercent: rate(opened, delivered) },
            clicked: { count: clicked, ratePercent: rate(clicked, delivered) },
            failed: m((x) => ['BOUNCED', 'FAILED'].includes(x.status)),
            pending: m((x) => x.status === 'QUEUED'),
            unsubscribed: m((x) => x.status === 'UNSUBSCRIBED'),
          },
          supports: { opens: r.d.channel === 'EMAIL', clicks: r.d.channel !== 'ANNOUNCEMENT' },
          funnel: [
            { stage: 'SENT', count: rows.length },
            { stage: 'DELIVERED', count: delivered },
            { stage: 'OPENED', count: opened },
            { stage: 'CLICKED', count: clicked },
          ],
          trend: days.map((date, i) => ({
            date,
            delivered: Math.round(delivered * share[i]!),
            opened: Math.round(opened * share[i]!),
            clicked: Math.round(clicked * share[i]!),
          })),
          failureReasons: failed.length
            ? [{ code: 'MAILBOX_FULL', label: 'The mailbox is full', count: failed.length }]
            : [],
          canExport: role !== 'STAFF',
          canResendFailed: role !== 'STAFF' && failed.length > 0,
        };
      }),
    recipients: (communicationId, q = {}) =>
      run(() => {
        const query = parseInput(CommunicationRecipientsQuery, q);
        const r = find(communicationId);
        const term = query.search?.toLowerCase();
        const rows = r.recipients.filter(
          (x) =>
            (!query.status || x.status === query.status) &&
            (!query.engagement ||
              (query.engagement === 'opened'
                ? x.openCount > 0
                : query.engagement === 'not_opened'
                  ? x.openCount === 0
                  : query.engagement === 'clicked'
                    ? x.clickCount > 0
                    : x.clickCount === 0)) &&
            (!term ||
              `${x.client?.name ?? x.leadName ?? ''} ${x.addressMask}`
                .toLowerCase()
                .includes(term)),
        );
        return {
          items: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
          total: rows.length,
          page: query.page,
          pageSize: query.pageSize,
        };
      }),
    activity: (communicationId, q = {}) =>
      run(() => {
        const query = parseInput(CommunicationActivityQuery, q);
        const rows = find(communicationId).activity.filter(
          (a) => !query.type || a.type === query.type,
        );
        return {
          items: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
          total: rows.length,
          page: query.page,
          pageSize: query.pageSize,
        };
      }),
    exportResults: (communicationId, body = {}) =>
      run(() => {
        if (role === 'STAFF') throw fail(403, 'EXPORT_NOT_ALLOWED', 'Your role cannot export.');
        parseInput(ExportCommunicationRequest, body);
        const r = find(communicationId);
        return {
          url: 'mock:download/results.csv',
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
          fileName: `${r.d.name.toLowerCase().replace(/\W+/g, '-')}-results.csv`,
          rowCount: r.recipients.length,
        };
      }),
    duplicate: (communicationId) =>
      run(() => {
        manage();
        const r = find(communicationId);
        const c = make({
          channel: r.d.channel,
          name: `${r.d.name} (Copy)`,
          subject: r.d.subject,
          body: r.d.body,
          sourceId: r.d.id,
          sourceKind: 'DUPLICATE',
        });
        c.audience = copy(r.audience);
        touch(c);
        recs.unshift(c);
        return c.d;
      }),
    resendFailed: (communicationId) =>
      run(() => {
        manage();
        const r = find(communicationId);
        const failedOnes = r.recipients.filter((x) => ['BOUNCED', 'FAILED'].includes(x.status));
        if (failedOnes.length === 0) throw fail(409, 'NO_ELIGIBLE_RECIPIENTS', 'Nothing failed.');
        const c = make({
          channel: r.d.channel,
          name: `${r.d.name} (Resend)`,
          subject: r.d.subject,
          body: r.d.body,
          sourceId: r.d.id,
          sourceKind: 'RESEND_FAILED',
        });
        c.audience.clientIds = failedOnes.flatMap((x) => (x.client ? [x.client.id] : []));
        c.audience.leadIds = failedOnes.flatMap((x) => (x.leadId ? [x.leadId] : []));
        touch(c);
        recs.unshift(c);
        return c.d;
      }),
    followUp: (communicationId, body) =>
      run(() => {
        manage();
        const input = parseInput(FollowUpRequest, body);
        const r = find(communicationId);
        const group = r.recipients.filter((x) =>
          input.group === 'OPENED'
            ? x.openCount > 0
            : input.group === 'NOT_OPENED'
              ? x.openCount === 0
              : input.group === 'CLICKED'
                ? x.clickCount > 0
                : input.group === 'NOT_CLICKED'
                  ? x.clickCount === 0
                  : ['BOUNCED', 'FAILED'].includes(x.status),
        );
        const c = make({
          channel: r.d.channel,
          name: `${r.d.name} (Follow-up)`,
          subject: r.d.subject ? `Following up: ${r.d.subject}` : null,
          body: '',
          sourceId: r.d.id,
          sourceKind: 'FOLLOW_UP',
        });
        c.audience.clientIds = group.flatMap((x) => (x.client ? [x.client.id] : []));
        c.audience.leadIds = group.flatMap((x) => (x.leadId ? [x.leadId] : []));
        touch(c);
        recs.unshift(c);
        return c.d;
      }),
    segmentFields: () => run(() => FIELDS),
    segments: (q = {}) =>
      run(() => {
        const query = parseInput(SegmentsQuery, q);
        const term = query.search?.toLowerCase();
        const rows = segs
          .filter(
            (s) =>
              (query.archived === true ? s.d.archived : !s.d.archived) &&
              (!query.type || s.d.type === query.type) &&
              (!query.audience || s.d.audience === query.audience) &&
              (!term || s.d.name.toLowerCase().includes(term)),
          )
          .map((s) => {
            const { criteria, etag, ...row } = s.d;
            void criteria;
            void etag;
            return { ...row, memberCount: segCount(s) };
          });
        return {
          items: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
          total: rows.length,
          page: query.page,
          pageSize: query.pageSize,
        };
      }),
    createSegment: (body) =>
      run(() => {
        manage();
        const input = parseInput(CreateSegmentRequest, body);
        if (segs.some((s) => s.d.name.toLowerCase() === input.name.toLowerCase() && !s.d.archived))
          throw fail(409, 'DUPLICATE_NAME', 'A segment with this name already exists.');
        const conds = (input.criteria?.conditions ?? []) as Cond[];
        for (const c of conds)
          if (!FIELDS.some((f) => f.field === c.field))
            throw fail(400, 'INVALID_CRITERIA', `${c.field} is not a field you can filter by.`);
        const pickIds = new Set([...input.clientIds, ...input.leadIds]);
        const s = newSeg(
          input.name,
          input.description ?? '',
          input.type,
          input.audience,
          input.type === 'STATIC'
            ? (c) => pickIds.has(c.id)
            : (c) =>
                (input.audience === 'LEADS'
                  ? c.kind === 'LEAD'
                  : input.audience === 'CLIENTS'
                    ? c.kind === 'CLIENT'
                    : true) && c.index % 2 ** Math.min(conds.length, 4) === 0,
          input.type === 'DYNAMIC' ? { conditions: conds } : undefined,
        );
        s.d.description = input.description ?? null;
        segs.unshift(s);
        return s.d;
      }),
    segment: (segmentId) =>
      run(() => {
        const s = segs.find((x) => x.d.id === segmentId);
        if (!s) throw fail(404, 'NOT_FOUND', 'That segment was not found.');
        return { ...s.d, memberCount: segCount(s) };
      }),
    updateSegment: (segmentId, body) =>
      run(() => {
        manage();
        const input = parseInput(UpdateSegmentRequest, body);
        const s = segs.find((x) => x.d.id === segmentId);
        if (!s) throw fail(404, 'NOT_FOUND', 'That segment was not found.');
        if (input.etag !== s.d.etag)
          throw fail(409, 'SAVE_CONFLICT', 'Someone saved this segment after you opened it.');
        if (input.name !== undefined) {
          if (
            segs.some(
              (x) =>
                x.d.id !== s.d.id &&
                x.d.name.toLowerCase() === input.name!.toLowerCase() &&
                !x.d.archived,
            )
          )
            throw fail(409, 'DUPLICATE_NAME', 'A segment with this name already exists.');
          s.d.name = input.name;
        }
        if (input.description !== undefined) s.d.description = input.description;
        if (input.audience !== undefined) s.d.audience = input.audience;
        if (input.criteria !== undefined) {
          const conds = (input.criteria.conditions ?? []) as Cond[];
          s.d.criteria = { logic: 'AND', conditions: conds, groups: [] } as never;
          s.d.criteriaSummary = conds.map(condText).join(' and ') || 'Everyone';
          s.d.lastRefreshedAt = nowIso();
        }
        s.d.etag = `e${next++}`;
        s.d.updatedAt = nowIso();
        return { ...s.d, memberCount: segCount(s) };
      }),
    previewSegment: (body) =>
      run(() => {
        const input = parseInput(PreviewSegmentRequest, body);
        const conds = (input.criteria.conditions ?? []) as Cond[];
        for (const c of conds)
          if (!FIELDS.some((f) => f.field === c.field))
            throw fail(400, 'INVALID_CRITERIA', `${c.field} is not a field you can filter by.`);
        const pool = contacts.filter(
          (c) =>
            (input.audience === 'LEADS'
              ? c.kind === 'LEAD'
              : input.audience === 'CLIENTS'
                ? c.kind === 'CLIENT'
                : true) && c.index % 2 ** Math.min(conds.length, 4) === 0,
        );
        const eligible = pool.filter(
          (c) => !c.unsubscribed && !c.invalid && !(input.channel === 'SMS' && c.noPhone),
        ).length;
        return {
          count: pool.length,
          eligibleCount: input.channel ? eligible : null,
          sample: pool
            .slice(0, input.sample)
            .map((c) => ({ kind: c.kind, id: c.id, label: c.name, secondary: c.email })),
          criteriaSummary: conds.map(condText).join(' and ') || 'Everyone',
          calculatedAt: nowIso(),
        };
      }),
    segmentMembers: (segmentId, q = {}) =>
      run(() => {
        const query = parseInput(SegmentMembersQuery, q);
        const s = segs.find((x) => x.d.id === segmentId);
        if (!s) throw fail(404, 'NOT_FOUND', 'That segment was not found.');
        const term = query.search?.toLowerCase();
        const rows = members(s)
          .filter((c) => !term || `${c.name} ${c.email}`.toLowerCase().includes(term))
          .map((c) => ({ kind: c.kind, id: c.id, label: c.name, secondary: c.email }));
        return {
          items: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
          total: rows.length,
          page: query.page,
          pageSize: query.pageSize,
        };
      }),
    setSegmentMembers: (segmentId, body) =>
      run(() => {
        manage();
        const input = parseInput(SetSegmentMembersRequest, body);
        const s = segs.find((x) => x.d.id === segmentId);
        if (!s) throw fail(404, 'NOT_FOUND', 'That segment was not found.');
        if (input.etag !== s.d.etag)
          throw fail(409, 'SAVE_CONFLICT', 'Someone saved this list after you opened it.');
        if (s.d.type !== 'STATIC')
          throw fail(400, 'INVALID_CRITERIA', 'Only a list has chosen members.');
        s.members = [
          ...input.clientIds.map((x) => ({ kind: 'CLIENT' as const, id: x })),
          ...input.leadIds.map((x) => ({ kind: 'LEAD' as const, id: x })),
        ];
        s.d.etag = `e${next++}`;
        s.d.updatedAt = nowIso();
        return { ...s.d, memberCount: segCount(s) };
      }),
    duplicateSegment: (segmentId) =>
      run(() => {
        manage();
        const s = segs.find((x) => x.d.id === segmentId);
        if (!s) throw fail(404, 'NOT_FOUND', 'That segment was not found.');
        let name = `${s.d.name} (Copy)`;
        let n = 2;
        while (segs.some((x) => x.d.name === name)) name = `${s.d.name} (Copy ${n++})`;
        const c = copy(s);
        c.d.id = id('c400');
        c.d.name = name;
        c.d.usedBy = 0;
        c.d.etag = `e${next++}`;
        segs.unshift(c);
        return { ...c.d, memberCount: segCount(c) };
      }),
    archiveSegment: (segmentId) =>
      run(() => {
        manage();
        const s = segs.find((x) => x.d.id === segmentId);
        if (!s) throw fail(404, 'NOT_FOUND', 'That segment was not found.');
        if (recs.some((r) => r.audience.segmentIds.includes(s.d.id) && r.d.status === 'SCHEDULED'))
          throw fail(409, 'SEGMENT_IN_USE', 'A scheduled communication uses this segment.');
        s.d.archived = true;
        return { ...s.d, memberCount: segCount(s) };
      }),
    restoreSegment: (segmentId) =>
      run(() => {
        manage();
        const s = segs.find((x) => x.d.id === segmentId);
        if (!s) throw fail(404, 'NOT_FOUND', 'That segment was not found.');
        s.d.archived = false;
        return { ...s.d, memberCount: segCount(s) };
      }),
    consent: (q) =>
      run(() => {
        const query = parseInput(ConsentQuery, q);
        const key = query.clientId ?? query.leadId ?? '';
        const c = byId.get(key);
        const set = consentOf.get(key);
        const at = nowIso();
        return {
          items: (['EMAIL', 'SMS'] as const).map((channel) => ({
            channel,
            status:
              set?.[channel] ??
              (c?.unsubscribed
                ? ('OPTED_OUT' as const)
                : c?.invalid && channel === 'EMAIL'
                  ? ('INVALID' as const)
                  : ('OPTED_IN' as const)),
            source: set?.[channel] ? 'Staff' : 'Sign-up',
            changedBy: set?.[channel] ? mockMe : null,
            updatedAt: at,
          })),
        };
      }),
    setConsent: (body) =>
      run(() => {
        manage();
        const input = parseInput(SetConsentRequest, body);
        const key = (input.clientId ?? input.leadId) as string;
        const cur = consentOf.get(key) ?? {};
        cur[input.channel] = input.status;
        consentOf.set(key, cur);
        const c = byId.get(key);
        if (c && input.channel === 'EMAIL') c.unsubscribed = input.status === 'OPTED_OUT';
        const at = nowIso();
        return {
          items: (['EMAIL', 'SMS'] as const).map((channel) => ({
            channel,
            status: cur[channel] ?? ('OPTED_IN' as const),
            source: cur[channel] ? 'Staff' : 'Sign-up',
            changedBy: cur[channel] ? mockMe : null,
            updatedAt: at,
          })),
        };
      }),
  };
}
