import type { FirmDocument } from '@firmivra/types';
import { Badge } from '@firmivra/ui';

/**
 * The page's real status: `scanStatus` (malware-scan state), the only per-document status the API
 * has today. The design's words (Completed, Signed, Needs Review, Pending...) describe a review
 * and e-signature workflow that does not exist in the data model yet (R34 PR: documented
 * difference) — this never invents one of those.
 */
const LABEL: Record<FirmDocument['scanStatus'], string> = {
  PENDING: 'Checking',
  CLEAN: 'Verified',
  INFECTED: 'Blocked',
  FAILED: 'Scan failed',
};
const TONE: Record<FirmDocument['scanStatus'], 'success' | 'warning' | 'danger'> = {
  PENDING: 'warning',
  CLEAN: 'success',
  INFECTED: 'danger',
  FAILED: 'danger',
};

export function DocumentStatusBadge({ status }: { status: FirmDocument['scanStatus'] }) {
  return <Badge tone={TONE[status]}>{LABEL[status]}</Badge>;
}
