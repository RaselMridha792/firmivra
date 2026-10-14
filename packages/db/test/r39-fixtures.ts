// Shared setup for the R39 table tests: two active firms, each with an owner, a client, a
// service and an engagement of `kind`. Synthetic data only. Runs no tests itself.
import { randomUUID } from 'node:crypto';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import type { Prisma, ServiceKind } from '../src/generated/prisma/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

export type Firm = { id: string; owner: string; client: string; service: string; eng: string };
type Tx = Prisma.TransactionClient;

export function r39Fixtures(urls: { owner: string; app: string }) {
  const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
  const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);
  const run = randomUUID().slice(0, 8);
  const firm = (): Firm => ({ id: '', owner: randomUUID(), client: '', service: '', eng: '' });
  const [A, B] = [firm(), firm()];
  /** The app role in `f`'s scope (RLS applies). */
  const as = (f: Firm) => db.forBusiness(f.id);
  /** The table owner in `f`'s scope, for fixtures the app role may not write. */
  const ownerIn = <T>(f: Firm, fn: (tx: Tx) => Promise<T>) =>
    runInScope(owner, { kind: 'business', businessId: f.id }, fn);

  async function setup(kind: ServiceKind = 'ANNUAL_TAX') {
    await runInScope(owner, { kind: 'platform' }, async (tx) => {
      for (const [f, slug] of [
        [A, `r39a-${run}`],
        [B, `r39b-${run}`],
      ] as const) {
        const email = `${slug}@example.test`;
        await tx.user.create({
          data: { id: f.owner, cognitoSub: f.owner, pool: 'STAFF', email, name: 'Owner' },
        });
        f.id = (await tx.business.create({ data: { slug, name: slug, status: 'ACTIVE' } })).id;
      }
    });
    for (const f of [A, B]) {
      await ownerIn(f, async (tx) => {
        const businessId = f.id;
        await tx.membership.create({
          data: { businessId, userId: f.owner, role: 'OWNER', status: 'ACTIVE' },
        });
        f.client = (await tx.client.create({ data: { businessId, displayName: 'Pat' } })).id;
        f.service = (await tx.service.create({ data: { businessId, kind, name: kind } })).id;
        const data = { businessId, clientId: f.client, serviceId: f.service, title: '2026' };
        f.eng = (await tx.engagement.create({ data })).id;
      });
    }
  }
  const close = () => Promise.all([owner.$disconnect(), db.disconnect()]);
  /** A promise's error message, or 'ok', so a rejection is never unhandled. */
  const outcome = (p: Promise<unknown>) =>
    p.then(
      () => 'ok',
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
  return { A, B, run, as, ownerIn, setup, close, outcome, owner, db };
}
