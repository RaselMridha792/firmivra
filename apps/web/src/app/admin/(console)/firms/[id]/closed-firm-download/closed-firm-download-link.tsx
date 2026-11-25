'use client';

import { FirmId } from '@firmivra/types';
import Link from 'next/link';
import { useSearchParams, useSelectedLayoutSegment } from 'next/navigation';
import { useMe } from '../../../../../../components/signed-in';
import { api } from '../../../../../../lib/api';
import { withOrigin } from '../../../../../../lib/origin';
import { useApiQuery } from '../../../../../../lib/query';
import { firmDetailKey } from '../../_components/firm-account';

export function ClosedFirmDownloadLink({ firmId }: { firmId: string }) {
  const segment = useSelectedLayoutSegment();
  const { me } = useMe();
  if (segment || !me.platformAdmin || !FirmId.safeParse(firmId).success) return null;
  return <FirmLink firmId={firmId} />;
}

function FirmLink({ firmId }: { firmId: string }) {
  const search = useSearchParams().toString();
  const firm = useApiQuery(firmDetailKey(firmId), () => api.firmApplications.getFirm(firmId));
  if (firm.data?.status !== 'CLOSED') return null;
  const detail = '/firms/' + encodeURIComponent(firmId);
  return (
    <Link
      href={withOrigin(detail + '/closed-firm-download', detail + (search ? '?' + search : ''))}
      className="mb-3 inline-flex min-h-11 items-center rounded-control border border-border bg-surface px-4 text-sm font-semibold text-link hover:bg-canvas"
    >
      Manage download access
    </Link>
  );
}
