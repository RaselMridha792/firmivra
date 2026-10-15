// Shared setup for the R38 work-module tests: two firms, each with a member and a client, made
// with the owner role. Everything else the tests do runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

export interface TwoFirms {
  /** The same names in each firm: member `a`/`b` of firm A/B, their client, an extra member. */
  firmA: string;
  firmB: string;
  memberA: string;
  member2A: string;
  memberB: string;
  clientA: string;
  clientB: string;
}

/** Opens the app-role database and the owner client for `urls`. */
export function connect(urls: { owner: string; app: string }) {
  return {
    owner: createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS),
    db: createDatabase(urls.app, TEST_CLIENT_OPTIONS),
  };
}

/** Creates two firms with synthetic people. `tag` keeps slugs and emails unique per test file. */
export async function createTwoFirms(
  owner: ReturnType<typeof connect>['owner'],
  tag: string,
): Promise<TwoFirms> {
  const run = randomUUID().slice(0, 8);
  const users = { a: randomUUID(), a2: randomUUID(), b: randomUUID() };
  const out = {} as TwoFirms;
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of Object.values(users)) {
      await tx.user.create({
        data: {
          id,
          cognitoSub: id,
          pool: 'STAFF',
          email: `${id}@${tag}.test`,
          name: 'Fake Person',
        },
      });
    }
    out.firmA = (await tx.business.create({ data: { slug: `${tag}a-${run}`, name: 'Firm A' } })).id;
    out.firmB = (await tx.business.create({ data: { slug: `${tag}b-${run}`, name: 'Firm B' } })).id;
  });
  out.memberA = users.a;
  out.member2A = users.a2;
  out.memberB = users.b;
  for (const [businessId, members] of [
    [out.firmA, [users.a, users.a2]],
    [out.firmB, [users.b]],
  ] as const) {
    await runInScope(owner, { kind: 'business', businessId }, async (tx) => {
      for (const userId of members) {
        await tx.membership.create({
          data: { businessId, userId, role: 'STAFF', status: 'ACTIVE' },
        });
      }
      const client = await tx.client.create({ data: { businessId, displayName: 'Fake Client' } });
      if (businessId === out.firmA) out.clientA = client.id;
      else out.clientB = client.id;
    });
  }
  return out;
}

/** The message of a rejected promise, or '' when it resolved. */
export async function failure(p: PromiseLike<unknown>): Promise<string> {
  try {
    await p;
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** An engagement of a new service of `kind` for `clientId`, made with the owner role. */
export async function createEngagement(
  owner: ReturnType<typeof connect>['owner'],
  businessId: string,
  clientId: string,
  kind: 'BOOKKEEPING' | 'TAX_PLANNING' | 'ANNUAL_TAX' = 'BOOKKEEPING',
): Promise<string> {
  return runInScope(owner, { kind: 'business', businessId }, async (tx) => {
    const service = await tx.service.create({
      data: { businessId, kind, name: `${kind} ${randomUUID()}` },
    });
    const engagement = await tx.engagement.create({
      data: { businessId, clientId, serviceId: service.id, title: `${kind} (fake)` },
    });
    return engagement.id;
  });
}
