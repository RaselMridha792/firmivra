import type { MessageTemplateKind } from '@firmivra/types';

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
