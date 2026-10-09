import {
  GoneException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Database } from '@firmivra/db';
import type { BeginDraft, ResumeLinkSent } from './wire.js';
import { AuditService } from '../audit/audit.service.js';
import { PortalInfoService } from '../client-auth/portal-info.controller.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { NOTIFY_SERVICE, type NotifyService } from '../notify/notify.types.js';
import { BeginOnlineService, type Draft } from './begin-online.service.js';
import {
  draftErrors,
  hashToken,
  rethrowExpired,
  newDraftToken,
  renewDraft,
  writeDraftCookie,
} from './drafts.js';

/**
 * Resume links a draft sends, counted in the audit log (so every API task shares the counts):
 * per draft, and per firm so that no firm's sender can be used to flood inboxes.
 */
export const RESUME_LINK_LIMITS = { perDraft: 5, perFirm: 200, windowMs: 24 * 60 * 60_000 };
const SENT = 'begin_online.resume_link_sent';

const rateLimited = () =>
  new HttpException(
    { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' },
    HttpStatus.TOO_MANY_REQUESTS,
  );
/** One answer for every token that opens no live draft: unknown, replaced, expired or sent. */
const linkExpired = () =>
  new GoneException({
    code: 'RESUME_LINK_EXPIRED',
    message: 'This link has expired or was replaced by a newer one.',
  });

/**
 * "Save and Continue Later" (R11 step 3): an emailed link with a new draft key in its fragment,
 * `{PORTAL_BASE_URL}/{slug}/begin/resume#token=...`. The new key replaces the stored hash, so the
 * previous link and this browser's previous cookie stop working; the cookie is set again. The
 * resume page trades the token for the cookie (`resume`). The email holds the link only.
 */
@Injectable()
export class ResumeLinksService {
  private readonly logger = new Logger(ResumeLinksService.name);
  private readonly secure: boolean;

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    private readonly drafts: BeginOnlineService,
    private readonly portal: PortalInfoService,
    private readonly audit: AuditService,
  ) {
    this.secure = env.NODE_ENV === 'production';
  }

  async send(slug: string, req: Request, res: Response): Promise<ResumeLinkSent> {
    const draft = await this.drafts.draftOf(slug, req);
    const { firm, leadId } = draft;
    const { token, hash } = newDraftToken();
    const since = new Date(Date.now() - RESUME_LINK_LIMITS.windowMs);
    const sent = await this.database
      .withScope({ kind: 'business', businessId: firm.id }, async (tx) => {
        // Locks the lead first, so two sends for one draft count one after the other.
        const expiresAt = await renewDraft(tx, leadId, draft.hash, hash);
        if (!expiresAt) throw draftErrors.noDraft();
        const recent = { action: SENT, createdAt: { gt: since } };
        const [mine, firmWide, lead] = await Promise.all([
          tx.auditLog.count({ where: { ...recent, entityId: leadId } }),
          tx.auditLog.count({ where: recent }),
          tx.lead.findUniqueOrThrow({ where: { id: leadId }, select: { email: true } }),
        ]);
        // The rollback keeps the old key and expiry.
        if (mine >= RESUME_LINK_LIMITS.perDraft || firmWide >= RESUME_LINK_LIMITS.perFirm) {
          throw rateLimited();
        }
        await this.audit.logIn(
          tx,
          SENT,
          { type: 'lead', id: leadId },
          { serviceId: draft.service.id },
          { businessId: firm.id },
        );
        return { expiresAt, email: lead.email };
      })
      .catch(rethrowExpired);
    writeDraftCookie(res, firm.slug, token, sent.expiresAt, this.secure);
    const link = `${this.env.PORTAL_BASE_URL.replace(/\/+$/, '')}/${firm.slug}/begin/resume#token=${token}`;
    try {
      await this.notify.send({
        template: 'begin-online.resume-link',
        to: sent.email,
        businessId: firm.id,
        data: { link, expiresAt: sent.expiresAt },
      });
    } catch (error) {
      // The draft stays open in this browser (its new cookie); the visitor can ask again.
      const name = error instanceof Error ? error.name : typeof error;
      this.logger.warn(`Resume link for lead ${leadId} not sent: ${name}`);
      throw new ServiceUnavailableException({
        code: 'SERVICE_UNAVAILABLE',
        message: 'The email could not be sent right now. Please try again in a moment.',
      });
    }
    return { draftExpiresAt: sent.expiresAt.toISOString() };
  }

  /** The resume page: a link's token becomes this browser's cookie (no new key). */
  async resume(slug: string, token: string, res: Response): Promise<BeginDraft> {
    const firm = await this.portal.activeFirm(slug);
    let draft: Draft;
    try {
      draft = await this.drafts.draftByHash(firm, hashToken(token));
    } catch (error) {
      if (error instanceof HttpException && [404, 410].includes(error.getStatus())) {
        throw linkExpired();
      }
      throw error;
    }
    writeDraftCookie(res, firm.slug, token, draft.draftExpiresAt, this.secure);
    await this.audit.log(
      'begin_online.draft_resumed',
      { type: 'lead', id: draft.leadId },
      { serviceId: draft.service.id },
      { businessId: firm.id },
    );
    return this.drafts.view(draft);
  }
}
