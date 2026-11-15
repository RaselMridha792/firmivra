import type { TxClient } from '@firmivra/db';
import { BadRequestException } from '@nestjs/common';
import type { IntakeCompletion } from '@firmivra/types';
import { formMetaOf } from '../intake-workspace/workspace.common.js';

/**
 * Intake Forms Review Two row 21: what a recipient sees once the form is sent. The form's own
 * success message (Form Settings), else the firm's thank-you message (Intake Form Settings >
 * Client Experience); and the page the browser opens after, only while Redirect after completion
 * is on (an https address, checked when it was saved). Null: the screen's own words, no redirect.
 */
export async function intakeCompletion(
  tx: TxClient,
  businessId: string,
  definition: unknown,
): Promise<IntakeCompletion> {
  const settings = await tx.intakeSettings.findUnique({
    where: { businessId },
    select: { thankYouMessage: true, redirectAfterCompletion: true, redirectUrl: true },
  });
  const own = formMetaOf(definition).settings['successMessage'];
  const message =
    typeof own === 'string' && own.trim() ? own.trim() : settings?.thankYouMessage?.trim() || null;
  const redirectUrl =
    settings?.redirectAfterCompletion && settings.redirectUrl?.startsWith('https://')
      ? settings.redirectUrl
      : null;
  return { message, redirectUrl };
}

/**
 * Review Two row 21: whether the firm asks for consent before a form is sent (Intake Form Settings
 * > Consent checkbox required; on until the firm turns it off, as the settings' own default).
 */
export async function intakeConsentRequired(tx: TxClient, businessId: string): Promise<boolean> {
  const settings = await tx.intakeSettings.findUnique({
    where: { businessId },
    select: { consentRequired: true },
  });
  return settings?.consentRequired ?? true;
}

/** 400 CONSENT_REQUIRED: a portal intake or a lead's link sent without the consent asked for. */
export const consentRequiredError = () =>
  new BadRequestException({
    code: 'CONSENT_REQUIRED',
    message: 'Tick the box to confirm your information and agree to its use',
  });

/** What the submit's audit keeps of the consent (no schema change: the audit log holds it). */
export const consentEvidence = (consent: true | undefined) =>
  consent ? { consent: true, consentAt: new Date().toISOString() } : {};

/**
 * Review Two row 23 (P2-6): Intake Form Settings > Notify assigned staff member. On (the default):
 * the submitted notice reaches the client's assigned member and every Owner and Admin, as for any
 * client news. Off: the form's assignee and the client's assigned member are left out of it (the
 * Owners and Admins still hear). The members to leave out, or undefined.
 */
export async function submittedNoticeExcludes(
  tx: TxClient,
  businessId: string,
  intakeId: string,
): Promise<string[] | undefined> {
  const settings = await tx.intakeSettings.findUnique({
    where: { businessId },
    select: { notifyAssignedStaff: true },
  });
  if (settings?.notifyAssignedStaff ?? true) return undefined;
  const row = await tx.intake.findFirst({
    where: { businessId, id: intakeId },
    select: {
      assignedUserId: true,
      engagement: { select: { client: { select: { assignedUserId: true } } } },
    },
  });
  const ids = [row?.assignedUserId, row?.engagement?.client.assignedUserId].filter(
    (id): id is string => !!id,
  );
  return ids.length ? [...new Set(ids)] : undefined;
}
