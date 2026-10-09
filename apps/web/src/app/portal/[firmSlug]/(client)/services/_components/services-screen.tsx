'use client';

import type { MyService } from '@firmivra/types';
import { Tabs } from '@firmivra/ui';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { usePortal } from '../../../layout';
import { ServiceCard } from './service-card';

type Group = 'active' | 'recurring' | 'completed' | 'cancelled';
const GROUPS: [Group, string, string][] = [
  ['active', 'Active Services', 'No active services right now.'],
  ['recurring', 'Recurring', 'No recurring services.'],
  ['completed', 'Completed', 'No completed services yet.'],
  ['cancelled', 'Cancelled', 'No cancelled services.'],
];
const groupOf = (s: MyService): Group =>
  s.status === 'COMPLETED'
    ? 'completed'
    : s.status === 'CANCELLED'
      ? 'cancelled'
      : s.recurring
        ? 'recurring'
        : 'active';

/** /{firm}/services (Octavia's My Services mockup, N06): the client's services by group. */
export function ServicesScreen() {
  const { firmSlug: slug } = useParams<{ firmSlug: string }>();
  const { business } = usePortal();
  const [tab, setTab] = useState<Group>('active');
  const services = useApiQuery(['my-services', slug], () => api.myServices(slug).list());
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <header>
        <h1 className="font-display text-4xl font-bold text-heading">
          My <span className="text-firm-accent">Services</span>
        </h1>
        <p className="text-text">View and manage the services you have with {business.name}.</p>
      </header>
      <PageState query={services}>
        {(items) => (
          <Tabs
            label="Services"
            value={tab}
            onChange={(id) => setTab(id as Group)}
            items={GROUPS.map(([id, label, empty]) => {
              const rows = items.filter((s) => groupOf(s) === id);
              return {
                id,
                label: `${label} (${rows.length})`,
                content:
                  rows.length === 0 ? (
                    <p className="py-6 text-muted">{empty}</p>
                  ) : (
                    <ul className="grid gap-4 py-4 md:grid-cols-2 xl:grid-cols-3">
                      {rows.map((s) => (
                        <li key={s.id} className="min-w-0">
                          <ServiceCard slug={slug} service={s} />
                        </li>
                      ))}
                    </ul>
                  ),
              };
            })}
          />
        )}
      </PageState>
    </div>
  );
}
