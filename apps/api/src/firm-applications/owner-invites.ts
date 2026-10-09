import type { Database } from '@firmivra/db';
import type { ActivationEmail, ActivationMailer } from '../auth/activation-mailer.js';
import type { IdentityProvider } from '../auth/identity/identity-provider.js';
import { InvitesService } from '../auth/invites.service.js';
import type { AuditService } from '../audit/audit.service.js';
import type { Env } from '../config/env.js';
import type { NotifyService } from '../notify/notify.types.js';

/**
 * The new firm's owner invite (R4 step 3) through R2's flow: an InvitesService of its own whose
 * activation email is Firmivra's "application approved" message (`firm-application.approved`,
 * NotifyService) instead of a firm's staff invite. Everything else (the login, the membership,
 * the link and its limits) is R2's.
 */
export const OWNER_INVITES = Symbol('OWNER_INVITES');

/** Sends the owner's activation link as the approval email. A failed send throws to the caller. */
export class ApprovalActivationMailer implements ActivationMailer {
  constructor(private readonly notify: NotifyService) {}

  async send(email: ActivationEmail): Promise<void> {
    await this.notify.send({
      template: 'firm-application.approved',
      to: email.to,
      businessId: null,
      // The firm is named after the application's legal name when approve creates it.
      data: {
        name: email.name,
        legalName: email.businessName,
        link: email.link,
        expiresAt: email.expiresAt,
      },
    });
  }
}

export function createOwnerInvites(
  db: Database,
  identity: IdentityProvider,
  notify: NotifyService,
  audit: AuditService,
  env: Env,
): InvitesService {
  return new InvitesService(db, identity, new ApprovalActivationMailer(notify), audit, env);
}
