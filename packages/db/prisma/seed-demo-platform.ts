// Demo seed, stage 4 (R0, PART 2): the Super Admin side. Eight more firms (`demo-` slugs) in every
// firm status, each with an owner login, the application it came from and a plan subscription;
// four applications still waiting on the Super Admin; and a subscription for the demo firm itself.
// Steps run in the scope the app uses: applications are filed in platform scope, decided in admin
// scope, and linked to their firm at provisioning; subscriptions are written in admin scope. The
// database takes the reviewer from the admin scope, so the seed acts as the earliest existing
// SUPER_ADMIN (Rasel's choice, Oct 17) and refuses to run if there is none.
import { runInScope, type createPrismaClient, type TxClient } from '../src/client.js';
import { SEED_SERVICES, SEED_TAX_STATUSES } from './seed-data.js';
import {
  demoApplicationId,
  demoFirmOwnerId,
  SEED_DEMO_APPLICATIONS,
  SEED_DEMO_FIRMS,
} from './seed-demo-data.js';
import { demoDay } from './seed-demo-engagements.js';
import type { DemoOrgResult } from './seed-demo-org.js';
import { seedFirmBasics, seedServices } from './seed-helpers.js';

type Prisma = ReturnType<typeof createPrismaClient>;

/** The application form a firm submits (R4's stored shape), filled for one demo firm. */
const applicationForm = (a: {
  name: string;
  legalName: string;
  city: string;
  contact: { name: string; email: string };
  teamSize: number;
}) => ({
  business: {
    practiceType: 'TAX_ACCOUNTING',
    legalName: a.legalName,
    dbaName: a.name,
    entityType: 'LLC',
    email: a.contact.email,
    phone: '+14045550188',
    website: null,
    address: {
      line1: '200 Commerce Street',
      line2: 'Suite 400',
      city: a.city,
      state: 'GA',
      postalCode: '30303',
    },
    services: ['TAX_PREPARATION', 'BOOKKEEPING', 'PAYROLL'],
  },
  primaryAdmin: {
    fullName: a.contact.name,
    email: a.contact.email,
    phone: '+14045550188',
    title: 'Owner',
    preferredContact: 'EMAIL',
    alternatePhone: null,
  },
  account: {
    requestedPlan: 'PROFESSIONAL',
    teamSize: a.teamSize,
    clientVolume: a.teamSize > 10 ? 'FROM_500' : 'UNDER_100',
    heardFrom: 'Industry referral',
    requestedStartDate: null,
    additionalInfo: null,
  },
  credentials: [],
});

/** The earliest SUPER_ADMIN, who the demo's application decisions and subscriptions are made as. */
async function reviewerId(prisma: Prisma): Promise<string> {
  const admin = await runInScope(prisma, { kind: 'platform' }, (tx) =>
    tx.platformAdmin.findFirst({ where: { role: 'SUPER_ADMIN' }, orderBy: { createdAt: 'asc' } }),
  );
  if (!admin) {
    throw new Error('demo seed stage 4: no SUPER_ADMIN exists to review the demo applications');
  }
  return admin.userId;
}

async function fileApplication(tx: TxClient, id: string, a: Parameters<typeof applicationForm>[0]) {
  if (await tx.firmApplication.findUnique({ where: { id } })) return;
  const form = applicationForm(a);
  await tx.firmApplication.create({
    data: {
      id,
      legalName: a.legalName,
      dbaName: a.name,
      contactName: a.contact.name,
      contactEmail: a.contact.email,
      contactPhone: form.primaryAdmin.phone,
      data: form,
    },
  });
}

export async function seedDemoPlatform(prisma: Prisma, org: DemoOrgResult): Promise<void> {
  const reviewer = await reviewerId(prisma);
  const firmApp = (f: (typeof SEED_DEMO_FIRMS)[number]) => ({
    name: f.name,
    legalName: f.legalName,
    city: f.city,
    contact: f.owner,
    teamSize: f.teamSize,
  });

  // Platform scope: the owners' logins, the firms, and every application as submitted.
  const firmIds = await runInScope(prisma, { kind: 'platform' }, async (tx) => {
    const ids: Record<string, string> = {};
    for (const f of SEED_DEMO_FIRMS) {
      const userId = demoFirmOwnerId(f.slug);
      await tx.user.upsert({
        where: { id: userId },
        update: { email: f.owner.email, name: f.owner.name },
        create: {
          id: userId,
          cognitoSub: userId,
          pool: 'STAFF',
          email: f.owner.email,
          name: f.owner.name,
        },
      });
      const business = await tx.business.upsert({
        where: { slug: f.slug },
        update: {},
        create: {
          slug: f.slug,
          name: f.name,
          legalName: f.legalName,
          businessType: 'Tax and accounting firm',
        },
      });
      ids[f.slug] = business.id;
      await fileApplication(tx, demoApplicationId(f.slug), firmApp(f));
    }
    for (const a of SEED_DEMO_APPLICATIONS) {
      await fileApplication(tx, demoApplicationId(a.key), a);
    }
    return ids;
  });

  // Admin scope: the Super Admin's decisions.
  await runInScope(prisma, { kind: 'admin', adminUserId: reviewer }, async (tx) => {
    for (const f of SEED_DEMO_FIRMS) {
      await tx.firmApplication.updateMany({
        where: { id: demoApplicationId(f.slug), status: 'PENDING_REVIEW' },
        data: {
          status: 'APPROVED',
          reviewedByUserId: reviewer,
          reviewedAt: demoDay(-f.applied + 2),
          decisionReason: 'Credentials verified. Welcome to Firmivra.',
        },
      });
    }
    for (const a of SEED_DEMO_APPLICATIONS) {
      if (a.status === 'PENDING_REVIEW') continue;
      await tx.firmApplication.updateMany({
        where: { id: demoApplicationId(a.key), status: 'PENDING_REVIEW' },
        data: {
          status: a.status,
          reviewedByUserId: reviewer,
          reviewedAt: demoDay(-2),
          decisionReason: a.reason!,
        },
      });
    }
  });

  // Provisioning, in each firm's own scope: settings, Terms and Privacy, tax statuses, services,
  // and the owner (once the owner has finished setup: not for the firm still pending it).
  for (const f of SEED_DEMO_FIRMS) {
    const businessId = firmIds[f.slug]!;
    await runInScope(prisma, { kind: 'business', businessId }, async (tx) => {
      await seedFirmBasics(tx, businessId, {
        name: f.name,
        ownerId: demoFirmOwnerId(f.slug),
        contactEmail: f.owner.email,
        taxStatuses: SEED_TAX_STATUSES.lvp,
      });
      await seedServices(tx, businessId, SEED_SERVICES.lvp);
      if (f.status !== 'PENDING_SETUP') {
        await tx.membership.upsert({
          where: { businessId_userId: { businessId, userId: demoFirmOwnerId(f.slug) } },
          update: {},
          create: { businessId, userId: demoFirmOwnerId(f.slug), role: 'OWNER', status: 'ACTIVE' },
        });
      }
    });
  }

  // Platform scope: link each approved application to its firm, and set the firm's status.
  await runInScope(prisma, { kind: 'platform' }, async (tx) => {
    for (const f of SEED_DEMO_FIRMS) {
      const businessId = firmIds[f.slug]!;
      await tx.firmApplication.updateMany({
        where: { id: demoApplicationId(f.slug), businessId: null },
        data: { businessId },
      });
      if (f.status === 'PENDING_SETUP') continue;
      await tx.business.updateMany({
        where: { id: businessId, status: 'PENDING_SETUP' },
        data: { status: 'ACTIVE' },
      });
      if (f.status !== 'ACTIVE') {
        await tx.business.updateMany({
          where: { id: businessId, status: 'ACTIVE' },
          data: { status: f.status },
        });
      }
    }
  });

  // Admin scope: plan subscriptions, the demo firm's included.
  await runInScope(prisma, { kind: 'admin', adminUserId: reviewer }, async (tx) => {
    const plans = new Map(
      (
        await tx.platformPlan.findMany({
          select: { id: true, code: true, includedSeats: true, includedLocations: true },
        })
      ).map((p) => [p.code, p]),
    );
    const subscribe = async (
      businessId: string,
      s: {
        plan: string;
        status: (typeof SEED_DEMO_FIRMS)[number]['subscription'];
        cycle: 'MONTHLY' | 'ANNUAL';
        since: number;
        seats: number;
      },
    ) => {
      const plan = plans.get(s.plan);
      if (!plan)
        throw new Error(
          `demo seed stage 4: plan ${s.plan} is missing (run the platform-org bootstrap)`,
        );
      if (await tx.platformFirmSubscription.findUnique({ where: { businessId } })) return;
      const months = s.cycle === 'ANNUAL' ? 12 : 1;
      const periodStart = demoDay(-(s.since % (months * 30)));
      const periodEnd = new Date(periodStart.getTime() + months * 30 * 86_400_000);
      await tx.platformFirmSubscription.create({
        data: {
          businessId,
          planId: plan.id,
          status: s.status,
          billingCycle: s.cycle,
          seatsIncluded: plan.includedSeats,
          seatsPurchased: Math.max(0, s.seats - plan.includedSeats),
          locationsIncluded: plan.includedLocations,
          ...(s.status === 'TRIAL'
            ? { trialStartedAt: demoDay(-s.since), trialEndsAt: demoDay(14 - s.since) }
            : {
                startedAt: demoDay(-s.since),
                currentPeriodStart: periodStart,
                currentPeriodEnd: periodEnd,
                nextBillingDate: periodEnd,
                paidThroughDate: s.status === 'PAST_DUE' ? periodStart : periodEnd,
              }),
          ...(s.status === 'SUSPENDED'
            ? { suspendedAt: demoDay(-6), suspendedReason: 'Payment failed three times.' }
            : {}),
          ...(s.status === 'CANCELLED'
            ? {
                autoRenew: false,
                cancelRequestedAt: demoDay(-40),
                cancelReason: 'Retiring from practice.',
                cancelRequestSource: 'firm',
                closedAt: demoDay(-30),
                closedReason: 'Cancelled at the end of the term.',
              }
            : {}),
        },
      });
    };
    await subscribe(org.businessId, {
      plan: 'BUSINESS',
      status: 'ACTIVE',
      cycle: 'MONTHLY',
      since: 90,
      seats: 7,
    });
    for (const f of SEED_DEMO_FIRMS) {
      await subscribe(firmIds[f.slug]!, {
        plan: f.plan,
        status: f.subscription,
        cycle: f.cycle,
        since: f.applied,
        seats: f.teamSize,
      });
    }
  });
}
