// R10 step 2 (and the lead's reviews of #60 and #82): the field-encryption helper (SSN, EIN, date
// of birth). Envelope encryption with the firm's key, which the helper looks up itself (in the
// caller's transaction when given one), bound to firm, table, record and field with the ids in
// lowercase; local mode only in development and test.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DecryptCommand, GenerateDataKeyCommand, type KMSClient } from '@aws-sdk/client-kms';
import { Test } from '@nestjs/testing';
import type { TxClient } from '@firmivra/db';
import { describe, expect, it, vi } from 'vitest';
import { loadFieldEncryptionConfig } from '../../src/field-encryption/config.js';
import {
  type FieldContext,
  FieldEncryption,
  FieldEncryptionError,
  FieldEncryptionModule,
  FIRM_KEY_IDS,
  type FirmKeyIds,
} from '../../src/field-encryption/field-encryption.service.js';
import {
  AwsKmsKeyWrapper,
  LocalKeyWrapper,
  open,
  seal,
} from '../../src/field-encryption/key-wrapper.js';

const FIRM_A = '0199b6a0-0000-7000-8000-00000000000a';
const FIRM_B = '0199b6a0-0000-7000-8000-00000000000b';
const RECORD = '0199b6a1-0000-7000-8000-00000000000c';
const KEY_A = 'arn:aws:kms:us-east-1:000000000000:key/firm-a';
const KEY_B = 'arn:aws:kms:us-east-1:000000000000:key/firm-b';

/** The firms' key ids, as businesses.kms_key_id would hold them; records every lookup. */
const keyIds = (byFirm: Record<string, string> = {}) => {
  const asked: string[] = [];
  const txs: (TxClient | undefined)[] = [];
  const ids: FirmKeyIds = {
    keyIdOf: async (businessId, tx) => {
      asked.push(businessId);
      txs.push(tx);
      return byFirm[businessId] ?? null;
    },
  };
  return Object.assign(ids, { asked, txs });
};

/** A stand-in for Nest's Logger, so tests can read what was logged. */
const logger = () => ({ warn: vi.fn() });

const localKey = randomBytes(32);
const local = () => new FieldEncryption(new LocalKeyWrapper(localKey), keyIds());
const ctx = (over: Partial<FieldContext> = {}): FieldContext => ({
  businessId: FIRM_A,
  table: 'client_profiles',
  recordId: RECORD,
  field: 'ssn',
  ...over,
});
const SSN = '123456789'; // synthetic
const code = (error: unknown) => (error as FieldEncryptionError).code;
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => {
      throw new Error('expected a failure');
    },
    (e: unknown) => e,
  );

/**
 * A stand-in for AWS KMS: one AES key per KeyId; the encryption context must match on decrypt,
 * and a blob only decrypts under the key that wrapped it, as in KMS. `fail` makes the next call
 * throw an AWS-style error with that name.
 */
function fakeKms() {
  const keys = new Map<string, Buffer>();
  const calls: unknown[] = [];
  const handedOut: Uint8Array[] = [];
  let fail: string | null = null;
  const keyFor = (id: string) => {
    if (!keys.has(id)) keys.set(id, randomBytes(32));
    return keys.get(id)!;
  };
  const context = (c: Record<string, string> | undefined) => Buffer.from(JSON.stringify(c ?? {}));
  const kms = {
    send: async (command: unknown) => {
      calls.push(command);
      if (fail) {
        const error = new Error(`User arn:aws:iam::000000000000:role/api is not allowed (${fail})`);
        error.name = fail;
        fail = null;
        throw error;
      }
      if (command instanceof GenerateDataKeyCommand) {
        const { KeyId, EncryptionContext } = command.input;
        const plaintext = randomBytes(32);
        const blob = Buffer.concat([
          Buffer.from(`${KeyId}|`),
          seal(keyFor(KeyId!), plaintext, context(EncryptionContext)),
        ]);
        const handed = new Uint8Array(plaintext);
        handedOut.push(handed);
        return { Plaintext: handed, CiphertextBlob: new Uint8Array(blob) };
      }
      if (command instanceof DecryptCommand) {
        const { KeyId, CiphertextBlob, EncryptionContext } = command.input;
        const blob = Buffer.from(CiphertextBlob!);
        const sep = blob.indexOf('|');
        if (blob.subarray(0, sep).toString() !== KeyId) {
          const error = new Error('IncorrectKeyException');
          error.name = 'IncorrectKeyException';
          throw error;
        }
        const plaintext = open(keyFor(KeyId), blob.subarray(sep + 1), context(EncryptionContext));
        const handed = new Uint8Array(plaintext);
        handedOut.push(handed);
        return { Plaintext: handed };
      }
      throw new Error('unexpected command');
    },
  };
  return {
    kms: kms as unknown as Pick<KMSClient, 'send'>,
    calls,
    handedOut,
    failNext: (name: string) => {
      fail = name;
    },
  };
}

/** The helper in AWS KMS mode with the fake KMS, firm A's key and a logger tests can read. */
function withKms(byFirm: Record<string, string> = { [FIRM_A]: KEY_A }) {
  const fake = fakeKms();
  const ids = keyIds(byFirm);
  const log = logger();
  return { ...fake, ids, log, fe: new FieldEncryption(new AwsKmsKeyWrapper(fake.kms, log), ids) };
}

describe('field encryption (local mode)', () => {
  it('round-trips an SSN and a date of birth, with a new ciphertext every time', async () => {
    const fe = local();
    const a = await fe.encrypt(ctx(), SSN);
    const b = await fe.encrypt(ctx(), SSN);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(Buffer.from(a).includes(Buffer.from(SSN))).toBe(false);
    await expect(fe.decrypt(ctx(), a)).resolves.toBe(SSN);
    const dob = ctx({ field: 'date_of_birth' });
    await expect(fe.decrypt(dob, await fe.encrypt(dob, '1985-04-12'))).resolves.toBe('1985-04-12');
  });

  it('a value copied to another firm, table, record or field does not decrypt', async () => {
    const fe = local();
    const blob = await fe.encrypt(ctx(), SSN);
    for (const other of [
      ctx({ businessId: randomUUID() }),
      ctx({ table: 'business_settings' }),
      ctx({ recordId: randomUUID() }),
      ctx({ field: 'date_of_birth' }),
    ]) {
      const error = await failure(fe.decrypt(other, blob));
      expect(code(error)).toBe('DECRYPTION_FAILED');
      expect(String(error)).not.toContain(SSN);
    }
  });

  it('ids in capitals reach the same value: the helper uses them in lowercase', async () => {
    const fe = local();
    const upper = ctx({ businessId: FIRM_A.toUpperCase(), recordId: RECORD.toUpperCase() });
    await expect(fe.decrypt(ctx(), await fe.encrypt(upper, SSN))).resolves.toBe(SSN);
    await expect(fe.decrypt(upper, await fe.encrypt(ctx(), SSN))).resolves.toBe(SSN);
  });

  it('any changed byte, or another local key, fails', async () => {
    const blob = Buffer.from(await local().encrypt(ctx(), SSN));
    for (const i of [5, blob.length - 20, blob.length - 1]) {
      const changed = Buffer.from(blob);
      changed[i] = changed[i]! ^ 1;
      expect(code(await failure(local().decrypt(ctx(), changed)))).toBe('DECRYPTION_FAILED');
    }
    const otherKey = new FieldEncryption(new LocalKeyWrapper(randomBytes(32)), keyIds());
    expect(code(await failure(otherKey.decrypt(ctx(), blob)))).toBe('DECRYPTION_FAILED');
  });

  it('refuses unknown formats, bad contexts and values that are not text', async () => {
    const fe = local();
    expect(code(await failure(fe.decrypt(ctx(), new Uint8Array([9, 1, 0, 0]))))).toBe(
      'UNSUPPORTED_FORMAT',
    );
    // Only bytes are a stored value: anything else is UNSUPPORTED_FORMAT, never a TypeError.
    for (const blob of [null, undefined, 123, [1, 1, 0, 0], new ArrayBuffer(64)]) {
      const error = await failure(fe.decrypt(ctx(), blob as unknown as Uint8Array));
      expect([blob, code(error)]).toEqual([blob, 'UNSUPPORTED_FORMAT']);
    }
    // Text only: an object that prints as a valid name or id is not one.
    const printsAs = (text: string) => ({ toString: () => text }) as unknown as string;
    for (const bad of [
      ctx({ businessId: 'x' }),
      ctx({ table: 'client_profiles:x' }),
      ctx({ field: 'ssn:x' }),
      ctx({ field: '' }),
      ctx({ table: ['client_profiles'] as unknown as string }),
      ctx({ field: printsAs('ssn') }),
      ctx({ businessId: printsAs(FIRM_A) }),
      ctx({ recordId: [RECORD] as unknown as string }),
      null as unknown as FieldContext,
    ]) {
      expect(code(await failure(fe.encrypt(bad, SSN)))).toBe('INVALID_CONTEXT');
      expect(code(await failure(fe.decrypt(bad, new Uint8Array(64))))).toBe('INVALID_CONTEXT');
    }
    const error = await failure(fe.encrypt(ctx(), 123456789 as unknown as string));
    expect(code(error)).toBe('INVALID_VALUE');
    expect(String(error)).not.toContain(SSN);
  });

  it("never asks for a KMS key id, with or without the caller's transaction", async () => {
    const ids = keyIds();
    const fe = new FieldEncryption(new LocalKeyWrapper(localKey), ids);
    await fe.decrypt(ctx(), await fe.encrypt(ctx(), SSN));
    const tx = { caller: 'tx' } as unknown as TxClient;
    await fe.decrypt(ctx(), await fe.encrypt(ctx(), SSN, { tx }), { tx });
    expect(ids.asked).toEqual([]);
  });
});

describe('field encryption (AWS KMS mode)', () => {
  it("looks up the firm's own key, sends the firm as context and pins the key on decrypt", async () => {
    const { calls, ids, fe } = withKms({ [FIRM_A]: KEY_A, [FIRM_B]: KEY_B });
    const blob = await fe.encrypt(ctx(), SSN);
    await expect(fe.decrypt(ctx(), blob)).resolves.toBe(SSN);
    expect(ids.asked).toEqual([FIRM_A, FIRM_A]);

    const [generate, decrypt] = calls as [GenerateDataKeyCommand, DecryptCommand];
    expect(generate.input).toMatchObject({
      KeyId: KEY_A,
      KeySpec: 'AES_256',
      EncryptionContext: { businessId: FIRM_A },
    });
    expect(decrypt.input).toMatchObject({
      KeyId: KEY_A,
      EncryptionContext: { businessId: FIRM_A },
    });

    // Firm B's context brings firm B's key: firm A's value does not open.
    expect(code(await failure(fe.decrypt(ctx({ businessId: FIRM_B }), blob)))).toBe(
      'DECRYPTION_FAILED',
    );
  });

  it('looks up the key and calls KMS with the firm id in lowercase, as sent in capitals', async () => {
    const { calls, ids, fe } = withKms();
    const upper = ctx({ businessId: FIRM_A.toUpperCase(), recordId: RECORD.toUpperCase() });
    await expect(fe.decrypt(ctx(), await fe.encrypt(upper, SSN))).resolves.toBe(SSN);
    await expect(fe.decrypt(upper, await fe.encrypt(ctx(), SSN))).resolves.toBe(SSN);
    expect(ids.asked).toEqual([FIRM_A, FIRM_A, FIRM_A, FIRM_A]);
    for (const call of calls as (GenerateDataKeyCommand | DecryptCommand)[]) {
      expect(call.input.EncryptionContext).toEqual({ businessId: FIRM_A });
    }
  });

  it("reads the key id in the caller's transaction when given one", async () => {
    const { ids, fe } = withKms();
    const tx = { caller: 'tx' } as unknown as TxClient;
    const blob = await fe.encrypt(ctx(), SSN, { tx });
    await expect(fe.decrypt(ctx(), blob, { tx })).resolves.toBe(SSN);
    await expect(fe.decrypt(ctx(), blob)).resolves.toBe(SSN);
    expect(ids.txs).toHaveLength(3);
    expect(ids.txs[0]).toBe(tx);
    expect(ids.txs[1]).toBe(tx);
    expect(ids.txs[2]).toBeUndefined();
  });

  it('zeroes the data keys KMS hands out', async () => {
    const { handedOut, fe } = withKms();
    await fe.decrypt(ctx(), await fe.encrypt(ctx(), SSN));
    expect(handedOut).toHaveLength(2);
    for (const key of handedOut) expect(key.every((byte) => byte === 0)).toBe(true);
  });

  it('zeroes a data key KMS returns without its wrapped form, or with an empty one', async () => {
    for (const wrapped of [undefined, new Uint8Array(0)]) {
      const handed = new Uint8Array(32).fill(7);
      const kms = {
        send: async () => ({ Plaintext: handed, CiphertextBlob: wrapped }),
      } as unknown as Pick<KMSClient, 'send'>;
      const fe = new FieldEncryption(
        new AwsKmsKeyWrapper(kms, logger()),
        keyIds({ [FIRM_A]: KEY_A }),
      );
      expect(code(await failure(fe.encrypt(ctx(), SSN)))).toBe('KMS_UNAVAILABLE');
      expect(handed.every((byte) => byte === 0)).toBe(true);
    }
  });

  it('a value too short for a wrapped key, iv and tag fails before KMS is asked', async () => {
    const { calls, fe } = withKms();
    const blob = Buffer.from(await fe.encrypt(ctx(), SSN));
    const wrappedEnd = 4 + blob.readUInt16BE(2);
    const asked = calls.length;
    for (const short of [
      blob.subarray(0, wrappedEnd + 12 + 16 - 1),
      blob.subarray(0, wrappedEnd),
      blob.subarray(0, 10),
      // An empty wrapped key.
      Buffer.concat([Buffer.from([1, 2, 0, 0]), randomBytes(64)]),
    ]) {
      expect(code(await failure(fe.decrypt(ctx(), short)))).toBe('DECRYPTION_FAILED');
    }
    expect(calls).toHaveLength(asked);
  });

  it('a firm without a key gets KEY_NOT_PROVISIONED; a local value is refused', async () => {
    expect(code(await failure(withKms({}).fe.encrypt(ctx(), SSN)))).toBe('KEY_NOT_PROVISIONED');
    const localBlob = await local().encrypt(ctx(), SSN);
    expect(code(await failure(withKms().fe.decrypt(ctx(), localBlob)))).toBe('WRONG_MODE');
  });

  it('KMS errors become KEY_ACCESS_DENIED or KMS_UNAVAILABLE, never with AWS details', async () => {
    const { failNext, log, fe } = withKms();
    const blob = await fe.encrypt(ctx(), SSN);
    for (const [name, expected] of [
      ['AccessDeniedException', 'KEY_ACCESS_DENIED'],
      ['DisabledException', 'KEY_ACCESS_DENIED'],
      ['ThrottlingException', 'KMS_UNAVAILABLE'],
      ['TimeoutError', 'KMS_UNAVAILABLE'],
    ] as const) {
      for (const [operation, call] of [
        ['GenerateDataKey', () => fe.encrypt(ctx(), SSN)],
        ['Decrypt', () => fe.decrypt(ctx(), blob)],
      ] as const) {
        failNext(name);
        log.warn.mockClear();
        const error = await failure(call());
        expect(code(error)).toBe(expected);
        expect(String(error)).not.toMatch(/arn:|000000000000/);
        // Operators see the AWS error's name (throttling or permissions), never its message.
        expect(log.warn).toHaveBeenCalledTimes(1);
        const logged = String(log.warn.mock.calls[0]?.[0]);
        expect(logged).toBe(`KMS ${operation} failed for business ${FIRM_A}: ${name}`);
      }
    }
  });
});

describe('settings', () => {
  // 32 different bytes: 0, 1, 2 ... 31.
  const key = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('base64');

  it('defaults to AWS KMS', () => {
    expect(loadFieldEncryptionConfig({})).toEqual({ mode: 'kms' });
  });

  it('local mode needs a real 32-byte key and NODE_ENV development or test', () => {
    for (const env of ['development', 'test']) {
      expect(
        loadFieldEncryptionConfig({ NODE_ENV: env, KMS_MODE: 'local', LOCAL_KMS_KEY: key }),
      ).toMatchObject({ mode: 'local' });
    }
    const base = { NODE_ENV: 'test', KMS_MODE: 'local' };
    expect(() => loadFieldEncryptionConfig(base)).toThrow(/LOCAL_KMS_KEY/);
    expect(() => loadFieldEncryptionConfig({ ...base, LOCAL_KMS_KEY: 'c2hvcnQ=' })).toThrow(
      /LOCAL_KMS_KEY/,
    );
    // One byte repeated is no key: all zeros, all sevens, all 0xff.
    for (const byte of [0, 7, 0xff]) {
      expect(() =>
        loadFieldEncryptionConfig({
          ...base,
          LOCAL_KMS_KEY: Buffer.alloc(32, byte).toString('base64'),
        }),
      ).toThrow(/must not repeat one byte/);
    }
    for (const NODE_ENV of ['production', undefined]) {
      expect(() =>
        loadFieldEncryptionConfig({ NODE_ENV, KMS_MODE: 'local', LOCAL_KMS_KEY: key }),
      ).toThrow(/only allowed when NODE_ENV is development or test/);
    }
  });

  it('accepts the .env.example key, which local development uses', () => {
    const example = readFileSync(new URL('../../../../.env.example', import.meta.url), 'utf8');
    const LOCAL_KMS_KEY = /^LOCAL_KMS_KEY=(.*)$/m.exec(example)?.[1]?.trim();
    expect(LOCAL_KMS_KEY).toBeTruthy();
    expect(
      loadFieldEncryptionConfig({ NODE_ENV: 'development', KMS_MODE: 'local', LOCAL_KMS_KEY }),
    ).toMatchObject({ mode: 'local' });
  });
});

describe('FieldEncryptionModule', () => {
  it('provides FieldEncryption with the key wrapper picked from the settings', async () => {
    const saved = {
      KMS_MODE: process.env['KMS_MODE'],
      LOCAL_KMS_KEY: process.env['LOCAL_KMS_KEY'],
    };
    process.env['KMS_MODE'] = 'local';
    process.env['LOCAL_KMS_KEY'] = localKey.toString('base64');
    try {
      const moduleRef = await Test.createTestingModule({ imports: [FieldEncryptionModule] })
        .overrideProvider(FIRM_KEY_IDS)
        .useValue(keyIds())
        .compile();
      const fe = moduleRef.get(FieldEncryption);
      await expect(fe.decrypt(ctx(), await fe.encrypt(ctx(), SSN))).resolves.toBe(SSN);
      // Same local key, so a value from the module opens with a directly built helper too.
      await expect(local().decrypt(ctx(), await fe.encrypt(ctx(), SSN))).resolves.toBe(SSN);
      await moduleRef.close();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
