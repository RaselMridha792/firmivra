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
 * - CreateKey only with the three firm tags (env pinned, a UUID-shaped business id) and a
 *   symmetric encryption key. CreateKey sends no key policy, so KMS attaches its default (the
 *   account root, which hands control to IAM): these statements are all the API can do.
 * - TagResource is needed because CreateKey sends Tags. It only tags a key that has no firm tags
 *   and no alias yet, which is the key CreateKey is making, so an existing firm key's env and
 *   business id (and the CDK documents keys) can never be rewritten.
 * - CreateAlias only under alias/firmivra/<env>/business/, and only on keys tagged with the env.
 * - Use: GenerateDataKey and Decrypt (all field encryption calls), only on keys tagged with the
 *   env, and only when the encryption context's businessId equals the key's businessId tag.
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
        },
      },
    }),
    new iam.PolicyStatement({
      sid: 'FirmKeysTagOnCreate',
      actions: ['kms:TagResource'],
      resources: [keys],
      conditions: {
        ...requestTags,
        Null: {
          [`aws:ResourceTag/${FIRM_KEY_TAG.env}`]: 'true',
          [`aws:ResourceTag/${FIRM_KEY_TAG.businessId}`]: 'true',
          'kms:ResourceAliases': 'true',
        },
      },
    }),
    new iam.PolicyStatement({
      sid: 'FirmKeysAliasName',
      actions: ['kms:CreateAlias'],
      resources: [aliases], // KMS takes no conditions on the alias side
    }),
    new iam.PolicyStatement({
      sid: 'FirmKeysOnEnvKeys',
      actions: ['kms:CreateAlias', 'kms:DescribeKey'],
      resources: [keys],
      conditions: { StringEquals: { [`aws:ResourceTag/${FIRM_KEY_TAG.env}`]: envName } },
    }),
    new iam.PolicyStatement({
      sid: 'FirmKeysUse',
      actions: ['kms:Decrypt', 'kms:GenerateDataKey'],
      resources: [keys],
      conditions: {
        StringEquals: {
          [`aws:ResourceTag/${FIRM_KEY_TAG.env}`]: envName,
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
