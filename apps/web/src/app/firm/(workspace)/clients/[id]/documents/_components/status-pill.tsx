import type { FirmDocument } from '@firmivra/types';
import { Badge } from '@firmivra/ui';

const labels = {
  PENDING: 'Security check in progress',
  CLEAN: 'Security check passed',
  INFECTED: 'Blocked: malware detected',
  FAILED: 'Security check failed',
} satisfies Record<FirmDocument['scanStatus'], string>;

export function StatusPill({ status }: { status: FirmDocument['scanStatus'] }) {
  return (
    <span
      className="inline-block whitespace-nowrap [&>span]:px-2"
      title={labels[status]}
      data-testid="document-status"
    >
      <Badge tone={status === 'CLEAN' ? 'success' : status === 'PENDING' ? 'warning' : 'danger'}>
        {
          { PENDING: 'Scanning', CLEAN: 'Scan passed', INFECTED: 'Blocked', FAILED: 'Scan failed' }[
            status
          ]
        }
      </Badge>
    </span>
  );
}
