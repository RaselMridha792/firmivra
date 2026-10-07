// The field-encryption helper finds the firm's KMS key itself (the lead's #60 review): it reads
// businesses.kms_key_id in that firm's own scope, as the app role, and inside the caller's
// transaction when given one (#82 review), so it never needs a second pooled connection.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { DatabaseFirmKeyIds } from '../../src/field-encryption/field-encryption.service.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const KEY = 'arn:aws:kms:us-east-1:000000000000:key/fake-firm-key';
const firms = { withKey: '', withoutKey: '' };
const db = createDatabase(fx.appUrl);

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    firms.withKey = (
      await tx.business.create({ data: { slug: `fk-a-${run}`, name: 'A', kmsKeyId: KEY } })
    ).id;
    firms.withoutKey = (await tx.business.create({ data: { slug: `fk-b-${run}`, name: 'B' } })).id;
  });
  await owner.$disconnect();
});

afterAll(async () => {
  await db.disconnect();
});

describe('DatabaseFirmKeyIds', () => {
  it("returns the firm's own key id, null without one or for an unknown firm", async () => {
    const keys = new DatabaseFirmKeyIds(db);
    await expect(keys.keyIdOf(firms.withKey)).resolves.toBe(KEY);
    await expect(keys.keyIdOf(firms.withoutKey)).resolves.toBeNull();
    await expect(keys.keyIdOf(randomUUID())).resolves.toBeNull();
  });

  it("reads it in the caller's firm transaction, without a second connection", async () => {
    // One pooled connection, held by the caller's transaction: a lookup in a transaction of its
    // own would wait for a second connection until Prisma gives up (maxWait).
    const single = createDatabase(fx.appUrl, {
      maxConnections: 1,
      transactionOptions: { maxWait: 2_000, timeout: 10_000 },
    });
    try {
      const keys = new DatabaseFirmKeyIds(single);
      const inFirm = (businessId: string, fn: (tx: TxClient) => Promise<string | null>) =>
        single.withScope({ kind: 'business', businessId }, fn);
      await expect(inFirm(firms.withKey, (tx) => keys.keyIdOf(firms.withKey, tx))).resolves.toBe(
        KEY,
      );
      await expect(
        inFirm(firms.withoutKey, (tx) => keys.keyIdOf(firms.withoutKey, tx)),
      ).resolves.toBeNull();
      // Another firm's row is not visible in this firm's transaction (row-level security).
      await expect(
        inFirm(firms.withoutKey, (tx) => keys.keyIdOf(firms.withKey, tx)),
      ).resolves.toBeNull();
    } finally {
      await single.disconnect();
    }
  });
});
