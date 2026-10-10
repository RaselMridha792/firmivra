'use client';

import { Select } from '@firmivra/ui';
import { useState } from 'react';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../lib/query';
import { DocumentList } from './document-list';
import { RequestList } from './request-list';

export function DocumentsScreen({ clientId }: { clientId: string }) {
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
      <h1 className="text-2xl font-semibold text-heading" data-testid="page-title">
        Client documents
      </h1>
      <PageState query={categories}>
        {(items) => (
          <div className="grid gap-4 sm:grid-cols-2" data-testid="document-filters">
            <Select
              label="Category"
              data-testid="document-category-filter"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setCursors([undefined]);
              }}
              options={[
                { value: '', label: 'All categories' },
                ...items.map((item) => ({ value: item.id, label: item.name })),
              ]}
            />
            <Select
              label="Year"
              data-testid="document-year-filter"
              value={year}
              disabled={allDocuments.isPending || allDocuments.isError}
              onChange={(event) => {
                setYear(event.target.value);
                setCursors([undefined]);
              }}
              options={[
                { value: '', label: 'All years' },
                ...(allDocuments.data?.years ?? []).map((value) => ({
                  value: String(value),
                  label: String(value),
                })),
              ]}
            />
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
