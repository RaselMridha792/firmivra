import { Module } from '@nestjs/common';
import { loadScanQueueConfig, SCAN_QUEUE_CONFIG, type ScanQueueConfig } from './config.js';
import { ScanResultConsumer } from './scan-consumer.js';
import { SCAN_QUEUE, type ScanQueue, SqsScanQueue } from './sqs-scan-queue.js';

/** Stands in when no queue is set: the consumer never polls, so nothing calls it. */
const NO_QUEUE: ScanQueue = {
  receive: () => Promise.reject(new Error('No scan results queue (SCAN_RESULTS_QUEUE_URL unset)')),
  delete: () => Promise.reject(new Error('No scan results queue')),
  retryAfter: () => Promise.reject(new Error('No scan results queue')),
};

/**
 * GuardDuty's scan results (R1 step 19): the settings (checked at start), the SQS queue and the
 * consumer. The handlers register with ScanRouterModule's router from their own modules
 * (DocumentsModule's DocumentScanHandler for documents).
 */
@Module({
  providers: [
    { provide: SCAN_QUEUE_CONFIG, useFactory: () => loadScanQueueConfig() },
    {
      provide: SCAN_QUEUE,
      inject: [SCAN_QUEUE_CONFIG],
      useFactory: (config: ScanQueueConfig): ScanQueue =>
        config.queue ? SqsScanQueue.create(config.queue.url, config.queue.region) : NO_QUEUE,
    },
    ScanResultConsumer,
  ],
})
export class ScanQueueModule {}
