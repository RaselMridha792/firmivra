// The field-encryption helper finds the firm's KMS key itself (the lead's #60 review): it reads
// businesses.kms_key_id in that firm's own scope, as the app role.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '@firmivra/db';
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
});
