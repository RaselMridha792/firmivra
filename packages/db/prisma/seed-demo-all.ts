// The whole demo seed, in order, as one side-effect-free function: the CLI (seed-demo.ts) and the
// round-trip test both run exactly this. A later stage adds its module call here.
import type { createPrismaClient } from '../src/client.js';
import { seedDemoBilling } from './seed-demo-billing.js';
import { seedDemoCalendar } from './seed-demo-calendar.js';
import { seedDemoDocuments } from './seed-demo-documents.js';
import { seedDemoMessages } from './seed-demo-messages.js';
import { seedDemoEngagements } from './seed-demo-engagements.js';
import { seedDemoOrg, type DemoOrgResult } from './seed-demo-org.js';

type Prisma = ReturnType<typeof createPrismaClient>;

export async function seedDemo(prisma: Prisma): Promise<DemoOrgResult> {
  const org = await seedDemoOrg(prisma);
  await seedDemoEngagements(prisma, org);
  await seedDemoBilling(prisma, org);
  await seedDemoCalendar(prisma, org);
  await seedDemoDocuments(prisma, org);
  // After documents: a message attaches one of them.
  await seedDemoMessages(prisma, org);
  return org;
}
