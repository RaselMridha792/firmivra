'use client';

import { Card } from '@firmivra/ui';
import { PageState } from '../../../../../components/page-state';
import { useMe } from '../../../../../components/signed-in';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import {
  applicationRows,
  firmRows,
  ResultRow,
  type SearchRow,
} from '../../_components/admin-search';
import { NoApplicationPermission } from '../../applications/_components/application-ui';

function Group({ title, total, rows }: { title: string; total: number; rows: SearchRow[] }) {
  return (
    <Card variant="elevated" className="!p-4">
      <section aria-label={title}>
        <h2 className="text-lg font-bold text-heading">
          {title} ({total})
        </h2>
        {rows.length ? (
          <div className="mt-2 flex flex-col">
            {rows.map(({ key, ...row }) => (
              <ResultRow key={key} {...row} />
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">No {title.toLowerCase()} match.</p>
        )}
        {total > rows.length ? (
          <p className="mt-2 text-sm text-muted">
            Showing the newest {rows.length}. Type more of the name or email to narrow it.
          </p>
        ) : null}
      </section>
    </Card>
  );
}

function Results({ q }: { q: string }) {
  const results = useApiQuery(['admin-search', 'page', q], () =>
    api.firmApplications.search({ q, limit: 50 }),
  );
  return (
    <PageState query={results}>
      {(data) => (
        <div className="grid gap-4 lg:grid-cols-2">
          <Group title="Firms" total={data.firms.total} rows={firmRows(data)} />
          <Group
            title="Applications"
            total={data.applications.total}
            rows={applicationRows(data)}
          />
        </div>
      )}
    </PageState>
  );
}

/**
 * Search (SA-DSH-F01): every firm and application the header search matches, newest first, 50
 * of each; each opens its record. Firms and applications only, never people.
 */
export function SearchResults({ q }: { q: string }) {
  const { me } = useMe();
  if (!me.platformAdmin) return <NoApplicationPermission />;
  const term = q.trim();
  return (
    <div className="flex w-full flex-col gap-5">
      <header>
        <h1
          data-testid="page-title"
          className="font-display text-4xl font-bold tracking-tight text-heading md:text-5xl"
        >
          Search
        </h1>
        <p className="mt-1 text-lg text-muted">
          {term ? `Firms and applications matching “${term}”` : 'Search firms and applications.'}
        </p>
      </header>
      {term.length >= 2 ? (
        <Results q={term} />
      ) : (
        <Card variant="elevated" className="!p-6">
          <p className="text-sm text-muted">
            Type at least 2 characters in the search box: a firm or applicant name, an email, an id,
            or a status such as pending, approved or active.
          </p>
        </Card>
      )}
    </div>
  );
}
