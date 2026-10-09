'use client';

import type { EsignTemplateRow } from '@firmivra/types';
import { Badge, Checkbox, Input, Table, type Column } from '@firmivra/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EsignGate } from '../../../../../../components/esign/esign-gate';
import { VISIBILITY_LABELS } from '../../../../../../components/esign/field-labels';
import { count, shortDate } from '../../../../../../components/esign/format';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { shouldRetry } from '../../../../../../lib/query';
import { TEMPLATES } from './keys';

const COLUMNS: Column<EsignTemplateRow>[] = [
  {
    id: 'name',
    label: 'Template',
    cell: (t) => (
      <div className="flex flex-col">
        <Link href={`/firm-sign/templates/${t.id}`} className="font-medium text-link">
          {t.name}
        </Link>
        {t.description && <span className="text-sm text-muted">{t.description}</span>}
      </div>
    ),
  },
  {
    id: 'visibility',
    label: 'Who can use it',
    cell: (t) => (
      <Badge tone={t.visibility === 'FIRM' ? 'info' : 'neutral'}>
        {VISIBILITY_LABELS[t.visibility]}
      </Badge>
    ),
  },
  { id: 'owner', label: 'Owner', cell: (t) => t.owner.name },
  {
    id: 'size',
    label: 'Pages and roles',
    cell: (t) => `${count(t.pageCount, 'page')}, ${count(t.roleCount, 'role')}`,
  },
  { id: 'version', label: 'Version', cell: (t) => t.version },
  { id: 'updated', label: 'Updated', cell: (t) => shortDate(t.updatedAt) },
];

/** /firm-sign/templates: the templates the caller may use, newest first. */
export function TemplatesList() {
  return <EsignGate>{() => <Templates />}</EsignGate>;
}

function Templates() {
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  // Typing waits a moment before it searches.
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(q.trim()), 300);
    return () => clearTimeout(timer);
  }, [q]);
  const list = useQuery({
    queryKey: [...TEMPLATES, 'list', search, archived],
    queryFn: () => api.esign.templates.list({ ...(search && { q: search }), archived }),
    // The old rows stay while the next search loads, so the table doesn't flash empty.
    placeholderData: keepPreviousData,
    retry: shouldRetry,
  });
  return (
    <div className="flex flex-col gap-6">
      <h1 data-testid="page-title" className="font-display text-3xl text-heading">
        Signing templates
      </h1>
      <p className="text-muted">
        A template keeps a prepared request&apos;s pages, roles, fields and settings for the next
        one.
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-full max-w-sm">
          <Input
            label="Search templates"
            type="search"
            maxLength={100}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Checkbox
          label="Show archived"
          checked={archived}
          onChange={(e) => setArchived(e.target.checked)}
        />
      </div>
      {list.isError && !list.data ? (
        <p role="alert" className="text-danger">
          {errorMessage(list.error)}
        </p>
      ) : (
        <Table
          caption="Signing templates"
          rows={list.data?.items ?? []}
          columns={COLUMNS}
          rowKey={(t) => t.id}
          loading={list.isPending}
          pageSize={25}
          emptyTitle={archived ? 'No archived templates' : 'No templates yet'}
          emptyText={
            search
              ? 'No template matches that search.'
              : 'Templates saved from a prepared request appear here.'
          }
        />
      )}
    </div>
  );
}
