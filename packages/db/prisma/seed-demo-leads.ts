// Demo seed, stage 3 (R0, PART 2): leads for the Leads list, the pipeline board and a lead's
// profile tabs. Begin Online leads arrive the real way (an intake on the service's form, signed
// and submitted, then the lead leaves DRAFT); the rest are prospects staff entered from a
// referral, an ad, a call or an event, each with an owner, a priority, the next follow-up and an
// activity trail. Every pipeline status except converted and expired shows up (those need a
// conversion or a 30-day-old draft, which the API makes). Synthetic people, `.test` emails, 555
// numbers.
import { runInScope, type createPrismaClient } from '../src/client.js';
import { demoId, SEED_DEMO_USERS, type DemoStaffKey } from './seed-demo-data.js';
import { demoDay } from './seed-demo-engagements.js';
import { submitSigned, type FormLookup } from './seed-demo-intake.js';
import type { DemoOrgResult } from './seed-demo-org.js';

type Prisma = ReturnType<typeof createPrismaClient>;

type Status =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'IN_REVIEW'
  | 'DECLINED'
  | 'CONTACTED'
  | 'IN_FOLLOW_UP'
  | 'APPOINTMENT_SCHEDULED'
  | 'QUALIFIED'
  | 'LOST';

interface DemoActivity {
  kind: 'CALL' | 'EMAIL_SENT' | 'NOTE' | 'MEETING' | 'SMS_SENT';
  text: string;
}

interface DemoLead {
  key: string;
  first: string;
  last: string;
  business?: string;
  service: string;
  extraService?: string;
  source:
    | 'BEGIN_ONLINE'
    | 'WEBSITE_FORM'
    | 'FACEBOOK_AD'
    | 'INSTAGRAM'
    | 'GOOGLE_AD'
    | 'REFERRAL'
    | 'PHONE_CALL'
    | 'WALK_IN'
    | 'EMAIL'
    | 'EVENT';
  sourceDetail?: string;
  status: Status;
  priority?: 'HOT' | 'WARM' | 'COLD';
  owner?: DemoStaffKey;
  next?: {
    type: 'CALL' | 'EMAIL' | 'SMS' | 'APPOINTMENT' | 'SEND_DOCUMENTS' | 'FOLLOW_UP';
    day: number;
    note: string;
  };
  city: string;
  declineReason?: string;
  contact: ('EMAIL' | 'PHONE' | 'TEXT')[];
  activities?: DemoActivity[];
}

const LEADS: readonly DemoLead[] = [
  {
    key: 'l01',
    first: 'Nora',
    last: 'Whitfield',
    service: 'Annual Tax',
    source: 'BEGIN_ONLINE',
    status: 'SUBMITTED',
    priority: 'HOT',
    owner: 'manager',
    next: { type: 'CALL', day: 1, note: 'Review her 2025 W-2s and rental income' },
    city: 'Decatur',
    contact: ['EMAIL', 'PHONE'],
  },
  {
    key: 'l02',
    first: 'Elijah',
    last: 'Park',
    business: 'Park & Rowe Coffee Co.',
    service: 'Bookkeeping',
    extraService: 'Payroll',
    source: 'BEGIN_ONLINE',
    status: 'IN_REVIEW',
    priority: 'WARM',
    owner: 'bookkeeper',
    next: { type: 'EMAIL', day: 2, note: 'Send the Growth package quote' },
    city: 'Atlanta',
    contact: ['EMAIL'],
  },
  {
    key: 'l03',
    first: 'Mia',
    last: 'Hernandez',
    service: 'Tax Planning',
    source: 'BEGIN_ONLINE',
    status: 'SUBMITTED',
    priority: 'WARM',
    city: 'Marietta',
    contact: ['EMAIL', 'TEXT'],
  },
  {
    key: 'l04',
    first: 'Owen',
    last: 'Gallagher',
    business: 'Gallagher Freight Partners',
    service: 'Payroll',
    source: 'BEGIN_ONLINE',
    status: 'DECLINED',
    priority: 'COLD',
    owner: 'manager',
    city: 'Savannah',
    declineReason: 'Payroll in 14 states is outside our current service area.',
    contact: ['EMAIL'],
  },
  {
    key: 'l05',
    first: 'Grace',
    last: 'Liu',
    service: 'Annual Tax',
    source: 'BEGIN_ONLINE',
    status: 'DRAFT',
    city: 'Roswell',
    contact: ['EMAIL'],
  },
  {
    key: 'l06',
    first: 'Daniel',
    last: 'Okoye',
    service: 'Annual Tax',
    source: 'REFERRAL',
    sourceDetail: 'Referred by Harper Coleman',
    status: 'CONTACTED',
    priority: 'WARM',
    owner: 'manager',
    next: { type: 'FOLLOW_UP', day: 3, note: 'Check whether he received the engagement letter' },
    city: 'Atlanta',
    contact: ['PHONE'],
    activities: [
      { kind: 'CALL', text: 'Intro call: two W-2s and a brokerage account' },
      { kind: 'EMAIL_SENT', text: 'Sent the document checklist' },
    ],
  },
  {
    key: 'l07',
    first: 'Sofia',
    last: 'Marchetti',
    business: 'Marchetti Design Studio',
    service: 'Bookkeeping',
    source: 'WEBSITE_FORM',
    sourceDetail: 'Bookkeeping landing page',
    status: 'IN_FOLLOW_UP',
    priority: 'HOT',
    owner: 'bookkeeper',
    next: { type: 'EMAIL', day: 0, note: 'Answer her question about QuickBooks migration' },
    city: 'Atlanta',
    contact: ['EMAIL', 'TEXT'],
    activities: [
      { kind: 'MEETING', text: 'Discovery meeting: 18 months of uncategorized transactions' },
      { kind: 'NOTE', text: 'Wants monthly close by the 10th. Good fit for Growth.' },
    ],
  },
  {
    key: 'l08',
    first: 'Marcus',
    last: 'Bell',
    service: 'Quarterly Tax',
    source: 'GOOGLE_AD',
    sourceDetail: 'Estimated Tax Campaign',
    status: 'APPOINTMENT_SCHEDULED',
    priority: 'HOT',
    owner: 'manager',
    next: { type: 'APPOINTMENT', day: 2, note: 'Consultation at 10:00 by video' },
    city: 'Alpharetta',
    contact: ['PHONE', 'EMAIL'],
    activities: [{ kind: 'CALL', text: 'Missed Q2 and Q3 estimates; wants to catch up' }],
  },
  {
    key: 'l09',
    first: 'Priya',
    last: 'Raman',
    service: 'Tax Planning',
    extraService: 'Annual Tax',
    source: 'EVENT',
    sourceDetail: 'Small Business Expo 2026',
    status: 'QUALIFIED',
    priority: 'WARM',
    owner: 'owner',
    next: { type: 'SEND_DOCUMENTS', day: 1, note: 'Send the planning proposal' },
    city: 'Atlanta',
    contact: ['EMAIL'],
    activities: [
      { kind: 'MEETING', text: 'Met at the expo booth; consultant with S corp election questions' },
      { kind: 'EMAIL_SENT', text: 'Followed up with our planning overview' },
    ],
  },
  {
    key: 'l10',
    first: 'Caleb',
    last: 'Foster',
    business: 'Foster Roofing LLC',
    service: 'Payroll',
    source: 'PHONE_CALL',
    status: 'LOST',
    priority: 'COLD',
    owner: 'bookkeeper',
    city: 'Kennesaw',
    contact: ['PHONE'],
    activities: [{ kind: 'CALL', text: 'Decided to stay with his current payroll provider' }],
  },
  {
    key: 'l11',
    first: 'Lucy',
    last: 'Tran',
    service: 'Annual Tax',
    source: 'FACEBOOK_AD',
    sourceDetail: 'Spring Tax Season Ad',
    status: 'CONTACTED',
    priority: 'COLD',
    owner: 'clientSupport',
    next: { type: 'SMS', day: 4, note: 'Text a reminder about the free consultation' },
    city: 'Duluth',
    contact: ['TEXT'],
    activities: [{ kind: 'SMS_SENT', text: 'Sent the booking link' }],
  },
  {
    key: 'l12',
    first: 'Henry',
    last: 'Adeyemi',
    business: 'Adeyemi Logistics',
    service: 'Business Development',
    source: 'WALK_IN',
    status: 'IN_FOLLOW_UP',
    priority: 'WARM',
    owner: 'owner',
    next: { type: 'CALL', day: 5, note: 'Talk through the growth plan and financing options' },
    city: 'Atlanta',
    contact: ['PHONE', 'EMAIL'],
    activities: [{ kind: 'NOTE', text: 'Expanding to a second warehouse next spring' }],
  },
  {
    key: 'l13',
    first: 'Ava',
    last: 'Sinclair',
    service: 'Annual Tax',
    source: 'INSTAGRAM',
    status: 'QUALIFIED',
    priority: 'HOT',
    owner: 'taxPreparer',
    next: { type: 'APPOINTMENT', day: 3, note: 'Book her document drop-off' },
    city: 'Smyrna',
    contact: ['TEXT', 'EMAIL'],
    activities: [{ kind: 'CALL', text: 'First-time filer with freelance income' }],
  },
  {
    key: 'l14',
    first: 'Ethan',
    last: 'Brooks',
    service: 'Bookkeeping',
    source: 'EMAIL',
    status: 'CONTACTED',
    priority: 'WARM',
    owner: 'bookkeeper',
    next: { type: 'CALL', day: 6, note: 'Walk through bank feed setup' },
    city: 'Peachtree City',
    contact: ['EMAIL'],
    activities: [{ kind: 'EMAIL_SENT', text: 'Replied with pricing for the Starter package' }],
  },
];

const TAX_FORM_SERVICES = new Set(['Annual Tax']);

export async function seedDemoLeads(prisma: Prisma, org: DemoOrgResult, form: FormLookup) {
  const { businessId } = org;
  const user = (key: DemoStaffKey) => SEED_DEMO_USERS[key].id;

  await runInScope(prisma, { kind: 'business', businessId }, async (tx) => {
    for (const [n, l] of LEADS.entries()) {
      const id = demoId(`lead:${l.key}`);
      const email = `${l.first}.${l.last}`.toLowerCase() + '@demo.test';
      const author = l.owner ? user(l.owner) : user('clientSupport');
      if (!(await tx.lead.findUnique({ where: { id } }))) {
        await tx.lead.create({
          data: {
            id,
            businessId,
            serviceId: org.serviceIds(l.service),
            firstName: l.first,
            lastName: l.last,
            email,
            phone: `+1404555${String(150 + n).padStart(4, '0')}`,
            businessName: l.business ?? null,
            city: l.city,
            state: 'GA',
            taxYear: TAX_FORM_SERVICES.has(l.service) ? 2025 : null,
            source: l.source,
            sourceDetail: l.sourceDetail ?? null,
            preferredContactMethods: l.contact,
            updatedByUserId: author,
          },
        });
      }

      // Begin Online: the intake on the service's form, signed and submitted by the prospect.
      if (l.source === 'BEGIN_ONLINE' && l.status !== 'DRAFT') {
        const intakeId = demoId(`lead-intake:${l.key}`);
        if (!(await tx.intake.findUnique({ where: { id: intakeId } }))) {
          await tx.intake.create({
            data: {
              id: intakeId,
              businessId,
              formId: form(l.service),
              leadId: id,
              status: 'SUBMITTED',
            },
          });
        }
        const name = `${l.first} ${l.last}`;
        const signedAt = await submitSigned(tx, businessId, {
          key: `lead:${l.key}`,
          intakeId,
          leadId: id,
          answers: TAX_FORM_SERVICES.has(l.service)
            ? { firstName: l.first, lastName: l.last }
            : { fullName: name },
          name,
          email,
        });
        await tx.lead.updateMany({
          where: { id, status: 'DRAFT' },
          data: { status: 'SUBMITTED', submittedAt: signedAt, updatedByUserId: author },
        });
      }

      // Move to its pipeline status (once), then the owner, priority and next follow-up.
      const closed = l.status === 'DECLINED' || l.status === 'LOST';
      if (l.status !== 'DRAFT' && l.status !== 'SUBMITTED') {
        await tx.lead.updateMany({
          where: { id, status: { in: ['DRAFT', 'SUBMITTED'] } },
          data: {
            status: l.status,
            // A lead past DRAFT has a submitted time: for one staff entered, when it came in.
            ...(l.source === 'BEGIN_ONLINE' ? {} : { submittedAt: demoDay(-(2 + (n % 9))) }),
            updatedByUserId: author,
            ...(l.status === 'DECLINED' || l.status === 'IN_REVIEW'
              ? { reviewedByUserId: author, reviewedAt: demoDay(-1) }
              : {}),
            ...(l.declineReason ? { declineReason: l.declineReason } : {}),
          },
        });
      }
      await tx.lead.update({
        where: { id },
        data: {
          priority: l.priority ?? null,
          assignedUserId: l.owner ? user(l.owner) : null,
          bestTimeToContact: n % 2 === 0 ? 'Weekday mornings' : 'Evenings (after 5 PM)',
          ...(l.next && !closed
            ? {
                nextActionType: l.next.type,
                nextActionAt: (() => {
                  const at = demoDay(l.next.day);
                  at.setUTCHours(15);
                  return at;
                })(),
                nextActionNote: l.next.note,
              }
            : {}),
          updatedByUserId: author,
        },
      });

      if (l.extraService) {
        await tx.leadService.upsert({
          where: { leadId_serviceId: { leadId: id, serviceId: org.serviceIds(l.extraService) } },
          update: {},
          create: { businessId, leadId: id, serviceId: org.serviceIds(l.extraService) },
        });
      }
      for (const [k, a] of (l.activities ?? []).entries()) {
        const activityId = demoId(`lead-activity:${l.key}:${k}`);
        if (await tx.leadActivity.findUnique({ where: { id: activityId } })) continue;
        await tx.leadActivity.create({
          data: {
            id: activityId,
            businessId,
            leadId: id,
            kind: a.kind,
            ...(a.kind === 'NOTE' ? { body: a.text } : { summary: a.text }),
            actorUserId: author,
          },
        });
      }
    }
  });
}
