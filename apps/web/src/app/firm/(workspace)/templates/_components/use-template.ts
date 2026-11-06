import type { MessageTemplateKind, MessageTemplateStatus } from '@firmivra/types';

/**
 * Where a template's Use opens: a new Communications draft copied from it (the API's
 * `templateId`, whose kind must be the channel: Email or SMS). Other kinds are used from their own
 * screens and have no draft to start here, so Use is left out for them (null).
 */
export function templateUseHref(kind: MessageTemplateKind, id: string): string | null {
  return kind === 'EMAIL' || kind === 'SMS'
    ? `/communications/new?channel=${kind}&template=${id}`
    : null;
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
