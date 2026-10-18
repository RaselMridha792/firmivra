import type {
  ActivityKind,
  AppointmentType,
  LeadSource,
  LinkedTransaction,
  LostReason,
  PipelineStage,
  PlanId,
  SalesActivity,
  SalesActor,
  SalesAppointment,
  SalesCommunication,
  SalesDocument,
  SalesNote,
  SalesRep,
  SalesTag,
  SalesTask,
  SalesView,
} from './admin-sales';

/**
 * The starting records of the Super Admin sales mock (mocks/admin-sales.ts): about a hundred
 * synthetic prospects on the default pipeline, spread over its ten stages, with their history,
 * appointments, follow-ups, notes, outreach and proposals. Every date is relative to the moment
 * the mock starts, so the KPIs, trends and attention badges read naturally on any day. The data
 * comes from a fixed pseudo-random sequence: the same records on every run. Invented names only
 * ("Sample …", "Example …"), example.test emails and 555-01xx phone numbers.
 */

export type StoredStage = PipelineStage;
export interface StoredPipeline {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  stages: StoredStage[];
  createdAt: string;
  updatedAt: string;
}
export interface StoredOpportunity {
  id: string;
  pipelineId: string;
  stageId: string;
  firmName: string;
  contactName: string;
  email: string | null;
  phone: string | null;
  valueCents: number | null;
  plan: PlanId | null;
  extraUsers: number;
  extraLocations: number;
  source: LeadSource;
  ownerId: string | null;
  tagIds: string[];
  createdAt: string;
  stageEnteredAt: string;
  lastActivityAt: string;
  attempts: number;
  contactedAt: string | null;
  nextFollowUpAt: string | null;
  nextStep: string | null;
  trialStartedAt: string | null;
  trialEndsAt: string | null;
  convertedAt: string | null;
  closedAt: string | null;
  lostAt: string | null;
  lostReason: LostReason | null;
  lostNote: string | null;
  transaction: LinkedTransaction | null;
}
export interface SalesStore {
  reps: SalesRep[];
  tags: SalesTag[];
  pipelines: StoredPipeline[];
  opportunities: StoredOpportunity[];
  activities: SalesActivity[];
  appointments: SalesAppointment[];
  notes: SalesNote[];
  tasks: SalesTask[];
  communications: SalesCommunication[];
  documents: SalesDocument[];
  viewPreference: SalesView;
  /** The last number used in a new id. */
  next: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const uuid = (block: string, n: number) =>
  `0199d1a0-${block}-7000-8000-${String(n).padStart(12, '0')}`;

const REPS = [
  { n: 1, name: 'Morgan Admin', role: 'Owner / Super Admin' },
  { n: 2, name: 'Jordan Example', role: 'Sales Manager' },
  { n: 3, name: 'Taylor Sample', role: 'Sales Rep' },
  { n: 4, name: 'Alex Demo', role: 'Sales Rep' },
];
const TAGS = [
  'Hot Lead',
  'Multi-location',
  'Referral Partner',
  'Tax Season',
  'Webinar',
  'Switching Software',
];
const PREFIXES = [
  'Brightpath',
  'Summit',
  'Riverbend',
  'Blue Ridge',
  'Stonebridge',
  'Cedar Lane',
  'Thrivewell',
  'Redwood',
  'Quillfeather',
  'Metro',
  'NextGen',
  'Coastal',
  'Horizon',
  'Clearview',
  'Pinecrest',
  'Silver Maple',
  'Northgate',
  'Harborview',
  'Oak Hollow',
  'Granite',
  'Meadowlark',
  'Copper Kettle',
  'Lakeshore',
  'Ironwood',
  'Bluebell',
];
const SUFFIXES = ['Tax', 'CPA', 'Books', 'Advisory', 'Tax Co', 'Accounting', 'Ledger', 'Tax Group'];
const FIRST = [
  'Lisa',
  'Robert',
  'Karen',
  'Steven',
  'Rachel',
  'Michael',
  'Samantha',
  'Laura',
  'Andrew',
  'Tom',
  'James',
  'Mark',
  'Danielle',
  'Nicole',
  'Kevin',
  'David',
  'Daniel',
  'Patricia',
  'Susan',
  'Priya',
];
const LAST = ['Sample', 'Example', 'Test', 'Demo', 'Placeholder', 'Dummy'];
const AREAS = ['212', '312', '415', '512', '617'];
const SOURCE_BAG: LeadSource[] = [
  'WEBSITE',
  'WEBSITE',
  'WEBSITE',
  'WEBSITE',
  'REFERRAL',
  'REFERRAL',
  'REFERRAL',
  'SOCIAL_MEDIA',
  'SOCIAL_MEDIA',
  'PAID_ADVERTISING',
  'ORGANIC_SEARCH',
  'EVENT',
  'PARTNER',
  'MANUAL_ENTRY',
  'OTHER',
];
const PLAN_BAG: PlanId[] = [
  'SOLO_CORE',
  'SOLO_PRO',
  'SOLO_PRO',
  'SOLO_ELITE',
  'TEAM_PRO',
  'TEAM_PRO',
  'TEAM_PRO',
  'BUSINESS',
  'BUSINESS',
  'ENTERPRISE',
];
const LOST_BAG: LostReason[] = [
  'NOT_A_FIT',
  'BUDGET',
  'NO_RESPONSE',
  'CHOSE_COMPETITOR',
  'TIMING',
  'OTHER',
  'BUDGET',
  'INVALID_LEAD',
];
/** Records per stage of the default pipeline, in stage order. */
const PER_STAGE = [12, 10, 11, 10, 8, 7, 12, 6, 14, 8];
/** Days since creation, [min, max], per stage. */
const AGE: [number, number][] = [
  [0.1, 6],
  [3, 22],
  [5, 30],
  [8, 45],
  [10, 50],
  [20, 80],
  [28, 110],
  [45, 140],
  [70, 220],
  [6, 95],
];
const NEXT_STEPS = [
  'Send the pricing overview',
  'Book a product demo',
  'Answer questions on data migration',
  'Share the client portal walkthrough',
  'Check trial progress',
  'Review the proposal together',
  'Confirm the onboarding date',
];
const NOTES = [
  'Wants the client portal and e-signatures in one place before tax season.',
  'Currently on spreadsheets and email; asked about importing client lists.',
  'Two partners decide together; send material to both.',
  'Asked whether payroll clients can upload documents from a phone.',
];

/** A fixed pseudo-random sequence (linear congruential), so every run seeds the same records. */
function sequence(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

export function seedSales(options: {
  now: number;
  empty: boolean;
  stages: StoredStage[];
  monthly: (plan: PlanId, extraUsers: number, extraLocations: number) => number;
  maxExtraUsers: (plan: PlanId) => number;
  planName: (plan: PlanId) => string;
  lostReasonLabel: (reason: LostReason) => string;
  appointmentTypeLabel: (type: AppointmentType) => string;
}): SalesStore {
  const { now, stages } = options;
  const random = sequence(20_261_018);
  const minute = (ms: number) => Math.round(ms / 60_000) * 60_000;
  const iso = (ms: number) => new Date(minute(ms)).toISOString();
  const daysAgo = (days: number) => now - days * DAY;
  const between = (min: number, max: number) => min + random() * (max - min);
  /** A whole hour between 9 AM and 4 PM, `days` from today. */
  const slot = (days: number, hour: number) => {
    const date = new Date(now + days * DAY);
    date.setHours(hour, hour % 2 ? 30 : 0, 0, 0);
    return date.getTime();
  };

  const pipelineId = uuid('5a01', 1);
  const store: SalesStore = {
    reps: REPS.map(({ n, name, role }) => ({ id: uuid('5a03', n), name, role })),
    tags: TAGS.map((name, index) => ({ id: uuid('5a04', index + 1), name })),
    pipelines: [
      {
        id: pipelineId,
        name: 'Firmivra Sales Pipeline',
        description: 'The approved lifecycle from first inquiry to closed or past client.',
        isDefault: true,
        stages,
        createdAt: new Date(daysAgo(240)).toISOString(),
        updatedAt: new Date(daysAgo(30)).toISOString(),
      },
    ],
    opportunities: [],
    activities: [],
    appointments: [],
    notes: [],
    tasks: [],
    communications: [],
    documents: [],
    viewPreference: 'CARD',
    next: 10_000,
  };
  if (options.empty) return store;

  let counter = 0;
  const id = (block: string) => {
    counter += 1;
    return uuid(block, counter);
  };
  const me: SalesActor = { kind: 'USER', name: 'Morgan Admin' };
  const sync: SalesActor = { kind: 'SYSTEM', name: 'Transactions sync' };

  let index = 0;
  stages.forEach((stage, stageIndex) => {
    const count = PER_STAGE[stageIndex] ?? 0;
    for (let k = 0; k < count; k += 1) {
      const i = index;
      index += 1;
      const [minAge, maxAge] = AGE[stageIndex] ?? [1, 30];
      const createdDays = between(minAge, maxAge);
      const created = daysAgo(createdDays);
      const prefix = PREFIXES[i % PREFIXES.length] ?? 'Sample';
      const suffix = SUFFIXES[(i * 3) % SUFFIXES.length] ?? 'Tax';
      const firmName = `${i % 2 ? 'Example' : 'Sample'} ${prefix} ${suffix}`;
      const first = FIRST[i % FIRST.length] ?? 'Sam';
      const last = LAST[Math.floor(i / FIRST.length) % LAST.length] ?? 'Sample';
      const slug = `${prefix}-${suffix}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const owner = i % 11 === 5 ? null : (store.reps[i % store.reps.length]?.id ?? null);
      const plan =
        stageIndex <= 1 && random() < 0.4
          ? null
          : (PLAN_BAG[Math.floor(random() * PLAN_BAG.length)] ?? 'SOLO_PRO');
      const extraUsers = plan ? Math.min(options.maxExtraUsers(plan), Math.floor(random() * 6)) : 0;
      const extraLocations = plan === 'ENTERPRISE' ? Math.floor(random() * 3) : 0;
      const monthly = plan ? options.monthly(plan, extraUsers, extraLocations) : null;
      const isLost = stage.type === 'LOST';
      // A lost record left from one of the first five stages.
      const lostFrom = isLost ? i % 5 : null;
      const reached = isLost ? (lostFrom ?? 0) >= 2 : stageIndex >= 2;

      const tagIds: string[] = [];
      const tag = (n: number) => store.tags[n]?.id;
      if (i % 5 === 0) tagIds.push(tag(0) ?? '');
      if (plan === 'ENTERPRISE') tagIds.push(tag(1) ?? '');
      if (i % 6 === 1) tagIds.push(tag(3) ?? '');
      if (i % 8 === 2) tagIds.push(tag(5) ?? '');

      const opp: StoredOpportunity = {
        id: uuid('5a00', i + 1),
        pipelineId,
        stageId: stage.id,
        firmName,
        contactName: `${first} ${last}`,
        email: `${first}.${last}@${slug}.example.test`.toLowerCase(),
        phone: `(${AREAS[i % AREAS.length] ?? '212'}) 555-01${String(i % 100).padStart(2, '0')}`,
        valueCents: monthly !== null && i % 10 !== 3 ? monthly * 12 : null,
        plan,
        extraUsers,
        extraLocations,
        source: SOURCE_BAG[Math.floor(random() * SOURCE_BAG.length)] ?? 'WEBSITE',
        ownerId: owner,
        tagIds: tagIds.filter(Boolean),
        createdAt: iso(created),
        stageEnteredAt: iso(created),
        lastActivityAt: iso(created),
        attempts: 0,
        contactedAt: null,
        nextFollowUpAt: null,
        nextStep: null,
        trialStartedAt: null,
        trialEndsAt: null,
        convertedAt: null,
        closedAt: null,
        lostAt: null,
        lostReason: null,
        lostNote: null,
        transaction: null,
      };

      const activity: Omit<SalesActivity, 'id'>[] = [];
      const add = (
        kind: ActivityKind,
        at: number,
        text: string,
        extra: Partial<
          Pick<SalesActivity, 'actor' | 'valueCents' | 'fromStage' | 'toStage' | 'detail'>
        > = {},
      ) =>
        activity.push({
          opportunityId: opp.id,
          firmName,
          kind,
          text,
          actor: extra.actor ?? me,
          at: iso(Math.min(at, now)),
          valueCents: extra.valueCents ?? null,
          fromStage: extra.fromStage ?? null,
          toStage: extra.toStage ?? null,
          detail: extra.detail ?? null,
        });
      const ownerName = store.reps.find((rep) => rep.id === owner)?.name ?? 'Unassigned';
      add('CREATED', created, `New lead added: ${firmName}`, {
        toStage: stages[0]?.name ?? null,
        detail: `Owner: ${ownerName}. Stage: ${stages[0]?.name ?? 'New Lead'}.`,
      });

      // When the record reached its stage, and when anything last happened.
      let entered = created;
      if (stage.type === 'CONVERTED') {
        opp.convertedAt = iso(daysAgo(Math.min(between(2, 26), createdDays - 1)));
        entered = Date.parse(opp.convertedAt);
      } else if (stage.type === 'TRANSACTION' || stage.type === 'CLOSED') {
        const convertedDays = Math.min(between(25, 70), createdDays - 2);
        opp.convertedAt = iso(daysAgo(convertedDays));
        const linked = daysAgo(convertedDays - 1);
        const closedDays = Math.max(0.5, Math.min(between(2, 60), convertedDays - 2));
        opp.transaction = {
          reference: `TX-2026-${String(1_000 + i)}`,
          status: stage.type === 'CLOSED' ? 'CLOSED' : 'UNDER_CONTRACT',
          linkedAt: iso(linked),
          estimatedCloseAt: stage.type === 'CLOSED' ? null : iso(now + between(5, 50) * DAY),
          closedAt: stage.type === 'CLOSED' ? iso(daysAgo(closedDays)) : null,
        };
        entered = stage.type === 'CLOSED' ? daysAgo(closedDays) : linked + HOUR;
        if (stage.type === 'CLOSED') opp.closedAt = iso(entered);
      } else if (isLost) {
        entered = daysAgo(Math.min(between(1, 35), createdDays - 0.5));
        opp.lostAt = iso(entered);
        opp.lostReason = LOST_BAG[i % LOST_BAG.length] ?? 'OTHER';
        opp.lostNote =
          opp.lostReason === 'OTHER' ? 'Staying with their current software this year.' : null;
      } else if (stageIndex > 0) {
        entered = created + (now - created) * between(0.3, 0.85);
      }
      opp.stageEnteredAt = iso(entered);

      // Outreach: attempts until the first two-way contact.
      opp.attempts = stageIndex === 0 && !isLost ? 0 : stageIndex === 1 ? 1 + (i % 4) : 1 + (i % 3);
      const contactWindow = Math.max(HOUR, (entered - created) * 0.6);
      for (let attempt = 1; attempt <= opp.attempts; attempt += 1) {
        const at = created + (contactWindow * attempt) / (opp.attempts + 1);
        const channel = attempt % 2 ? 'CALL' : 'EMAIL';
        store.communications.push({
          id: id('5a09'),
          opportunityId: opp.id,
          channel,
          direction: 'OUTBOUND',
          summary: channel === 'CALL' ? 'Call: no answer, left a voicemail' : 'Email: introduction',
          at: iso(at),
          by: ownerName === 'Unassigned' ? me.name : ownerName,
        });
        add('OUTREACH_ATTEMPT', at, `Outreach attempt ${attempt} to ${firmName}`, {
          detail: channel === 'CALL' ? 'Call' : 'Email',
        });
      }
      if (reached) {
        const at = created + contactWindow;
        opp.contactedAt = iso(at);
        store.communications.push({
          id: id('5a09'),
          opportunityId: opp.id,
          channel: 'EMAIL',
          direction: 'INBOUND',
          summary: `Email reply from ${first} ${last}`,
          at: iso(at),
          by: `${first} ${last}`,
        });
        add('CONTACTED', at, `Reached ${first} ${last} at ${firmName}`, { detail: 'Email' });
      }

      // Stage history: every step from the first stage to this one.
      const path = isLost ? stages.slice(0, (lostFrom ?? 0) + 1) : stages.slice(0, stageIndex + 1);
      const steps = path.length - 1;
      path.forEach((pathStage, n) => {
        if (n === 0) return;
        const before = path[n - 1];
        const final = n === steps && !isLost;
        const at = final ? entered : created + ((entered - created) * n) / (steps + 1);
        const transactionDriven =
          final && (stage.type === 'TRANSACTION' || stage.type === 'CLOSED');
        add('STAGE_CHANGED', at, `Moved ${firmName} to ${pathStage.name}`, {
          actor: transactionDriven ? sync : me,
          fromStage: before?.name ?? null,
          toStage: pathStage.name,
        });
      });
      if (isLost && opp.lostReason) {
        add('LOST', entered, `Marked ${firmName} as ${stage.name}`, {
          fromStage: path[path.length - 1]?.name ?? null,
          toStage: stage.name,
          detail: [options.lostReasonLabel(opp.lostReason), opp.lostNote]
            .filter(Boolean)
            .join(': '),
        });
      }
      if (opp.convertedAt)
        add('WON', Date.parse(opp.convertedAt), `Won ${firmName}`, { valueCents: monthly });
      if (opp.transaction) {
        add(
          'TRANSACTION_LINKED',
          Date.parse(opp.transaction.linkedAt),
          `Linked transaction ${opp.transaction.reference} to ${firmName}`,
          {
            detail: opp.transaction.reference,
          },
        );
        add(
          'UNDER_CONTRACT',
          Date.parse(opp.transaction.linkedAt) + HOUR,
          `Transaction ${opp.transaction.reference} is under contract`,
          {
            actor: sync,
            detail: opp.transaction.reference,
          },
        );
        if (opp.transaction.closedAt)
          add(
            'CLOSED',
            Date.parse(opp.transaction.closedAt),
            `Transaction ${opp.transaction.reference} closed`,
            {
              actor: sync,
              detail: opp.transaction.reference,
            },
          );
      }

      // Trials and proposals.
      if (
        (stageIndex === 3 || stageIndex === 4 || stageIndex === 5) &&
        i % 3 === 0 &&
        plan &&
        plan !== 'ENTERPRISE'
      ) {
        const started = Math.max(created + DAY, daysAgo(between(1, 11)));
        opp.trialStartedAt = iso(started);
        opp.trialEndsAt = iso(started + 14 * DAY);
        add('TRIAL_STARTED', started, `Started a 14-day trial for ${firmName}`, {
          valueCents: monthly,
        });
      }
      if (plan && stageIndex >= 4 && !isLost && i % 2 === 0) {
        const sent = Math.min(entered, created + (entered - created) * 0.8);
        store.documents.push({
          id: id('5a0a'),
          opportunityId: opp.id,
          name: `Proposal – ${options.planName(plan)}.pdf`,
          addedAt: iso(sent),
        });
        add('PROPOSAL_SENT', sent, `Sent a proposal to ${firmName}`, { valueCents: monthly });
      }

      // Appointments: the Appointment Set stage always has one ahead; others now and then.
      const book = (type: AppointmentType, startsAt: number, bookedAt: number, done: boolean) => {
        const appointment: SalesAppointment = {
          id: id('5a06'),
          opportunityId: opp.id,
          firmName,
          contactName: opp.contactName,
          type,
          startsAt: iso(startsAt),
          assignedId: owner ?? store.reps[0]?.id ?? null,
          assignedName: null,
          status: done ? 'COMPLETED' : 'SCHEDULED',
          createdAt: iso(Math.min(bookedAt, now)),
        };
        store.appointments.push(appointment);
        add(
          'APPOINTMENT_SCHEDULED',
          bookedAt,
          `Scheduled ${options.appointmentTypeLabel(type).toLowerCase()} with ${firmName}`,
          {
            detail: options.appointmentTypeLabel(type),
          },
        );
      };
      const hour = 9 + (i % 8);
      if (stageIndex === 4)
        book(i % 2 ? 'INITIAL_CONSULTATION' : 'DEMO', slot(1 + (i % 12), hour), entered, false);
      if (stageIndex === 3 && opp.trialStartedAt)
        book('TRIAL_CHECK_IN', slot(2 + (i % 9), hour), now - 2 * DAY, false);
      if (stageIndex === 3 && i % 5 === 2)
        book('PROPOSAL_REVIEW', slot(3 + (i % 7), hour), now - 3 * DAY, false);
      if (stageIndex === 5 && i % 3 !== 1)
        book('FOLLOW_UP', slot(2 + (i % 10), hour), now - DAY, false);
      if (stageIndex === 6 && i % 4 === 0)
        book('CHECK_IN', slot(4 + (i % 8), hour), now - 4 * DAY, false);
      if (stageIndex >= 5 && stageIndex <= 8 && i % 3 === 0)
        book(
          'DEMO',
          created + (entered - created) * 0.4,
          created + (entered - created) * 0.3,
          true,
        );

      // Follow-ups on open records: some overdue, some due soon, some later.
      const open =
        stage.type === 'ACTIVE' || stage.type === 'CONVERTED' || stage.type === 'TRANSACTION';
      const step = NEXT_STEPS[(stageIndex + i) % NEXT_STEPS.length] ?? NEXT_STEPS[0] ?? '';
      if (open && stageIndex > 0) {
        const pattern = i % 6;
        const due =
          pattern === 0
            ? now - between(1, 4) * DAY
            : pattern === 1
              ? now + between(4, 30) * HOUR
              : pattern <= 3
                ? now + between(3, 12) * DAY
                : null;
        if (due !== null) {
          opp.nextFollowUpAt = iso(due);
          opp.nextStep = step;
          store.tasks.push({
            id: id('5a08'),
            opportunityId: opp.id,
            title: step,
            dueAt: iso(due),
            done: false,
            completedAt: null,
          });
        }
      }
      if (stageIndex >= 2 && i % 4 === 1) {
        const at = created + (entered - created) * 0.5;
        store.tasks.push({
          id: id('5a08'),
          opportunityId: opp.id,
          title: 'Send the welcome pack',
          dueAt: iso(at),
          done: true,
          completedAt: iso(at),
        });
        add('FOLLOW_UP_COMPLETED', at, `Completed follow-up for ${firmName}`, {
          detail: 'Send the welcome pack',
        });
      }
      if (i % 4 === 0) {
        const note = NOTES[(i / 4) % NOTES.length] ?? NOTES[0] ?? '';
        store.notes.push({
          id: id('5a07'),
          opportunityId: opp.id,
          body: note,
          author: ownerName === 'Unassigned' ? me.name : ownerName,
          createdAt: iso(created + HOUR),
        });
        add('NOTE_ADDED', created + HOUR, `Added a note to ${firmName}`);
      }

      // Last activity: the latest entry of its history.
      opp.lastActivityAt = iso(Math.max(...activity.map((entry) => Date.parse(entry.at))));

      store.opportunities.push(opp);
      for (const entry of activity) store.activities.push({ ...entry, id: id('5a05') });
    }
  });

  store.activities.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  store.next = 10_000 + counter;
  return store;
}
