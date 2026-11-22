'use client';

import type { PublicItemKind, PublicLink } from '@firmivra/types';
import { PublicLinkBlock } from '@firmivra/ui';
import { publicLinkText } from '../lib/public-link';

/**
 * The shared "Copy link / Copy embed code" block for one public item: an intake form, an
 * appointment type or a service package. Pass what the item's `GET …/{id}/public-link` answered
 * (`PublicLink`, `packages/types/src/public-links`), or nothing while it loads or when the item
 * has no public page yet; the block then keeps its frame with a quiet line.
 *
 *   const link = useApiQuery([...KEY, id, 'public-link'], () => api.appointmentTypes.publicLink(id));
 *   <PublicLinkSection kind="APPOINTMENT_TYPE" link={link.data} />
 */
export function PublicLinkSection({
  kind,
  link,
  emptyText,
  embedHelp,
}: {
  kind: PublicItemKind;
  link: PublicLink | null | undefined;
  /** Replaces the item's default line when there is no link (a loading or error text). */
  emptyText?: string;
  /** The line under the embed code, when it is not a button. */
  embedHelp?: string;
}) {
  const text = publicLinkText(kind, link?.state ?? null);
  return (
    <PublicLinkBlock
      url={link?.url ?? null}
      embedCode={link?.embedCode ?? null}
      buttonCode={link?.buttonCode ?? null}
      portalEntryUrl={link?.portalEntryUrl ?? null}
      title={text.title}
      copyLinkLabel={text.copyLinkLabel}
      copyEmbedLabel={text.copyEmbedLabel}
      notice={text.notice}
      emptyText={emptyText ?? text.emptyText}
      embedHelp={embedHelp}
    />
  );
}
