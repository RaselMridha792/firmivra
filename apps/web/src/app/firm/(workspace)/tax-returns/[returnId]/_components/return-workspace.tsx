'use client';

import { ArrowLeft } from '@phosphor-icons/react';
import Link from 'next/link';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';
import {
  ReturnKind,
  StatusBadge,
  TR_ERRORS,
  TR_KEY,
  card,
  dayText,
  outlined,
  quiet,
} from '../../_components/tr-shared';

/** /tax-returns/{id} (Frame 2): the client return workspace. Its tabs follow in the next PR. */
export function ReturnWorkspace({ returnId }: { returnId: string }) {
  const q = useApiQuery([...TR_KEY, 'detail', returnId], () =>
    api.taxReturnWorkspace.get(returnId),
  );
  const r = q.data;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="return-workspace">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href="/tax-returns" className="text-link hover:underline">
          Tax Returns
        </Link>
        {r ? ` › ${r.client.name} › ${r.taxYear} ${r.formType ?? 'Return'}` : null}
      </nav>
      {q.isError ? (
        <p role="alert" className={quiet}>
          This return is not available. {errorMessage(q.error, TR_ERRORS)}
        </p>
      ) : (
        <section className={`${card} flex flex-wrap items-center gap-4`} aria-label="Return">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl font-bold text-heading">
              {r ? r.client.name : 'Loading…'}
            </h1>
            {r ? (
              <p className="text-muted">
                {r.client.maskedId ?? 'ID not on file'} · {r.taxYear} ·{' '}
                {r.dueOn ? `Due ${dayText(r.dueOn)}` : 'No due date'}
              </p>
            ) : null}
          </div>
          {r ? (
            <>
              <ReturnKind row={r} />
              <StatusBadge status={r.workflowStatus} />
            </>
          ) : null}
        </section>
      )}
      <div>
        <Link href="/tax-returns" className={outlined}>
          <ArrowLeft aria-hidden weight="bold" className="size-5" /> Back to Returns
        </Link>
      </div>
    </div>
  );
}
