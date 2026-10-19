// The whole demo seed, in order, as one side-effect-free function: the CLI (seed-demo.ts) and the
// round-trip test both run exactly this. A later stage adds its module call here.
import type { createPrismaClient } from '../src/client.js';
import { seedDemoBilling } from './seed-demo-billing.js';
import { seedDemoBookkeeping } from './seed-demo-bookkeeping.js';
import { seedDemoCalendar } from './seed-demo-calendar.js';
import { seedDemoCommunications } from './seed-demo-communications.js';
import { seedDemoCompliance } from './seed-demo-compliance.js';
import { seedDemoDocuments } from './seed-demo-documents.js';
import { seedDemoMessages } from './seed-demo-messages.js';
import { seedDemoNotifications } from './seed-demo-notifications.js';
import { seedDemoEngagements } from './seed-demo-engagements.js';
import { seedDemoEsign } from './seed-demo-esign.js';
import { seedDemoIntake } from './seed-demo-intake.js';
import { seedDemoLeads } from './seed-demo-leads.js';
import { seedDemoOrg, type DemoOrgResult } from './seed-demo-org.js';
import { seedDemoPayroll } from './seed-demo-payroll.js';
import { seedDemoPlatform } from './seed-demo-platform.js';
import { seedDemoPortal } from './seed-demo-portal.js';
import { seedDemoSignups } from './seed-demo-signups.js';
import { seedDemoTasks } from './seed-demo-tasks.js';
import { seedDemoTemplates } from './seed-demo-templates.js';

type Prisma = ReturnType<typeof createPrismaClient>;

export async function seedDemo(prisma: Prisma): Promise<DemoOrgResult> {
  const org = await seedDemoOrg(prisma);
  await seedDemoEngagements(prisma, org);
  await seedDemoBilling(prisma, org);
  // Stage 5, work modules: Bookkeeping (profiles, connections, periods, ledger, reports, terms).
  await seedDemoBookkeeping(prisma, org);
  await seedDemoCalendar(prisma, org);
  await seedDemoDocuments(prisma, org);
  // After documents: a message attaches one of them.
  await seedDemoMessages(prisma, org);
  // Stage 5, work modules: Templates (message, document request and invoice templates).
  await seedDemoTemplates(prisma, org);
  // Stage 3
  const form = await seedDemoIntake(prisma, org);
  await seedDemoLeads(prisma, org, form);
  // Stage 5, work modules: Compliance & Deadlines (after documents: a filed return's document).
  await seedDemoCompliance(prisma, org);
  await seedDemoEsign(prisma, org);
  await seedDemoSignups(prisma, org);
  // Portal gaps from the Oct 18 click-through: tax-year statuses and the firm's content.
  await seedDemoPortal(prisma, org);
  // Stage 5, work modules: Tasks (after documents and leads: attachments and lead tags).
  await seedDemoTasks(prisma, org);
  // Stage 5, work modules: Payroll.
  await seedDemoPayroll(prisma, org);
  // Stage 4: the Super Admin side.
  await seedDemoPlatform(prisma, org);
  // Last: bell items point at rows the modules above made.
  await seedDemoNotifications(prisma, org);
  // Stage 5, work modules: Communications (after the bell items: their deliveries).
  await seedDemoCommunications(prisma, org);
  return org;
}
