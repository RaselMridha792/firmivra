import type { PublicItemKind, PublicLinkState } from '@firmivra/types';

const ITEM: Record<PublicItemKind, { noun: string; link: string; use: string; empty: string }> = {
  INTAKE_FORM: {
    noun: 'form',
    link: 'Form Link',
    use: 'submissions',
    empty: 'The form link appears here once the form is published.',
  },
  APPOINTMENT_TYPE: {
    noun: 'appointment type',
    link: 'Booking Link',
    use: 'bookings',
    empty: 'The booking link appears here once online booking is available for this type.',
  },
  PACKAGE: {
    noun: 'package',
    link: 'Booking Link',
    use: 'bookings',
    empty: 'The booking link appears here once online booking is available for this package.',
  },
};

/** What each state means for the link, said the same way for forms, types and packages. */
function noticeFor(kind: PublicItemKind, state: PublicLinkState): string | undefined {
  const { noun, use } = ITEM[kind];
  switch (state) {
    case 'LIVE':
      return undefined;
    case 'DRAFT':
      return `This ${noun} is a draft. The link takes no ${use} until it is published.`;
    case 'INACTIVE':
      return `This ${noun} is inactive. The link stays the same, but it takes no new ${use} until the ${noun} is active again.`;
    case 'ARCHIVED':
      return `This ${noun} is archived. The link stays the same, but it takes no new ${use} until the ${noun} is restored.`;
    case 'HIDDEN':
      return `This ${noun} is hidden from clients. The link takes no new ${use} while it is hidden.`;
  }
}

/** The labels and notice `PublicLinkBlock` shows for one item (components/public-link.tsx). */
export function publicLinkText(kind: PublicItemKind, state: PublicLinkState | null) {
  const item = ITEM[kind];
  return {
    title: item.link,
    copyLinkLabel: `Copy ${item.link}`,
    copyEmbedLabel: 'Copy Embed Code',
    notice: state ? noticeFor(kind, state) : undefined,
    emptyText: item.empty,
  };
}
