import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { runInScope } from '@firmivra/db';
import { firmFixtures } from '../helpers/firm-fixtures.js';
import { requestContext } from '../../src/common/request-context.js';
import { TeamService } from '../../src/team/team.service.js';
import { InviteResender } from '../../src/team/invite-resender.js';
let fx: Awaited<ReturnType<typeof firmFixtures>>, staffId: string, invitedId: string;
const resend = vi.fn(async () => {});
beforeAll(async () => {
  fx = await firmFixtures('team-suspension', (builder) =>
    builder.overrideProvider(InviteResender).useValue({ resend }),
  );
  await runInScope(fx.owner, { kind: 'business', businessId: fx.firmA.id }, async (tx) => {
    staffId = (
      await tx.membership.findFirstOrThrow({
        where: { businessId: fx.firmA.id, userId: fx.users.staffA.id },
      })
    ).id;
    invitedId = (
      await tx.membership.findFirstOrThrow({
        where: { businessId: fx.firmA.id, userId: fx.users.adminA.id },
      })
    ).id;
    await tx.membership.update({
      where: { id: invitedId },
      data: { status: 'INVITED', role: 'STAFF' },
    });
  });
});
afterAll(async () => {
  await fx?.close();
});
it('rejects role, deactivation and resend from a guard snapshot predating firm suspension', async () => {
  await runInScope(fx.owner, { kind: 'platform' }, (tx) =>
    tx.business.update({ where: { id: fx.firmA.id }, data: { status: 'SUSPENDED' } }),
  );
  const service = fx.app.get(TeamService);
  const writes: Array<() => Promise<unknown>> = [
    () => service.role(staffId, { role: 'ADMIN' }),
    () => service.deactivate(staffId),
    () => service.resend(invitedId),
  ];
  for (const work of writes) {
    await expect(
      requestContext.run(
        {
          requestId: randomUUID(),
          auth: { userId: fx.users.ownerA.id, cognitoSub: fx.users.ownerA.id, pool: 'STAFF' },
          tenant: { businessId: fx.firmA.id, role: 'OWNER', kind: 'staff' },
        },
        work,
      ),
    ).rejects.toMatchObject({ status: 404 });
  }
  expect(resend).not.toHaveBeenCalled();
  const member = await runInScope(fx.owner, { kind: 'business', businessId: fx.firmA.id }, (tx) =>
    tx.membership.findUniqueOrThrow({ where: { id: staffId } }),
  );
  expect(member.role).toBe('STAFF');
  expect(member.status).toBe('ACTIVE');
});
