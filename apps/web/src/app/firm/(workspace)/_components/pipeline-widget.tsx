'use client';

import Link from 'next/link';
import { api } from '../../../../lib/api';
import { useApiQuery } from '../../../../lib/query';
import { Widget } from './widget';

/** Where people are in the firm's work today: leads waiting, leads in review, active clients. */
export function PipelineWidget() {
  const leads = useApiQuery(['dashboard', 'leads'], () => api.leads.counts());
  const clients = useApiQuery(['dashboard', 'clients'], () => api.clients.list({ limit: 100 }));
  const stages = [
    { label: 'New leads', count: leads.data?.submitted ?? 0, href: '/leads', bar: 'bg-info' },
    { label: 'In review', count: leads.data?.inReview ?? 0, href: '/leads', bar: 'bg-sky' },
    {
      label: 'Clients',
      count: clients.data?.items.length ?? 0,
      plus: Boolean(clients.data?.nextCursor),
      href: '/clients',
      bar: 'bg-gold',
    },
  ];
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <Widget
      title="Client Pipeline"
      query={leads}
      empty="No leads or clients yet. New leads from Begin Online show up here."
      isEmpty={(d) => d.submitted + d.inReview === 0 && clients.data?.items.length === 0}
    >
      {() => (
        <ul className="grid grid-cols-3 gap-3">
          {stages.map((s) => (
            <li key={s.label}>
              <Link
                href={s.href}
                className="flex h-full flex-col gap-2 rounded-control p-2 hover:bg-canvas"
              >
                <span className="text-sm text-muted">{s.label}</span>
                <span className="text-2xl font-semibold text-heading">
                  {s.count}
                  {s.plus ? '+' : ''}
                </span>
                <span className="mt-auto flex h-24 items-end">
                  <span
                    aria-hidden
                    className={`mx-auto w-14 rounded-control ${s.bar}`}
                    style={{ height: `${Math.max(8, (s.count / max) * 100)}%` }}
                  />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}
