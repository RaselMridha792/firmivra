'use client';

import { Input, Select } from '@firmivra/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../../../../../../lib/api';

/**
 * The request's client: search by name, email or phone, then pick. The client from a client
 * record stays chosen even when the search doesn't list it.
 */
export function ClientPicker({
  value,
  onChange,
  fromClient,
}: {
  value: string;
  onChange: (id: string) => void;
  fromClient?: string;
}) {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(q.trim()), 300);
    return () => clearTimeout(timer);
  }, [q]);
  // The names of clients picked from earlier searches, so the choice keeps its label.
  const [names, setNames] = useState<Record<string, string>>({});
  const list = useQuery({
    queryKey: ['clients', 'list', 'esign-pick', search],
    queryFn: () => api.clients.list({ limit: 25, ...(search && { search }) }),
    placeholderData: keepPreviousData,
  });
  const listed = list.data?.items ?? [];
  const from = useQuery({
    queryKey: ['clients', fromClient],
    queryFn: () => api.clients.get(fromClient ?? ''),
    enabled: !!fromClient,
  });
  const chosenName =
    names[value] ??
    (value === fromClient ? (from.data?.displayName ?? 'The client you came from') : undefined);
  const chosen =
    value && !listed.some((c) => c.id === value) && chosenName
      ? [{ value, label: chosenName }]
      : [];
  return (
    <div className="flex flex-col gap-3">
      <Input
        label="Find a client"
        type="search"
        maxLength={100}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <Select
        label="Client"
        value={value}
        onChange={(e) => {
          const c = listed.find((x) => x.id === e.target.value);
          if (c) setNames((n) => ({ ...n, [c.id]: c.displayName }));
          onChange(e.target.value);
        }}
        options={[
          { value: '', label: 'No client (someone outside your client list)' },
          ...chosen,
          ...listed.map((c) => ({ value: c.id, label: c.displayName })),
        ]}
      />
    </div>
  );
}
