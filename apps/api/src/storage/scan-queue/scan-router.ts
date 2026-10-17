import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import { DATABASE } from '../../database/database.module.js';
import type { ScanOutcome, ScanResult } from '../scan-results.service.js';
import type { ParsedScanEvent } from './scan-event.js';

/**
 * The scan result registry: one handler per prefix of the documents bucket, under
 * tenant/{businessId}/{prefix}/. GuardDuty scans every new object under tenant/, so each feature
 * that writes there registers a handler for its prefix with the same outcome contract:
 *
 * - Register in your provider's `onModuleInit` with `router.register(this)` (one per prefix).
 * - `result.businessId` comes from the key (tenant/{businessId}/), never from the message body.
 *   `inFirm` opens that firm's business scope only (RLS); use no other database access.
 * - Find the row by `{ businessId: result.businessId, s3Key: result.key }` inside `inFirm`.
 * - No row: 'UNKNOWN' (kept for redelivery, about 32 minutes, then the dead-letter queue), or
 *   'IGNORED' when this key will never get a row (a refused upload, a server-written object you
 *   do not track, an orphan past its confirm window).
 * - Result already set: 'IGNORED'. Scan results are set once (the database triggers).
 * - Map with `scanVerdict(result, contentType)` (scan-results.service.ts): NO_THREATS_FOUND is
 *   CLEAN, THREATS_FOUND INFECTED, a file reason FAILED (a PDF that is only PASSWORD_PROTECTED is
 *   CLEAN and 'UNSCANNED', q24), and null means our side: leave the row PENDING, write an
 *   `<entity>.scan_unfinished` audit row and return 'PENDING' (the alarm and a rescan).
 * - Audit ids and codes only; never a file name, its bytes or a threat name.
 * - Leads (R15): a converted lead upload shares its s3_key with a Document
 *   (documents.lead_upload_id), so update both rows in one `inFirm` transaction.
 * A known prefix with no handler yet is 'UNKNOWN': its results wait in the dead-letter queue and
 * are redriven once the handler is on dev (docs/SETUP-LOG.md, step 19, command 8).
 */
export const SCAN_PREFIXES = ['documents', 'leads', 'esign', 'agreements'] as const;
export type ScanPrefix = (typeof SCAN_PREFIXES)[number];

export interface RoutedScanResult {
  /** From tenant/{businessId}/ (a lower-case UUID), never from the message body. */
  businessId: string;
  prefix: ScanPrefix;
  /** The full object key. */
  key: string;
  /** The part after tenant/{businessId}/{prefix}/. */
  path: string;
  status: ScanResult['status'];
  /** `statusReasons`, [] when GuardDuty sent none. */
  reasons: readonly string[];
  versionId: string | null;
  /** When GuardDuty sent the result. */
  eventTime: Date;
  eventId: string;
}

/** Runs `fn` in the business scope of the key's firm only (RLS). */
export type InFirm = <T>(fn: (tx: TxClient) => Promise<T>) => Promise<T>;

export interface ScanResultHandler {
  readonly prefix: ScanPrefix;
  handle(result: RoutedScanResult, inFirm: InFirm): Promise<ScanOutcome>;
}

export interface RoutedOutcome {
  outcome: ScanOutcome;
  /** Set when the key is under a known prefix: for the log (ids only). */
  target?: {
    prefix: ScanPrefix;
    businessId: string;
    /** The path's first segment when it is a UUID (the upload, agreement, lead or request id). */
    objectId: string | null;
  };
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const KEY = new RegExp(`^tenant/(${UUID})/([a-z]+)/(.+)$`);
const OBJECT_ID = new RegExp(`^${UUID}$`);

const isPrefix = (p: string): p is ScanPrefix => (SCAN_PREFIXES as readonly string[]).includes(p);

/** Routes each scan result to its prefix's handler, in its own firm's scope (R1 step 19). */
@Injectable()
export class ScanResultRouter {
  private readonly handlers = new Map<ScanPrefix, ScanResultHandler>();

  constructor(@Inject(DATABASE) private readonly database: Database) {}

  register(handler: ScanResultHandler): void {
    if (this.handlers.has(handler.prefix)) {
      throw new Error(`A scan result handler for ${handler.prefix} is already registered`);
    }
    this.handlers.set(handler.prefix, handler);
  }

  /** IGNORED for a key outside the prefixes; UNKNOWN for a prefix with no handler yet. */
  async route(event: ParsedScanEvent): Promise<RoutedOutcome> {
    const [, businessId, prefix, path] = KEY.exec(event.key) ?? [];
    if (!businessId || !prefix || !path || !isPrefix(prefix)) return { outcome: 'IGNORED' };
    const first = path.split('/', 1)[0] ?? '';
    const target = { prefix, businessId, objectId: OBJECT_ID.test(first) ? first : null };
    const handler = this.handlers.get(prefix);
    if (!handler) return { outcome: 'UNKNOWN', target };
    const inFirm: InFirm = (fn) => this.database.withScope({ kind: 'business', businessId }, fn);
    const outcome = await handler.handle(
      {
        businessId,
        prefix,
        key: event.key,
        path,
        status: event.status,
        reasons: event.reasons,
        versionId: event.versionId,
        eventTime: event.time,
        eventId: event.id,
      },
      inFirm,
    );
    return { outcome, target };
  }
}

/**
 * Global, with no imports, so the esign, agreements and leads modules can inject the router
 * without an import cycle.
 */
@Global()
@Module({ providers: [ScanResultRouter], exports: [ScanResultRouter] })
export class ScanRouterModule {}
