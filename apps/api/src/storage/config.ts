import { z } from 'zod';

/**
 * Settings of the documents module (R5), read and checked by the module itself, like the
 * field-encryption helper's. In AWS the API task gets S3_DOCUMENTS_BUCKET and AWS_REGION from the
 * infra app stack and uses its task role; objects take the bucket's default encryption (SSE-KMS
 * with the documents key). Locally .env points at s3mock (S3_ENDPOINT, path-style, any key).
 * SCAN_MODE=guardduty (the default): a new file stays PENDING until GuardDuty's result arrives.
 * SCAN_MODE=local: confirm marks the file CLEAN at once; development and test only.
 */
const Schema = z
  .object({
    // No default: local mode needs NODE_ENV set to development or test, never assumed.
    NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
    AWS_REGION: z.string().min(1).default('us-east-1'),
    S3_DOCUMENTS_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'a bucket name'),
    S3_ENDPOINT: z.url().optional(),
    S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    // Default is GuardDuty, so a missing value can never skip the scan.
    SCAN_MODE: z.enum(['local', 'guardduty']).default('guardduty'),
  })
  .superRefine((env, ctx) => {
    const devOnly = 'is only allowed when NODE_ENV is development or test';
    const issue = (key: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [key], message });
    const dev = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
    if (env.SCAN_MODE === 'local' && !dev) issue('SCAN_MODE', `SCAN_MODE=local ${devOnly}`);
    if (env.NODE_ENV !== 'production') return;
    if (env.S3_ENDPOINT) issue('S3_ENDPOINT', `S3_ENDPOINT (s3mock) ${devOnly}`);
    if (env.S3_ACCESS_KEY_ID || env.S3_SECRET_ACCESS_KEY) {
      issue('S3_ACCESS_KEY_ID', `static S3 keys ${devOnly}; AWS uses the task role`);
    }
  });

export interface DocumentsConfig {
  bucket: string;
  region: string;
  /** s3mock locally; undefined in AWS. */
  endpoint?: string;
  forcePathStyle: boolean;
  /** Static keys for s3mock; undefined in AWS (the task role). */
  credentials?: { accessKeyId: string; secretAccessKey: string };
  scanMode: 'local' | 'guardduty';
}

/** Nest token for the documents settings (tests replace it). */
export const DOCUMENTS_CONFIG = Symbol('DOCUMENTS_CONFIG');

export function loadDocumentsConfig(
  raw: Record<string, string | undefined> = process.env,
): DocumentsConfig {
  // `KEY=` in .env arrives as an empty string; treat it as not set.
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ''));
  const result = Schema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(`Invalid documents settings:\n${z.prettifyError(result.error)}`);
  }
  const env = result.data;
  const { S3_ACCESS_KEY_ID: accessKeyId, S3_SECRET_ACCESS_KEY: secretAccessKey } = env;
  return {
    bucket: env.S3_DOCUMENTS_BUCKET,
    region: env.AWS_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    scanMode: env.SCAN_MODE,
  };
}
