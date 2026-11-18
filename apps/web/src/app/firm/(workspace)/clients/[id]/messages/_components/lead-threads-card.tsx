'use client';

import Link from 'next/link';
import { api } from '../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../lib/query';
import { when } from './parts';

/**
 * P4-1 (Leads Review Two 17): the conversations the firm had with this client while they were a
 * lead. They stay on the lead (its Messages tab replies to them); here they are listed, newest
 * first, and open on the lead. Nothing shows for a client who was never a lead.
 */
export function LeadThreadsCard({ clientId }: { clientId: string }) {
  const threads = useApiQuery(['messages', 'client', clientId, 'lead-threads'], () =>
    api.messages.leads.list({ clientId, limit: 25 }),
  );
  const items = threads.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="client-lead-threads" className="flex flex-col gap-2">
      <h3 id="client-lead-threads" className="font-semibold text-heading">
        From when they were a lead
      </h3>
      <ul className="flex flex-col divide-y divide-border rounded-control border border-border">
        {items.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <Link href={`/leads/${t.lead.id}`} className="min-w-0 flex-1 text-link underline">
              {t.subject}
            </Link>
            <span className="text-sm text-muted">{t.lead.displayName}</span>
            <span className="whitespace-nowrap text-sm text-muted">
              {when.format(new Date(t.lastMessage?.createdAt ?? t.createdAt))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
