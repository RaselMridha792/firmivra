// The create-firm-key command against the test database, as the app role, with a fake KMS:
// it stores the key in platform scope only (R0's businesses_protected_columns), once, with one
// platform audit row, and field encryption then finds the key (R10's DatabaseFirmKeyIds).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest';
import { createDatabase, createPrismaClient, databaseErrorCode, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { DatabaseFirmKeyIds } from '../../src/field-encryption/field-encryption.service.js';
import {
  createFirmKey,
  KEY_SET_ACTION,
  runCreateFirmKey,
} from '../../src/firm-applications/create-firm-key.js';
import {
  AwsFirmKeys,
  firmKeyAlias,
  LocalFirmKeys,
  type FirmKeys,
} from '../../src/firm-applications/firm-keys.js';
import { fakeKms } from '../fake-kms.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const db = createDatabase(fx.appUrl);
const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
const DEV = { APP_ENV: 'dev', KMS_MODE: 'kms' };
const firms = { a: { id: '', slug: `ck-a-${run}` }, b: { id: '', slug: `ck-b-${run}` } };

const keyOf = async (id: string) =>
  (
    await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.business.findUnique({ where: { id }, select: { kmsKeyId: true } }),
    )
  )?.kmsKeyId ?? null;
const auditRows = (id: string) =>
  runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.auditLog.findMany({ where: { action: KEY_SET_ACTION, entityId: id } }),
  );
const makeFirm = (slug: string) =>
  runInScope(
    owner,
    { kind: 'platform' },
    async (tx) =>
      (await tx.business.create({ data: { slug, name: slug }, select: { id: true } })).id,
  );

beforeAll(async () => {
  firms.a.id = await makeFirm(firms.a.slug);
  firms.b.id = await makeFirm(firms.b.slug);
});

afterAll(async () => {
  await db.disconnect();
  await owner.$disconnect();
});

describe('create-firm-key', () => {
  const fake = fakeKms();
  const lines: string[] = [];
  const say = (line: string) => lines.push(line);

  it('stores the key in platform scope with one platform audit row', async () => {
    const code = await runCreateFirmKey([firms.a.slug], DEV, say, { database: db, kms: fake.kms });
    expect(code).toBe(0);
    expect(fake.names()).toEqual(['DescribeKey', 'CreateKey', 'CreateAlias']);
    const arn = fake.aliases.get(firmKeyAlias('dev', firms.a.id))!;
    expect(fake.keys.get(arn)?.tags).toEqual([
      { TagKey: 'firmivra:env', TagValue: 'dev' },
      { TagKey: 'firmivra:businessId', TagValue: firms.a.id },
      { TagKey: 'firmivra:purpose', TagValue: 'firm-data' },
    ]);
    expect(await keyOf(firms.a.id)).toBe(arn);
    const rows = await auditRows(firms.a.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      businessId: null,
      actorUserId: null,
      entityType: 'business',
      entityId: firms.a.id,
      metadata: { keyArn: arn },
    });
    expect(lines.at(-1)).toBe(`Firm ${firms.a.slug} (${firms.a.id}): stored key ${arn}`);
    // Field encryption finds it in the firm's own scope.
    await expect(new DatabaseFirmKeyIds(db).keyIdOf(firms.a.id)).resolves.toBe(arn);
  });

  it('changes nothing on a second run: no KMS call, no second audit row', async () => {
    const arn = await keyOf(firms.a.id);
    fake.calls.length = 0;
    const code = await runCreateFirmKey([firms.a.slug], DEV, say, { database: db, kms: fake.kms });
    expect(code).toBe(0);
    expect(fake.calls).toEqual([]);
    expect(await auditRows(firms.a.id)).toHaveLength(1);
    expect(lines.at(-1)).toBe(
      `Firm ${firms.a.slug} (${firms.a.id}) already has key ${arn}; nothing changed`,
    );
  });

  it('leaves the other firm without a key', async () => {
    expect(await keyOf(firms.b.id)).toBeNull();
    expect(await auditRows(firms.b.id)).toEqual([]);
  });

  it('stores the named key when a run stopped between naming and storing', async () => {
    const id = await makeFirm(`ck-c-${run}`);
    const crashed = fakeKms();
    const arn = await new AwsFirmKeys(crashed.kms, 'dev').ensureKey(id); // named, never stored
    crashed.calls.length = 0;
    const keys = new AwsFirmKeys(crashed.kms, 'dev');
    await expect(createFirmKey({ database: db, keys, say }, `ck-c-${run}`)).resolves.toBe(arn);
    expect(crashed.names()).toEqual([
      'DescribeKey',
      'ListResourceTags',
      'GetKeyPolicy',
      'ListGrants',
    ]);
    expect(await keyOf(id)).toBe(arn);
  });

  it('refuses in business or admin scope: only platform scope sets kms_key_id (R0)', async () => {
    const arn = 'arn:aws:kms:us-east-1:000000000000:key/0199b6a3-0000-7000-8000-0000000000b0';
    const inFirm = db.withScope({ kind: 'business', businessId: firms.b.id }, (tx) =>
      tx.business.update({ where: { id: firms.b.id }, data: { kmsKeyId: arn } }),
    );
    const error = await inFirm.catch((e: unknown) => e);
    expect(databaseErrorCode(error)).toBe('42501'); // insufficient_privilege
    const asAdmin = await db
      .withScope({ kind: 'admin', adminUserId: fx.users.admin.id }, (tx) =>
        tx.business.update({ where: { id: firms.b.id }, data: { kmsKeyId: arn } }),
      )
      .catch((e: unknown) => e);
    expect(databaseErrorCode(asAdmin)).toBe('42501');
    expect(await keyOf(firms.b.id)).toBeNull();
  });

  it('writes nothing for an unknown slug, the local adapter or a value that is no key ARN', async () => {
    const unknown = await runCreateFirmKey([`ck-none-${run}`], DEV, say, {
      database: db,
      kms: fakeKms().kms,
    });
    expect(unknown).toBe(1);
    expect(lines.at(-1)).toBe(`Refused: no firm has the slug ck-none-${run}`);

    const wrong: FirmKeys = { mode: 'kms', ensureKey: async () => ' ' };
    for (const keys of [new LocalFirmKeys(), wrong]) {
      await expect(createFirmKey({ database: db, keys, say }, firms.b.slug)).rejects.toThrow(
        /returned no key ARN; nothing stored/,
      );
    }
    expect(await keyOf(firms.b.id)).toBeNull();
    expect(await auditRows(firms.b.id)).toEqual([]);
  });

  it('refuses when another key was stored meanwhile, and leaves the row as it is', async () => {
    const other = 'arn:aws:kms:us-east-1:000000000000:key/0199b6a3-0000-7000-8000-0000000000b1';
    const slug = `ck-d-${run}`;
    const id = await makeFirm(slug);
    const racing = fakeKms();
    const inner = new AwsFirmKeys(racing.kms, 'dev');
    // Between this run's read and its write, another run stores a different key.
    const keys: FirmKeys = {
      mode: 'kms',
      ensureKey: async (businessId) => {
        const arn = await inner.ensureKey(businessId);
        await runInScope(owner, { kind: 'platform' }, (tx) =>
          tx.business.update({ where: { id }, data: { kmsKeyId: other } }),
        );
        return arn;
      },
    };
    await expect(createFirmKey({ database: db, keys, say }, slug)).rejects.toThrow(
      new RegExp(`got key ${other} meanwhile; key arn:aws:kms:.* was not stored`),
    );
    expect(await keyOf(id)).toBe(other);
    expect(await auditRows(id)).toEqual([]);
  });
});
