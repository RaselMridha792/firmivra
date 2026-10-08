import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import type { SubmitFirmApplicationRequest, SubmitFirmApplicationResponse } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { canonicalIp } from '../client-auth/network.js';
import { requestContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { NOTIFY_SERVICE, type NotifyService } from '../notify/notify.types.js';
import { EIN_HASH_KEY, type EinHashKey, einHash, emailHasher } from './ein-hash.js';
import { StoredApplication } from './firm-applications.service.js';

type Body = z.output<typeof SubmitFirmApplicationRequest>;

/**
 * Submit limits, counted in the database from this module's attempt rows (platform audit rows
 * with the canonical IP and the email's keyed hash, never the email), the way R3's sign-up limits
 * are: one platform transaction under advisory try-locks, so every API task shares them and
 * parallel submits can't pass one together. A filled honeypot counts too, so it is answered
 * exactly like a real submit. Mutable for tests.
 * - perIpPerHour: submits from one IP in an hour.
 * - perEmailPerDay: submits naming one primary administrator email in 24 hours.
 * - receivedEmailGapMs: at most one "received" email to an address in this window (24 hours): a
 *   second application from the address within it is stored and answered as usual, unmailed.
 */
export const SUBMIT_LIMITS = {
  perIpPerHour: 5,
  perEmailPerDay: 3,
  receivedEmailGapMs: 24 * 60 * 60_000,
};
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
const ATTEMPT = 'firm_application.submit_attempt';

/** The same 429 as R3's sign-up limits: one answer for every limit. */
const rateLimited = () =>
  new HttpException(
    { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' },
    HttpStatus.TOO_MANY_REQUESTS,
  );

/** An advisory try-lock for this transaction (never waited for: busy is a burst, refused). */
async function tryLock(tx: TxClient, key: string): Promise<boolean> {
  const [row] = await tx.$queryRaw<{ ok: boolean }[]>`
    SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS ok`;
  return row?.ok === true;
}

/** The stored form: the review page's groups, every optional field null, never the EIN. */
function storedForm(body: Body): StoredApplication {
  const { business: b, primaryAdmin: p, account: a } = body;
  return StoredApplication.parse({
    business: {
      practiceType: b.practiceType,
      legalName: b.legalName,
      dbaName: b.dbaName ?? null,
      entityType: b.entityType,
      email: b.email ?? null,
      phone: b.phone ?? null,
      website: b.website ?? null,
      address: { ...b.address, line2: b.address.line2 ?? null },
      services: b.services,
    },
    primaryAdmin: {
      fullName: p.fullName,
      email: p.email,
      phone: p.phone,
      title: p.title ?? null,
      preferredContact: p.preferredContact,
      alternatePhone: p.alternatePhone ?? null,
    },
    account: {
      requestedPlan: a.requestedPlan,
      teamSize: a.teamSize,
      clientVolume: a.clientVolume,
      heardFrom: a.heardFrom ?? null,
      requestedStartDate: a.requestedStartDate ?? null,
      additionalInfo: a.additionalInfo ?? null,
    },
    credentials: body.credentials.map((c) => ({ ...c, issuedBy: c.issuedBy ?? null })),
  });
}

/**
 * The public application form (R4 step 2): POST /firm-applications, no account. Every answer is
 * `{ received: true }`, also for a repeat, an address that has applied or has an account, and a
 * filled honeypot, so it never tells anyone who has applied. Platform scope (the applicant has no
 * firm and no session).
 */
@Injectable()
export class FirmApplicationSubmitService {
  private readonly logger = new Logger(FirmApplicationSubmitService.name);
  private readonly keys: { ein: Buffer; email: (email: string) => string } | { problem: string };

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    @Inject(EIN_HASH_KEY) einKey: EinHashKey,
  ) {
    this.keys = einKey.ok ? { ein: einKey.key, email: emailHasher(einKey.key) } : einKey;
  }

  async submit(body: Body): Promise<SubmitFirmApplicationResponse> {
    // Fails closed: without the key no EIN could be hashed, so nothing is taken. The warning
    // names the setting, never a value.
    if ('problem' in this.keys) {
      this.logger.warn(`Firm application submit refused: ${this.keys.problem}`);
      throw new ServiceUnavailableException({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Applications cannot be received right now. Please try again later.',
      });
    }
    const key = this.keys.ein;
    const email = body.primaryAdmin.email;
    const ip = canonicalIp(requestContext.getStore()?.ip);
    const emailKey = this.keys.email(email);
    const trap = body.honeypot !== undefined && body.honeypot !== '';

    const outcome = await this.database.withScope({ kind: 'platform' }, async (tx) => {
      if (!(await tryLock(tx, `fv-firm-apply-ip:${ip}`))) return null;
      if (!(await tryLock(tx, `fv-firm-apply-email:${emailKey}`))) return null;
      const attempts = (field: 'ip' | 'emailKey', value: string, windowMs: number) =>
        tx.auditLog.count({
          where: {
            businessId: null,
            action: ATTEMPT,
            createdAt: { gt: new Date(Date.now() - windowMs) },
            metadata: { path: [field], equals: value },
          },
        });
      if (
        (await attempts('ip', ip, HOUR_MS)) >= SUBMIT_LIMITS.perIpPerHour ||
        (await attempts('emailKey', emailKey, DAY_MS)) >= SUBMIT_LIMITS.perEmailPerDay
      ) {
        return null;
      }
      await this.audit.logIn(tx, ATTEMPT, { type: 'firm_application' }, { ip, emailKey });
      if (trap) return { id: null, mail: false };

      // Under the email's lock, so two submits at once can't both mail.
      const mailedRecently = await tx.firmApplication.count({
        where: {
          contactEmail: email,
          createdAt: { gt: new Date(Date.now() - SUBMIT_LIMITS.receivedEmailGapMs) },
        },
      });
      const ein = body.business.ein ?? null;
      const { id } = await tx.firmApplication.create({
        data: {
          legalName: body.business.legalName,
          dbaName: body.business.dbaName ?? null,
          contactName: body.primaryAdmin.fullName,
          contactEmail: email,
          contactPhone: body.primaryAdmin.phone,
          data: storedForm(body),
          // Both or neither (R0's firm_applications_ein); the full EIN is never stored.
          einLast4: ein ? ein.slice(-4) : null,
          einHash: ein ? new Uint8Array(einHash(key, ein)) : null,
        },
        select: { id: true },
      });
      // A platform event without the body: no firm, no actor, no metadata.
      await this.audit.logIn(tx, 'firm_application.submitted', { type: 'firm_application', id });
      return { id, mail: mailedRecently === 0 };
    });
    if (!outcome) throw rateLimited();

    if (trap) {
      // Never the form's content or the honeypot's value.
      this.logger.warn('Firm application submit dropped: the honeypot was filled');
    } else if (outcome.id && outcome.mail) {
      try {
        await this.notify.send({
          template: 'firm-application.received',
          to: email,
          businessId: null,
          data: { name: body.primaryAdmin.fullName, legalName: body.business.legalName },
        });
      } catch {
        // The application stands. The id only (R8 alarms on this warning).
        this.logger.warn(
          `Firm application ${outcome.id}: the firm-application.received email could not be sent`,
        );
      }
    }
    return { received: true };
  }
}
