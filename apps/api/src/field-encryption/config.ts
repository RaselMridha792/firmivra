import { z } from 'zod';

/**
 * Settings of the field-encryption helper, read and checked by its own module (R10 step 2).
 * KMS_MODE=kms: AWS KMS with one key per business (businesses.kms_key_id).
 * KMS_MODE=local: data keys wrapped with LOCAL_KMS_KEY; development and test only. A key of one
 * repeated byte (all zeros, all 0xff) is refused; the .env.example key is not one.
 */
const Schema = z
  .object({
    // No default: local mode needs NODE_ENV set to development or test, never assumed.
    NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
    // Default is AWS KMS, so a missing value can never switch on the local key.
    KMS_MODE: z.enum(['local', 'kms']).default('kms'),
    LOCAL_KMS_KEY: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.KMS_MODE !== 'local') return;
    if (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test') {
      ctx.addIssue({
        code: 'custom',
        path: ['KMS_MODE'],
        message: 'KMS_MODE=local is only allowed when NODE_ENV is development or test',
      });
    }
    const key = Buffer.from(env.LOCAL_KMS_KEY ?? '', 'base64');
    if (key.length !== 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['LOCAL_KMS_KEY'],
        message: 'required when KMS_MODE=local: 32 bytes, base64',
      });
    } else if (key.every((byte) => byte === key[0])) {
      ctx.addIssue({
        code: 'custom',
        path: ['LOCAL_KMS_KEY'],
        message:
          'must not repeat one byte (such as all zeros); generate one with `openssl rand -base64 32`',
      });
    }
  });

export type FieldEncryptionConfig =
  | { mode: 'kms' }
  | {
      mode: 'local';
      /** 32 bytes. */
      localKey: Buffer;
    };

export function loadFieldEncryptionConfig(
  raw: Record<string, string | undefined> = process.env,
): FieldEncryptionConfig {
  // `KEY=` in .env arrives as an empty string; treat it as not set.
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ''));
  const result = Schema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(`Invalid field-encryption settings:\n${z.prettifyError(result.error)}`);
  }
  const env = result.data;
  return env.KMS_MODE === 'local'
    ? { mode: 'local', localKey: Buffer.from(env.LOCAL_KMS_KEY!, 'base64') }
    : { mode: 'kms' };
}
