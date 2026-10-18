'use client';

import { Card } from '@firmivra/ui';
import Link from 'next/link';
import { RequestsTable } from '../../../../../components/esign/requests-table';

/** The dashboard's Recent Documents: five rows, with View All for the full list. */
export function RecentDocuments() {
  return (
    <Card className="min-w-0 p-3!" data-testid="firm-sign-recent-documents">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-heading">Recent Documents</h2>
        <Link href="/firm-sign/requests" className="text-sm font-medium text-link hover:underline">
          View All
        </Link>
      </div>
      <RequestsTable limit={5} caption="Recent documents" compact />
    </Card>
  );
}
