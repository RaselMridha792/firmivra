import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';

/**
 * The result queue's timing, the same numbers as infra's SCAN_RESULTS_QUEUE
 * (infra/src/stacks/malware-scan.ts): a message stays invisible 120 s after a receive; a result
 * with no record yet comes back after 20 s on its first 5 receives (so a result that beats the
 * confirm shows within seconds), then after 120 s; the 20th receive is the last before the
 * dead-letter queue (5 x 20 s + 15 x 120 s, about 32 minutes). Change both together.
 */
export const SCAN_QUEUE_TIMING = {
  maxReceiveCount: 20,
  earlyRetries: 5,
  earlyRetrySeconds: 20,
  waitSeconds: 20,
} as const;

export interface QueueMessage {
  messageId: string;
  receiptHandle: string;
  body: string;
  /** SQS's ApproximateReceiveCount: 1 on the first receive. */
  receiveCount: number;
}

/** The result queue as the consumer uses it (tests pass a fake). */
export interface ScanQueue {
  /** One long poll; the signal ends it at once (shutdown). */
  receive(signal: AbortSignal): Promise<QueueMessage[]>;
  delete(receiptHandle: string): Promise<void>;
  /** Makes a kept message visible again after `seconds`. */
  retryAfter(receiptHandle: string, seconds: number): Promise<void>;
}

/** Nest token for the ScanQueue (tests replace it). */
export const SCAN_QUEUE = Symbol('SCAN_QUEUE');

/**
 * Timeouts in the style of S3_TIMEOUTS: 3 s to connect, 2 attempts; the answer may take the long
 * poll's 20 s, so 30 s before it counts as stalled.
 */
const SQS_CLIENT = {
  maxAttempts: 2,
  requestHandler: { connectionTimeout: 3_000, requestTimeout: 30_000, throwOnRequestTimeout: true },
} as const;

/** The queue in AWS, with the task role (sqs:ReceiveMessage, DeleteMessage, ChangeMessageVisibility). */
export class SqsScanQueue implements ScanQueue {
  constructor(
    private readonly url: string,
    private readonly client: Pick<SQSClient, 'send'>,
  ) {}

  static create(url: string, region: string): SqsScanQueue {
    return new SqsScanQueue(url, new SQSClient({ region, ...SQS_CLIENT }));
  }

  async receive(signal: AbortSignal): Promise<QueueMessage[]> {
    const out = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.url,
        // One at a time: a batch could outlive the 120 s visibility timeout.
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: SCAN_QUEUE_TIMING.waitSeconds,
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      }),
      { abortSignal: signal },
    );
    return (out.Messages ?? []).flatMap((m) =>
      m.MessageId && m.ReceiptHandle && m.Body !== undefined
        ? [
            {
              messageId: m.MessageId,
              receiptHandle: m.ReceiptHandle,
              body: m.Body,
              receiveCount: Number(m.Attributes?.ApproximateReceiveCount ?? '1') || 1,
            },
          ]
        : [],
    );
  }

  async delete(receiptHandle: string): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({ QueueUrl: this.url, ReceiptHandle: receiptHandle }),
    );
  }

  async retryAfter(receiptHandle: string, seconds: number): Promise<void> {
    await this.client.send(
      new ChangeMessageVisibilityCommand({
        QueueUrl: this.url,
        ReceiptHandle: receiptHandle,
        VisibilityTimeout: seconds,
      }),
    );
  }
}
