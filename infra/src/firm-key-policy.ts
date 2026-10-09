import * as iam from 'aws-cdk-lib/aws-iam';

/**
 * Each firm's own KMS key (CLAUDE.md: per-business KMS keys, the fourth wall). The API makes it
 * when the Super Admin approves a firm (R4), or through the one-off create-firm-key command, and
 * field encryption (R10) wraps the firm's data keys with it. The tag names and values here are
 * the ones the API's adapter sends (apps/api/src/firm-applications/firm-keys.ts).
 */
export const FIRM_KEY_TAG = {
  env: 'firmivra:env',
  businessId: 'firmivra:businessId',
  purpose: 'firmivra:purpose',
} as const;
export const FIRM_KEY_PURPOSE = 'firm-data';

/** A business id is a lower-case UUID: 36 characters, hyphens at fixed places. */
const UUID_SHAPE = '????????-????-????-????-????????????';

/** The tag `Tags.of(app)` puts on every CDK resource (bin/firmivra.ts), CDK keys included. */
const CDK_TAG = 'project';

export function firmKeyArns(envName: string, region: string, account: string) {
  return {
    /** Every key in the account and region; each statement on it narrows by tag. */
    keys: `arn:aws:kms:${region}:${account}:key/*`,
    /** One alias per firm: alias/firmivra/<env>/business/<businessId>. */
    aliases: `arn:aws:kms:${region}:${account}:alias/firmivra/${envName}/business/*`,
  };
}

/**
 * The API task role's rights on firm keys. Never granted: ScheduleKeyDeletion, DisableKey,
 * PutKeyPolicy, UntagResource, UpdateAlias, DeleteAlias, CreateGrant, or kms:*. A person removes a
 * key, never the API.
 * - CreateKey only with the three firm tags (env pinned, a UUID-shaped business id), and only a
 *   single-Region symmetric encryption key with key material from KMS. KMS has no condition key
 *   for CreateKey's Policy parameter, so IAM cannot stop a key policy being sent: the adapter
 *   sends none (KMS's default, the account root, which hands control to IAM), and it checks the
 *   policy, tags, origin and grants of every key it adopts by its alias (firm-keys.ts).
 * - TagResource is needed because CreateKey sends Tags. It never changes a firm tag a key already
 *   has to another value, never tags a key that has an alias or a CDK key, and only sets the
 *   three firm tags. Known limit: it can add firm tags to an untagged key without an alias made
 *   outside CDK (the adapter refuses such a key unless its policy is the default and it has no
 *   grants), and tags take up to five minutes to reach authorization.
 * - CreateAlias only under alias/firmivra/<env>/business/, and only on firm keys of the env.
 * - Read-only on keys of the env: DescribeKey, GetKeyPolicy, ListResourceTags, ListGrants (the
 *   adapter's checks).
 * - Use: GenerateDataKey and Decrypt (all field encryption calls), only on firm keys of the env,
 *   and only when the encryption context's businessId equals the key's businessId tag.
 */
export function firmKeyStatements(
  envName: string,
  region: string,
  account: string,
): iam.PolicyStatement[] {
  const { keys, aliases } = firmKeyArns(envName, region, account);
  const requestTags = {
    StringEquals: {
      [`aws:RequestTag/${FIRM_KEY_TAG.env}`]: envName,
      [`aws:RequestTag/${FIRM_KEY_TAG.purpose}`]: FIRM_KEY_PURPOSE,
    },
    StringLike: { [`aws:RequestTag/${FIRM_KEY_TAG.businessId}`]: UUID_SHAPE },
    'ForAllValues:StringEquals': {
      'aws:TagKeys': [FIRM_KEY_TAG.env, FIRM_KEY_TAG.businessId, FIRM_KEY_TAG.purpose],
    },
  };
  /** A firm key of this env: its env and purpose tags, KMS key material, one Region. */
  const firmKey = {
    StringEquals: {
      [`aws:ResourceTag/${FIRM_KEY_TAG.env}`]: envName,
      [`aws:ResourceTag/${FIRM_KEY_TAG.purpose}`]: FIRM_KEY_PURPOSE,
      'kms:KeyOrigin': 'AWS_KMS',
    },
    Bool: { 'kms:MultiRegion': 'false' },
  };
  return [
    new iam.PolicyStatement({
      sid: 'FirmKeysCreate',
      actions: ['kms:CreateKey'],
      resources: ['*'], // no key exists yet
      conditions: {
        ...requestTags,
        StringEquals: {
          ...requestTags.StringEquals,
          'kms:KeySpec': 'SYMMETRIC_DEFAULT',
          'kms:KeyUsage': 'ENCRYPT_DECRYPT',
          'kms:KeyOrigin': 'AWS_KMS',
        },
        Bool: { 'kms:MultiRegion': 'false' },
      },
    }),
    new iam.PolicyStatement({
      sid: 'FirmKeysTagOnCreate',
      actions: ['kms:TagResource'],
      resources: [keys],
      conditions: {
        ...requestTags,
        // Holds whether or not KMS fills the new key's tags from the request: a tag the key
        // already has must equal the requested value, so it can never be rewritten.
        StringEqualsIfExists: {
          [`aws:ResourceTag/${FIRM_KEY_TAG.env}`]: envName,
          [`aws:ResourceTag/${FIRM_KEY_TAG.businessId}`]: `\${aws:RequestTag/${FIRM_KEY_TAG.businessId}}`,
          [`aws:ResourceTag/${FIRM_KEY_TAG.purpose}`]: FIRM_KEY_PURPOSE,
        },
        Null: {
          'kms:ResourceAliases': 'true',
          [`aws:ResourceTag/${CDK_TAG}`]: 'true',
        },
      },
    }),
    new iam.PolicyStatement({
      sid: 'FirmKeysAliasName',
      actions: ['kms:CreateAlias'],
      resources: [aliases], // KMS takes no conditions on the alias side
    }),
    new iam.PolicyStatement({
      sid: 'FirmKeysAliasKey',
      actions: ['kms:CreateAlias'],
      resources: [keys],
      conditions: firmKey,
    }),
    new iam.PolicyStatement({
      sid: 'FirmKeysRead',
      actions: ['kms:DescribeKey', 'kms:GetKeyPolicy', 'kms:ListGrants', 'kms:ListResourceTags'],
      resources: [keys],
      conditions: { StringEquals: { [`aws:ResourceTag/${FIRM_KEY_TAG.env}`]: envName } },
    }),
    new iam.PolicyStatement({
      sid: 'FirmKeysUse',
      actions: ['kms:Decrypt', 'kms:GenerateDataKey'],
      resources: [keys],
      conditions: {
        ...firmKey,
        StringEquals: {
          ...firmKey.StringEquals,
          // An IAM policy variable (a plain string, not a CDK token): the key's own tag.
          'kms:EncryptionContext:businessId': `\${aws:ResourceTag/${FIRM_KEY_TAG.businessId}}`,
        },
      },
    }),
    new iam.PolicyStatement({
      sid: 'FirmKeysNoLockoutBypass',
      effect: iam.Effect.DENY,
      actions: ['kms:CreateKey'],
      resources: ['*'],
      conditions: { Bool: { 'kms:BypassPolicyLockoutSafetyCheck': 'true' } },
    }),
  ];
}
