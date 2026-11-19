import type { MessageTemplateRow, MessageTemplateStatus } from '@firmivra/types';

/** What a template's Use does: opens `href`, or is switched off for `reason`. */
export type TemplateUse = { href: string } | { reason: string };

/** The Communications channel a message template starts a draft on (P03, P04). */
const CHANNEL: Partial<Record<MessageTemplateRow['kind'], 'EMAIL' | 'SMS' | 'ANNOUNCEMENT'>> = {
  EMAIL: 'EMAIL',
  CAMPAIGN: 'EMAIL',
  SMS: 'SMS',
  ANNOUNCEMENT: 'ANNOUNCEMENT',
};

/** TP-F08: the module template a Task, Document Request or Intake template stands for. */
const LINKED: Partial<
  Record<MessageTemplateRow['kind'], { noun: string; href: (id: string) => string }>
> = {
  TASK: { noun: 'task template', href: (id) => `/tasks/new?template=${id}` },
  DOCUMENT_REQUEST: {
    noun: 'request template',
    href: (id) => `/documents/requests/new?template=${id}`,
  },
  INTAKE_ORGANIZER: { noun: 'intake template', href: (id) => `/intake-forms/send?formId=${id}` },
};

/**
 * TP-F08 (the lead's default, Nov 7): Tax Returns and Bookkeeping take no template yet, so these
 * keep their structure for reference; no new flow is invented. Templates Review Two P02: what does
 * start a client's bookkeeping, said where the Use would be (checked in the API: adding a client
 * under Bookkeeping opens it; a new period takes Bookkeeping Settings' close checklist).
 */
const NOT_YET: Partial<Record<MessageTemplateRow['kind'], string>> = {
  TAX_WORKFLOW:
    'Tax Returns cannot start from a template yet. This one keeps its steps for reference.',
  BOOKKEEPING:
    'Bookkeeping cannot start from a template yet. Adding a bookkeeping service in Services & Pricing creates no workflow: a client’s bookkeeping starts when you add the client under Bookkeeping, and each new period’s close checklist comes from Bookkeeping Settings. This template keeps a checklist and messages to copy from.',
};

/**
 * Where a template's Use goes, why it is switched off, or null when the kind has no Use here.
 * - Email and SMS: a new Communications draft copied from it (the API's `templateId`).
 * - Campaign: an email draft (a campaign is an email to many); Announcement: an announcement
 *   draft (Templates Review Two P03, P04: Communications is where both are used by hand).
 * - Task, Document Request and Intake: their module's own start, from the template they stand for
 *   (TP-F08): a task, a document request, a form to send.
 * - Tax Workflow and Bookkeeping: off, with the reason.
 * Only an active template can be used (TP-F13, TP-F14); the API refuses the others too.
 */
export function templateUse(
  row: Pick<MessageTemplateRow, 'id' | 'kind' | 'status' | 'linkedTemplateId'>,
  canActivate: boolean,
): TemplateUse | null {
  const linked = LINKED[row.kind];
  const notYet = NOT_YET[row.kind];
  const message = row.kind in CHANNEL;
  if (!message && !linked && !notYet) return null;
  const blocked = blockedUseReason(row.status, canActivate);
  if (blocked) return { reason: blocked };
  if (notYet) return { reason: notYet };
  if (linked) {
    return row.linkedTemplateId
      ? { href: linked.href(row.linkedTemplateId) }
      : { reason: `Choose the ${linked.noun} it stands for under Structure in the editor first.` };
  }
  return { href: `/communications/new?channel=${CHANNEL[row.kind]}&template=${row.id}` };
}

/**
 * Why Use is off for a template, or null when it can be used (TP-F13, TP-F14). Only an active
 * template can start a message; the API refuses a draft or an archived one too.
 */
export function blockedUseReason(
  status: MessageTemplateStatus,
  canActivate: boolean,
): string | null {
  if (status === 'ACTIVE') return null;
  if (status === 'ARCHIVED') {
    return 'An archived template cannot be used. Restore it from its Actions menu and activate it to use it again.';
  }
  return canActivate
    ? 'A draft cannot be used yet. Activate it from its Actions menu first.'
    : 'A draft cannot be used yet. Ask an Owner or Admin to activate it.';
}
