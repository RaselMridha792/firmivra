// Unit tests for R18 step 4, the Firm Sign store: keys only under tenant/<businessId>/esign/,
// firm A's call with a firm B key refused (S3 and the in-memory fake alike), vault copies only
// from the firm's own documents, and the engine module providing the store.
import { randomUUID } from 'node:crypto';
import { CopyObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { ConfigModule } from '../../src/config/config.module.js';
import { loadEnv } from '../../src/config/env.js';
import { EsignEngineModule } from '../../src/esign/engine/engine.module.js';
import { ESIGN_STORE, type EsignStore } from '../../src/esign/engine/engine.types.js';
import {
  checkKey,
  EsignKeyError,
  MemoryEsignStore,
  S3EsignStore,
} from '../../src/esign/engine/esign-store.js';

const firmA = randomUUID();
const firmB = randomUUID();
const requestA = randomUUID();
const bytes = new TextEncoder().encode('%PDF-1.7 fake');

/** An S3 client that records commands and answers nothing. */
function fakeS3() {
  const sent: unknown[] = [];
  const s3 = { send: (command: unknown) => (sent.push(command), Promise.resolve({})) };
  return { s3: s3 as unknown as S3Client, sent };
}

describe('keys', () => {
  it('builds keys under the firm and the request', () => {
    expect(new MemoryEsignStore().keyFor(firmA, requestA, 'packet.pdf')).toBe(
      `tenant/${firmA}/esign/${requestA}/packet.pdf`,
    );
  });

  it('refuses other firms, other folders and path tricks', () => {
    const bad = [
      `tenant/${firmB}/esign/${requestA}/packet.pdf`,
      `tenant/${firmA}/documents/${randomUUID()}`,
      `tenant/${firmA}/esign/../../${firmB}/esign/x.pdf`,
      `tenant/${firmA}/esign/${requestA}/../x.pdf`,
      `tenant/${firmA}/esign/${requestA}//x.pdf`,
      `tenant/${firmA}/esign/`,
      `tenant/${firmA}/esign/${requestA}/a b.pdf`,
    ];
    for (const key of bad) expect(() => checkKey(firmA, key), key).toThrow(EsignKeyError);
    expect(() => checkKey('not-a-uuid', `tenant/not-a-uuid/esign/x`)).toThrow(EsignKeyError);
    const store = new MemoryEsignStore();
    expect(() => store.keyFor(firmA, 'x/../y', 'a.pdf')).toThrow(EsignKeyError);
    expect(() => store.keyFor(firmA, requestA, '../a.pdf')).toThrow(EsignKeyError);
  });
});

describe.each([
  ['memory', () => ({ store: new MemoryEsignStore() as EsignStore, sent: [] as unknown[] })],
  [
    'S3',
    () => {
      const { s3, sent } = fakeS3();
      return { store: new S3EsignStore(s3, 'fake-bucket') as EsignStore, sent };
    },
  ],
])('%s store', (_name, make) => {
  it("refuses firm A's call with a firm B key, before touching storage", async () => {
    const { store, sent } = make();
    const keyB = store.keyFor(firmB, randomUUID(), 'packet.pdf');
    const vaultB = `tenant/${firmB}/documents/${randomUUID()}`;
    const calls: (() => Promise<unknown>)[] = [
      () => store.put(firmA, keyB, bytes, 'application/pdf'),
      () => store.read(firmA, keyB),
      () => store.head(firmA, keyB),
      () => store.remove(firmA, keyB),
      () =>
        store.presignDownload(firmA, {
          key: keyB,
          fileName: 'a.pdf',
          contentType: 'application/pdf',
        }),
      () => store.copyFromVault(firmA, vaultB, store.keyFor(firmA, requestA, 'a.pdf')),
      () => store.copyFromVault(firmB, vaultB, store.keyFor(firmA, requestA, 'a.pdf')),
    ];
    for (const call of calls) {
      await expect(Promise.resolve().then(() => call())).rejects.toBeInstanceOf(EsignKeyError);
    }
    expect(sent).toEqual([]);
  });
});

describe('memory store', () => {
  it('puts, reads, heads, copies from the vault and removes', async () => {
    const store = new MemoryEsignStore();
    const key = store.keyFor(firmA, requestA, 'source/1.pdf');
    await store.put(firmA, key, bytes, 'application/pdf');
    expect(await store.read(firmA, key)).toEqual(bytes);
    expect(await store.head(firmA, key)).toEqual({ sizeBytes: bytes.byteLength });

    const vault = `tenant/${firmA}/documents/${randomUUID()}`;
    store.objects.set(vault, { bytes, contentType: 'application/pdf' });
    const copy = store.keyFor(firmA, requestA, 'source/2.pdf');
    await store.copyFromVault(firmA, vault, copy);
    expect(await store.read(firmA, copy)).toEqual(bytes);

    await store.remove(firmA, key);
    expect(await store.read(firmA, key)).toBeNull();
    expect(await store.head(firmA, key)).toBeNull();
  });
});

describe('S3 store', () => {
  it('sends a PUT and a copy for keys in the firm', async () => {
    const { s3, sent } = fakeS3();
    const store = new S3EsignStore(s3, 'fake-bucket');
    const key = store.keyFor(firmA, requestA, 'final.pdf');
    await store.put(firmA, key, bytes, 'application/pdf');
    const vault = `tenant/${firmA}/documents/${randomUUID()}`;
    await store.copyFromVault(firmA, vault, key);
    const [put, copy] = sent as [PutObjectCommand, CopyObjectCommand];
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect(put.input).toMatchObject({
      Bucket: 'fake-bucket',
      Key: key,
      ContentType: 'application/pdf',
    });
    expect(copy).toBeInstanceOf(CopyObjectCommand);
    expect(copy.input).toMatchObject({ Key: key, CopySource: `fake-bucket/${vault}` });
  });
});

describe('EsignEngineModule', () => {
  it('provides the store', async () => {
    process.env.S3_DOCUMENTS_BUCKET ??= 'fake-bucket';
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot(loadEnv()), EsignEngineModule],
    }).compile();
    expect(moduleRef.get(ESIGN_STORE)).toBeInstanceOf(S3EsignStore);
    await moduleRef.close();
  });
});
