// An in-memory stand-in for AWS KMS, shared by the firm key tests: keys with their metadata, tags,
// key policy and grants, aliases, KMS's errors by name, and the API role's IAM rule on use (the
// encryption context's businessId must equal the key's firmivra:businessId tag, and its
// firmivra:env tag must be dev). Never calls AWS.
import { randomBytes, randomUUID } from 'node:crypto';
import {
  CreateAliasCommand,
  CreateKeyCommand,
  DecryptCommand,
  DescribeKeyCommand,
  GenerateDataKeyCommand,
  GetKeyPolicyCommand,
  type GrantListEntry,
  type KMSClient,
  ListGrantsCommand,
  ListResourceTagsCommand,
  type Tag,
} from '@aws-sdk/client-kms';

export const named = (name: string) => Object.assign(new Error(`${name}: fake detail`), { name });

export const FAKE_ACCOUNT = '000000000000';

/** KMS's default key policy for keys made through the API, as GetKeyPolicy returns it. */
export const defaultKeyPolicy = (account = FAKE_ACCOUNT) =>
  JSON.stringify(
    {
      Version: '2012-10-17',
      Id: 'key-default-1',
      Statement: [
        {
          Sid: 'Enable IAM User Permissions',
          Effect: 'Allow',
          Principal: { AWS: `arn:aws:iam::${account}:root` },
          Action: 'kms:*',
          Resource: '*',
        },
      ],
    },
    null,
    2,
  );

export interface FakeKmsOptions {
  /** State of every key CreateKey makes (default Enabled). */
  keyState?: string;
  /** Another call names this key first, just before our CreateAlias (a key it made). */
  aliasTakenBy?: string;
  /** CreateAlias fails with these error names first, in order. */
  aliasErrors?: string[];
  /** DescribeKey fails with this error name. */
  describeError?: string;
  /** Simulates a role without the encryption-context rule: any business id may use any key. */
  ignoreContext?: boolean;
}

export interface FakeKey {
  state: string;
  tags: Tag[];
  account: string;
  keyManager: string;
  origin: string;
  multiRegion: boolean;
  keySpec: string;
  keyUsage: string;
  policy: string;
  grants: GrantListEntry[];
}

/** A key as CreateKey makes it with the adapter's settings. */
export function fakeKey(tags: Tag[], state = 'Enabled'): FakeKey {
  return {
    state,
    tags,
    account: FAKE_ACCOUNT,
    keyManager: 'CUSTOMER',
    origin: 'AWS_KMS',
    multiRegion: false,
    keySpec: 'SYMMETRIC_DEFAULT',
    keyUsage: 'ENCRYPT_DECRYPT',
    policy: defaultKeyPolicy(),
    grants: [],
  };
}

export function fakeKms(options: FakeKmsOptions = {}) {
  const aliases = new Map<string, string>();
  const keys = new Map<string, FakeKey>();
  const blobs = new Map<string, { arn: string; businessId: string; plaintext: Buffer }>();
  const calls: unknown[] = [];
  const handed: Uint8Array[] = [];
  const aliasErrors = [...(options.aliasErrors ?? [])];

  const tag = (key: FakeKey, name: string) => key.tags.find((t) => t.TagKey === name)?.TagValue;
  const keyOf = (id: string | undefined) => {
    const key = keys.get(id ?? '');
    if (!key) throw named('NotFoundException');
    return key;
  };
  /** The API role's FirmKeysUse statement. */
  const mayUse = (arn: string, context: Record<string, string> | undefined) => {
    const key = keyOf(arn);
    if (key.state !== 'Enabled') throw named('KMSInvalidStateException');
    if (options.ignoreContext) return;
    const businessId = tag(key, 'firmivra:businessId');
    if (
      tag(key, 'firmivra:env') !== 'dev' ||
      !businessId ||
      context?.['businessId'] !== businessId
    ) {
      throw named('AccessDeniedException');
    }
  };

  const kms = {
    send: async (command: unknown) => {
      calls.push(command);
      if (command instanceof DescribeKeyCommand) {
        if (options.describeError) throw named(options.describeError);
        const arn = aliases.get(command.input.KeyId!) ?? command.input.KeyId!;
        const key = keyOf(arn);
        return {
          KeyMetadata: {
            Arn: arn,
            AWSAccountId: key.account,
            KeyState: key.state,
            KeyManager: key.keyManager,
            Origin: key.origin,
            MultiRegion: key.multiRegion,
            KeySpec: key.keySpec,
            KeyUsage: key.keyUsage,
          },
        };
      }
      if (command instanceof ListResourceTagsCommand) {
        return { Tags: keyOf(command.input.KeyId).tags.map((t) => ({ ...t })), Truncated: false };
      }
      if (command instanceof GetKeyPolicyCommand) {
        if (command.input.PolicyName !== 'default') throw named('NotFoundException');
        return { Policy: keyOf(command.input.KeyId).policy, PolicyName: 'default' };
      }
      if (command instanceof ListGrantsCommand) {
        return { Grants: keyOf(command.input.KeyId).grants, Truncated: false };
      }
      if (command instanceof CreateKeyCommand) {
        const arn = `arn:aws:kms:us-east-1:${FAKE_ACCOUNT}:key/${randomUUID()}`;
        const key = fakeKey(command.input.Tags ?? [], options.keyState ?? 'Enabled');
        if (command.input.Policy) key.policy = command.input.Policy;
        if (command.input.Origin) key.origin = command.input.Origin;
        if (command.input.MultiRegion !== undefined) key.multiRegion = command.input.MultiRegion;
        keys.set(arn, key);
        return { KeyMetadata: { Arn: arn, KeyState: 'Enabled' } };
      }
      if (command instanceof CreateAliasCommand) {
        const { AliasName, TargetKeyId } = command.input;
        const error = aliasErrors.shift();
        if (error) throw named(error);
        if (options.aliasTakenBy && !aliases.has(AliasName!)) {
          // The other call's key, made by the same adapter for the same business.
          const tags = keyOf(TargetKeyId).tags.map((t) => ({ ...t }));
          keys.set(options.aliasTakenBy, fakeKey(tags));
          aliases.set(AliasName!, options.aliasTakenBy);
        }
        if (aliases.has(AliasName!)) throw named('AlreadyExistsException');
        aliases.set(AliasName!, TargetKeyId!);
        return {};
      }
      if (command instanceof GenerateDataKeyCommand) {
        const arn = command.input.KeyId!;
        mayUse(arn, command.input.EncryptionContext);
        const plaintext = randomBytes(32);
        const id = randomUUID();
        blobs.set(id, {
          arn,
          businessId: command.input.EncryptionContext?.['businessId'] ?? '',
          plaintext: Buffer.from(plaintext),
        });
        const out = new Uint8Array(plaintext);
        handed.push(out);
        return { Plaintext: out, CiphertextBlob: Buffer.from(id) };
      }
      if (command instanceof DecryptCommand) {
        const arn = command.input.KeyId!;
        mayUse(arn, command.input.EncryptionContext);
        const blob = blobs.get(Buffer.from(command.input.CiphertextBlob!).toString());
        if (
          !blob ||
          blob.arn !== arn ||
          blob.businessId !== command.input.EncryptionContext?.['businessId']
        ) {
          throw named('InvalidCiphertextException');
        }
        const out = new Uint8Array(blob.plaintext);
        handed.push(out);
        return { Plaintext: out };
      }
      throw new Error('unexpected command');
    },
  };
  return {
    kms: kms as unknown as Pick<KMSClient, 'send'>,
    calls,
    keys,
    aliases,
    /** Every plain data key the fake handed out (the caller must have zeroed each). */
    handed,
    /** The names of the commands sent, in order. */
    names: () => calls.map((c) => (c as object).constructor.name.replace(/Command$/, '')),
  };
}
