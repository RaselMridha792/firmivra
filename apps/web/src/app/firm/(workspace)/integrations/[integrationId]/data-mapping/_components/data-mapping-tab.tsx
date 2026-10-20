'use client';

import type {
  IntegrationMappings,
  IntegrationSyncDirection,
  SaveIntegrationMappingsRequest,
} from '@firmivra/types';
import { Button, Card, Select } from '@firmivra/ui';
import { ArrowsLeftRight, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { EmptyLine, formatDirection } from '../../_components/manage-integration-shared';
import { integrationError, ManageShell, Notice } from '../../_components/manage-shell';

/**
 * Data Mapping (the spec: LVP Pro field ↔ external field, with Configure Mapping). One card per
 * mapping scope the provider defines (clients, invoices...). Configure Mapping edits a scope's
 * pairs from the provider's own field lists and saves them all at once (PUT .../mappings); a
 * local field is mapped once.
 */

type Scope = IntegrationMappings['scopes'][number];
interface Row {
  /** Only for the list's keys; never sent. */
  id: string;
  localField: string;
  externalField: string;
  direction: IntegrationSyncDirection;
}
const DIRECTIONS: IntegrationSyncDirection[] = ['TWO_WAY', 'IMPORT', 'EXPORT'];

export function DataMappingTab({ integrationId }: { integrationId: string }) {
  return (
    <ManageShell integrationId={integrationId} current="/data-mapping" testId="data-mapping-tab">
      {(detail) => <Mappings integrationId={integrationId} canManage={!!detail?.canManage} />}
    </ManageShell>
  );
}

function Mappings({ integrationId, canManage }: { integrationId: string; canManage: boolean }) {
  const query = useApiQuery(['integrations', 'mappings', integrationId], () =>
    api.integrations.mappings(integrationId),
  );
  const scopes = query.data?.scopes ?? [];
  if (!query.data)
    return (
      <Card title="Data Mapping" data-testid="mapping-scope" className="p-5!">
        {query.isError ? (
          <Notice tone="error" onRetry={() => void query.refetch()}>
            {integrationError(query.error)}
          </Notice>
        ) : (
          <EmptyLine>The field mappings show when they load.</EmptyLine>
        )}
      </Card>
    );
  if (!scopes.length)
    return (
      <Card title="Data Mapping" data-testid="mapping-scope" className="p-5!">
        <EmptyLine>This provider has no fields to map.</EmptyLine>
      </Card>
    );
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {scopes.map((scope) => (
        <ScopeCard
          key={scope.scope}
          integrationId={integrationId}
          scope={scope}
          canManage={canManage}
        />
      ))}
    </div>
  );
}

function ScopeCard({
  integrationId,
  scope,
  canManage,
}: {
  integrationId: string;
  scope: Scope;
  canManage: boolean;
}) {
  const saved: Row[] = scope.pairs.map(({ localField, externalField, direction }) => ({
    id: localField,
    localField,
    externalField,
    direction,
  }));
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<Row[]>(saved);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useApiMutation(
    (body: SaveIntegrationMappingsRequest) => api.integrations.saveMappings(integrationId, body),
    { invalidate: ['integrations'] },
  );
  const label = (list: { key: string; label: string }[], key: string) =>
    list.find((field) => field.key === key)?.label ?? key;
  const free = (current: string) =>
    scope.localFields.filter(
      (field) => field.key === current || !rows.some((row) => row.localField === field.key),
    );
  const update = (index: number, patch: Partial<Row>) => {
    setProblem(null);
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  function submit() {
    if (rows.some((row) => !row.localField || !row.externalField))
      return setProblem('Choose both fields on every row, or remove the row.');
    const pairs = rows.map(({ localField, externalField, direction }) => ({
      localField,
      externalField,
      direction,
    }));
    save.mutate({ scope: scope.scope, pairs }, { onSuccess: () => setEditing(false) });
  }

  return (
    <Card data-testid="mapping-scope" className="flex flex-col gap-3 p-5!">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-heading">{scope.label}</h2>
          <p className="text-sm text-muted">
            {saved.length} {saved.length === 1 ? 'field' : 'fields'} mapped
          </p>
        </div>
        {editing ? null : (
          <Button
            variant="secondary"
            disabled={!canManage}
            onClick={() => {
              setRows(saved);
              setEditing(true);
            }}
          >
            <PencilSimple aria-hidden weight="fill" className="size-4" />
            Configure Mapping
          </Button>
        )}
      </div>
      {save.isError ? <Notice tone="error">{integrationError(save.error)}</Notice> : null}
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      {save.isSuccess && !editing ? <Notice tone="success">Mapping saved.</Notice> : null}

      {editing ? (
        <div className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <div
              key={row.id}
              className="grid items-end gap-2 rounded-control border border-border p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_10rem_auto]"
            >
              <Select
                label="LVP Pro field"
                value={row.localField}
                onChange={(event) => update(index, { localField: event.target.value })}
                options={[
                  { value: '', label: 'Choose a field' },
                  ...free(row.localField).map((f) => ({ value: f.key, label: f.label })),
                ]}
              />
              <Select
                label="Provider field"
                value={row.externalField}
                onChange={(event) => update(index, { externalField: event.target.value })}
                options={[
                  { value: '', label: 'Choose a field' },
                  ...scope.externalFields.map((f) => ({ value: f.key, label: f.label })),
                ]}
              />
              <Select
                label="Direction"
                value={row.direction}
                onChange={(event) =>
                  update(index, {
                    direction: DIRECTIONS.find((d) => d === event.target.value) ?? 'TWO_WAY',
                  })
                }
                options={DIRECTIONS.map((d) => ({ value: d, label: formatDirection(d) }))}
              />
              <Button
                variant="ghost"
                aria-label={`Remove row ${index + 1}`}
                onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
              >
                <Trash aria-hidden weight="fill" className="size-4" />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              variant="ghost"
              disabled={rows.length >= scope.localFields.length}
              onClick={() =>
                setRows((current) => [
                  ...current,
                  {
                    id: crypto.randomUUID(),
                    localField: '',
                    externalField: '',
                    direction: 'TWO_WAY',
                  },
                ])
              }
            >
              <Plus aria-hidden weight="bold" className="size-4" />
              Add Field
            </Button>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                disabled={save.isPending}
                onClick={() => {
                  setRows(saved);
                  setProblem(null);
                  save.reset();
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
              <Button disabled={save.isPending} onClick={submit}>
                {save.isPending ? 'Saving…' : 'Save Mapping'}
              </Button>
            </div>
          </div>
        </div>
      ) : saved.length ? (
        <table className="w-full text-sm">
          <caption className="sr-only">{scope.label}</caption>
          <thead>
            <tr className="border-b border-divider text-left text-xs text-muted">
              <th scope="col" className="py-2 font-medium">
                LVP Pro field
              </th>
              <th scope="col" className="py-2 font-medium">
                <span className="sr-only">Direction</span>
              </th>
              <th scope="col" className="py-2 font-medium">
                Provider field
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {saved.map((row) => (
              <tr key={row.localField}>
                <td className="py-2 text-heading">{label(scope.localFields, row.localField)}</td>
                <td className="py-2 text-center" title={formatDirection(row.direction)}>
                  <ArrowsLeftRight
                    aria-hidden
                    weight="bold"
                    className="inline size-4 text-action"
                  />
                  <span className="sr-only">{formatDirection(row.direction)}</span>
                </td>
                <td className="py-2 text-heading">
                  {label(scope.externalFields, row.externalField)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyLine>No fields are mapped yet. Configure Mapping to match them.</EmptyLine>
      )}
    </Card>
  );
}
