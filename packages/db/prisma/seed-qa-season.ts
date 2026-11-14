// QA seed, part 5 (R1, Nov 14; Dashboard Review 2 "Tax season context", the lead's approval under
// Rasel's packages/db delegation until Nov 17, dev only): Test Firm B's tax season, Jan 15 to
// Apr 15, so the dashboard header shows Tax Season or Off-Season from the firm's settings with the
// qa-* logins. Only when Firm B has none yet: a season someone set in Settings is kept. Never
// another firm (LVP sets its own). Nothing is sent.
import { runInScope, type createPrismaClient } from '../src/client.js';

type PrismaClient = ReturnType<typeof createPrismaClient>;

export const QA_SEASON = { taxSeasonStart: '01-15', taxSeasonEnd: '04-15' } as const;

export type QaSeasonResult = 'seeded' | 'already' | 'missing';

export async function seedQaSeason(owner: PrismaClient): Promise<QaSeasonResult> {
  const firm = await runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.business.findUnique({ where: { slug: 'test-firm-b' }, select: { id: true } }),
  );
  if (!firm) return 'missing';
  const businessId = firm.id;
  return runInScope(owner, { kind: 'business', businessId }, async (tx) => {
    const now = await tx.businessSettings.findUnique({
      where: { businessId },
      select: { taxSeasonStart: true },
    });
    if (now?.taxSeasonStart) return 'already';
    await tx.businessSettings.upsert({
      where: { businessId },
      create: { businessId, ...QA_SEASON },
      update: QA_SEASON,
    });
    return 'seeded';
  });
}
