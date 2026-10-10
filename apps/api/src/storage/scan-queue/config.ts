import { z } from 'zod';

/**
 * The queue GuardDuty's scan results arrive on (R1 step 19; infra/src/stacks/malware-scan.ts):
 * an EventBridge rule sends each "Object Scan Result" event of the documents bucket to it, and
 * the API reads it with its task role. In AWS the API task gets SCAN_RESULTS_QUEUE_URL from the
 * app stack. Unset (locally and in CI) nothing reads results; a production build that waits for
 * GuardDuty (SCAN_MODE=guardduty) refuses to start without it, so no upload waits forever unseen.
 */
const QUEUE_URL = /^https:\/\/sqs\.([a-z0-9-]+)\.amazonaws\.com\/(\d{12})\/([A-Za-z0-9_-]{1,80})$/;

const Schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
    SCAN_MODE: z.enum(['local', 'guardduty']).default('guardduty'),
    S3_DOCUMENTS_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'a bucket name')
      .optional(),
    SCAN_RESULTS_QUEUE_URL: z.string().regex(QUEUE_URL, 'an SQS queue URL').optional(),
  })
  .superRefine((env, ctx) => {
    const issue = (key: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [key], message });
    if (
      env.NODE_ENV === 'production' &&
      env.SCAN_MODE === 'guardduty' &&
      !env.SCAN_RESULTS_QUEUE_URL
    ) {
      issue(
        'SCAN_RESULTS_QUEUE_URL',
        'SCAN_RESULTS_QUEUE_URL is required in production with SCAN_MODE=guardduty: without it every upload stays PENDING',
      );
    }
    if (env.SCAN_RESULTS_QUEUE_URL && !env.S3_DOCUMENTS_BUCKET) {
      issue('S3_DOCUMENTS_BUCKET', 'S3_DOCUMENTS_BUCKET is required to check scan results');
    }
  });

export interface ScanQueueConfig {
  nodeEnv: 'development' | 'test' | 'production' | undefined;
  /** The documents bucket a result must name; null when no queue is read. */
  bucket: string | null;
  /** The queue, with the region and account a result must name; null: nothing is read. */
  queue: { url: string; region: string; account: string } | null;
}

/** Nest token for the scan queue settings (tests replace it). */
export const SCAN_QUEUE_CONFIG = Symbol('SCAN_QUEUE_CONFIG');

export function loadScanQueueConfig(
  raw: Record<string, string | undefined> = process.env,
): ScanQueueConfig {
  // `KEY=` in .env arrives as an empty string; treat it as not set.
  const cleaned = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ''));
  const result = Schema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(`Invalid scan queue settings:\n${z.prettifyError(result.error)}`);
  }
  const env = result.data;
  const url = env.SCAN_RESULTS_QUEUE_URL;
  const [, region, account] = (url && QUEUE_URL.exec(url)) || [];
  return {
    nodeEnv: env.NODE_ENV,
    bucket: url ? (env.S3_DOCUMENTS_BUCKET ?? null) : null,
    queue: url && region && account ? { url, region, account } : null,
  };
}
