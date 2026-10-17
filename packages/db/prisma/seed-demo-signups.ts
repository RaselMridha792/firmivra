// Demo seed, stage 3 (R0, PART 2): portal sign-ups for the firm's Sign-ups page. Each person has a
// CLIENT login and a verified email, and waits for the firm to approve; one was declined.
import { runInScope, type createPrismaClient } from '../src/client.js';
import { demoSignupUserId, SEED_DEMO_SIGNUPS, SEED_DEMO_USERS } from './seed-demo-data.js';
import { demoDay } from './seed-demo-engagements.js';
import type { DemoOrgResult } from './seed-demo-org.js';

type Prisma = ReturnType<typeof createPrismaClient>;

export async function seedDemoSignups(prisma: Prisma, org: DemoOrgResult): Promise<void> {
  const { businessId } = org;

  await runInScope(prisma, { kind: 'platform' }, async (tx) => {
    for (const s of SEED_DEMO_SIGNUPS) {
      const id = demoSignupUserId(s.key);
      await tx.user.upsert({
        where: { id },
        update: { email: s.email, name: s.name },
        create: { id, cognitoSub: id, pool: 'CLIENT', email: s.email, name: s.name },
      });
    }
  });

  await runInScope(prisma, { kind: 'business', businessId }, async (tx) => {
    for (const [i, s] of SEED_DEMO_SIGNUPS.entries()) {
      const userId = demoSignupUserId(s.key);
      if (await tx.clientAccount.findUnique({ where: { userId } })) continue;
      await tx.clientAccount.create({
        data: {
          businessId,
          userId,
          email: s.email,
          accountType: s.accountType,
          status: 'PENDING_APPROVAL',
          emailVerifiedAt: demoDay(-(i + 1)),
        },
      });
      if (s.declined) {
        await tx.clientAccount.update({
          where: { userId },
          data: {
            status: 'DECLINED',
            declinedAt: demoDay(-1),
            declinedByUserId: SEED_DEMO_USERS.clientSupport.id,
            declineReason: s.declined,
          },
        });
      }
    }
  });
}
