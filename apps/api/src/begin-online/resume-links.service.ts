import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { Database } from '@firmivra/db';
import type { BeginDraft, BeginReceived } from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { NOTIFY_SERVICE, type NotifyService } from '../notify/notify.types.js';
import { BeginOnlineService } from './begin-online.service.js';
import { hashToken, holdDraft, newResumeToken } from './drafts.js';

/**
 * Resume links sent, counted in the audit log (so every API task shares the counts): per address
 * at the firm in an hour (past it the API silently sends nothing), and per firm in a day so that
 * no firm's sender can be used to flood inboxes.
 */
export const RESUME_LINK_LIMITS = {
  perAddress: 5,
  addressWindowMs: 60 * 60_000,
  perFirm: 200,
  firmWindowMs: 24 * 60 * 60_000,
};
const SENT = 'begin_online.resume_link_sent';
const nameOf = (error: unknown) => (error instanceof Error ? error.name : typeof error);

/**
 * "Save and Continue Later" (contract B): `emailResumeLink` always answers `{ received: true }`
 * at once; the work (finding the address's open drafts at the firm, a new token for each, the
 * emails) runs after the answer, so neither the answer nor its timing says whether the address
 * has a draft. Each link is `{PORTAL_BASE_URL}/{slug}/begin/resume#token=...` (the token in the
 * fragment; only its SHA-256 is stored); a new link replaces the draft's older one. A link never
 * extends a draft: it lasts until the draft's current expiry. The resume page trades the token
 * for this browser's draft cookie (`resume`). The email holds the link only.
 */
@Injectable()
export class ResumeLinksService {
  private readonly logger = new Logger(ResumeLinksService.name);
  private readonly pending = new Set<Promise<void>>();

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    private readonly drafts: BeginOnlineService,
    private readonly audit: AuditService,
  ) {}

  async emailLinks(slug: string, email: string): Promise<BeginReceived> {
    const firm = await this.drafts.firm(slug);
    const work = this.sendLinks(firm, email.toLowerCase())
      .catch((error: unknown) => {
        this.logger.warn(`Resume links for a Begin Online address not sent: ${nameOf(error)}`);
      })
      .finally(() => this.pending.delete(work));
    this.pending.add(work);
    return { received: true };
  }

  /** Resolves when every resume-link email started so far is done (for tests and shutdown). */
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  private async sendLinks(firm: { id: string; slug: string }, email: string): Promise<void> {
    const businessId = firm.id;
    const leads = await this.database.forBusiness(businessId).lead.findMany({
      where: { email, status: 'DRAFT', draftExpiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, serviceId: true },
    });
    const portal = this.env.PORTAL_BASE_URL.replace(/\/+$/, '');
    for (const lead of leads) {
      const { token, hash } = newResumeToken();
      const sent = await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
        // One address's sends count one after the other.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`begin-online-link:${businessId}:${email}`}, 0))`;
        const live = await holdDraft(tx, lead.id).then(
          () => true,
          () => false,
        );
        if (!live) return null;
        const mine = await tx.lead.findMany({ where: { email }, select: { id: true } });
        const now = Date.now();
        const [address, firmWide] = await Promise.all([
          tx.auditLog.count({
            where: {
              action: SENT,
              entityId: { in: mine.map((l) => l.id) },
              createdAt: { gt: new Date(now - RESUME_LINK_LIMITS.addressWindowMs) },
            },
          }),
          tx.auditLog.count({
            where: {
              action: SENT,
              createdAt: { gt: new Date(now - RESUME_LINK_LIMITS.firmWindowMs) },
            },
          }),
        ]);
        if (address >= RESUME_LINK_LIMITS.perAddress || firmWide >= RESUME_LINK_LIMITS.perFirm) {
          return null;
        }
        // The link lasts as long as the draft does now (never longer, and it renews nothing).
        const rows = await tx.$queryRaw<{ resume_expires_at: Date }[]>`
          UPDATE leads SET resume_token_hash = ${hash}, resume_expires_at = draft_expires_at
           WHERE id = ${lead.id}::uuid AND status = 'DRAFT' AND draft_expires_at > now()
          RETURNING resume_expires_at`;
        const expiresAt = rows[0]?.resume_expires_at;
        if (!expiresAt) return null;
        await this.audit.logIn(
          tx,
          SENT,
          { type: 'lead', id: lead.id },
          { serviceId: lead.serviceId },
          { businessId },
        );
        return expiresAt;
      });
      if (!sent) continue;
      await this.notify.send({
        template: 'begin-online.resume-link',
        to: email,
        businessId,
        data: { link: `${portal}/${firm.slug}/begin/resume#token=${token}`, expiresAt: sent },
      });
    }
  }

  /**
   * The resume page: a link's token opens its draft and sets this browser's cookie for that
   * service (no new token, nothing renewed). 410 DRAFT_EXPIRED for an unknown, replaced or expired
   * link; 409 DRAFT_SUBMITTED once the draft was sent.
   */
  async resume(slug: string, token: string, res: Response): Promise<BeginDraft> {
    const firm = await this.drafts.firm(slug);
    const draft = await this.drafts.loadDraft(firm, { resumeTokenHash: hashToken(token) });
    await this.drafts.cookies.write(
      res,
      firm,
      draft.form,
      draft.leadId,
      draft.draftExpiresAt,
      this.drafts.secure,
    );
    await this.audit.log(
      'begin_online.draft_resumed',
      { type: 'lead', id: draft.leadId },
      { serviceId: draft.service.id },
      { businessId: firm.id },
    );
    return this.drafts.view(draft);
  }
}
