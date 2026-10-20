import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import type { AdminEmailStatus, AdminServiceStatus, AdminSystemHealth } from '@firmivra/types';
import { DATABASE } from '../database/database.module.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import type { NotifyConfig } from '../notify/config.js';
import { NOTIFY_CONFIG } from '../notify/notify.module.js';
import { loadStripeConfig } from '../payments/stripe/config.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../storage/document-storage.js';

/** A storage check that cannot hang the page: no answer in this long is DOWN. */
const STORAGE_TIMEOUT_MS = 3_000;
/** A key nobody writes: the head request answers "not found", which is a reachable bucket. */
const PROBE_KEY = 'platform/health/probe';

type Service = AdminSystemHealth['services'][number];
const service = (
  key: Service['key'],
  status: AdminServiceStatus,
  detail: string | null,
): Service => ({
  key,
  status,
  detail,
});

/**
 * The System Settings status reads (R55): Email Delivery Status and System Health. Only what the
 * API can tell without side effects: the database and storage are reached now; email, SMS and
 * payments are reported as configured or not (a test would send a real message or charge; Send
 * Test Email exists for email). Nothing here reads a secret or returns one.
 */
@Injectable()
export class AdminHealthService {
  private readonly logger = new Logger(AdminHealthService.name);

  constructor(
    private readonly admin: AdminPrisma,
    @Inject(DATABASE) private readonly database: Database,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(NOTIFY_CONFIG) private readonly notify: NotifyConfig,
  ) {}

  async emailStatus(): Promise<AdminEmailStatus> {
    const [smtp, test] = await Promise.all([
      this.admin.db.platformSecretRef.findUnique({ where: { key: 'smtp' }, select: { key: true } }),
      // The admin's own audit rows (business_id NULL): readable in the admin scope.
      this.admin.db.auditLog.findFirst({
        where: { action: 'system_settings.email_test_sent' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { createdAt: true, metadata: true },
      }),
    ]);
    const mode = this.notify.email.mode;
    const accepted = (test?.metadata as { accepted?: unknown } | null)?.accepted === true;
    return {
      sender: mode === 'ses' ? 'SES' : mode === 'smtp' ? 'SMTP' : 'LOG',
      customSmtp: !!smtp,
      lastTest: test ? { at: test.createdAt.toISOString(), accepted } : null,
      // The firms' delivery records are outside the admin scope (contract: null).
      deliveryRate24h: null,
      bounced24h: null,
    };
  }

  async health(): Promise<AdminSystemHealth> {
    const [database, storage] = await Promise.all([
      this.database.ping().then(
        () => true,
        () => false,
      ),
      this.storageUp(),
    ]);
    const email = this.notify.email;
    const sms = this.notify.sms;
    const stripe = loadStripeConfig();
    return {
      checkedAt: new Date().toISOString(),
      services: [
        service('api', 'ONLINE', null),
        service('database', database ? 'ONLINE' : 'DOWN', null),
        service(
          'storage',
          storage ? 'ONLINE' : 'DOWN',
          storage ? null : 'The documents bucket did not answer',
        ),
        email.mode === 'log'
          ? service('email', 'NOT_CONFIGURED', 'EMAIL_MODE is log: emails are written to the log')
          : service('email', 'CONFIGURED', email.mode === 'ses' ? 'Amazon SES' : 'SMTP server'),
        sms.mode === 'sns'
          ? service('sms', 'CONFIGURED', 'Amazon SNS')
          : service(
              'sms',
              'NOT_CONFIGURED',
              sms.unregistered
                ? 'SMS_MODE is sns but no origination number is set'
                : 'SMS_MODE is log: texts are written to the log',
            ),
        stripe.mode === 'stripe'
          ? service('payments', 'CONFIGURED', 'Stripe')
          : stripe.mode === 'fake'
            ? service('payments', 'CONFIGURED', 'A fake gateway (development)')
            : service('payments', 'NOT_CONFIGURED', 'No Stripe key is set'),
      ],
    };
  }

  /** Whether the documents bucket answers a head request in time ("not found" is an answer). */
  private async storageUp(): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.storage.head(PROBE_KEY).then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), STORAGE_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      this.logger.warn(`Storage health check failed (${(error as Error).name})`);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
