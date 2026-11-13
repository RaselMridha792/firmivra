'use client';

import { roleCan } from '@firmivra/types';
import { Button, Select } from '@firmivra/ui';
import { UploadSimple } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { useFirm } from '../../../../../../../components/firm-context';
import { useOriginNavigate } from '../../../../../../../components/origin-link';
import { PageState } from '../../../../../../../components/page-state';
import { YearSelect } from '../../../../../../../components/year-select';
import { api } from '../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../lib/query';
import { DocumentList } from './document-list';
import { RequestList } from './request-list';

export function DocumentsScreen({ clientId }: { clientId: string }) {
  const { role } = useFirm();
  const navigate = useOriginNavigate();
  const [category, setCategory] = useState('');
  const [year, setYear] = useState('');
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const cursor = cursors[cursors.length - 1];
  const categories = useApiQuery(['document-categories'], () => api.documents.categories());
  // Keep all years available even when a filter returns no documents.
  const allDocuments = useApiQuery(['client-documents', clientId, '', '', undefined], () =>
    api.documents.list(clientId),
  );
  const documents = useApiQuery(['client-documents', clientId, category, year, cursor], () =>
    api.documents.list(clientId, {
      categoryId: category || undefined,
      taxYear: year ? Number(year) : undefined,
      cursor,
    }),
  );

  return (
    <div className="space-y-4" data-testid="client-documents-screen">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-semibold text-heading">Client documents</h2>
        {/* E8: Documents' own upload, with this client chosen, and Back here. */}
        {role && roleCan(role, 'DOCUMENTS', 'VIEW') ? (
          <Button
            data-testid="upload-document"
            onClick={() => navigate(`/documents/upload?clientId=${encodeURIComponent(clientId)}`)}
          >
            <UploadSimple aria-hidden weight="bold" className="size-4" /> Upload Document
          </Button>
        ) : null}
      </div>
      <PageState query={categories}>
        {(items) => (
          <div className="flex flex-col gap-2">
            <div className="grid gap-4 sm:grid-cols-2" data-testid="document-filters">
              <Select
                label="Category"
                data-testid="document-category-filter"
                value={category}
                disabled={items.length === 0}
                onChange={(event) => {
                  setCategory(event.target.value);
                  setCursors([undefined]);
                }}
                options={[
                  { value: '', label: items.length ? 'All categories' : 'No categories yet' },
                  ...items.map((item) => ({ value: item.id, label: item.name })),
                ]}
              />
              {/* Advisory B12 and B34: rolling years with every year on a document, and a custom one. */}
              <YearSelect
                label="Year"
                testId="document-year-filter"
                value={year}
                empty="All years"
                stored={allDocuments.data?.years ?? []}
                disabled={allDocuments.isPending || allDocuments.isError}
                onChange={(next) => {
                  setYear(next);
                  setCursors([undefined]);
                }}
              />
            </div>
            {items.length === 0 ? (
              // Advisory B12: no categories is a setup step, never an empty list without a word.
              <p className="text-sm text-muted" data-testid="no-categories">
                The firm has no document categories yet. Categories are set up in Documents &gt;
                Settings (they are not Services &amp; Pricing).{' '}
                {role === 'OWNER' || role === 'ADMIN' ? (
                  <Link
                    href="/documents/settings?tab=general"
                    className="font-medium text-action underline"
                  >
                    Add document categories
                  </Link>
                ) : (
                  'Ask an Owner or Admin to add them.'
                )}
              </p>
            ) : null}
          </div>
        )}
      </PageState>
      {allDocuments.isError && (category || year) ? (
        <PageState query={allDocuments}>{() => null}</PageState>
      ) : null}
      <PageState
        query={documents}
        empty={
          category || year
            ? 'No documents match these filters.'
            : 'No documents for this client yet.'
        }
        isEmpty={(data) => data.items.length === 0}
      >
        {(data) => (
          <>
            <DocumentList
              rows={data.items}
              pagination={{
                page: cursors.length,
                hasPrevious: cursors.length > 1,
                hasNext: data.nextCursor !== null,
                onPrevious: () => setCursors((previous) => previous.slice(0, -1)),
                onNext: () => {
                  const nextCursor = data.nextCursor;
                  if (nextCursor) setCursors((previous) => [...previous, nextCursor]);
                },
              }}
            />
          </>
        )}
      </PageState>
      <RequestList clientId={clientId} />
    </div>
  );
}
