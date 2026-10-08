// An in-memory stand-in for AWS KMS, shared by the firm key tests: keys, tags and aliases, KMS's
// errors by name, and the API role's IAM rule on use (the encryption context's businessId must
// equal the key's firmivra:businessId tag, and its firmivra:env tag must be dev). Never calls AWS.
import { randomBytes, randomUUID } from 'node:crypto';
import {
  CreateAliasCommand,
  CreateKeyCommand,
  DecryptCommand,
  DescribeKeyCommand,
  GenerateDataKeyCommand,
  type KMSClient,
  type Tag,
} from '@aws-sdk/client-kms';

export const named = (name: string) => Object.assign(new Error(`${name}: fake detail`), { name });

export interface FakeKmsOptions {
  /** State of every key CreateKey makes (default Enabled). */
  keyState?: string;
  /** Another call names this key first, just before our CreateAlias. */
  aliasTakenBy?: string;
  /** CreateAlias fails with these error names first, in order. */
  aliasErrors?: string[];
  /** DescribeKey fails with this error name. */
  describeError?: string;
  /** Simulates a role without the encryption-context rule: any business id may use any key. */
  ignoreContext?: boolean;
}

interface FakeKey {
  state: string;
  tags: Tag[];
}

export function fakeKms(options: FakeKmsOptions = {}) {
  const aliases = new Map<string, string>();
  const keys = new Map<string, FakeKey>();
  const blobs = new Map<string, { arn: string; businessId: string; plaintext: Buffer }>();
  const calls: unknown[] = [];
  const handed: Uint8Array[] = [];
  const aliasErrors = [...(options.aliasErrors ?? [])];

  const tag = (key: FakeKey, name: string) => key.tags.find((t) => t.TagKey === name)?.TagValue;
  /** The API role's FirmKeysUse statement. */
  const mayUse = (arn: string, context: Record<string, string> | undefined) => {
    const key = keys.get(arn);
    if (!key) throw named('NotFoundException');
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
        const key = keys.get(arn);
        if (!key) throw named('NotFoundException');
        return { KeyMetadata: { Arn: arn, KeyState: key.state } };
      }
      if (command instanceof CreateKeyCommand) {
        const arn = `arn:aws:kms:us-east-1:000000000000:key/${randomUUID()}`;
        keys.set(arn, { state: options.keyState ?? 'Enabled', tags: command.input.Tags ?? [] });
        return { KeyMetadata: { Arn: arn, KeyState: 'Enabled' } };
      }
      if (command instanceof CreateAliasCommand) {
        const { AliasName, TargetKeyId } = command.input;
        const error = aliasErrors.shift();
        if (error) throw named(error);
        if (options.aliasTakenBy && !aliases.has(AliasName!)) {
          keys.set(options.aliasTakenBy, { state: 'Enabled', tags: [] });
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
