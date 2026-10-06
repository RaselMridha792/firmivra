import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { runInScope } from '@firmivra/db';
import { firmFixtures } from '../helpers/firm-fixtures.js';
import { requestContext } from '../../src/common/request-context.js';
import { TaxStatusesService } from '../../src/tax-statuses/tax-statuses.service.js';
let fx: Awaited<ReturnType<typeof firmFixtures>>, id: string;
beforeAll(async () => {
  fx = await firmFixtures('tax-suspension');
  id = (
    await runInScope(fx.owner, { kind: 'business', businessId: fx.firmA.id }, (tx) =>
      tx.taxStatus.create({
        data: { businessId: fx.firmA.id, name: 'Synthetic unchanged', sortOrder: 0 },
      }),
    )
  ).id;
});
afterAll(async () => {
  await fx?.close();
});
it('rejects every tax-status mutation from a pre-suspension guard snapshot', async () => {
  await runInScope(fx.owner, { kind: 'platform' }, (tx) =>
    tx.business.update({ where: { id: fx.firmA.id }, data: { status: 'SUSPENDED' } }),
  );
  const service = fx.app.get(TaxStatusesService);
  const writes: Array<() => Promise<unknown>> = [
    () => service.create('Rejected synthetic'),
    () => service.rename(id, 'Rejected synthetic'),
    () => service.order([id]),
    () => service.archive(id),
  ];
  for (const work of writes)
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
  const rows = await runInScope(fx.owner, { kind: 'business', businessId: fx.firmA.id }, (tx) =>
    tx.taxStatus.findMany({ where: { businessId: fx.firmA.id } }),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ name: 'Synthetic unchanged', sortOrder: 0, archivedAt: null });
});
