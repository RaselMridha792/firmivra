import type { LibraryDocument, ReviewDocumentRequest } from '@firmivra/types';

type ReviewStatus = NonNullable<LibraryDocument['reviewStatus']>;

/** Each review status's words and badge tone. */
export const REVIEW_LOOKS: Record<
  ReviewStatus,
  { label: string; tone: 'success' | 'warning' | 'info' | 'danger' }
> = {
  NEEDS_REVIEW: { label: 'Needs Review', tone: 'warning' },
  IN_REVIEW: { label: 'In Review', tone: 'info' },
  VERIFIED: { label: 'Verified', tone: 'success' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  REPLACEMENT_REQUESTED: { label: 'Replacement Requested', tone: 'danger' },
};

type Move = Exclude<ReviewDocumentRequest['action'], 'REQUEST_REPLACEMENT'>;
const MOVES: { action: Move; label: string; to: ReviewStatus }[] = [
  { action: 'START', label: 'Start Review', to: 'IN_REVIEW' },
  { action: 'VERIFY', label: 'Mark Verified', to: 'VERIFIED' },
  { action: 'COMPLETE', label: 'Mark Completed', to: 'COMPLETED' },
];

/**
 * The review moves More Actions offers: each one that changes the status (the API takes any
 * move, except for a document in Trash), and Request Replacement unless one is pending.
 */
export function reviewMoves(doc: Pick<LibraryDocument, 'reviewStatus' | 'trashedAt'>) {
  if (doc.trashedAt) return { moves: [], replace: false };
  return {
    moves: MOVES.filter((m) => m.to !== doc.reviewStatus),
    replace: doc.reviewStatus !== 'REPLACEMENT_REQUESTED',
  };
}

/** "Sep 2, 2026 at 4:15 PM". */
export function atText(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} at ${time}`;
}

/** A tag as the API keeps it: trimmed, one space between words, at most 40 characters. */
export const cleanTag = (tag: string) => tag.trim().replace(/\s+/g, ' ').slice(0, 40);
