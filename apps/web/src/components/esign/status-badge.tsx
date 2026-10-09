import { ESIGN_STATUS_LABELS, type EsignRequestStatus } from '@firmivra/types';
import { Badge } from '@firmivra/ui';

type Tone = 'info' | 'success' | 'warning' | 'danger' | 'neutral' | 'accent';

/**
 * Each status's colour, as in the mockup's Status column. DELIVERED reads "Sent". Partially Signed
 * is purple in the mockup; it is teal until packages/ui has a purple tone.
 */
export const STATUS_TONE: Record<EsignRequestStatus, Tone> = {
  DRAFT: 'neutral',
  NEEDS_APPROVAL: 'warning',
  SENT: 'info',
  DELIVERED: 'info',
  VIEWED: 'info',
  PARTIALLY_SIGNED: 'accent',
  COMPLETED: 'success',
  DECLINED: 'danger',
  EXPIRED: 'warning',
  VOIDED: 'neutral',
};

/** A request's status as a coloured label. */
export function StatusBadge({ status }: { status: EsignRequestStatus }) {
  const tone = STATUS_TONE[status];
  const label = ESIGN_STATUS_LABELS[status];
  // The Badge has no accent tone yet: Partially Signed uses the accent tokens directly.
  if (tone === 'accent') {
    return (
      <span className="inline-flex rounded-pill bg-accent-soft px-3 py-1 text-xs font-semibold text-accent">
        {label}
      </span>
    );
  }
  return <Badge tone={tone}>{label}</Badge>;
}
