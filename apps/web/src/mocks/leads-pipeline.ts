import {
  AddLeadNoteRequest,
  ApiRequestError,
  CompleteFollowUpRequest,
  ConvertLeadToClientRequest,
  CreateLeadRequest,
  type LeadActivity,
  LeadActivityQuery,
  type LeadAppointment,
  LeadBulkRequest,
  LeadMessageRequest,
  type LeadNote,
  type LeadPipelineClient,
  LeadPipelineQuery,
  type LeadProfile,
  type LeadRow,
  type LeadStage,
  type LeadTask,
  LogLeadActivityRequest,
  type MemberRef,
  type NextActionType,
  parseInput,
  SetFollowUpRequest,
  UpdateLeadRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';

/**
 * Mock data for `api.leadPipeline` (R43 contract, the Leads page and Lead Profile). Synthetic
 * people only (invented names, example.test emails). Leads sit around today so Overdue and Last
 * Contact read naturally. It checks input with the contract's schemas and answers the API's
 * codes: `taken@example.test` is POSSIBLE_DUPLICATE on create and DUPLICATE_EMAIL on convert;
 * converting twice is ALREADY_CONVERTED. Staff see only the leads assigned to them.
 * `empty: true` (NEXT_PUBLIC_API_MOCK_EMPTY=leadPipeline) starts with no leads.
 */

type MockRole = 'OWNER' | 'ADMIN' | 'STAFF';
interface Options {
  role?: MockRole;
  empty?: boolean;
}

const HOUR = 3_600_000;
const uuid = (block: string, n: number) =>
  `0199c0c0-${block}-7000-8000-${String(n).padStart(12, '0')}`;
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const copy = <T>(value: T): T => structuredClone(value);
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();
const TAKEN = 'taken@example.test';

const staff = (n: number, name: string): MemberRef => ({
  userId: `0199c0a0-0b00-7000-8000-${String(n).padStart(12, '0')}`,
  name,
});

interface Lead {
  profile: LeadProfile;
  notes: LeadNote[];
  activity: LeadActivity[];
  tasks: LeadTask[];
  appointments: LeadAppointment[];
}

interface Store {
  leads: Lead[];
  converted: Map<string, string>;
  next: number;
}

function services() {
  return [
    'Personal Tax',
    'Business Tax',
    'Bookkeeping',
    'Payroll',
    'Tax Planning',
    'Advisory',
    'Business Formation',
  ].map((name, i) => ({ id: uuid('0e00', i + 1), name }));
}
function team() {
  return [
    staff(1, 'Morgan Avery'),
    staff(3, 'Daniel Okafor'),
    staff(6, 'Hana Kim'),
    staff(7, 'Theo Grant'),
  ];
}

function seed(empty: boolean): Store {
  const s: Store = { leads: [], converted: new Map(), next: 100 };
  if (empty) return s;
  const sv = services();
  const people = team();
  // first, last, source, detail, services, priority, stage, lastContact hours ago, next action, next in hours, staff
  const rows: [
    string,
    string,
    LeadRow['source'],
    string,
    number[],
    LeadRow['priority'],
    LeadStage,
    number | null,
    NextActionType,
    number | null,
    number,
  ][] = [
    [
      'Avery',
      'Lawson',
      'FACEBOOK_AD',
      'Back Taxes Campaign',
      [0, 2],
      'HOT',
      'NEW',
      null,
      'CALL',
      30,
      0,
    ],
    [
      'Nina',
      'Fairbanks',
      'WEBSITE_FORM',
      'Bookkeeping Landing Page',
      [1, 3],
      'WARM',
      'CONTACTED',
      70,
      'EMAIL',
      5,
      1,
    ],
    [
      'Bruno',
      'Sandoval',
      'INSTAGRAM',
      'Tax Planning Reel',
      [0, 4],
      'HOT',
      'IN_FOLLOW_UP',
      90,
      'CALL',
      2,
      2,
    ],
    [
      'Selma',
      'Shields',
      'REFERRAL',
      'Business Tax',
      [1, 2],
      'WARM',
      'APPOINTMENT_SCHEDULED',
      110,
      'APPOINTMENT',
      160,
      3,
    ],
    [
      'Ravi',
      'Greenwood',
      'GOOGLE_AD',
      'Payroll Campaign',
      [3, 6],
      'COLD',
      'QUALIFIED',
      130,
      'SEND_DOCUMENTS',
      90,
      1,
    ],
    [
      'Kendra',
      'Gill',
      'FACEBOOK_AD',
      'Small Business Campaign',
      [1, 2],
      'WARM',
      'LOST',
      200,
      'CALL',
      -40,
      2,
    ],
    [
      'Lena',
      'Brooks',
      'WEBSITE_FORM',
      'Tax Planning Landing Page',
      [4, 5],
      'HOT',
      'CONVERTED',
      70,
      'FOLLOW_UP',
      170,
      0,
    ],
    [
      'Jonah',
      'Yates',
      'INSTAGRAM',
      'General Inquiry',
      [0, 3],
      'COLD',
      'NOT_QUALIFIED',
      150,
      'CLOSE_LEAD',
      null,
      1,
    ],
    ['Marco', 'Diaz', 'BEGIN_ONLINE', 'Annual Tax', [0], 'WARM', 'NEW', null, 'CALL', -5, 3],
    [
      'Clara',
      'Voss',
      'REFERRAL',
      'Client referral',
      [2],
      'HOT',
      'IN_FOLLOW_UP',
      20,
      'EMAIL',
      26,
      2,
    ],
    [
      'Owen',
      'Hartley',
      'PHONE_CALL',
      'Called the office',
      [1],
      'WARM',
      'CONTACTED',
      48,
      'FOLLOW_UP',
      72,
      3,
    ],
    [
      'Grace',
      'Pruitt',
      'EVENT',
      'Small Business Expo',
      [6, 2],
      'COLD',
      'NEW',
      null,
      'EMAIL',
      -30,
      0,
    ],
  ];
  rows.forEach(
    ([first, last, source, detail, svc, priority, stage, contacted, action, nextIn, who], i) => {
      const n = i + 1;
      const assigned = people[who] ?? null;
      const createdAt = ago(24 * (3 + i));
      const profile: LeadProfile = {
        id: uuid('0a00', n),
        number: `LD-${10020 + n}`,
        firstName: first,
        lastName: last,
        businessName: n % 4 === 0 ? `${last} Holdings LLC` : null,
        email: `${first.toLowerCase()}.${last.toLowerCase()}@example.test`,
        phone: `(555) 030-${String(1000 + n)}`,
        avatarUrl: null,
        source,
        sourceDetail: detail,
        campaign: source.endsWith('_AD') ? { id: uuid('0c00', n % 3), name: detail } : null,
        services: svc
          .map((k) => sv[k])
          .filter((x): x is { id: string; name: string } => x !== undefined),
        priority,
        stage,
        lastContact:
          contacted === null ? null : { at: ago(contacted), channel: n % 2 ? 'CALL' : 'EMAIL' },
        nextAction:
          stage === 'CONVERTED' || stage === 'NOT_QUALIFIED'
            ? stage === 'NOT_QUALIFIED'
              ? { type: 'CLOSE_LEAD', dueAt: null, notes: 'No further action', overdue: false }
              : null
            : {
                type: action,
                dueAt: nextIn === null ? null : ago(-nextIn),
                notes: null,
                overdue: nextIn !== null && nextIn < 0,
              },
        assignedTo: assigned,
        preferredContact: n % 3 === 0 ? ['EMAIL'] : ['PHONE', 'EMAIL', 'SMS'],
        tags: n === 1 ? ['Back Taxes'] : [],
        createdAt,
        address: null,
        dateOfBirth: null,
        bestTimeToContact: n === 1 ? 'Evenings (after 5 PM)' : null,
        score: priority === 'HOT' ? { value: 85, label: 'High Intent' } : undefined,
        recentActivity: [],
        upcomingAppointments: [],
        openTasks: [],
        client: stage === 'CONVERTED' ? { id: uuid('1c00', n), name: `${first} ${last}` } : null,
        beginOnline: source === 'BEGIN_ONLINE',
        archivedAt: null,
        version: 'v1',
      };
      const activity: LeadActivity[] = [
        {
          id: uuid('0f00', n * 10 + 1),
          at: createdAt,
          kind: 'CREATED',
          label: `Lead created from ${detail}`,
          by: null,
        },
        {
          id: uuid('0f00', n * 10 + 2),
          at: createdAt,
          kind: 'STAGE_CHANGED',
          label: 'Status changed to New Lead',
          by: null,
        },
        ...(contacted === null
          ? []
          : [
              {
                id: uuid('0f00', n * 10 + 3),
                at: ago(contacted),
                kind: 'EMAIL' as const,
                label: 'Email sent: Welcome to LVP',
                by: assigned,
              },
            ]),
        ...(source === 'WEBSITE_FORM' || source === 'BEGIN_ONLINE'
          ? [
              {
                id: uuid('0f00', n * 10 + 4),
                at: createdAt,
                kind: 'FORM_SUBMITTED' as const,
                label: 'Website form submitted',
                by: null,
              },
            ]
          : []),
      ];
      const tasks: LeadTask[] =
        n === 1
          ? [
              {
                id: uuid('0d00', 1),
                title: 'Call lead',
                dueOn: ago(-30).slice(0, 10),
                priority: 'HIGH',
                done: false,
              },
              {
                id: uuid('0d00', 2),
                title: 'Send tax preparation info',
                dueOn: ago(-50).slice(0, 10),
                priority: 'MEDIUM',
                done: false,
              },
              {
                id: uuid('0d00', 3),
                title: 'Email pricing guide',
                dueOn: ago(-74).slice(0, 10),
                priority: 'MEDIUM',
                done: false,
              },
              {
                id: uuid('0d00', 4),
                title: 'Schedule consultation',
                dueOn: ago(-120).slice(0, 10),
                priority: 'LOW',
                done: false,
              },
            ]
          : [];
      const appointments: LeadAppointment[] =
        stage === 'APPOINTMENT_SCHEDULED' && assigned
          ? [
              {
                id: uuid('0b10', n),
                startsAt: ago(-160),
                endsAt: ago(-159),
                type: 'Consultation',
                staff: assigned,
                status: 'CONFIRMED',
              },
            ]
          : [];
      s.leads.push({
        profile,
        notes:
          n === 1
            ? [
                {
                  id: uuid('0e10', 1),
                  text: 'Interested in starting a small business in 2027.',
                  by: assigned,
                  at: createdAt,
                },
              ]
            : [],
        activity: activity.reverse(),
        tasks,
        appointments,
      });
    },
  );
  return s;
}

let stores: Map<string, Store> | undefined;
function storeFor(options: Options): Store {
  stores ??= new Map();
  const key = options.empty ? 'empty' : 'full';
  let s = stores.get(key);
  if (!s) {
    s = seed(options.empty ?? false);
    stores.set(key, s);
  }
  return s;
}

const toRow = (l: Lead): LeadRow => {
  const p = l.profile;
  return {
    id: p.id,
    number: p.number,
    firstName: p.firstName,
    lastName: p.lastName,
    businessName: p.businessName,
    email: p.email,
    phone: p.phone,
    avatarUrl: null,
    source: p.source,
    sourceDetail: p.sourceDetail,
    campaign: p.campaign,
    services: p.services,
    priority: p.priority,
    stage: p.stage,
    lastContact: p.lastContact,
    nextAction: p.nextAction,
    assignedTo: p.assignedTo,
    preferredContact: p.preferredContact,
    tags: p.tags,
    createdAt: p.createdAt,
  };
};

/** `api.leadPipeline` in mock mode. */
export function createLeadPipelineMock(options: Options = {}): LeadPipelineClient {
  const role = options.role ?? 'OWNER';
  const s = storeFor(options);
  const me = role === 'STAFF' ? staff(3, 'Daniel Okafor') : staff(1, 'Morgan Avery');
  const visible = (l: Lead) =>
    !l.profile.archivedAt && (role !== 'STAFF' || l.profile.assignedTo?.userId === me.userId);
  const find = (id: string) => {
    const l = s.leads.find((x) => x.profile.id === id);
    if (!l || !visible(l)) throw fail(404, 'NOT_FOUND', 'Not found');
    return l;
  };
  const view = (l: Lead): LeadProfile => ({
    ...copy(l.profile),
    recentActivity: copy(l.activity.slice(0, 5)),
    upcomingAppointments: copy(l.appointments),
    openTasks: copy(l.tasks.filter((t) => !t.done)),
  });
  const log = (l: Lead, kind: LeadActivity['kind'], label: string) => {
    l.activity.unshift({
      id: uuid('0f00', s.next++),
      at: new Date().toISOString(),
      kind,
      label,
      by: me,
    });
  };
  const bump = (l: Lead) => {
    l.profile.version = `v${Number(l.profile.version.slice(1)) + 1}`;
  };
  const services_ = services();
  const recount = (from: number, to: number, pick: (l: Lead) => boolean) =>
    s.leads.filter(
      (l) =>
        visible(l) &&
        pick(l) &&
        Date.parse(l.profile.createdAt) >= from &&
        Date.parse(l.profile.createdAt) < to,
    ).length;

  return {
    list: async (query = {}) => {
      await mockDelay();
      const q = parseInput(LeadPipelineQuery, query);
      const search = q.search?.toLowerCase() ?? '';
      const rows = s.leads
        .filter(visible)
        .filter((l) => {
          const p = l.profile;
          if (
            search &&
            ![
              `${p.firstName} ${p.lastName}`,
              p.email,
              p.phone ?? '',
              p.source,
              p.sourceDetail ?? '',
              p.campaign?.name ?? '',
              ...l.notes.map((n) => n.text),
            ].some((t) => t.toLowerCase().includes(search))
          )
            return false;
          if (q.source && p.source !== q.source) return false;
          if (q.serviceId && !p.services.some((x) => x.id === q.serviceId)) return false;
          if (q.stage && p.stage !== q.stage) return false;
          if (q.overdue && !p.nextAction?.overdue) return false;
          if (q.assignedUserId && p.assignedTo?.userId !== q.assignedUserId) return false;
          if (q.priority && p.priority !== q.priority) return false;
          if (q.campaignId && p.campaign?.id !== q.campaignId) return false;
          if (q.tag && !p.tags.includes(q.tag)) return false;
          if (q.from && p.createdAt.slice(0, 10) < q.from) return false;
          if (q.to && p.createdAt.slice(0, 10) > q.to) return false;
          return true;
        })
        .sort((a, b) => Date.parse(b.profile.createdAt) - Date.parse(a.profile.createdAt))
        .map(toRow);
      const start = (q.page - 1) * q.pageSize;
      return {
        items: copy(rows.slice(start, start + q.pageSize)),
        total: rows.length,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
    summary: async () => {
      await mockDelay();
      const now = Date.now();
      const month = 30 * 24 * HOUR;
      const live = s.leads.filter(visible);
      const count = (pick: (l: Lead) => boolean) => ({
        value: live.filter(pick).length,
        previous: s.leads.length ? recount(now - 2 * month, now - month, pick) || null : null,
      });
      return {
        total: count(() => true),
        new: count((l) => l.profile.stage === 'NEW'),
        inFollowUp: count((l) => l.profile.stage === 'IN_FOLLOW_UP'),
        converted: count((l) => l.profile.stage === 'CONVERTED'),
        notQualified: count((l) => l.profile.stage === 'NOT_QUALIFIED'),
        overdueFollowUps: count((l) => l.profile.nextAction?.overdue === true),
      };
    },
    options: async () => {
      await mockDelay();
      const tags = [...new Set(s.leads.flatMap((l) => l.profile.tags))];
      return {
        services: services_,
        staff: team(),
        campaigns: [
          { id: uuid('0c00', 0), name: 'Back Taxes Campaign' },
          { id: uuid('0c00', 1), name: 'Payroll Campaign' },
          { id: uuid('0c00', 2), name: 'Small Business Campaign' },
        ],
        tags: tags.length ? tags : ['Back Taxes'],
      };
    },

    create: async (body) => {
      await mockDelay();
      const input = parseInput(CreateLeadRequest, body);
      const dup =
        input.email === TAKEN ||
        s.leads.some(
          (l) =>
            l.profile.email === input.email || (input.phone && l.profile.phone === input.phone),
        );
      if (dup && !input.allowDuplicate)
        throw fail(
          409,
          'POSSIBLE_DUPLICATE',
          'A lead or client with this email or phone already exists',
        );
      const n = s.next++;
      const at = new Date().toISOString();
      const l: Lead = {
        profile: {
          id: uuid('0a00', n),
          number: `LD-${10020 + n}`,
          firstName: input.firstName,
          lastName: input.lastName,
          businessName: input.businessName ?? null,
          email: input.email,
          phone: input.phone ?? null,
          avatarUrl: null,
          source: input.source,
          sourceDetail: input.sourceDetail ?? null,
          campaign: null,
          services: services_.filter((x) => input.serviceIds.includes(x.id)),
          priority: input.priority,
          stage: input.stage,
          lastContact: null,
          nextAction: input.nextAction
            ? {
                type: input.nextAction.type,
                dueAt: input.nextAction.dueAt ?? null,
                notes: input.nextAction.notes ?? null,
                overdue: false,
              }
            : null,
          assignedTo:
            team().find((m) => m.userId === input.assignedUserId) ?? (role === 'STAFF' ? me : null),
          preferredContact: input.preferredContact,
          tags: [],
          createdAt: at,
          address: null,
          dateOfBirth: null,
          bestTimeToContact: null,
          recentActivity: [],
          upcomingAppointments: [],
          openTasks: [],
          client: null,
          beginOnline: false,
          archivedAt: null,
          version: 'v1',
        },
        notes: [],
        activity: [],
        tasks: [],
        appointments: [],
      };
      log(l, 'CREATED', 'Lead created');
      s.leads.unshift(l);
      return view(l);
    },
    profile: async (id) => {
      await mockDelay();
      return view(find(id));
    },
    update: async (id, body) => {
      await mockDelay();
      const input = parseInput(UpdateLeadRequest, body);
      const l = find(id);
      if (input.version && input.version !== l.profile.version)
        throw fail(409, 'SAVE_CONFLICT', 'Someone saved this lead first');
      const p = l.profile;
      const { version: _v, serviceIds, assignedUserId, campaignId, stage, ...rest } = input;
      for (const [k, v] of Object.entries(rest)) if (v !== undefined) Object.assign(p, { [k]: v });
      if (serviceIds) p.services = services_.filter((x) => serviceIds.includes(x.id));
      if (assignedUserId !== undefined) {
        p.assignedTo = team().find((m) => m.userId === assignedUserId) ?? null;
        log(l, 'ASSIGNED', `Assigned to ${p.assignedTo?.name ?? 'nobody'}`);
      }
      if (campaignId !== undefined)
        p.campaign = campaignId ? { id: campaignId, name: 'Campaign' } : null;
      if (stage && stage !== p.stage) {
        if (p.stage === 'CONVERTED')
          throw fail(409, 'ALREADY_CONVERTED', 'This lead is already a client');
        p.stage = stage;
        log(l, 'STAGE_CHANGED', `Status changed to ${stage}`);
      }
      bump(l);
      return view(l);
    },
    bulk: async (body) => {
      await mockDelay();
      const input = parseInput(LeadBulkRequest, body);
      let changed = 0;
      for (const id of input.ids) {
        const l = s.leads.find((x) => x.profile.id === id);
        if (!l || !visible(l) || (input.action !== 'TAGS' && l.profile.stage === 'CONVERTED'))
          continue;
        if (input.action === 'ASSIGN')
          l.profile.assignedTo = team().find((m) => m.userId === input.assignedUserId) ?? null;
        if (input.action === 'STAGE') l.profile.stage = input.stage;
        if (input.action === 'CAMPAIGN')
          l.profile.campaign = { id: input.campaignId, name: 'Campaign' };
        if (input.action === 'TAGS')
          l.profile.tags = [...new Set([...l.profile.tags, ...input.add])];
        if (input.action === 'ARCHIVE') l.profile.archivedAt = new Date().toISOString();
        bump(l);
        changed += 1;
      }
      return { changed, skipped: input.ids.length - changed };
    },
    message: async (body) => {
      await mockDelay();
      const input = parseInput(LeadMessageRequest, body);
      let changed = 0;
      for (const id of input.ids) {
        const l = s.leads.find((x) => x.profile.id === id);
        if (!l || !visible(l) || (input.channel === 'SMS' && !l.profile.phone)) continue;
        log(
          l,
          input.channel,
          input.channel === 'EMAIL' ? `Email sent: ${input.subject ?? 'Message'}` : 'SMS sent',
        );
        l.profile.lastContact = { at: new Date().toISOString(), channel: input.channel };
        changed += 1;
      }
      return { changed, skipped: input.ids.length - changed };
    },

    setFollowUp: async (id, body) => {
      await mockDelay();
      const input = parseInput(SetFollowUpRequest, body);
      const l = find(id);
      l.profile.nextAction = {
        type: input.type,
        dueAt: input.dueAt ?? null,
        notes: input.notes ?? null,
        overdue: input.dueAt ? Date.parse(input.dueAt) < Date.now() : false,
      };
      log(l, 'FOLLOW_UP', 'Follow-up scheduled');
      bump(l);
      return view(l);
    },
    completeFollowUp: async (id, body = {}) => {
      await mockDelay();
      const input = parseInput(CompleteFollowUpRequest, body);
      const l = find(id);
      log(l, 'FOLLOW_UP', `Follow-up completed${input.outcome ? `: ${input.outcome}` : ''}`);
      l.profile.lastContact = { at: new Date().toISOString(), channel: 'OTHER' };
      l.profile.nextAction = input.next
        ? {
            type: input.next.type,
            dueAt: input.next.dueAt ?? null,
            notes: input.next.notes ?? null,
            overdue: false,
          }
        : null;
      bump(l);
      return view(l);
    },
    activity: async (id, query = {}) => {
      await mockDelay();
      const q = parseInput(LeadActivityQuery, query);
      const items = find(id).activity.filter(
        (a) => q.kind === 'all' || ['CALL', 'EMAIL', 'SMS'].includes(a.kind),
      );
      return { items: copy(items.slice(0, q.limit)), nextCursor: null };
    },
    logActivity: async (id, body) => {
      await mockDelay();
      const input = parseInput(LogLeadActivityRequest, body);
      const l = find(id);
      log(l, input.kind, input.summary);
      if (['CALL', 'EMAIL', 'SMS'].includes(input.kind)) {
        l.profile.lastContact = {
          at: input.at ?? new Date().toISOString(),
          channel: input.kind as 'CALL' | 'EMAIL' | 'SMS',
        };
      }
      return copy(l.activity[0] as LeadActivity);
    },
    notes: async (id) => {
      await mockDelay();
      return copy(find(id).notes);
    },
    addNote: async (id, body) => {
      await mockDelay();
      const { text } = parseInput(AddLeadNoteRequest, body);
      const l = find(id);
      const note: LeadNote = {
        id: uuid('0e10', s.next++),
        text,
        by: me,
        at: new Date().toISOString(),
      };
      l.notes.unshift(note);
      log(l, 'NOTE', 'Note added');
      return copy(note);
    },
    tasks: async (id) => {
      await mockDelay();
      return copy(find(id).tasks);
    },
    appointments: async (id) => {
      await mockDelay();
      return copy(find(id).appointments);
    },
    documentsAndForms: async (id) => {
      await mockDelay();
      const l = find(id);
      return l.profile.beginOnline
        ? {
            documents: [
              {
                id: uuid('0b20', 1),
                fileName: 'W-2_2025.pdf',
                uploadedAt: l.profile.createdAt,
                scanStatus: 'CLEAN',
              },
            ],
            forms: [
              {
                id: uuid('0b30', 1),
                name: 'Personal Tax Intake Form',
                status: 'SUBMITTED',
                sentAt: l.profile.createdAt,
              },
            ],
          }
        : { documents: [], forms: [] };
    },

    convertToClient: async (id, body) => {
      await mockDelay();
      const input = parseInput(ConvertLeadToClientRequest, body);
      const again = s.converted.get(input.idempotencyKey);
      const l = find(id);
      if (again) {
        return {
          clientId: again,
          engagementIds: input.serviceIds.map((_, i) => uuid('1e00', i)),
          inviteSent: input.sendPortalInvite,
          carried: {
            notes: 0,
            communications: 0,
            appointments: 0,
            tasks: 0,
            documents: 0,
            intakeForms: 0,
          },
        };
      }
      if (l.profile.stage === 'CONVERTED')
        throw fail(409, 'ALREADY_CONVERTED', 'This lead is already a client');
      if (input.email === TAKEN && !input.clientId)
        throw fail(409, 'DUPLICATE_EMAIL', 'A client with this email already exists');
      const clientId = input.clientId ?? uuid('1c00', s.next++);
      l.profile.stage = 'CONVERTED';
      l.profile.client = { id: clientId, name: input.fullName };
      l.profile.nextAction = null;
      log(l, 'CONVERTED', 'Converted to client');
      bump(l);
      s.converted.set(input.idempotencyKey, clientId);
      const c = input.carryOver;
      return {
        clientId,
        engagementIds: input.serviceIds.map((_, i) => uuid('1e00', s.next + i)),
        inviteSent: input.sendPortalInvite,
        carried: {
          notes: c.notes ? l.notes.length : 0,
          communications: c.communications
            ? l.activity.filter((a) => ['CALL', 'EMAIL', 'SMS'].includes(a.kind)).length
            : 0,
          appointments: c.appointments ? l.appointments.length : 0,
          tasks: c.tasks ? l.tasks.length : 0,
          documents: c.documents && l.profile.beginOnline ? 1 : 0,
          intakeForms: c.intakeForms && l.profile.beginOnline ? 1 : 0,
        },
      };
    },
  };
}
