import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { runInScope } from '@firmivra/db';
import { firmFixtures } from '../helpers/firm-fixtures.js';
import { requestContext } from '../../src/common/request-context.js';
import { SettingsService } from '../../src/settings/settings.service.js';
let fx: Awaited<ReturnType<typeof firmFixtures>>;
beforeAll(async () => {
  fx = await firmFixtures('settings-permission');
});
afterAll(async () => {
  await fx?.close();
});
const staleRequest = (work: () => Promise<unknown>) =>
  requestContext.run(
    {
      requestId: randomUUID(),
      auth: { userId: fx.users.ownerA.id, cognitoSub: fx.users.ownerA.id, pool: 'STAFF' },
      tenant: { businessId: fx.firmA.id, role: 'OWNER', kind: 'staff' },
    },
    work,
  );
async function allWritesDenied(status: number) {
  const service = fx.app.get(SettingsService);
  const writes = [
    () => service.update({ name: 'Rejected synthetic name' }),
    () => service.saveSetup({ completedSteps: [] }),
    () => service.complete(),
    () => service.publish('TERMS', 'Rejected synthetic terms'),
  ];
  for (const write of writes) await expect(staleRequest(write)).rejects.toMatchObject({ status });
  const state = await runInScope(
    fx.owner,
    { kind: 'business', businessId: fx.firmA.id },
    async (tx) => ({
      firm: await tx.business.findUniqueOrThrow({ where: { id: fx.firmA.id } }),
      legal: await tx.firmLegalDocument.count({ where: { businessId: fx.firmA.id } }),
    }),
  );
  expect(state.firm.name).not.toBe('Rejected synthetic name');
  expect(state.legal).toBe(0);
}
it('denies all settings writes after a manager role is demoted following authentication', async () => {
  await runInScope(fx.owner, { kind: 'business', businessId: fx.firmA.id }, (tx) =>
    tx.membership.updateMany({
      where: { businessId: fx.firmA.id, userId: fx.users.ownerA.id },
      data: { role: 'STAFF' },
    }),
  );
  try {
    await allWritesDenied(403);
  } finally {
    await runInScope(fx.owner, { kind: 'business', businessId: fx.firmA.id }, (tx) =>
      tx.membership.updateMany({
        where: { businessId: fx.firmA.id, userId: fx.users.ownerA.id },
        data: { role: 'OWNER' },
      }),
    );
  }
});
it('denies all settings writes after the current membership is deactivated', async () => {
  await runInScope(fx.owner, { kind: 'business', businessId: fx.firmA.id }, (tx) =>
    tx.membership.updateMany({
      where: { businessId: fx.firmA.id, userId: fx.users.ownerA.id },
      data: { status: 'DEACTIVATED' },
    }),
  );
  try {
    await allWritesDenied(404);
  } finally {
    await runInScope(fx.owner, { kind: 'business', businessId: fx.firmA.id }, (tx) =>
      tx.membership.updateMany({
        where: { businessId: fx.firmA.id, userId: fx.users.ownerA.id },
        data: { status: 'ACTIVE' },
      }),
    );
  }
});
it('denies all settings writes after the firm is suspended', async () => {
  await runInScope(fx.owner, { kind: 'platform' }, (tx) =>
    tx.business.update({ where: { id: fx.firmA.id }, data: { status: 'SUSPENDED' } }),
  );
  try {
    await allWritesDenied(404);
  } finally {
    await runInScope(fx.owner, { kind: 'platform' }, (tx) =>
      tx.business.update({ where: { id: fx.firmA.id }, data: { status: 'ACTIVE' } }),
    );
  }
});
