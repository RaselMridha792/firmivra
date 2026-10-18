// Demo seed, stage 1 (R0, PART 2): the demo business itself, its settings, legal text, tax
// statuses, services, document categories and appointment types (reusing LVP's reference lists --
// a demo firm is the same kind of tax and accounting practice), the owner and six staff across
// three departments and teams, and the client directory (25 synthetic clients; one has a working
// portal login). Safe to run again: every write is keyed by a deterministic id (demoId) or a
// natural unique key, so re-running updates the same rows.
import { runInScope, type createPrismaClient, type TxClient } from '../src/client.js';
import {
  SEED_APPOINTMENT_TYPES,
  SEED_DOCUMENT_CATEGORIES,
  SEED_SERVICES,
  SEED_TAX_STATUSES,
} from './seed-data.js';
import {
  seedAppointmentTypes,
  seedDocumentCategories,
  seedFirmBasics,
  seedServices,
} from './seed-helpers.js';
import {
  demoId,
  SEED_DEMO_BUSINESS,
  SEED_DEMO_CLIENTS,
  SEED_DEMO_DEPARTMENTS,
  SEED_DEMO_PORTAL_CLIENT,
  SEED_DEMO_STAFF,
  SEED_DEMO_TEAMS,
  SEED_DEMO_USERS,
  type DemoStaffKey,
} from './seed-demo-data.js';

type Prisma = ReturnType<typeof createPrismaClient>;

export interface DemoOrgResult {
  businessId: string;
  /** Every staff member's membership id, by key (including the owner). */
  memberships: Record<DemoStaffKey, string>;
  /** Every client's id, by its SEED_DEMO_CLIENTS key ("01".."25"). */
  clients: Record<string, string>;
  /** The firm's service ids by name (seedServices's lookup; throws for an unknown name). */
  serviceIds: (name: string) => string;
  /** Document category ids by name (same kind of lookup). */
  categoryIds: (name: string) => string;
  /** Appointment type ids by name (same kind of lookup). */
  appointmentTypeIds: (name: string) => string;
}

/**
 * The demo firm's look: Octavia's LVP client portal mockups (docs/mockups/client-portal), navy
 * sidebar and headings with orange accents, all measured from the mockups. The portal reads them
 * from business_settings: primary and accent colour, then the theme colours (sidebar, primary and
 * secondary text, buttons: the mockups' royal-blue buttons), so the demo shows the theme working.
 */
const DEMO_BRAND = {
  brandColor: '#001F4B',
  accentColor: '#E68B18',
  sidebarColor: '#001F4B',
  textPrimaryColor: '#001F4B',
  textSecondaryColor: '#485677',
  buttonColor: '#006FF0',
} as const;

const splitName = (name: string): { firstName: string | null; lastName: string | null } => {
  const parts = name.split(' ');
  return { firstName: parts[0] ?? null, lastName: parts.slice(1).join(' ') || null };
};

/** A business client's entity type, varied deterministically by its key so the mix looks real. */
const ENTITY_TYPES = ['LLC', 'S_CORP', 'SOLE_PROPRIETOR'] as const;
const entityTypeFor = (key: string): (typeof ENTITY_TYPES)[number] =>
  ENTITY_TYPES[Number(key) % ENTITY_TYPES.length]!;

export async function seedDemoOrg(prisma: Prisma): Promise<DemoOrgResult> {
  const businessId = await runInScope(prisma, { kind: 'platform' }, async (tx) => {
    for (const u of Object.values(SEED_DEMO_USERS)) {
      await tx.user.upsert({
        where: { id: u.id },
        update: { email: u.email, name: u.name, pool: u.pool },
        create: { id: u.id, cognitoSub: u.id, pool: u.pool, email: u.email, name: u.name },
      });
    }
    const business = await tx.business.upsert({
      where: { slug: SEED_DEMO_BUSINESS.slug },
      update: {},
      create: { slug: SEED_DEMO_BUSINESS.slug, name: SEED_DEMO_BUSINESS.name, status: 'ACTIVE' },
    });
    return business.id;
  });

  const { memberships, serviceIds, categoryIds, appointmentTypeIds } = await runInScope(
    prisma,
    { kind: 'business', businessId },
    async (tx) => {
      await seedFirmBasics(tx, businessId, {
        name: SEED_DEMO_BUSINESS.name,
        ownerId: SEED_DEMO_USERS.owner.id,
        contactEmail: 'hello@demo.test',
        brandColor: DEMO_BRAND.brandColor,
        taxStatuses: SEED_TAX_STATUSES.lvp,
      });
      // seedFirmBasics sets colours only on a new firm: set them every run, so re-running the
      // demo seed on a database seeded earlier (dev) gives it the current look.
      await tx.businessSettings.update({ where: { businessId }, data: DEMO_BRAND });
      const serviceIds = await seedServices(tx, businessId, SEED_SERVICES.lvp);
      const categoryIds = await seedDocumentCategories(
        tx,
        businessId,
        SEED_DOCUMENT_CATEGORIES.lvp,
      );
      const appointmentTypeIds = await seedAppointmentTypes(
        tx,
        businessId,
        SEED_APPOINTMENT_TYPES.lvp,
      );

      // Owner, then the six staff, each with a membership, a profile and security settings.
      const ownerMember = await tx.membership.upsert({
        where: { businessId_userId: { businessId, userId: SEED_DEMO_USERS.owner.id } },
        update: { role: 'OWNER', status: 'ACTIVE' },
        create: { businessId, userId: SEED_DEMO_USERS.owner.id, role: 'OWNER', status: 'ACTIVE' },
      });
      const memberships: Partial<Record<DemoStaffKey, string>> = { owner: ownerMember.id };
      for (const s of SEED_DEMO_STAFF) {
        const user = SEED_DEMO_USERS[s.key];
        const member = await tx.membership.upsert({
          where: { businessId_userId: { businessId, userId: user.id } },
          update: { role: s.role, status: 'ACTIVE' },
          create: { businessId, userId: user.id, role: s.role, status: 'ACTIVE' },
        });
        memberships[s.key] = member.id;
        await tx.staffProfile.upsert({
          where: { businessId_membershipId: { businessId, membershipId: member.id } },
          update: { employmentType: 'FULL_TIME', office: 'Main Office' },
          create: {
            businessId,
            membershipId: member.id,
            employmentType: 'FULL_TIME',
            office: 'Main Office',
            hireDate: new Date('2024-02-01'),
            supervisorId: ownerMember.id,
            accessLevel: s.role === 'ADMIN' ? 'ADMINISTRATOR' : 'STANDARD_USER',
          },
        });
        await tx.staffSecuritySettings.upsert({
          where: { businessId_membershipId: { businessId, membershipId: member.id } },
          update: {},
          create: { businessId, membershipId: member.id, requirePasswordChange: false },
        });
      }
      const allMemberships = memberships as Record<DemoStaffKey, string>;

      // Three departments; the owner heads every department for simplicity.
      for (const d of SEED_DEMO_DEPARTMENTS) {
        await tx.department.upsert({
          where: { id: d.id },
          update: { name: d.name, description: d.description, headMembershipId: ownerMember.id },
          create: {
            id: d.id,
            businessId,
            name: d.name,
            description: d.description,
            headMembershipId: ownerMember.id,
          },
        });
      }
      for (const staffDef of SEED_DEMO_STAFF) {
        const department = SEED_DEMO_DEPARTMENTS.find((d) => d.code === staffDef.department)!;
        await tx.memberDepartment.upsert({
          where: {
            membershipId_departmentId: {
              membershipId: allMemberships[staffDef.key],
              departmentId: department.id,
            },
          },
          update: {},
          create: {
            businessId,
            membershipId: allMemberships[staffDef.key],
            departmentId: department.id,
          },
        });
      }
      for (const t of SEED_DEMO_TEAMS) {
        const department = SEED_DEMO_DEPARTMENTS.find((d) => d.code === t.department)!;
        const leadMembershipId = allMemberships[t.lead];
        const team = await tx.team.upsert({
          where: { id: demoId(`team:${t.code}`) },
          update: { name: t.name, leadMembershipId },
          create: {
            id: demoId(`team:${t.code}`),
            businessId,
            departmentId: department.id,
            name: t.name,
            leadMembershipId,
          },
        });
        // Each team's own roster (a member is on at most one team's PRIMARY/BACKUP slot).
        for (const key of t.members) {
          await tx.teamMember.upsert({
            where: {
              teamId_membershipId: { teamId: team.id, membershipId: allMemberships[key] },
            },
            update: {},
            create: {
              businessId,
              teamId: team.id,
              membershipId: allMemberships[key],
              kind: key === t.lead ? 'PRIMARY' : 'MEMBER',
            },
          });
        }
      }

      return { memberships: allMemberships, serviceIds, categoryIds, appointmentTypeIds };
    },
  );

  // The one portal-capable client gets a real login (user + client account) before its client
  // record, so seedClient can link clientAccount.clientId the same way the regular seed does.
  await runInScope(prisma, { kind: 'platform' }, (tx) =>
    tx.user.upsert({
      where: { id: demoId(`user:client:${SEED_DEMO_PORTAL_CLIENT.key}`) },
      update: { email: SEED_DEMO_PORTAL_CLIENT.email, name: SEED_DEMO_PORTAL_CLIENT.name },
      create: {
        id: demoId(`user:client:${SEED_DEMO_PORTAL_CLIENT.key}`),
        cognitoSub: demoId(`user:client:${SEED_DEMO_PORTAL_CLIENT.key}`),
        pool: 'CLIENT',
        email: SEED_DEMO_PORTAL_CLIENT.email,
        name: SEED_DEMO_PORTAL_CLIENT.name,
      },
    }),
  );

  const clients = await runInScope(prisma, { kind: 'business', businessId }, async (tx) => {
    await tx.clientAccount.upsert({
      where: { userId: demoId(`user:client:${SEED_DEMO_PORTAL_CLIENT.key}`) },
      update: { status: 'ACTIVE' },
      create: {
        businessId,
        userId: demoId(`user:client:${SEED_DEMO_PORTAL_CLIENT.key}`),
        email: SEED_DEMO_PORTAL_CLIENT.email,
        status: 'ACTIVE',
      },
    });

    const ids: Record<string, string> = {};
    for (const c of SEED_DEMO_CLIENTS) {
      const clientId = demoId(`client:${c.key}`);
      const assignedUserId = SEED_DEMO_USERS[c.assigned].id;
      await tx.client.upsert({
        where: { id: clientId },
        update: { displayName: c.name, email: c.email, assignedUserId },
        create: {
          id: clientId,
          businessId,
          displayName: c.name,
          email: c.email,
          phone: '+14045550100',
          accountType: c.accountType,
          assignedUserId,
        },
      });
      const profileData =
        c.accountType === 'INDIVIDUAL'
          ? splitName(c.name)
          : { businessName: c.name, entityType: entityTypeFor(c.key) };
      await tx.clientProfile.upsert({
        where: { clientId },
        update: profileData,
        create: {
          clientId,
          businessId,
          addressLine1: '100 Market Street',
          city: 'Atlanta',
          state: 'GA',
          postalCode: '30301',
          ...profileData,
        },
      });
      if (c.portal) {
        await tx.clientAccount.update({
          where: { userId: demoId(`user:client:${c.key}`) },
          data: { clientId },
        });
      }
      ids[c.key] = clientId;
    }
    return ids;
  });

  return {
    businessId,
    memberships,
    clients,
    serviceIds,
    categoryIds,
    appointmentTypeIds,
  };
}

export type { TxClient };
